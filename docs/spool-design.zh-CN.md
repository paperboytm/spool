# Spool 设计

> English: [spool-design.md](./spool-design.md)

## 1. 一句话说明

Git 在 `.git` 中保存代码历史。每个 commit 指向一棵代码树，checkout 时，Git 根据这棵树把代码恢复到工作目录。

Spool 做同样的事，只是保存的不是代码，而是 agent sessions。

```text
Git commit
├── tree <oid>             → 当时的代码
└── spool-snapshot <oid>   → 当时的 sessions
```

commit 中只保存 session snapshot 的地址。session 正文保存在 Spool 自己的对象库中。

因此，一个 commit 同时回答两个问题：

- 当时的代码是什么？
- 当时相关的 sessions 进行到了哪里？

### 1.1 Spool CLI

Spool 是建立在 Git 语义和对象模型上的新 CLI。用户的主要入口是：

```bash
spool init
spool commit
spool checkout <commit-ish>
spool push <remote> <refspec>
spool clone <url>
spool resume [<session-id>]
```

Spool 不是只实现上面几条命令。所有常用 Git 命令和参数都通过同一个入口提供，例如：

```bash
spool status
spool diff
spool log
spool branch
spool merge
spool rebase
```

不涉及 sessions 的命令保持 Git 原有语义、输出和退出码。涉及 session 生命周期的命令保持 Git 参数和代码语义兼容，但可以增加文档化的 Spool 诊断与失败状态。用户正常工作时不需要在 `git` 与 `spool` 两个 CLI 之间切换。

`spool` 是命令名；`origin` 等才是 remote 名。remote 不需要叫 `spool`。

Spool 复用 Git 的 tree、commit、refs、diff、merge、签名和传输能力，并在 session-aware 命令上增加 snapshot 行为。原生 `git` 命令仍能读取和操作这些 Git objects，但它只理解代码，不提供 Spool 的 session 保证。

## 2. 本地存储

Git 和 Spool 各自维护一套对象库：

```text
$GIT_COMMON_DIR/
├── objects/                 Git 对象库
│   ├── commit
│   ├── tree
│   └── blob
│
└── spool/
    ├── objects/             Spool 对象库
    │   ├── snapshot
    │   ├── sequence
    │   ├── occurrence
    │   └── provider record
    ├── index/               可重建的查询索引
    └── identity/            本机 session 身份映射
```

Git object 和 Spool object 都通过内容 hash 命名。在同一个 hash domain 内，canonical bytes 相同才会得到相同 OID，因此不需要重复存储或重复传输。

Spool 对象默认放在 `$GIT_COMMON_DIR/spool`。这样普通 clone、单仓库多 worktree 和 bare repo 可以共用一份 Spool 对象库；linked worktree 中的 `.git` 可能只是一个指向 common directory 的文件。

每个 worktree 独有的扫描游标和临时状态单独保存，不能把一条跨 worktree 的 session 切成多个 session。

## 3. Commit 怎样记录 Sessions

Spool 给 Git commit 增加几个 header：

```text
tree <git-tree-oid>
parent <parent-commit-oid>
author ...
committer ...
spool-version 1
spool-coverage complete
spool-snapshot captured sha256:<snapshot-oid>

commit message
```

一个 commit 关联多个 sessions，就写多个 `spool-snapshot`：

```text
spool-snapshot captured sha256:<snapshot-a>
spool-snapshot captured sha256:<snapshot-b>
```

这些 header 是 commit 内容的一部分。Git 会用包含这些 header 的完整内容计算 commit OID。

因此，事后修改 session 关联会得到另一个 commit OID。服务器或数据库不能偷偷改变原 commit 与 session 的关系。

签名也必须覆盖这些 header。流程是先加入 Spool headers，再让 Git 执行原有的 GPG 或 SSH signing。

### 3.1 为什么不把完整 Session 塞进 Commit

完整 session 可能有几十或几百 MB。直接塞进 Git 会让 clone、fetch、GC 和代码仓库都变重。

commit 只保存几十字节的 snapshot OID。真正的内容继续放在 Spool 对象库，按需下载。

### 3.2 为什么不能互相引用

关系必须是单向的：

```text
commit → session snapshot
```

snapshot 不能反过来保存这个 commit OID。因为 snapshot OID 要先生成，commit 又需要 snapshot OID，两边互相等待会形成 hash 循环。

commit 生成后，可以建立反向查询索引。但这个索引只是为了查得快，删除后可以重新生成。

## 4. Commit 时发生什么

用户执行 `spool commit` 时：

1. Spool 复用 Git 准备 tree、parents、author、message 等原有内容；
2. Spool 读取本地新增的完整 provider records；
3. Spool 为相关 sessions 创建不可变 snapshots；
4. Spool 把 objects 写入 `$GIT_COMMON_DIR/spool/objects`；
5. Spool 把 snapshot OIDs 交给 Git；
6. Git 写入 `spool-*` headers；
7. Git 签名、生成 commit OID，并更新 branch ref。

整个 commit 流程只访问本地文件，不访问网络。网络故障不能阻止用户 commit。

如果 Spool 本地存储损坏、provider log 无法安全解析，默认停止 commit。不能把捕获失败静默伪装成“没有 session”。

用户可以显式使用 `spool commit --no-session`。这种 commit 写入：

```text
spool-version 1
spool-coverage omitted
```

`omitted` 表示用户主动跳过，不能解释为“确认当时没有 session”。

### 4.1 哪些 Sessions 会进入 Commit

Spool 不判断“谁写了这段代码”。它只记录 commit 时与这个 repo 明确关联的 sessions。

自动进入 commit 的 session 必须满足：

- 已确认属于这个 repo；
- 它的 repo/worktree context 与当前 commit 重合；
- 从上次 checkpoint 后产生了新的完整消息或 tool item。

同时满足条件的多个 sessions 全部记录，不只选择最后活跃的一个。

已经被较早 commit 捕获、但从上次 checkpoint 后没有新增完整 record 的 session，不会自动重复写进后续 commit。否则一个旧 session 会被之后所有 commits 永久携带，header 也就无法表达“本次 commit 捕获了哪些 session 工作”。用户显式 include 或 pin 时例外。

仅靠时间接近、branch 名或路径字符串猜出的 session 不写入永久 header。它只能作为待确认候选。

用户可以显式 include 或 exclude 某个 session。明确选择永远高于自动判断。

header 只表示“commit 时捕获了这个 session snapshot”，不声称它是唯一作者。

## 5. Checkout 只负责代码

`spool checkout` 完全沿用 Git checkout 的代码语义：

```text
commit → tree → blobs → working tree
```

它不读取或下载 session 正文，不创建 Session View，也绝不启动 Claude、Codex 或其他 agent。

resume 不属于 checkout 流程。只有用户之后显式执行 `spool resume`，Spool 才查看那一刻当前 `HEAD` 关联的 sessions。resume 不执行 checkout，不改变 `HEAD`、index 或代码文件，也不创建 Git worktree。

原生 Git 不认识 `spool-*` headers，会直接忽略它们。代码 checkout 不受影响。

## 6. Push、Fetch 和 Clone

### 6.1 Remote 只有能力区别，没有保留名字

Spool 面对两类目标：

```text
Git-only remote         → Git commits、trees、blobs、refs
Session-capable remote  → 上述 Git 数据 + Spool session objects
```

remote 可以叫 `origin`、`github` 或任何用户选择的名字。Spool 通过协议握手判断能力，不能根据名字猜测；commit header 也只保存 location-independent snapshot OID，不写 remote 名或 URL。

一次成功握手明确没有 Spool capability，才把目标视为 Git-only。握手本身失败时整个命令失败，不能静默降级成 code-only。

### 6.2 `spool push`

用户统一执行：

```bash
spool push <remote> <refspec>
```

对 Git-only remote，Spool 复用标准 Git transport，只上传 Git objects，并明确报告 session bodies 没有发布。目标已通过握手明确为 Git-only 时直接执行，不要求用户额外传 `--code-only`。

对 session-capable remote：

1. Rust push engine 检查新 commits 引用了哪些 snapshots；
2. 客户端先上传服务端缺少的 Spool objects；
3. Git transport 上传 commit、tree 和 blobs；
4. 服务端验证每个 `spool-snapshot` 的完整 snapshot closure 都能读取；
5. 验证通过后，服务端才更新 branch ref。

branch ref 是最终发布开关。ref 更新成功，说明 commit 和它引用的 session objects 都完整存在。缺少任何 Spool object 时，服务端拒绝 ref update；已经上传但未被 ref 引用的临时 objects 之后按 TTL 清理。

用户如果绕过 Spool 改用原生 `git push`，Git-only remote 仍可正常接收代码；session-capable remote 则必须用服务端 closure validation 拒绝不完整更新。

### 6.3 GitHub 示例

如果 `origin` 指向 GitHub：

```bash
spool push origin main
```

Spool 从握手得知它是 Git-only，只上传 Git objects：

```text
GitHub
├── commits（包含 spool-* pointer headers）
├── trees
├── blobs
├── branches
└── tags
```

GitHub 不会收到 `$GIT_COMMON_DIR/spool/objects`，因此拥有完整代码历史和 snapshot pointers，但没有 session 正文：

```text
GitHub commit ──> Snapshot OID ──> body unavailable
```

GitHub 必须原样保存 `spool-*` headers，因为删除 header 会改变 commit OID。自定义 headers 不一定显示在 GitHub UI 或结构化 API 中，这一点必须加入真实 GitHub push 的兼容测试。

### 6.4 `spool clone` 和 `spool fetch`

用户无论面对哪类地址都使用同一套命令：

```bash
spool clone <url>
spool fetch <remote>
```

从 GitHub 等 Git-only 地址 clone 或 fetch 时，只取得 Git 数据。Spool 保留 commit 中的 snapshot OIDs，但不查找其他服务，也不下载 session bodies：

```text
Session snapshot: sha256:<snapshot-oid>
Status: body unavailable
```

从 session-capable 地址 clone 或 fetch 时，Spool 取得 Git 数据并登记同一地址提供的 session object source。不要求首次 clone 下载历史 sessions；只有显式 resume 时才按需下载选中的 snapshot。

无论源属于哪一类，clone、fetch 和 checkout 都不生成 Session View，也绝不自动启动 Claude、Codex 或其他 agent。fetch 只更新 refs；session-capable clone 或 fetch 只登记 session object source。只有显式执行 `spool resume` 才读取当前 `HEAD` 的 sessions。

### 6.5 可选的双 Remote 配置

一个 repo 可以配置两个任意命名的 remote，例如：

```text
github  → Git-only remote
origin  → Session-capable remote
```

对应命令是：

```bash
spool push github main  # 代码，session pointers 保留但 bodies 不发布
spool push origin main  # 代码 + session objects
```

两次 push 相互独立，不做跨 remote 分布式事务，也不做 GitHub → session service 自动发现。用户选择哪个目标，就选择了这次发布的能力边界。

## 7. Session 怎样增量存储

同一个 session 会不断增长：

```text
Commit A → Snapshot S1 → 消息 1～10
Commit B → Snapshot S2 → 消息 1～15
Commit C → Snapshot S3 → 消息 1～20
```

Spool 不保存三份完整 session。

它把消息顺序保存成一棵可共享节点的 Merkle sequence：

```text
S1 → [1 ... 10]
S2 → [1 ... 10] + [11 ... 15]
S3 → [1 ... 15] + [16 ... 20]
```

S1、S2、S3 的共同部分只存一次。每次 commit 通常只新增上次 commit 后产生的 records 和少量 sequence nodes。

snapshot 直接指向当前完整 sequence root。读取 S3 不需要先读取 S1，再读 S2，最后累加到 S3。

### 7.1 Provider 压缩或重写日志

Claude 或 Codex 可能压缩、截断或重写 session 尾部。

Spool 比较新旧 sequence 的共同前缀，然后生成新的 root：

```text
旧 snapshot → [a, b, c, d]
新 snapshot → [a, b, x]
```

`a, b` 可以复用。旧的 `c, d` 不会错误出现在新 snapshot 中。

snapshot 不使用“parent + 追加列表”来表达当前状态，所以不需要删除指令或周期性完整 keyframe。

### 7.2 相同内容出现多次

同一句“继续”可能在一个 session 中出现多次。

Spool 可以复用相同正文，但 sequence 会保留每次出现的位置。不能因为内容 hash 相同就从时间线中删掉重复消息。

## 8. Raw Records 和可读内容

启用 Spool 的仓库默认保存完整 session。这里的“完整”是指 Claude/Codex 已经写入本地 session 文件、且 adapter 能捕获的消息、tool calls、tool results 和必要 metadata。

MVP 只有这一种可 resume 的保存方式。用户必须先显式执行 `spool init` 启用；未启用 Spool 的仓库不会捕获 session。

完整 session 以 Claude/Codex 原始 records 作为正文来源。

Spool 另外保存很小的描述信息，例如角色、item 类型和 record 内的位置。搜索文本可以重新生成，不再默认保存第二份完整正文。

这样避免同时保存一份 raw JSONL 和一份内容几乎相同的 canonical session。

只保存用户 prompts 或可读文本的版本无法可靠 resume，因此不作为 MVP 存储模式。以后可以作为明确标记“不可 resume”的导出或分享格式，不能与完整 snapshot 混为一谈。

### 8.1 Resume 当前 Commit 的 Session

命令只有两种形态：

```bash
spool resume
spool resume <session-id>
```

解析规则只有一条：

```text
current HEAD
+ optional Spool session ID
→ exactly one snapshot
→ read source provider
→ materialize
→ provider-native resume
```

每个 snapshot descriptor 必须保存稳定的 Spool session ID 和 source provider。同一个 session 跨 commits 可以有不同 snapshot OID，但使用同一个 Spool session ID；同一个 commit 内，同一 session ID 最多出现一次。

没有传 `<session-id>` 时，Spool 读取当前 `HEAD` 的全部 snapshot pointers：

1. 零个匹配项：明确报错，不启动 agent；
2. 一个匹配项：不再询问，直接调用对应 agent 的 resume；
3. 多个匹配项：交互显示 session ID 和 provider，让用户选择；
4. 非交互环境有多个匹配项：列出 session IDs 后报错，要求显式重试。

传入 `<session-id>` 时，Spool 只在当前 `HEAD` 的候选中查找。它不搜索其他 commit；ID 不存在时明确报错。

选定 snapshot 后，Spool 把它精确物化成具有全新 provider session ID 的 provider-native local session，再调用 provider 自带的 resume：

```text
Codex snapshot  → codex resume <new-session-id>
Claude snapshot → claude --resume <new-session-id>
```

Codex 同时提供 `resume` 和 `fork`。根据 [Codex 官方 CLI 文档](https://learn.chatgpt.com/docs/developer-commands?surface=cli#cli-codex-resume)，`codex resume` 用于打开并继续指定 ID 的已有 interactive session。

[`codex fork`](https://learn.chatgpt.com/docs/developer-commands?surface=cli#cli-codex-fork) 用于从 Codex 已有 session 创建另一个 task。Spool 已经在物化时创建了新副本，所以只需要对新 ID 调用 `resume`，不调用 `fork`。

Spool 从 snapshot 的 source provider 自动选择 adapter：Claude snapshot 调用 Claude，Codex snapshot 调用 Codex。用户不能覆盖 provider；遇到未知 provider 时明确报错。

resume 不执行 checkout，不改变 `HEAD`、index 或代码文件，也不创建 Git worktree。它不附加原 session 在该 snapshot 之后增长的 records。

Spool 不传初始 prompt，不发起 model turn，也不批准 tool call。provider 自身的启动初始化行为不在此保证内。agent 打开后停在等待用户输入的状态。

adapter 必须通过真实 CLI round-trip 测试。无法物化时必须明确报“不支持恢复”，不能打开空 session，也不能退化成自动发送拼接 prompt。原 snapshot 和原 provider session 永远不修改。

## 9. Session 身份

Spool 为每条 source session 保存稳定的 Spool session ID。它是 CLI 的选择器，不是 snapshot OID，也不是 resume 时新生成的 provider-native session ID。

provider 有稳定 session ID 时，Spool 用它派生不泄漏原值的 Spool session ID。provider 没有稳定 ID 时，Spool 第一次看到 session 就生成随机 ID，并保存在本机 identity registry 中。

同一个 session 每次 commit 可以产生新的 snapshot OID，但 Spool session ID 保持不变。因此 `(HEAD, session-id)` 最多解析到一个 snapshot；重复项表示 commit 数据损坏。

identity registry 丢失或无法证明两个 sessions 相同时，默认创建新的 Spool session ID 并保持分开，不自动 alias 或合并。

## 10. Rust-first 实现

Spool 发布一个统一的 `spool` CLI，并内置版本固定、只做最小修改的 Git engine。它不依赖用户机器上碰巧安装的 Git 版本，也不使用 hooks 作为正确性边界。

Spool 使用一个仓库管理全部源码，但 Git 和 Rust 分开放：

```text
spool/
├── Cargo.toml              管理 Rust workspace
├── packages/
│   ├── git/                固定版本的 upstream Git 源码 + Spool 的少量修改
│   └── spool/              Spool 的 Rust package
└── docs/
```

根目录的 `Cargo.toml` 管理 Rust workspace，`workspace.members` 只显式列出 Rust package `packages/spool`。`packages/git` 是 Git 源码，不是 Cargo member。

`packages/git/` 是这个仓库里的普通目录，不是 submodule。修改 Git 调用点、Rust helper 和两边的集成测试时，可以在同一个 commit 中完成，不需要同步两个仓库和一个 submodule 指针。

`packages/git/` 只是现阶段 Git engine 的实现，不是 Spool 永久依赖的内部结构。真正稳定的边界是一层很窄的 Git engine/helper interface。Rust 高层模块只能依赖这层接口，不能依赖 `packages/git/` 中某个具体 C 文件、内部 struct 或目录布局。以后重写 Git 时，可以逐步用新的实现替换 `packages/git/`，而不必重写 session、存储、resume 和 push 等高层能力。

普通 Git-compatible 命令直接进入内置、版本固定的 Git engine；只有 session 能力进入 Rust 模块：

```text
spool CLI
├── packages/git/：bundled, version-pinned Git engine
│   └── status、diff、commit、merge、rebase、transport...
└── packages/spool/：Rust Spool package
    ├── spool-core
    │   ├── objects、typed OIDs
    │   ├── object store
    │   └── Merkle sequence
    ├── spool-adapters
    │   ├── Claude adapter
    │   └── Codex adapter
    └── spool-engine
        ├── checkpoint
        ├── commit headers
        ├── history reconciliation
        └── push preparation

minimal Git bridge → spool-git-helper（Rust）
```

Git 继续负责它擅长的事情：tree、parents、message editor、hooks、signing、commit object、reflog、refs 和 pack transport。

Rust 负责 sessions、objects、hash、sequence、provider parsing、resume 和上传。Git 的 C 代码只增加少量稳定调用点，把已经准备好的 operation context 交给 Rust，并接收 headers 或结果。

### 10.1 Git 需要改多少

Git 已经支持 extra commit headers。`spool commit` 不需要重新实现整个 Git commit 流程。

Session-aware 的 commit、amend 和 sequencer 路径只增加以下步骤：

1. 准备 tree、parents、操作类型和源 commit 等少量信息；
2. 调用 Rust `spool-git-helper`；
3. 把 helper 返回的 headers 交给 Git 现有 commit builder；
4. Git 按原流程签名并写入 commit。

底层 `commit_tree_extended(...)` 不主动扫描 sessions。它只负责写调用方已经准备好的 headers。

未启用 Spool 的仓库、server-side Git 和普通 plumbing command 保持原有行为。

`spool push` 的新增逻辑尽量由 Rust 实现：Rust 负责 capability negotiation 和 Spool objects 上传，Git 现有传输负责 Git objects，服务器负责最终验证。

MVP 先使用外部 Rust helper，不能用 hook 代替这个 bridge。只有 benchmark 证明进程启动影响 commit 延迟时，才考虑常驻 daemon。

## 11. Amend、Rebase 和 Merge

| Git 操作             | Spool 行为                                                                 |
| -------------------- | -------------------------------------------------------------------------- |
| 普通 commit          | 捕获当前明确关联的 sessions                                                |
| merge commit         | 只捕获 merge、review 或冲突解决相关 sessions                               |
| fast-forward         | 没有新 commit，因此没有新 snapshot pointer                                 |
| amend                | 重新捕获并替换旧 Spool headers，产生新 commit OID                          |
| 无内容变化的 rebase  | 明确保留原 snapshot pointer，并标记为 carried                              |
| rebase edit/conflict | 原 snapshot 标记为 carried；冲突解决 session 标记为 captured               |
| cherry-pick          | 默认捕获当前操作 session；原 session 只作为待确认来源                      |
| squash               | 所有 source snapshots 去重后标记为 carried；squash session 标记为 captured |

只要 rebase sequencer 明确知道旧 commit 与新 commit 的映射，Spool 就自动复制旧 commit 的 snapshot pointers，并把关系从 `captured` 改为 `carried`：

```text
spool-snapshot carried sha256:<snapshot-oid>
```

这不会复制 session 正文，只是在新 commit 中保留同一个不可变 snapshot OID。`carried` 只断言“这个 session 来自被转换的 source commit”，不声称它完整解释最终代码。

机械式 rebase 没有产生新的 session 时，新 commit 只有 `carried` pointers。发生 edit 或 conflict 时，旧 pointers 仍然 `carried`，解决冲突期间新产生的 sessions 另外以 `captured` 写入。两类关系可以同时存在。

squash 是明确的多对一历史转换，使用同一原则：结果 commit 携带所有 source commits 的 snapshot OIDs，相同 OID 只写一次；squash、edit 或 conflict 期间的新 sessions 另外写为 `captured`。

vanilla Git 创建的新 commit 可能不会保留 Spool headers。Spool 会把它标记为 unknown，并提示用户检查或 amend。

## 12. 已有仓库怎样迁移

已有 commit 没有 Spool headers。给它增加 header 会改变 commit OID，并递归改变后面的所有 commits。

MVP 只提供一种迁移方式：

```bash
spool import
```

它会扫描本地 sessions，生成旧 commits 与 snapshots 的关联方案，并在写入前展示即将重写的 branches、commits 和 session pointers。

只有确认的关联才能写进 commit；无法确认的候选不能伪装成事实。用户确认后，Spool 重新创建可达历史，把 `spool-snapshot` headers 写进 commits。

Git commit 是不可变对象，所以这里的“修改旧 commit”实际是创建内容相同但 headers 不同的新 commits，再把本地 branch refs 指向新历史。

每个被重写的 commit 及其所有后代都会得到新的 OID。Spool 必须在执行前明确展示这个后果，并在整个重写成功后才更新本地 refs。

协作者必须一起迁移到新历史。`spool import` 不自动 push；迁移后的历史默认只允许推到新的空 remote，Spool 不自动 force-push 现有 remote。

`spool import` 只用于已有仓库第一次启用 Spool。新建的 Spool-enabled repository 正常使用 `spool commit`，不需要 import。

## 13. 权限、删除和损坏

Spool object OID 固定使用普通 SHA-256。tenant/repo 隔离由存储 namespace 和权限系统负责，不能因为换 tenant 就改变 commit 中的 pointer。

私有仓库之间默认不进行全局对象存在性查询，也不做跨 tenant 去重。

commit 是不可变的，所以已经写入的 snapshot pointer 不能原地删除。

如果 session 包含 secret 或需要法务下架，Spool 可以撤销访问并删除正文。commit 中仍保留原 snapshot OID，但读取时返回 withdrawn。

服务端必须立即拒绝对 `withdrawn` session 的后续访问。已经下载到本地或离线保存的副本无法追溯撤销。对象从主存储、备份和副本中物理清除需要多久属于具体部署的运营与合规策略，不写进 object format，也不阻塞本地存储架构。

损坏对象不能用不同内容冒充原 OID。相同 OID 只能恢复完全相同的 bytes。

## 14. 为什么值得这样做

本机样本显示，不同 sessions 之间直接去重的收益很小。真正大的重复来自同一个增长中的 session 被多个 commits 反复保存完整前缀。

Spool 的 sequence sharing 正好处理这种重复。

但 Git pack 和 zstd 也能压缩重复前缀，所以正式冻结存储格式前，仍要测真实 commits、压缩后的磁盘大小和网络流量。

不能直接把未压缩实验中的节省比例当成最终产品收益。

## 15. MVP 顺序

### Slice 0：先验证格式

- 自定义 headers 是否通过 Git fsck；
- GitHub、GitLab、JGit 和 libgit2 是否兼容；
- GPG/SSH signature 是否覆盖 headers；
- amend、rebase、bundle 和 SHA-256 repo 是否正常；
- 真实 commit + pack/zstd benchmark。

### Slice 1：Rust 本地对象库

- Claude/Codex adapters；
- Spool object store；
- session identity；
- Merkle sequence；
- checkpoint 和 byte-exact reconstruction；
- truncate/rewrite 和重复消息测试。

### Slice 2：`spool commit` 集成

- Rust helper；
- `spool-*` commit headers；
- commit、merge、amend；
- rebase/cherry-pick operation context；
- `spool commit --no-session` 和失败处理。

### Slice 3：Spool Push 和迁移

- Rust push engine 和 remote capability negotiation；
- server-side object validation；
- session-capable server protocol；
- `spool import` 的历史重写、预览和本地 ref 更新。

### Slice 4：Spool 产品接入

- commit 页面展示相关 sessions；
- session 页面展示相关 commits；
- checkout/clone 不生成 Session View，也不启动 agent；
- resume 从当前 `HEAD` 选择 session：一个直接打开，多个交互选择，非交互环境要求传 `<session-id>`；
- snapshot 自动决定 provider；Spool 精确物化新的 provider-native local session，再用原生 resume 打开，且绝不修改原 snapshot；
- resume 不发送初始 prompt、不发起 model turn、也不批准 tool call；provider 自身的启动初始化行为不在此保证内，交互界面打开后停在等待用户输入的状态；
- carried、omitted 和 withdrawn 状态；
- 按需下载和权限检查。

## 16. MVP 验收条件

- commit OID 和 signature 覆盖 `spool-*` headers；
- 普通 Git 能 clone、checkout、log、fsck 和 push 这些 commits；
- 用户通过统一的 `spool commit`、`spool checkout`、`spool push`、`spool clone` 和 `spool resume` 使用相关能力；
- 不涉及 sessions 的 Git-compatible 命令保持 Git 的参数、输出、退出码和行为；session-aware 命令保持 Git 参数和代码语义兼容，但可以增加文档化的 Spool 诊断与失败状态；
- Spool 携带版本受控的 Git engine；新 session 能力由 Rust 实现，Git 侧只保留最小 bridge，正确性不依赖 hooks；
- Git 源码放在同一仓库的 `packages/git/` 目录而不是 submodule；Rust package 放在 `packages/spool/`，只有它由根 `Cargo.toml` 显式列入 workspace；Rust 高层只依赖窄的 Git engine/helper interface，不依赖 `packages/git/` 的内部文件布局；
- Git 的新增逻辑只负责调用 Rust helper 和传递 headers；
- commit 全程不访问网络；
- 捕获失败不会静默变成零 session；
- 一个 commit 可以关联零个、一个或多个 sessions；
- 未产生新完整 record 的旧 session 不会自动重复进入后续 commit，除非用户显式 include 或 pin；
- rebase 已知 source→result 映射时自动保留 source snapshot OIDs 并标记为 `carried`；发生 edit/conflict 时另外捕获解决过程的 sessions；
- squash 自动携带所有 source snapshot OIDs（去重），并另外捕获 squash 过程的新 sessions；
- 同一 session 跨 commits 只新增缺少的 objects；
- 重复消息不会从 session 时间线消失；
- provider truncate/rewrite 不会把已删除内容恢复回来；
- 读取 snapshot 不需要遍历全部旧 snapshots；
- 完整、可 resume 的 snapshot 不默认保存两份 session 正文；
- `spool init` 后默认保存完整 session；只含 prompts 或可读文本的导出明确标记为不可 resume；
- push 时 snapshot closure 不完整，就不能更新 session-capable remote ref；
- `spool push` 明确识别到 Git-only remote 后自动执行 code-only push，并报告 session bodies 未发布；
- 普通 Git remote 仍能正常工作；
- `spool import` 只把确认的 session 关联写入新 commits，并在更新本地 refs 前展示 OID 变化。
- checkout 和 clone 在任何情况下都不会自动启动 agent。
- `spool resume` 只读取当前 `HEAD`：零个 session 明确报错，一个直接打开，多个交互选择。
- 非交互环境有多个 sessions 时必须传 `<session-id>`；显式 ID 必须属于当前 `HEAD`。
- Spool 从 snapshot 自动读取 source provider 并选择对应 adapter；用户不能覆盖 provider，也不发生跨 provider resume。
- Codex adapter 使用 `codex resume <new-session-id>`；Claude adapter 使用 `claude --resume <new-session-id>`，两者都不传 prompt。
- resume 只恢复选中 snapshot 截止位置的 records，绝不自动携带原 session 后来新增的尾部。

## 17. 剩余工程验证，不是产品决策

核心产品和架构语义已经确定。以下事项通过原型、benchmark 和部署配置解决，不再要求产品决策：

1. 增量 checkpoint 的初始性能目标为 p95 不超过 100 ms、p99 不超过 250 ms；首次全量导入不得进入 commit 热路径；
2. Claude/Codex snapshot → 新 provider session → 原生 resume 的真实 CLI round-trip；
3. GitHub、GitLab、JGit、libgit2、签名和 SHA-1/SHA-256 repo 的兼容测试；
4. pack/zstd 后的实际磁盘与网络收益；
5. session-capable server 在上传中断、对象缺失和 ref update 失败时的 closure validation；
6. `withdrawn` 的物理删除与备份清除 SLA 由部署方依据合规要求配置。
