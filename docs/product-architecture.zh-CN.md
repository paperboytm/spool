# Spool 产品架构

> 本文定义 Spool 的长期产品边界与各端职责。领域语言以根目录 `CONTEXT.md` 为准，公开叙事以 `docs/spool-positioning.md` 为准。

## 1. 核心定义

Spool 是 agent session 的发布平台，从 coding agent 开始。

系统围绕一个不可替代的对象展开：**Session**。它记录用户与 agent 的对话、工具活动和执行过程，是 agent 工作的权威记录。

四条不变量：

1. 原始 Session 始终是 agent 工作的权威数据。
2. Share 与 Publish 是两个显式动作，本地整理不会自动公开内容。
3. Resume 永远创建新的 Session，不修改来源 Session。
4. 代码的权威在 Git；Spool 保存工作过程和上下文，不承担完整代码仓库的恢复职责。

## 2. 产品闭环

```text
本地产生 Session
      ↓
准备与安全检查
      ↓
Share：生成 Link-only URL
      ↓
Publish：进入 Profile 与 Discovery
      ↓
阅读 Summary / Conversation / Tools / Files / Diff
      ↓
Resume / Fork：创建带 lineage 的新 Session
```

### Share

Share 选中一个 Session 或其前缀，生成持久 URL。新 Share 默认为 Link-only：知道 URL 的人可以访问，但它不会出现在作者 Profile 或 Discovery 中。

### Publish

Publish 把 Shared Session 设为 Public。Public Session 可以出现在作者 Profile、主题集合、搜索和其他 Discovery 页面中。

### Resume

Resume 拉取并验证来源 Session 的 records，将其物化为新的 provider-native Session，再交给本地 agent 继续。新 Session 记录来源与续接位置；来源 Session 保持不变。

## 3. 系统组成

```text
┌──────────────────────┐
│ Desktop / CLI        │
│ 本地准备、检查与发布  │
└──────────┬───────────┘
           │ explicit Share / Publish
           ▼
┌──────────────────────┐
│ Hub                  │
│ Session objects      │
│ identity + visibility│
│ lineage + withdrawal │
└──────────┬───────────┘
           │ public read APIs
           ▼
┌──────────────────────┐
│ Web                  │
│ Homepage + Discovery │
│ Profiles + Reader    │
└──────────────────────┘
```

### Desktop

作者的私有准备与管理界面：

- 读取并组织本地 Sessions；
- 检查要分享的范围与敏感信息；
- 编辑或生成 Summary；
- 执行 Share、Publish、Withdraw；
- 管理自己发布过的 Sessions。

### CLI

供终端、agent 和自动化使用的稳定接口：

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
- 校验作者权限和对象完整性；
- 区分 Link-only、Public 与 Withdrawn；
- 为 Web 和 CLI 提供范围读取；
- 支持 Profile 与 Discovery 所需的公共索引。

Hub 不修改原始 Session 内容，也不替代 Git。

### Web

Web 是公开发布与消费界面：

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

指向当前已分享 Sequence 的可变引用，属于单一作者。它携带：

- sequence root 与 record 数量；
- 作者身份与签名；
- Summary；
- workspace card；
- lineage；
- view object；
- 可选 `.spool` publication document；
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

Link-only Sessions 不得出现在 Profile、公开数量或空状态文案中。

### Discovery

Discovery 只索引 Public Sessions，并支持：

- 关键词与语义检索；
- topic、agent、author、project、time 过滤；
- recent、featured 与 continuation 等集合；
- 在结果中直接显示 Summary 摘录和机器证据。

社区首先是高质量 Session corpus。点赞、评论、关注和算法热度不是建立社区的前置条件。

## 7. 隐私与安全边界

| 状态      | URL 可访问 | Profile 可见 | Discovery 可见 |
| --------- | ---------- | ------------ | -------------- |
| Local     | 否         | 否           | 否             |
| Link-only | 是         | 否           | 否             |
| Public    | 是         | 是           | 是             |
| Withdrawn | 否         | 否           | 否             |

发布边界必须满足：

- Share 前显示 Session、record 范围与敏感信息检查结果；
- Share 完成后先返回 Link-only URL；
- Publish 需要独立确认，明确说明将进入 Profile 与 Discovery；
- Link-only 不能被称为 private 或 secret；
- Withdraw 立即拒绝新的读取，但无法追回读者已经下载的副本；
- 账号删除物理清理该作者的 Hub Sessions、owner-scoped objects 与 packs，优先级高于普通 Withdraw；
- 全局内容寻址 Manifest 不包含 Session 正文，但可能被多个作者共享。在具备无竞态引用计数或 GC 协议前，账号删除保留 Manifest，不能冒险破坏其他作者的 Session。

## 8. Agent 与代码边界

Spool 记录 agent 工作，不托管 agent 的模型或凭证。Local Agent 使用用户自己的 provider、模型和认证配置。

Spool 可以记录 Session 中出现的代码片段、tool output 和 edits，但完整代码仓库仍由 Git 管理。Resume 可以把 workspace card 交给新 agent 作为复原提示，但不能保证恢复未提交且未被 Session 记录的外部改动。
