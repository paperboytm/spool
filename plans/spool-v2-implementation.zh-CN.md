# Spool v2 实施规划

> 依据:[docs/spool-v2-design.zh-CN.md](../docs/spool-v2-design.zh-CN.md)。
> 状态:草案,待确认「开放决策」一节后动工。

## 0. 现状盘点(2026-07)

v2 三部件(Store / Hub / Trace)在现有代码里的对应物:

| v2 部件                                        | 现状                                                                      | 可复用                                                                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Store(内容寻址对象库、sequence、head、lineage) | **不存在**。core 是关系型 FTS 索引(`~/.spool/spool.db`,schema v15)        | `Syncer` 的目录扫描、增量游标、append/rewrite 分类器(`core/src/sync/syncer.ts`);workspace 识别(`core/src/projects/`) |
| Hub(对象存储 + refs + ACL + 墓碑)              | **不存在**。share-backend 是 v1 快照发布(D1/KV/R2,styled snapshot)        | 全套 Cloudflare 基建:Google OAuth(loopback PKCE + web)、D1 迁移、R2、hermetic 测试 fakes、`spool-pro-router` 路由    |
| Trace(版本链、blame/why)                       | **不存在**。且 v1 parsers 丢弃 tool_use 输入(只留 `contentText` + 工具名) | 无直接可复用;但 store 落地后 trace 只依赖 store 的 canonical records,**不需要**改 v1 parsers                         |
| CLI(v2 命令表)                                 | `search/sync/list/show/status/pin/projects/doctor`(v1 检索工具)           | commander 骨架;`show` 可升级                                                                                         |
| Web(session 页三层结构)                        | share-web 渲染 v1 快照(`/s/:id`)                                          | SPA 骨架、OG SSR Function、reader 组件模式                                                                           |
| Resume 物化                                    | 只有「跳转原生 CLI」(`app/src/main/sessionResume.ts`)                     | `insertSpoolAuthoredSession` + `spool-prelude.ts` 是「Spool 写 provider 原生 session 文件」的既有先例                |

v1 产品(Electron 检索 app、快照分享)继续照常运行,v2 全部是**增量**,不动存量。

## 1. 架构落位:包结构

```text
packages/
  session-kit/     ★新增。浏览器安全的纯 TS 库,v2 的“通用语言”:
                     record 类型与 canonical JSON、sha256(WebCrypto)、
                     sequence 链、edit-event 抽取、session diff 计算。
                     被 core / cli / share-web / share-backend 四方消费。
  core/
    src/store/     ★新增模块。本地对象库(store.db):objects/heads/lineage/
                     workspace card;挂在 Syncer 摄入管线上。
    src/trace/     ★新增模块。版本链 + blame(trace.db + blob cache),只依赖 store。
  cli/             扩展:share/resume/blame/why/withdraw/login/logout + show 升级。
  share-backend/   扩展:/api/hub/v1/* 端点族 + 新 D1 迁移(复用 auth)。
  share-web/       扩展:v2 session 页(三层结构),消费 session-kit。
```

**为什么必须有 session-kit**:core 依赖 better-sqlite3(native),不能进浏览器/Workers;而 web 页和 hub 都需要解析 records、算 session diff、验哈希。把纯逻辑抽成零依赖包是整个方案成立的关键接缝。CLI 与 web 对同一 session 的展示(首屏/timeline/diff)必须走同一套推导函数,这也直接满足设计稿规则 4「web 是 CLI 的投影」。

## 2. Store 设计要点

### 2.1 Record 与 canonicalization(先定规范,再写代码)

- record = provider JSONL 的一行,**canonical 化后取 sha256 为 OID**。
- Canonical 规则(需要一份独立 spec + golden fixtures):JSON 按 JCS(RFC 8785)风格重排(键排序、最小空白、UTF-8),使 provider 仅改动格式的重写不破坏前缀。
- **路径重写发生在摄入时**(见开放决策 D1):workspace 绝对路径 → `$WS` 占位符;workspace 根路径只存本地 workspace 表,不进 record、不上 hub。这样 OID 跨机器稳定,且 share 天然不泄露本机路径。

### 2.2 Sequence 与 head

- sequence 用哈希链(`node_i = H(node_{i-1} ‖ record_oid_i)`),git-commit 式前缀共享;位置即下标,支持 `@120` 前缀分享。MVP 不需要 Merkle 树的 O(log n) 证明。
- provider 截断/重写:复用 Syncer 的 append/rewrite 分类;发现分叉点后从分叉处重算链,旧 records 仍在对象库中(内容寻址,无损失)。
- head:`heads(session_id, root, count, card_json, summary_md, lineage_json, sig, updated_at)`。签名用 Ed25519(`@noble/ed25519`),首次使用生成机器密钥于 `~/.spool/key`,`spool login` 时把公钥注册到 hub 账号。
- spool-session-id = `<provider>:<provider-uuid>`,展示用短哈希(`#a3f2`)。
- 存储形态:独立 `~/.spool/store.db`(sqlite,WAL,zstd 压缩 blob 列)。不用文件系统扇出目录——records 小而多,单文件库更快也好清理。

### 2.3 摄入

Syncer 每次扫描,除喂 v1 索引外,同时把原始行切分 → canonical 化 → 入库 → 推进 head,并读取 workspace git 信息生成 workspace card(remotes/branch/head/dirty/observed)。MVP 范围只做 **claude + codex** 两个 adapter(gemini/opencode 后置)。

## 3. Hub 设计要点(server)

> 读路径(share 页 + server)的详细设计见 [spool-v2-hub-web.zh-CN.md](./spool-v2-hub-web.zh-CN.md)。

落在 share-backend 里新开 `/api/hub/v1/*`,复用现有 OAuth、D1、R2、hermetic 测试基建。**不新建服务**;`spool-pro-router` 已把 `/api/*` 指到 backend,零路由改动。

### 3.1 端点

```text
POST /api/hub/v1/sessions/:sid/head      推进 ref:{root,count,card,summaryMd,lineage,sig,prefix_limit}
                                          → 校验 owner+签名+单调推进,返回缺失 record OID 列表
POST /api/hub/v1/objects/batch           批量上传 records(服务端逐个验哈希,写 R2)
GET  /api/hub/v1/sessions/:sid           head 元数据(尊重墓碑与 prefix_limit)
GET  /api/hub/v1/sessions/:sid/records?from=0&to=120   NDJSON 流式批量读
POST /api/hub/v1/sessions/:sid/withdraw  墓碑:OID 保留、正文拒读(≠ 现有 revoke 的物理删除)
POST /api/hub/v1/tokens                  CLI 长效 token(login 流程内部使用)
```

同步协议即 git 的 have/want 极简版:客户端报 head + OID 清单,服务端答缺哪些,客户端补传。幂等、可断点续传。

### 3.2 存储(新 D1 迁移)

```sql
hub_sessions(sid PK, owner_user_id, head_root, record_count, prefix_limit,
             card_json, note_md, lineage_json, pubkey_id, visibility,
             withdrawn_at, created_at, updated_at)
hub_objects(oid PK, size, r2_key, created_at)        -- 去重/存在性检查
user_pubkeys(id PK, user_id, pubkey, created_at)
api_tokens(id PK, user_id, token_hash, label, created_at, last_used_at)
```

R2 新 bucket(或前缀)`hub-objects/<oid>`。ACL 沿用 owner + `visibility ∈ {private, unlisted}`,默认 private,share 即转 unlisted(拿 URL 可读)。

### 3.3 CLI 认证

`spool login` 复刻 app 的 loopback PKCE 流程(`app/src/main/auth/` 已有完整实现可移植),换取长效 API token 存 `~/.spool/credentials`。web 端继续用 cookie session。

## 4. Share / Resume(CLI 侧)

- `spool share [<id>][@<n>]`:先跑 redact 闸并推 head + 补传对象，URL 成功后再检测 Claude Code/Codex CLI；通过 Clack 询问/选择本地 Agent，临时调用生成 Markdown Summary，完成后自动二次推进 head。`--summary` 是高级旁路，`--no-agent-summary` 跳过询问。
- **share 前跑 redact 扫描**(复用 `@spool-lab/redact`,core 已有 scan 管线):发现高危 finding 时警示、要求确认。设计稿说「分享即分享全文」,这一道闸是必要的产品诚实,与 app 端 Security Scan 对齐。
- `spool resume <url|id>[@<n>]`:拉取 → 物化为**全新** provider 原生 session 文件(新 UUID,`$WS` 反向映射到本地 workspace 根;无 checkout 时用 cwd)→ 追加唯一一条 Spool 出生记录(resume note:来源 URL/作者/@位置 + workspace card 全文 + 给 agent 的复原提示)→ 登记 lineage → exec `claude --resume` / `codex resume`。物化机制沿 `spool-prelude.ts` 的先例扩展。
- **最大风险在这里**:物化文件必须被 provider CLI 原生接受,且 provider 格式随版本漂移。对策:Phase 0 先做 spike 验证可行性;之后用版本钉住的 golden round-trip 测试守护(fixtures 摄入 → 物化 → `claude --resume <id> -p "ok"` 单轮验收)。

## 5. Trace 设计要点

只依赖 store 的 canonical records(完整 JSON 都在,**不需要动 v1 parsers**):

1. **事件抽取**(session-kit):Claude 的 Edit/Write/MultiEdit/NotebookEdit `tool_use` + 配对成功 `tool_result`;Codex 的 `apply_patch`。产出:路径(workspace 相对)、old/new 或全文、ts、session@record。
2. **链构建**(core/trace):按内容链接(pre_blob == 上一版 post_blob),锚点 = 首个 Write 或磁盘扫描 blob;apply 失败插 external version、事件挂 floating。产物 `~/.spool/trace.db`(versions/hunks 表)+ zstd blob cache;git 对象库借用(spool OID → git blob OID 映射,`git cat-file` 取基底)。全部可重建、可删。
3. **查询**:磁盘内容 diff 到链尾对齐行号,从新到旧走链输出每行的 [出生 + 历次修改] 链。行级 diff 用现成 Myers 实现(`diff` npm 包级别即可)。
4. **指纹兜底**(n-gram shingle 倒排,suspected 档):**后置**,不进 MVP 关键路径。

CLI:`spool blame <path>[:<line>]`(`--porcelain`/`--json`)、`spool why <path>:<line>`(blame 单行 + 跳转 show 到出生 record)。

## 6. Web(share 页)

share-web 新增 v2 路由(建议 `/session/:sid`,`/s/` 留给 v1 快照;见 D4),严格按设计稿 §5 三层:

1. **首屏(定位)**:Markdown Summary（三级退化:Summary → 末条回复 → 首条 prompt+末条回复）+ 文件清单 + 章节大纲 + 状态 + resume 命令(一键复制)。Summary 与机器证据(diff 统计、card)分区渲染。
2. **第二层(消费)**:timeline ↔ session diff 双栏联动(点 hunk ↔ 点 tool call 互跳)。session diff = diff(首次触碰前, 最后离开后),由 session-kit 在**客户端**计算——hub 保持哑服务,不代算。
3. **第三层(考古)**:`#r/<idx>` 深链,带上下文展开。

OG 图复用 workers-og 管线。UI 遵循 `DESIGN.md`(Geist Mono 渲染 record 内容、warm amber、first-person metadata)。编辑器 gutter 注记(消费 `blame --porcelain`)为独立后续项目,不进本轮。

## 7. 分阶段实施

```text
Phase 0 ── spike(风险前置,~几天)
  S0.1  canonicalization spec + 真实 Claude/Codex 日志 golden fixtures
  S0.2  resume 物化 spike:手写物化器,证明 claude --resume / codex resume 接受
        ⛔ 不通过则重估 v2(resume 是三支柱之一)
  S0.3  存储量实测:全量摄入自己机器的 sessions,看 store.db 尺寸(zstd 后)

Phase 1 ── Store(core + session-kit)          ←基础,串行
  P1.1  session-kit 包:record 模型/canonical/哈希/sequence/类型
  P1.2  core/store:store.db、Syncer 挂钩、head、workspace card
  P1.3  CLI:spool 默认列表、show 升级(@r<n>、--log、--diff)
  验收:fixture 目录摄入幂等;截断/重写用例;--diff 与手工 diff 一致

Phase 2 ── Hub + Share/Resume                  ┐
  P2.1  backend:迁移 + objects/head/withdraw 端点 + token(hermetic 测试 + pentest 项)
  P2.2  CLI:login(loopback PKCE)、share(Summary 编辑器 + redact 闸)  │ 与 Phase 3
  P2.3  CLI:resume 物化 + lineage;双 HOME 跨机器 round-trip e2e     │ 并行
  P2.4  withdraw + 前缀分享                                        │
                                                                  │
Phase 3 ── Trace(只依赖 Phase 1)               ┘
  P3.1  事件抽取(session-kit)
  P3.2  链构建 + trace.db + 磁盘锚点 + git blob 借用
  P3.3  blame/why CLI + --porcelain
  P3.4  指纹索引(可延后)

Phase 4 ── Web(依赖 Phase 2)
  P4.1  公开读路径(view 数据全走 records 端点,客户端推导)
  P4.2  reader 三层 + #r 深链 + OG
```

每个 P 项对应一个(或一组 stacked)PR,遵循仓库测试纪律:typecheck → 新测试 → 相邻套件 → 抖动测试压测。粗量级:P0 数天;P1 一~~两周;P2、P3 各两~~三周(可并行);P4 一~两周。

## 8. 风险清单

| #   | 风险                                             | 对策                                                                |
| --- | ------------------------------------------------ | ------------------------------------------------------------------- |
| R1  | provider 格式漂移;物化 session 不被原生 CLI 接受 | Phase 0 spike 前置;版本钉住 golden round-trip 测试;adapter 带版本号 |
| R2  | 路径重写 vs OID 稳定性冲突(share 时改写会变哈希) | 摄入时 canonical 化(D1 决策),record 从一开始就不含绝对路径          |
| R3  | store 体积 ≈ 再存一份全量 transcript             | zstd + S0.3 实测;必要时 Read 输出类 record 单独压缩策略             |
| R4  | provider 重写历史破坏前缀/单写者假设             | 分叉点重算链;对象库无损保留旧 records                               |
| R5  | native 依赖(better-sqlite3)混入浏览器路径        | session-kit 零依赖硬边界;CI 加 browser build 检查                   |
| R6  | 分享全文泄密                                     | share 命令内嵌 redact 扫描闸;withdraw 墓碑兜底                      |

## 9. 开放决策(建议值,确认后动工)

- **D1 路径重写时机**:建议**摄入时** canonical 化(`$WS` 占位符)。设计稿 §3「resume 时重写」与 §5「share 时重写掉」存在张力,摄入时统一解决且保 OID 稳定。
- **D2 v1 CLI 命令去留**:建议保留 `search/sync/list` 等(app 与既有用户在用),v2 命令表增量加入;设计稿的「命令表 = 架构投影」理解为 v2 域内约束。
- **D3 签名进 MVP?**:建议**进**(Ed25519 极便宜),避免 head 格式后期迁移。
- **D4 web URL 命名空间**:建议 `/session/:sid`,`/s/` 留给 v1 快照。
- **D5 hub 落位**:建议扩展 share-backend(复用 auth/D1/测试基建),不另起服务。
- **D6 provider 范围**:建议 MVP 只做 claude + codex,gemini/opencode 后置。
