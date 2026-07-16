# Spool v2 融合规划:Desktop ↔ CLI ↔ Web 三端合一

> 背景:PR #449(walking skeleton)之后的下一阶段。三条产品指令:
> ① Desktop 与 CLI 能力对齐——桌面端一键 share 到 hub;
> ② Web 的 session 页直接复用 Desktop 打开 session 的 UI;
> ③ 每个 share 自动关联 .spool 文件,web 可展示。

## 0. 割裂现状盘点

| 能力 | Desktop | CLI | Web |
| --- | --- | --- | --- |
| 分享 | v1 snapshot(styled 快照,`/api/publish`) | v2 hub(records,`/api/hub/v1`) | 两套 reader(`/s/` 与 `/session/`) |
| 会话渲染 | MessageList/MessageBubble(Virtuoso+Markdown) | 纯文本 `spool show` | 自建 timeline(PR #449) |
| 解析 | core parsers(Node) | core parsers | session-kit record-render(简化重写) |
| resume | 按钮拼命令 | `spool resume` 物化+拉起 | 展示复制命令 |
| 认证 | OAuth session bearer | API token / dev token | cookie |

同一件事最多有三份实现。融合的原则:**每层收敛到一个实现,放进能被三端共享的最低层包**。

## 1. 目标架构

```text
session-kit(浏览器安全)     ← 解析大脑:records → Message[](P2 下沉 core parsers 的解析主体)
session-view(新包,React)   ← 渲染大脑:MessageList/MessageBubble/MarkdownContent/CodeBlock(P1 从 app 抽出)
hub-client(新包,Node)      ← 传输大脑:share 管线 + 三步握手 + workspace card(P3 从 cli 抽出)
        ▲                    ▲                     ▲
     Desktop 复用全部三个   CLI 用 kit+client      share-web 用 kit+view
```

## 2. 分阶段

### P1 — 抽出共享会话渲染包 `packages/session-view`(②的核心)

从 app 抽 `MessageBubble` / `MessageList` / `MarkdownContent` / `CodeBlock`(合计 ~900 行,耦合已验证很低:只吃 core 的 `Message` 形状 + lucide + Virtuoso)。改造点:

- 数据驱动:props 只收 `Message[]`-形状数据 + `isDark`;`Message` 类型定义随包走(core 从这里 re-export)。
- i18n:`useTranslation` 改为可注入的 label props(app 注入 i18next,web 给默认英文)——避免把 i18next 拖进 share-web。
- 样式:组件当前用 Tailwind 类。**决策 C1**:session-view 自带一份预编译 CSS(包内跑 Tailwind 构建,产出 scoped 样式表),share-web 只 import 成品 CSS,不引 Tailwind 工具链。
- app 回迁改用该包(视觉零变化,是纯搬家),web `/session/:sid` 的 timeline 面板换成 `MessageList`。diff 面板与首屏保留(那是 hub 特有的)。

### P2 — 解析大脑下沉(①②的地基)

core parsers 的 `node:fs` 只在加载入口,解析主体是纯函数。拆 seam:

- `loadClaudeSession(filePath)` → `readFileSync` + `parseClaudeRecords(raw)`;后者移入 session-kit,core 依赖 session-kit 重导出(行为零变化,现有 core 测试全部保真)。
- share-web 用同一个 `parseClaudeRecords` 把 hub records 聚合成 `Message[]` 喂给 session-view——**web 上看到的会话和 Desktop 完全同源**。
- 我在 PR #449 写的 `record-render.ts` 简化实现随之删除。

### P3 — 传输大脑抽包 + Desktop 一键 share(①的核心)

- `packages/cli/src/hub/{client,share-pipeline,workspace,birth,note,redact-gate}.ts` 抽成 `packages/hub-client`(Node 包,无 commander);CLI 与 app main process 共用。
- Desktop 一键 share:SessionDetail 头部动作区 + Shares 页加 "Share to spool.pro"。
  - 认证零成本(已验证):app 现有 OAuth session bearer 被 `requireHubUser` 直接接受,不需要 API token。
  - redact 闸复用 app 的 Security Scan UI 做确认界面(比 CLI 的 y/N 更好)。
  - note 编辑用一个小 modal(预填逻辑同 CLI)。
- resume 对齐:Desktop 的 resume 按钮对 hub session 走 `spool resume <sid>` 语义;web 页复制命令已改为短 sid 形式。

### P4 — .spool 文件自动关联(③)

.spool = share-kit 的 `SpoolDocument`(策展产物:标题、隐藏轮次、模板设置),与 raw records 互补——records 是原始流,.spool 是出版物。

- wire:head 增加可选 `spoolFileOid`(D1 迁移 0004 + zod + push/head/meta 透传);.spool 内容走 `objects/batch` 与 records 同池存储,内容寻址。
- Desktop share 时:若该 session 已有 Share 编辑器草稿,直接挂它;没有则用 `buildSpoolDocument` 确定性默认值(sanitize: true)。
- CLI:`spool share --spool-file <path>` 可选挂载(CLI 不生成策展物,不硬造)。
- Web:`spoolFileOid` 存在时,session 页加 "Document" 视图(share-kit `SnapshotReader` 渲染,四个模板现成)+ "下载 .spool" 按钮。

## 3. 依赖与切分

P1 与 P3 互相独立、可并行;P2 在 P1 后(session-view 定下 Message 形状);P4 在 P3 后(desktop share 存在后挂载才有意义)。建议 PR 序列:

1. **PR #449 先合**(walking skeleton 已完整、全绿,继续膨胀只会难 review)。
2. PR A = P1+P2(渲染+解析统一,app 视觉零变化 + web timeline 换血)。
3. PR B = P3(hub-client 抽包 + desktop 一键 share)。
4. PR C = P4(.spool 挂载 + web Document 视图)。

## 4. 风险

- **Tailwind→成品 CSS**(P1):类名提取要完整,app 的 purge 配置须包含新包路径;用视觉回归(现有 app e2e 截图)兜底。
- **Virtuoso 在 share-web**:纯 CSR,无 SSR 问题;bundle +~30KB gzip,可接受。
- **parsers 下沉**(P2):core 15 个 schema 迁移的测试全部要保持绿——搬家不改行为,靠现有测试矩阵守护。
- **desktop share 的隐私预期**(P3):桌面用户习惯了 v1 的"策展后发布",v2 是全文直发——确认弹窗必须把差异说清楚(Security Scan 结果 + "分享即全文")。
