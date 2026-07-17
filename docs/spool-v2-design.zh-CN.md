# Spool v2 设计草案

> 状态：v2 草案。与 [spool-design.zh-CN.md](./spool-design.zh-CN.md)（v1，commit 绑定方案）并存，供对比参考。

核心决定只有一个，其余都是推论：

> 系统里只有一种权威数据：session log。
> share = 同步它；resume = 物化它；blame = 从它推导出的索引。
> Git 一行不改，commit 里什么都不写。

## 1. 三个部件

```text
┌─────────────┐   同步（唯一被传输的东西）   ┌─────────────┐
│ 本地 store   │ ◄──────────────────────► │    Hub      │
│ session log │                           │ 对象存储+ACL │
└──────┬──────┘                           └─────────────┘
       │ 推导（本地可重建，可丢弃）
       ▼
┌─────────────┐
│   Trace     │ ← 回答 "这行/这个文件受哪些 session 影响"
│ 文件版本链   │
└─────────────┘
```

- **Store**：扫描 `~/.claude/projects`、`~/.codex/sessions`，把 provider records 摄入本地内容寻址对象库，按 workspace（仓库路径或显式声明）分组。
- **Hub**：一个哑服务——对象存储 + session refs + 权限 + 下架墓碑，不需要理解 git。
- **Trace**：从 records 里的编辑事件推导出的索引，删掉可重建，不进任何权威数据。

## 2. 对象模型

```text
record          一条 provider 记录，canonical bytes，内容寻址
sequence        record 的 Merkle 列表（前缀共享，容忍 provider 截断/重写）
session head    可变 ref：spool-session-id → 最新 sequence root
                单写者（只有作者机器能推进），携带四样元数据：作者签名、lineage、workspace card（§3.1）、note（§3.2）
lineage         fork 关系：新 session → (源 session-id @ record 位置)
```

和 git 的类比：record ≈ blob，sequence ≈ tree，session head ≈ branch。没有 commit 这一层——session 本身就是"活的分支"。

规则只有两条：head 只能由作者推进；别人想继续，就 fork 出新 session，lineage 记下来源。session 之间永不 merge。

正文的权威数据只有 records 一种；head 携带的少量元数据（签名、lineage、workspace card、note）与 ref 本身同级，是被同步的指针，不是正文。

## 3. Share 与 Resume

```bash
spool share                    # 推当前 workspace 的 session 到 hub，得到 URL
spool share <session-id>@120   # 只分享前 120 条 record（Merkle 前缀）
spool resume <url>             # 拉取 → 物化成全新 provider-native session → 原生 resume
```

Resume 原则：物化，不嫁接。拉到的 records 写成新的本地 provider session（新 ID），然后调用 `claude --resume` / `codex resume`。原 session 与原 snapshot 永不修改；fork 出的新 session 允许且只允许一条 Spool 出生记录，标记为 Spool 生成、非原对话内容；依旧不发起 model turn、不代跑任何命令，agent 打开后停在等待用户输入的状态；resume 产生的新 session 自动带 lineage 指回源 @ 位置。

跨机器边界：records 里的绝对路径按 workspace 映射重写；对话上下文可完整转移，工作区代码靠 git 自己对齐。`spool resume` 打印该 session 最后看到的仓库状态提示（来自 workspace card，见 §3.1），不强制。

隐私默认：一切 session 私有，share 是显式动作。分享即分享全文。支持前缀分享和 hub 侧 withdraw（墓碑，OID 保留、正文拒读）。

### 3.1 Workspace card 与 resume note：codebase 自复原

Spool 不管理 codebase，只记录它的坐标。扫描器在每次摄入时读取工作区的 git 信息，作为 workspace card 挂在 session head 上，随 head 同步：

```text
workspace-card {
  remotes:  [origin: git@github.com:foo/bar.git]
  branch:   main
  head:     abc123f
  dirty:    [src/foo.rs]        # 最后一次扫描时观察到的未提交文件
  observed: <ts>
}
```

card 是便利指针，不是保证：缺失或过期时 resume 退化为纯对话恢复，不报错。

`spool resume` 物化 records 之后，在新 session 末尾追加一条标记清晰的 Spool 出生记录（resume note），内容包括来源（hub URL、作者、@ 位置）、workspace card 全文、一句给 agent 的提示——如果当前目录没有这个 codebase，可以自己 clone/checkout 复原，过去的编辑和环境搭建命令都在这条 transcript 里。然后照常调用 provider 原生 resume。

复原逻辑因此不需要 Spool 实现：agent 被唤醒后，用户第一句话让它继续时，它读到 note，自己 clone、checkout、按记忆里跑过的命令装依赖，甚至能从自己的 Edit/Write 记录里重放未提交的改动。agent 直接读自己的 transcript，比任何静态抽取的环境清单都准。

诚实边界：

- 未 commit 且非本 session 产生的改动，坐标复原不了；note 里如实列出 dirty 清单。
- private repo 的凭证走 resumer 自己的 git auth，权限跟人走，不跟 session 走。
- 没有 remote 的本地仓库：card 记 no remote，退化为纯对话 resume。
- agent 自己复原要花几个回合——把成本从 Spool 的工程复杂度移到 resume 后的几轮对话，MVP 值得这个交换。

### 3.2 Note：session 的 README

session 是原始流，share 是发布动作；README 属于发布物，不属于原始流——类比 PR description 属于 PR，不属于 commits。这份 README 叫 note，是 share 的 message。

`spool share` 像 git commit 一样打开 $EDITOR：草稿从 records 确定性预填——意图取首条 prompt，结局取末条回复，附文件清单、测试证据、workspace card；预填部分像 git commit 的注释行一样标出，不算作者写的内容。作者要补的只有他自己知道的三样东西：为什么分享（给谁、要什么）、接手须知（环境、坑、下一步）、想被 review 的点。

```bash
spool share                 # 打开 $EDITOR，预填草稿，作者补写后保存退出
spool share -m "..."        # note 内联提供，不打开编辑器
spool share --no-edit       # 直接用预填草稿，不改一个字
```

note 可选：`-m`、`--no-edit`，或编辑器里什么都不写直接保存退出，都能发布——摩擦不能挡住 share。

存储：note 挂在 session head 的元数据上，随 head 同步，单写者，签名覆盖，作者可改。fork 不继承 note——新 session 的 share 自己写一份；来源已经由 lineage 记下。

诚实原则：note 是作者的主观自述，页面与 CLI 把它和机器证据（测试结果、diff 统计、workspace card）分区渲染。note 不覆盖证据：作者写"测试都过了"不算数，证据行说了才算。

## 4. Trace：行级归因

从 records 里抽取编辑事件，构建每个文件的版本链。归因分四档：

| 档位 | 来源 | 含义 |
| --- | --- | --- |
| exact | Edit/Write 事件 | 内容出自 log，可证明 |
| inferred | 变更窗口只与一个跑过 shell 的 session 重叠 | 大概率是它（sed、codegen） |
| suspected | 与 chat 消息里的代码块模糊指纹匹配 | 用户从对话里复制粘贴 |
| external | 无候选 | 人手改的 / git pull 进来的 |

实现分四层。

### 4.1 事件抽取层

provider record → edit event。Claude 侧取 Edit/Write/MultiEdit/NotebookEdit 的 `tool_use` + 配对 `tool_result`（只取成功的）；Codex 侧取 `apply_patch`。

字段：文件路径（用 record 里的 cwd 归一成 workspace 相对路径）、`old_string`/`new_string` 或全量 content、时间戳、session-id、record 位置。

关键事实：事件本身不含行号——绑定不发生在抽取时，发生在重放时。

### 4.2 重放层（chain builder）

按文件构建版本链。锚点来自两处：首个 Write 事件（全量内容），或磁盘扫描得到的 blob。

把事件按内容链接（上一版 post_blob == 下一版 pre_blob）成链，时间戳只用于排序断档。每次 apply 产出一个 version：`(pre_blob, post_blob, 带行号范围的 hunks, author=session@record, ts, confidence)`。

apply 失败（old_string 不匹配基底）说明中间存在未观察的外部修改：插入 external version，事件挂起为 floating，等待下一个磁盘锚点重试。

磁盘扫描在查询时惰性触发：对当前文件取 hash，不等于链尾 post_blob 就插入 external tip。产物存 sqlite 索引（versions 表 + hunks 表）+ zstd blob store，全部可重建。

存储坐标是 blob hash，不是"路径 + 行号"——行号是查询时坐标。所以 git checkout 切分支不破坏 trace：切回来时磁盘 blob 又命中链上已知节点。内容寻址让 trace 与 git 零耦合，但天然兼容。

blob store 借用 git 的对象库：凡是 commit 过的内容，git 对象库里已有 blob，Spool 只记一个 hash 映射（Spool OID → git blob OID），需要基底时用 `git cat-file` 取出。Spool 自己落盘的只剩一类东西——git 两次 commit 之间、agent 眼中的中间态版本，即被 git 采样丢掉的帧。范围有严格上限：只有被 session 触碰过的文件，只有版本链上出现过的版本；没被 agent 碰过的文件从不进入 Spool 的任何存储。

可重建性的精确表述：trace 里有两类数据。从 session log 重放出的派生结果可重建；磁盘观察得到的 external 锚点是一次性观测，删了无法回到过去再看一眼。丢失后者不会算错归因，只会让更多行退化成 unknown。

### 4.3 查询层（blame 回溯）

从磁盘内容出发，先 diff 到链尾对齐行号；然后从新到旧走链：每个 version 的 hunk 覆盖到的行记一笔 `(session@record, 动作=introduced/modified, confidence)`，行坐标经 diff 映射到更老版本继续，直到该行在更老版本不存在（出生点）或链尽头（external）。

输出是链不是单值：每行 → [出生 + 历次修改]。

文件级归因 = 行级聚合 + 所有触碰过该文件的事件（含被覆盖的——"影响过"不等于"现存行的作者"）；文件级比行级更鲁棒，行级是精化。

### 4.4 兜底层（指纹索引）

session 消息里的代码块和所有 `new_string` 归一化空白后切 n-gram shingle，建倒排索引。行回溯到 external 尽头时查指纹，命中则给 suspected 归因。

查询接口：

```bash
spool blame <file>             # 每行 → 影响它的 session 链
spool why <file>:<line>        # 跳进 session，定位到写下这行的那条 tool call
```

`why` 是产品价值所在：归因指到 session 内的确切 record，能读到写这行代码前后的完整讨论。协作时 trace 不需要同步：session log 同步了，每台机器自己重建（或 hub 代算供 web 用）。

## 5. Share 页面：别人看什么

首屏回答的不是"改了什么"，是"这是什么、值不值得继续看"——GitHub 首屏给 README + 目录树而不是 commit 列表，同一个逻辑。首屏的自述有三级来源，逐级退化：作者 share 时写的 note（§3.2）；作者让 agent 收尾总结的末条回复；什么都没有时，首条 prompt 说意图、末条回复说结局。触碰过的文件清单是空间地图，user prompts 章节大纲是时间地图。

页面分三层：

```text
首屏（定位）    note（若有）＋ 首条 prompt ＋ 末条回复 ＋ 文件清单/章节大纲
               ＋ 状态 ＋ resume 命令
    ↓ 点进去
第二层（消费）  timeline ↔ session diff 双栏联动
    ↓ 深链
第三层（考古）  #r/<record>，落在确切的那条 tool call
```

**session diff**：一个 session 全部编辑事件复合成的净改动，按文件取 diff(第一次触碰前, 最后一次离开后)，类比 PR 的 Files changed——agent 反复试错的中间过程相互抵消，只剩最终生效的改动。结果看 diff，过程看 timeline，两者双向联动：点 hunk 滚到产生它的 tool call，点 tool call 高亮对应 hunk。

三类读者三个入口：路过的人读完首屏自述就走；reviewer 点文件清单进 diff；接手的人读完末条回复复制 resume 命令。

深链锚点 `#r/<record-idx>`：`spool why` 和编辑器行注记跳进来时落在确切 record，带上下文展开。

默认不给别人看的：

- workspace 里的其他 session；
- 前缀分享点之后的内容；
- 分享时重写掉的绝对路径与环境信息。

模型生成的 note 草稿列为 later；确定性预填草稿属于 MVP。

## 6. 一个 CLI：唯一入口

产品的全部操作收敛在一个 `spool` CLI 里。命令表：

```text
spool                        # 定位：当前 workspace 的 sessions，活跃在前
spool show <id|url>[@r<n>]   # 看：默认首屏摘要；--log 看 timeline；--diff 看 session diff；@r<n> 落到确切 record
spool share [<id>][@<n>]     # 分享：打开编辑器写 note（-m 内联 / --no-edit），推 hub 返回 URL；@<n> 前缀分享
spool resume <id|url>[@<n>]  # 接手：拉取、物化、写出生记录、原生 resume
spool blame <path>[:<line>]  # 归因：行/文件 → session 链；--porcelain 供工具消费
spool why <path>:<line>      # blame 单行 + 自动 show 跳到出生 record
spool withdraw <id>          # 下架（hub 墓碑）
spool login / spool logout   # hub 凭证
```

`spool` 不带参数的输出示例：

```text
$ spool
  #a3f2  2h前   "修复 OAuth 回调的 PKCE 校验"   12 文件  ✓测试通过  (claude)
  #9c01  昨天   "把 eslint 换成 oxlint"         31 文件             (codex)
  #77b4  3天前  fork ← hub/xy/a3f2@120           2 文件             (claude)
```

五条设计规则：

1. **ID 与 URL 同构**：任何接受 session 标识的位置同时接受本地 ID 和 hub URL，远端内容按需拉取。每个 share URL 双栖：浏览器打开是页面，喂给 CLI 是数据——`spool show <url>`、`spool resume <url>` 吃同一个 URL。
2. **零初始化**：没有 `spool init`，没有 daemon。每条命令惰性扫描 provider 目录，增量游标保证速度。捕获只产生本地派生数据、不产生新的暴露面——隐私线不画在"是否捕获"，画在"是否 share"。
3. **命令表是架构的投影**：`spool`/`show` 读 store，`share`/`withdraw`/`login` 面向 hub，`blame`/`why` 查 trace，`resume` 是物化。部件不增，命令不增；反过来，需要新命令时先问对象模型是不是多了东西。
4. **一切输出可编程消费**：全部命令支持 `--json`；blame 提供 `--porcelain` 稳定格式。hub web 页和编辑器 gutter 注记是 CLI 的投影和消费者，不是并列产品：CLI 没有的能力，web 不能有。§5 的三层结构在 CLI 里的对应是：首屏 = `spool show`，第二层 = `--log`/`--diff`，第三层 = `@r<n>`。
5. **不吞并 git**：spool 没有 commit/push/checkout。git 的事 git 干，session 的事 spool 干——"一个 CLI"指 session 域的全部操作在一个入口，不是回到 v1 包裹 git 的老路。

## 7. 与 Git 的关系：零耦合

不 fork git，不加 commit header，没有 `spool commit`/`push`/`checkout`，没有 import 历史重写，没有 carried/captured 的 rebase 语义。git pull/checkout/merge 造成的文件变化在 trace 里是 external 版本；git 存在时可加注记（"external，匹配 blob abc123"），没有 git 也照常工作。

三层边界：

- 权威边界：代码的真相在 git，Spool 从不担任代码的存储与恢复责任。不能从 Spool checkout 代码；resume note 让 agent 去 git clone，不从 Spool 拉文件。
- 传输边界：跨机器同步的只有 session log。records 天然含代码片段（Edit 的 old/new、Write 的全文、Read 的输出），分享 session 即分享这些片段——这是分享对话的固有属性，trace 不往网络上加任何东西。
- 缓存边界：trace 的 blob store 是本地派生缓存（可删性以 §4.2 两类数据的表述为准），用途是归因不是恢复，设计上禁止从它恢复代码。

不变量：代码的权威在 git，对话的权威在 session log，trace 是对话的索引——它包含代码的碎片和快照，但从不承担代码的职责。

## 8. 明确放弃的东西

- **签名 commit 级防篡改**：降级为 session head 签名 + hub 校验。trace 是可重建缓存，不承载法务级断言。
- **"checkout 旧 commit 即见当时 sessions"**：没有了。替代品是按行问（blame 链天然带时间）。
- **归因完备性**：没走 tool call 且推断不出的改动永远是 external。四档置信度把边界摆在明面上。
- **环境复原、预检机器**：不做。Spool 只记录坐标（workspace card），复原由 resume 后的 agent 依据自己的 transcript 执行；devcontainer/Nix/沙箱是正交产品，card 可留指针，MVP 非目标。

## 9. MVP 切片

1. **摄入**：Claude/Codex adapter → record/sequence/head，容忍截断重写。
2. **Share + Resume**：hub 对象同步、前缀分享、跨机器物化 + 原生 resume 真实 round-trip、note 编辑器流程（确定性预填草稿）。
3. **Trace**：事件抽取、内容链接版本链、磁盘补洞、`spool blame`/`spool why` CLI。
4. **界面**：投影——hub session 页（§5 三层结构的 web 渲染，服务没装 CLI 的来访者）；编辑器 gutter 注记（消费 `blame --porcelain`）。

## 10. 与 v1 的本质区别

v1 把 session 依附于 commit；v2 把 session 作为一等公民，代码归因是它的推导物。三个需求各落在一个部件：share 靠 head 同步，resume 靠物化，归因靠 trace——互不纠缠，砍掉任何一个另外两个照常工作。
