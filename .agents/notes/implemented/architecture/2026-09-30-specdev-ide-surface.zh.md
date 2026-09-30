# Agent Note: SpecDev IDE 面——快照 v4 视图、门禁决定表单与引用链接

Status: implemented

[English](2026-09-30-specdev-ide-surface.md) | 中文

## Problem

面板已经能渲染 SpecDev 状态条、也能请 Host 决定待决门禁，但它无法对自己展示的内容做任何事。状态条没有计划位置、没有当前角色、没有产物清单、没有下一步入口，也不记录本会话已经取得哪些工作区外放行，于是这些问题都只能回到对话里问。门禁本身在 QuickPick 里收集，而卡片只说「有一个门禁待决」——人的备注从不经过卡片，已决与未决的卡片看起来一样。消息正文里的 `path:line` 引用是死文本，尽管面板早就会打开 `@` 引用。

这些都不是既有线上视图能回答的：`BridgeSpecdevSnapshot` 只有门禁、步骤状态与视觉链声明，面板若想回答就只能自己去读 `.specdev`——而这正是 bridge 快照要留在运行时那一侧的读取。

## Decision

### 运行时提供计划与产物清单（快照 v4）

`SpecdevSnapshot` 新增两个可选视图，由运行时在 `ide-view.ts` 计算：

- `plan` —— 按计划顺序的 phase-plan DAG，每行 `{ id, dependencies, status }`：该阶段全部步骤完成即 `done`，当前阶段 `active`，其余 `todo`。计划无法解析时省略该字段（`snapshot()` 不会因此抛错）。
- `artifacts` —— 工作流级 `requirements.md`、`design.md`、`phase-plan.md`，UI 工作流再加 `visual-baseline.md`；随后每个阶段的 `repo-exploration.md`、`implementation.md`、`review-correctness.md`、`review-design.md`、`review-connectivity.md`、`review.md`、`verification.md`，计划声明 `ui: true` 的阶段再加 `review-visual.md`。每行给出工作区相对的 POSIX `path`、作为 `label` 的文件名、所属 `phaseId`（工作流级为 `null`），以及按内容非空判定的 `ready`/`missing`。

`SPECDEV_SCHEMA_VERSION` 升到 4。投影 schema、bridge 类型与 bridge 校验接受这两个可选字段，出现时校验其行，并保持更旧的载荷合法。`confirmGate` 记录的快照带同样视图，离线 fold 仍等于实时快照。

### 卡片自己携带决定与备注

待决门禁在卡片内渲染表单：运行时对该门禁的判定依据、状态已携带的风险行（阻塞债、回炉轮次、缺失产物）、多行备注，以及「通过并推进 / 打回修改 / 延后」三个决定。卡片发出一条 `action/specdev-gate` 意图，携带 `{ decision, note? }`；Host 经 `confirmGate` 应用，后者仍是门禁状态的唯一写入方。

打回在两端都要求备注：卡片把「打回修改」保持禁用直到写下备注，`applySpecdevGateDecision` 也会拒绝无备注的打回并给出提示，而不是写入。通过与延后则备注可选。命令面板路径（`dsh.specdevStatus` → QuickPick）收集同样三个决定，并调用同一个应用函数。

### 引用走同一条路

产物行与消息正文的 `path:line` 都发出 `action/open-reference`，携带 `{ path, line? }`。扩展会跳到所指行，并优先采用引用自带的行号而不是存档的选择元数据，因为行号是作者在正文里写下的。正文引用在 Host 的安全 Markdown 渲染器（`file-links.ts`）中提取：至少一个 `/`、一个文件扩展名，随后 `:line` 与可选的 `:column`；URL、`@` mention 与不带行号的路径保持纯文本。

### 状态条补齐其余信息

状态条增加计划顺序（含当前阶段及其依赖）、当前阶段正在运行的角色、产物条，以及运行时的下一步加一个「填入输入框」按钮——只填入不发送。状态帧携带 `lastScope`（从 `specdev/scope-decided` 折叠出的最近一次放行），卡片因此能说出本会话已可触及什么；放行本身仍住在守卫的会话范围里。

越界访问申请继续使用原本就用的交互卡：详情区给出工具、角色、访问类型、路径、整盘/递归扫描的风险行与申请方理由，四个选项即四档范围。

## Alternatives considered

**只保留 QuickPick 作为决定入口。** 零新增 UI。否决：备注是人在阅读卡片依据时作出的决定的一部分，两个入口会在收集什么、拒绝什么上逐渐漂移。

**在扩展侧推导计划与产物清单。** 不改运行时，扩展也能列文件。否决：面板会绕过运行时去读 `.specdev`，重复运行时的计划解析与产物命名，而它读到的旧状态会与紧挨着渲染的状态互相矛盾。

**为文件链接再定义一种意图。** 否决：`@` 引用路径已经过发送门禁同一套工作区校验；另开一条路要重复同样解析，还可能在转义上产生分歧。

**在 markdown-it（`rich-markdown.ts`）里做链接化。** 否决：面板经安全子集渲染器渲染，轻量对话 HTML 经它的浏览器源码镜像渲染；第三个实现恰恰会在子集本要保证的转义规则上分叉。

**卡片直接以提示词发送下一步。** 一次点击即继续。否决：下一步是运行时给编排者的指引，直接发送会花掉一次人并未要求的回合；填入输入框让人自己拿捏措辞。

## Consequences

快照现在有两个可选视图。更旧的载荷仍然能渲染——字段缺省即不渲染相应行——单行非法只丢弃该列表而不是整份状态。`SPECDEV_SCHEMA_VERSION` 为 4；投影严格解析线上视图，因此含非法行的载荷会记录 fold 失败而不是降级显示。

bridge 帧 `specdev/status` 增加 `lastScope?`，仅供显示：守卫的会话范围仍是权威，卡片不做任何放行。

卡片自己不写入任何东西。每个决定都经扩展抵达 `confirmGate`，备注要求也在运行时看到决定之前于扩展处强制。运行时仍会拒绝次序不对的门禁，因此命令面板与卡片在同一套规则下行为一致。

`path:line` 链接化只作用于消息正文；输入框保留它的 `@` 路径。

## Testing

`packages/specdev/specdev/tests/ide-view.spec.ts` 固定计划三种状态、无计划时的缺省、产物行（工作流级、按阶段、仅 UI 的行、ready 与 missing、POSIX 路径）；`tests/projection.spec.ts` 固定 fold 的接受与对非法行的 fail-closed 拒绝；`packages/ide/ide-bridge/tests/bridge-session-frames.spec.ts` 固定 v4 线上视图与行级拒绝。`apps/vscode-dsh/tests/cap-webview.spec.tsx` 固定状态条（计划、角色、放行范围）、产物点击、下一步填入、门禁表单（依据、风险、禁用打回、决定与备注意图）与正文 `path:line` 跳到该行；`tests/cap-chat-panel.spec.ts` 固定 Host 转发决定与备注、丢弃不带决定的帧、渲染器的文件链接与浏览器源码一致性夹具；`tests/cap-interaction.spec.ts` 固定无备注打回的提示；`tests/cap-conversation.spec.ts` 固定放行范围折叠进状态帧，以及决定与备注经 `specdev/confirm-gate` 的往返。

## Related

[视觉链说明](2026-09-30-specdev-visual-chain.zh.md)拥有本面所渲染的 `ui` 声明与门禁；[工作流权威说明](2026-09-29-specdev-workflow-authority.zh.md)拥有日志与投影规则；[权限模型说明](2026-09-30-specdev-permission-model.zh.md)拥有状态条点名的放行范围；[SpecDev 子系统文档](../../../../docs/subsystems/specdev.zh.md)给出面向使用者的图景，[应用 README](../../../../apps/vscode-dsh/README.zh.md) 给出面板自身行为。
