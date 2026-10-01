# Agent Note: IDE composer 的 `/` 菜单读取并执行运行时目录

Status: implemented

[English](2026-09-28-ide-composer-slash-catalog.md) | 中文

## 问题

VS Code 扩展的 composer 既读不到运行时的命令注册表，也没有拿一行去执行它的路径。用户在面板里键入 `/feature <描述>`，只看到这段文字作为普通 prompt 离开：`dsh-sdk-jsonrpc-server` 在 stdout 上只服务 `initialize`、`session/prompt` 与 `shutdown`，而 Web 客户端的命令业务面（`commands/list`、`commands/execute`、`skills/list`）走的是 `ide` profile 并未挂载的 Host API HTTP 传输。扩展自己的压缩按钮踩的是同一个坑：它以字面文本 `/compact` 到达模型，而不是执行同名命令。

从未 prompt 过的页签让它更糟：运行时不为它持有 Agent，而运行时里每条命令路径都要经 live Agent 解析注册表，因此菜单也无法沿用 Web「会话恒有 Agent」的前提。

## 决策

四条 bridge 帧承载这些目录与执行，一个新的 SDK 服务端服务为命令路径提供可执行的 live Agent。

`commands/list`、`commands/execute`、`agent-presets/list` 与 `skills/list` 加入 bridge 帧清单，各自应答一条 `<kind>/response` 帧，并各自解析运行时自己使用的服务（`ctx.commands`、`ctx.agentPresets`、`ctx.skills`）。它们保持为独立帧，因为各自的归属、作用域与失败文本都不同：preset 名册是部署级的，另外两条按 `sessionId` 寻址。

`ctx.sdkSessionEnsure` 从 `dsh-sdk-jsonrpc-server` 发布 `ensureSession(sessionId)`，委托给 `session/prompt` 同样使用的 `getOrCreateSession`。bridge 经 `ctx.get` 解析它，并在任何按会话寻址的请求找不到 live Agent 时调用，因此从空页签发起的命令运行在它首条 prompt 本会创建的同一套组合上——不存在第二条创建路径。

扩展把三份目录聚合在一对 Webview 帧之后（`composer/slash-query` → `composer/slash-candidates`），排序与截断都在 Host 完成。选中一行时，命令与技能插入 `/名字 `，agent 行插入裸 preset id，因为 preset 在会话创建时绑定，该行只是 prompt 提示而非命令。

已发送的命令行在 `@path` 与 prompt 门禁之前执行，因为命令的参数是自由文本。`commands/execute` 报出 `matched: false`——没有命令认领该行——时把该行交回 prompt 路径，而 `dsh-tool-skill` 的 `agent/pre-step` 边界正是在那里把行首的 `/name` 读作技能调用。结果是消息流中的一条本地提示：命令打印的内容由 composer 呈现，而不是模型。

## 考虑过的替代方案

**只列目录、不执行。** 最小的 bridge 改动会从注册表答出菜单，并把每条发送的行留在 prompt 路径上。否决：一个提供 `/feature`、转身又把 `/feature` 当散文发给模型的菜单，等于让扩展就运行时的行为撒谎，而这正是压缩按钮已有的缺陷。

**用一条 `slash/list` 帧承载三份目录。** 需要校验的帧更少，每次按键一次往返。否决是因为三份目录的作用域毫无共同点：合并会把部署级的 preset 名册与某会话的技能压在同一条失败文本之后，而只想读 preset 的调用方会被迫拖上一次会话读取。

**为技能增设专用执行帧。** 与 `commands/execute` 对称，可让技能行绕开 prompt 路径。否决：`agent/pre-step` 已经从任何 prompt 上读取行首 `/name`，技能只需被列出；第二条路径会让同一个名字拥有两种执行含义，并在技能调用发生变化时留下两处待改。

**只为 `commands/execute` 物化会话，** 让目录读取保持 Web `skills/list` 那样的非激活。否决：空页签将因此不显示任何技能，而且它的行来自与菜单之后那条 prompt 不同的组合。被接受的代价是：用户只是打开菜单的页签也会被物化出会话。

**把 agent 行做成命令插入（`/preset <id>`）。** 三组候选共用一种手势。否决：运行时侧没有任何东西会切换 live 会话的 preset，这样的插入会承诺一条命令做不到的切换。

**在行上报告每条命令的 `acceptsImages` 标志。** 注册表确实声明了它。否决：本桥完全不承载图片，该标志会宣传一种传输始终拒绝的能力；composer 改为对带附件的命令行弹出提示并让它保持普通消息。

## 后果

composer 的行就是运行时真相：菜单给出的每个名字都能在运行时使用的注册表里解析，而扩展在渲染之前就过滤掉部署无法挂载的 preset。命令输出到达用户而不进入模型上下文，因此后续轮次无法引用命令打印过什么；会话日志仍经命令注册表自身的事件记录这次运行及其结局。

扩展现在会在打开菜单时物化页签的会话。用户键入 `/`、看完列表再关掉页签，就留下了一个会话；而某会话的首次 `skills/list` 也要付出与它首条 prompt 相同的组合挂载代价。

`skills/list` 在这个面上是激活式的，而 Web 的同名 Remote 明确不是，因为 Web 的 composer 只会看到已经拥有 Agent 的会话。这处不对称是 IDE 空页签的代价；未来的某个面若要为一个它并不打算在其中运行的页签读目录，应当解析既有 Agent，而不是确保一个。

composer 的「压缩上下文」按钮与 `dsh.triggerCompact` 先走命令路径，只有在没有命令认领 `/compact` 时才回落到 prompt 路径，因此没有该命令的组合保持原有行为而不会失败。

## 测试

`packages/ide/ide-bridge/tests/bridge-command-frames.spec.ts` 覆盖四条帧的校验与应答，含服务缺失与无 live Agent 的失败；`packages/sdk/server/tests/plugin-apply.spec.ts` 证明 `ensureSession` 只物化一次并复用 live 会话。`apps/vscode-dsh/tests/cap-chat-panel.spec.ts` 钉住排序、缓存、无目录时的空应答、命令路由先于发送门禁，以及附件提示；`cap-webview.spec.tsx` 钉住菜单的插入、Escape、参数流与 agent 行 id。

## Related

Web 自己的命令业务面及其组装见 [web-command-surfaces Agent Note](../../archived/architecture/2026-07-25-web-command-surfaces-and-assembly.md)；prompt 路径保留的技能手势见[用户显式技能调用](../../archived/feature/2026-08-08-user-explicit-skill-invocation.md)，Web 目录如何跟随 preset 切换见[斜杠目录 Agent Note](../../archived/bug-fix/2026-08-10-slash-catalog-follows-preset-switch.md)。承载这些帧的通道与帧族见[IDE Host bridge 子系统](../../../../docs/subsystems/ide-bridge.zh.md)。
