# Spool v2 读路径详细设计:Share 页面与背后的 Hub

> 深化 [spool-v2-implementation.zh-CN.md](./spool-v2-implementation.zh-CN.md) 的 §3(Hub)与 §6(Web)。
> 回答一个问题:**别人拿到 share URL 之后,打开的那个页面和背后的 server 怎么做。**

## 0. 核心张力与解法

设计稿要求 hub 是哑服务(对象存储 + refs + ACL,不理解内容),但首屏要"回答这是什么、值不值得看"——文件清单、章节大纲、diff 统计都需要扫全部 records。一个几千条 record、几十 MB 的 session,访客不可能先下载全量再渲染首屏。

**解法:view object(视图对象)。** `spool share` 时,作者侧 CLI 用 session-kit 从 records 确定性推导出一个紧凑索引对象,作为普通内容寻址对象随 push 上传,OID 挂在 head 元数据上。hub 只存储、从不计算——依然是哑的;web 首屏只需 2 个请求;CLI 和 web 用同一份 session-kit 代码推导,满足"web 是 CLI 的投影"。

view object 内容(全部可从 records 重算,作者篡改可被重算揭穿):

```jsonc
{
  "v": 1,
  "index": [
    // 每条 record 一行:类型/尺寸/触碰文件,不含正文
    { "i": 0, "kind": "user", "ts": "...", "size": 812, "excerpt": "修复 OAuth 回调…" },
    { "i": 7, "kind": "edit", "file": "src/auth/pkce.ts", "size": 4096 },
    { "i": 8, "kind": "tool", "tool": "Bash", "size": 20480 },
  ],
  "files": [{ "path": "src/auth/pkce.ts", "events": [7, 12, 31], "adds": 40, "dels": 6 }],
  "outline": [{ "i": 0, "excerpt": "…" }], // user prompts 章节大纲
  "firstPrompt": "…(截断 4KB)…",
  "lastReply": "…(截断 4KB)…",
  "diffstat": { "files": 12, "adds": 340, "dels": 85 },
}
```

尺寸量级:1 万条 record ≈ 1MB(gzip 后远小),设 8MB 上限,超限时 web 退化为分页扫描。

## 1. 请求全景

```text
访客浏览器 ── spool.pro/session/<sid>
      │
spool-pro-router(现有 Worker,加一条路由)
      ├── /session/* ─→ share-web(Pages)
      │      functions/session/[sid].ts   ← SSR 注入 OG meta(爬虫)
      │      SPA SessionReader            ← 真实渲染
      └── /api/hub/* ─→ share-backend(Pages Functions)
             ├─ D1: hub_sessions / hub_objects / user_pubkeys / api_tokens
             └─ R2: packs / manifests / views
```

## 2. Hub 存储模型

对象小而多(record 平均几 KB),逐条存 R2 会让一次页面浏览打出几千次 GET。参照 git packfile:

```text
R2  hub/packs/<user>/<push-id>     一次 push 的 records 顺序拼接(未压缩,保 ranged GET;传输层靠 CF brotli)
R2  hub/manifests/<root>           sequence 清单:OID 列表,按 root 内容寻址,不可变
R2  hub/views/<view-oid>           view object
D1  hub_sessions(sid PK, owner_user_id, root, record_count, sig,
                 card_json, note_md, lineage_json, view_oid,
                 visibility, withdrawn_at, created_at, updated_at)
D1  hub_objects(owner_user_id, oid, size, pack_key, offset, length,
                PRIMARY KEY(owner_user_id, oid))          ← 去重按用户隔离,见 §5
```

关键性质:**sequence root 定义在 record OID 之上**(`node_i = H(node_{i-1} ‖ oid_i)`),所以 hub 拿 manifest 折叠一遍哈希就能验证 root,不需要读任何正文;record 正文哈希在上传时逐条校验。哑服务 + 端到端完整性两不误。

前缀分享不需要额外机制:`share @120` 就是把 head 推到位置 120 的链根,hub 存的 head 即"已发布的边界"。作者后续 re-share 才会推进;作者也允许回推(rewind 属于 owner 权利)。

## 3. 写路径(share 的三步握手,决定读路径的形状)

```text
1. POST /api/hub/v1/sessions/:sid/push
     body: { root, count, manifest: [oid…], sig, card, note, lineage, view_oid }
     ← hub 折叠 manifest 验 root、验签名、按 (owner,oid) 对比 → { missing: [oid…] }
2. POST /api/hub/v1/objects/batch        (可多轮,幂等,断点续传天然成立)
     body: NDJSON,每行一条 canonical record(或 view/manifest 对象)
     ← hub 逐条 sha256 校验 ∈ missing,顺序写入新 pack,登记 hub_objects 偏移
3. POST /api/hub/v1/sessions/:sid/head
     ← 校验对象齐全 → 原子更新 hub_sessions,返回 URL
```

配额与限制:per-push ≤ 100MB、per-user 总量 ≤ 1GB(D1 计数)、view ≤ 8MB;record 本身不设上限(canonical bytes 不可截断,截断即变 OID),巨型 record 靠配额约束、web 端渲染时截断。

## 4. 读路径(访客打开页面时真正发生的事)

```text
GET /api/hub/v1/sessions/:sid          → head 元数据 + 作者档案(handle/头像,复用 profiles)
                                          404=不存在或 private;410=墓碑(返回下架页数据)
                                          Cache: no-store(墓碑必须即时生效)
GET /api/hub/v1/sessions/:sid/view     → view object;ETag=view_oid,max-age=3600
GET /api/hub/v1/sessions/:sid/records?from=0&to=200
                                       → NDJSON 流:查 manifest 取 [from,to) 的 OID,
                                          按 pack 分组做 R2 ranged GET,顺序流出
                                          clamp 到 record_count;每次 ≤500 条 / 8MB
                                          ETag=root+range,max-age=3600
```

- **首屏 = 2 个请求**(meta + view),正文一个字节都不用拉。首条 prompt / 末条回复的摘录就在 view 里。
- **ACL**:default private(hub 上根本没有,share 即上传+unlisted);unlisted = 拿 URL 即可读,sid 含 122 位随机 UUID,capability URL 语义,与现有 snapshot 一致。访客不需要账号。
- **墓碑**:withdraw 置 `withdrawn_at`,meta 立即 410;view/records 拒读;R2 对象保留(OID 保留、正文拒读)。已缓存的 records 有 ≤1h 尾巴(附带 CF purge API 尽力清除)——诚实边界:已下载者本就无法追回。注意这与 v1 revoke(物理删除)语义不同;**账号删除流程(deletion-worker)必须扩展为物理清除 hub 对象**,合规删除高于墓碑语义。
- **CDN 缓存**:view/manifest/records 按内容寻址天然不可变,ETag + max-age=3600;meta 永不缓存。

## 5. 安全细节

- **去重预言机**:若按全局 OID 去重,攻击者可构造 record 探测"别人是否上传过内容 X"(Dropbox 式 dedup attack)。所以 `hub_objects` 主键含 `owner_user_id`,missing 计算只对本人对象——牺牲跨用户去重,换隐私。
- **单写者**:head 推进要求 cookie/token 属 owner 且 Ed25519 签名验证通过(公钥在 login 时注册,存 user_pubkeys)。
- **速率限制**:读端点复用现有 RATE KV 中间件;push 端点按用户限频。
- **lineage 引用私有 session**:fork 的 lineage 指向源 sid,页面上源未分享时只显示"fork 自未公开 session",不泄露内容。

## 6. Web:SessionReader 三层实现

路由 `/session/:sid`(`/s/` 留给 v1 快照)。组件结构:

```text
share-web/src/pages/SessionReader.tsx
  ├─ FirstScreen      note(作者自述区)‖ 机器证据区(diffstat/card/文件清单/大纲)
  │                    + 状态 + resume 命令一键复制(spool resume <本页URL>)
  ├─ TimelinePane     虚拟列表:view.index 预知每条 kind/size(行高可预估),
  │                    滚动时按窗口拉 records 范围;巨型 record 渲染截断+展开
  ├─ DiffPane         按文件惰性:view.files[].events → 只拉该文件的 edit records
  │                    → session-kit 客户端合成净 diff(首触前 vs 末离后)
  │                    联动:点 hunk → timeline 滚到产生它的 record;点 tool call → 高亮 hunk
  └─ #r/<idx> 深链    hash 路由:拉 idx 邻域范围,定位展开(spool why 跳转的落点)
```

- **note 三级退化**在 FirstScreen 实现:note → 末条回复 → 首条 prompt + 末条回复(数据都在 view 里,零额外请求)。
- **诚实分区**:note 是作者主观自述,与机器证据(diffstat、card、文件清单)分区渲染,视觉上不混排——设计稿 §3.2 的硬要求。
- **session diff 在客户端算**:hub 不代算(哑服务),CLI 的 `show --diff` 与页面跑同一个 `session-kit.composeSessionDiff()`。作者上传的 diffstat 只用于首屏概览,进入 diff 层即被重算覆盖——view 撒谎会当场露馅。
- **OG/社交预览**:`functions/session/[sid].ts` 服务端注入 meta(标题取 note 首行,退化到首条 prompt 摘录),OG 图复用 workers-og,数据来自 view。
- **DESIGN.md 适配**:record 正文/路径/命令用 Geist Mono;warm amber 强调色;注意「第一人称 metadata」规则是给 owner 本人的库用的,**share 页读者是别人**,metadata 用作者归属式(`@handle · shared 2h ago`),这是对 DESIGN.md 的一处有意扩展,需在文档里补记。
- 无 CLI 的访客:页面就是完整消费界面;resume 命令旁附安装指引链接(landing 已有)。

## 7. 实施位置与 PR 切分

| #   | PR                                                                            | 位置                     | 依赖    |
| --- | ----------------------------------------------------------------------------- | ------------------------ | ------- |
| 1   | session-kit:view 推导 + composeSessionDiff + golden 测试                      | packages/session-kit     | Phase 1 |
| 2   | hub 写路径:迁移 0003 + push/batch/head(hermetic 测试;R2 fake 需补 ranged GET) | share-backend            | 1       |
| 3   | hub 读路径:meta/view/records + ACL/墓碑/缓存 + pentest 项                     | share-backend            | 2       |
| 4   | CLI `spool share` 接线(note 编辑器 + redact 闸 + 三步握手)                    | cli                      | 2       |
| 5   | Reader 第一层:FirstScreen + OG + 路由(router 加 /session/*)                   | share-web, router        | 3       |
| 6   | Reader 第二三层:Timeline/Diff/深链                                            | share-web                | 5       |
| 7   | withdraw + /me 管理列表 + 账号删除扩展                                        | share-backend, share-web | 3       |

集成测试基线:一个 fixture session 走完整 round-trip——本地 store → 三步握手推到 fakes → 读端点逐个断言 → session-kit 在"浏览器侧"重算 diff 与作者侧一致。

## 8. 本文档新增的决策点

- **D7 view object**:作者算、hub 存、读者可重算揭穿。替代方案(hub 现算/纯客户端扫全量)分别违反哑服务原则/首屏性能,不取。
- **D8 pack 不压缩存储**:保 R2 ranged GET 可用,传输压缩交给 CF;存储成本换读路径简单性。
- **D9 去重按用户隔离**:防 dedup 预言机,放弃跨用户去重。
- **D10 墓碑缓存尾巴 ≤1h**:withdraw 即时生效于 meta,正文缓存自然过期 + 尽力 purge。
- **D11 share 页 metadata 用作者归属式**而非第一人称,需补记 DESIGN.md。
