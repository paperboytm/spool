# Spool 产品架构

> 本文定义 Spool 当前对外产品边界与各端职责。领域语言以根目录 `CONTEXT.md` 为准，公开叙事以 `docs/spool-positioning.md` 为准。

## 1. 核心定义

Spool 是 agent session 的发布平台，从 coding agent 开始。

系统围绕一个不可替代的对象展开：**Session**。它记录用户与 agent 的对话、工具活动和执行过程，是 agent 工作的权威记录。

五条不变量：

1. 原始 Session 始终是 agent 工作的权威数据。
2. Share 是显式公开边界；本地整理不会自动公开内容，受 Explore 支持的 Session 在确认 Share 后默认 Public。
3. Resume 永远创建新的 Session，不修改来源 Session。
4. 代码的权威在 Git；Spool 保存工作过程和上下文，不承担完整代码仓库的恢复职责。
5. Session 转入 Team 后，托管资产的控制权归 Team；原创作者离开或删除个人账号不会删除该 Team 资产。

## 2. 产品闭环

```text
本地产生 Session
      ↓
准备与安全检查
      ↓
Share：确认后生成持久 URL（初始 Public / Link-only）
      ↓
管理可见性：Public / Link-only / Team · name
      ↓
阅读 Summary / Conversation / Tools / Files / Diff
      ↓
Resume / Fork：创建带 lineage 的新 Session
```

### Share

Share 选中一个 Session 或其前缀，在展示 record 范围和敏感信息检查结果后生成持久 URL。Claude Code 与 Codex CLI Session 默认 Public，可进入 Discovery；Explore 尚未支持的 provider 保持 Link-only。

### Publish

Publish 把 Link-only Shared Session 设为 Public。受支持的新 Share 默认同时完成这一步；Public Session 可以出现在搜索和其他 Discovery 页面中。

### Team visibility

作者可以在 Share 后把 Session 转入一个自己所属的 Team。这个动作把托管资产的控制权转给 Team，并把可见性设为 `Team · {name}`：只有当前成员可以读取，且必须立即清除 Discovery 与公开 engagement projection。Team Owner / Admin 可以把 Team 资产改为 Public 或 Link-only；这会扩大到 Team 之外的受众，因此必须二次确认。Member 没有该披露权限。

### Resume

Resume 拉取并验证来源 Session 的 records，将其物化为新的 provider-native Session，再交给本地 agent 继续。新 Session 记录来源与续接位置；来源 Session 保持不变。

## 3. 系统组成

```text
┌──────────────────────┐
│ CLI                  │
│ 本地准备、检查与分享  │
└──────────┬───────────┘
           │ explicit Share
           ▼
┌──────────────────────┐
│ Hub                  │
│ Session objects      │
│ identity + Teams     │
│ roles + visibility   │
│ lineage + withdrawal │
└──────────┬───────────┘
           │ audience-gated read APIs
           ▼
┌──────────────────────┐
│ Web                  │
│ Homepage + Discovery │
│ Profiles + Teams     │
│ Account + Reader     │
└──────────────────────┘
```

### CLI

作者、agent 和自动化进行本地准备与 Share 的稳定接口：

- `npx @spool-lab/cli share`：创建 Shared Session；
- `npx @spool-lab/cli show`：按摘要、timeline、diff 或 record 阅读；
- `npx @spool-lab/cli resume`：物化并继续 Shared Session；
- `npx @spool-lab/cli withdraw`：撤回访问；
- `npx @spool-lab/cli login/logout`：管理 Hub 凭证；
- `npx @spool-lab/cli sync/search/list/projects`：本地准备与检索。

### Hub

Hub 负责对象存储、身份、可见性和访问边界：

- 保存内容寻址 records 与派生 view；
- 保存 Session head、Summary、workspace card 与 lineage；
- 校验作者、Team membership、角色权限和对象完整性；
- 区分 Link-only、Team-only、Public 与 Withdrawn；
- 保存 Team、membership、invitation 与 Team-owned object 映射；
- 为 Web 和 CLI 提供范围读取；
- 支持 Profile 与 Discovery 所需的公共索引。

Hub 不修改原始 Session 内容，也不替代 Git。

### Web

Web 是发布、Team 管理与消费界面：

- 展示并管理 Public / Link-only / `Team · {name}` 状态；
- 创建 Team，发送 invitation，按 Owner / Admin / Member 管理角色与成员；
- 在账号页管理个人 Session，在 Team 页管理 Team-owned Sessions；
- Homepage 直接展示真实 Public Sessions；
- Discovery 按主题、agent、作者和时间组织内容；
- Profile 展示作者身份与 Public Sessions；
- Session Reader 提供 Summary、conversation/tools、files/diff 和深链；
- Resume/Fork 提供继续工作的入口并展示 lineage。

## 4. 对象模型

### Record

Provider Session 中的一条 canonical record。Record 内容寻址，上传和读取时都可验证完整性。

### Sequence

按顺序连接 records 的不可变序列。Session 前缀可以独立 Share，后续续写不会改变已经分享的边界。

### Session Head

指向当前已分享 Sequence 的可变引用。它保留原创作者归属，同时托管控制权属于个人或一个 Team。它携带：

- sequence root 与 record 数量；
- 作者身份与签名；
- Summary；
- workspace card；
- lineage；
- view object；
- 可选 `.spool` publication document；
- Team ownership（可空）；
- visibility 与 withdrawal 状态。

### Summary

作者或作者的 Local Agent 提供的 Markdown 概览。Summary 帮助读者判断 Session 的意图与结果，但不属于原始 Session，也不能替代 records 中的证据。

### View Object

由 records 确定性推导的紧凑阅读索引，包括章节、文件、摘录与 diffstat。它优化首屏和范围读取，读者可以从 records 重算关键结果。

### `.spool` Document

面向阅读的策展文档，可以选择 turns、应用 redaction、设置版式。它是 presentation artifact，不改变原始 records。

### Lineage

新 Session 指向来源 Shared Session 与续接位置的关系。Session 之间不 merge；每次 Resume/Fork 都创建独立分支。

## 5. 阅读模型

Session 页面按阅读深度组织：

1. **定位**：作者、agent、Summary、状态、文件与 diff 概览。
2. **理解**：conversation 与工具活动解释过程。
3. **验证**：files 与 composed diff 展示实际变化。
4. **引用**：record deep link 落到确切上下文。
5. **继续**：Resume/Fork 创建新的工作分支。

Summary 与机器证据必须分区呈现。公开 metadata 使用作者归属式，例如 `@handle · published 2h ago · Claude Code`。

## 6. Public Profile 与 Discovery

### Profile

Profile 是一个人的公开 agent 工作集合，包含：

- display name、handle、avatar、bio；
- Public Sessions；
- 常见 topics、projects 与 agents；
- Session 的 continuation / lineage 关系。

Link-only 与 Team-only Sessions 不得出现在 Profile、公开数量或空状态文案中。Team-owned Session 只有在 Owner / Admin 明确设为 Public 后才可以进入这些公共表面。

### Discovery

Discovery 只索引 Public Sessions，并支持：

- 关键词与语义检索；
- topic、agent、author、project、time 过滤；
- recent、featured 与 continuation 等集合；
- 在结果中直接显示 Summary 摘录和机器证据。

社区首先是高质量 Session corpus。点赞、评论、关注和算法热度不是建立社区的前置条件。

## 7. Team workspace 与授权

Team 是访问与资产边界，不只是筛选标签：

- WorkOS Organization 承载外部组织、membership 与 invitation；D1 保存产品内的 Team、角色、权限与同步状态；
- 角色为 Owner、Admin、Member。Owner 管理所有权与归档；Owner / Admin 管理邀请、成员、角色、Session 披露与永久 Withdraw；Member 只能读取 Team-only Session 与离开 Team；
- 个人 Session 转入 Team 是明确的资产转移。Team 保留托管资产，即使原创作者离开、被移除或删除个人账号；
- 离开或移除必须让后续 Team-only 请求立即失去访问，同时保留最小 removal block，避免目录同步静默恢复权限；
- 删除个人账号前，用户必须先转移或归档自己仍为 Owner 的活跃 Team。删除流程只物理清理个人资产；Team 引用的对象必须先迁入 Team-owned storage；
- 归档 Team 会关闭 workspace 访问，把其 Session 收回非公开状态，并原子移除所有公共 Discovery / engagement projection。

## 8. 隐私与安全边界

| 状态                   | URL 读取者        | Profile 可见 | Discovery 可见 |
| ---------------------- | ----------------- | ------------ | -------------- |
| Local                  | 无                | 否           | 否             |
| Link-only              | 任何持有 URL 的人 | 否           | 否             |
| Team-only (`Team · …`) | 当前 Team 成员    | 否           | 否             |
| Public                 | 任何人            | 是           | 是             |
| Withdrawn              | 无                | 否           | 否             |

发布边界必须满足：

- Share 前显示 Session、record 范围与敏感信息检查结果；
- Share 前明确说明受支持的 Session 将成为 Public 并进入 Discovery；
- Share 完成后返回 URL 与初始 Public / Link-only 状态；之后的管理界面必须明确显示 Public / Link-only / `Team · {name}`；
- Link-only 不能被称为 private 或 secret；
- Team-only 必须在每次读取时校验登录身份和当前 membership，不能只依赖不可猜测 URL；
- Personal → Team、Team → Public 和 Team → Link-only 都是需要确认的披露变更；Public → Team 在成功响应前必须清除公开 projection；
- Personal Withdraw 立即让当前托管副本拒绝读取并返回 410；visibility 不能恢复，但作者之后可以再次显式 Share 同一 SID。Team-owned Withdraw 是永久墓碑，任何成员都不能通过新 head 复活；两者都无法追回读者已经下载的副本；
- 账号删除物理清理该作者个人拥有的 Hub Sessions、owner-scoped objects 与 packs，优先级高于普通 Withdraw；Team-owned Sessions 与其必要对象保留在 Team storage；
- 全局内容寻址 Manifest 不包含 Session 正文，但可能被多个作者共享。在具备无竞态引用计数或 GC 协议前，账号删除保留 Manifest，不能冒险破坏其他作者的 Session。

## 9. Agent 与代码边界

Spool 记录 agent 工作，不托管 agent 的模型或凭证。Local Agent 使用用户自己的 provider、模型和认证配置。

Spool 可以记录 Session 中出现的代码片段、tool output 和 edits，但完整代码仓库仍由 Git 管理。Resume 可以把 workspace card 交给新 agent 作为复原提示，但不能保证恢复未提交且未被 Session 记录的外部改动。
