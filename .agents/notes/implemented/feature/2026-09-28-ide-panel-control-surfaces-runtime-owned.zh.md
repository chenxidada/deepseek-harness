# Agent Note: IDE 面板控制面调用持有该决策的运行时服务

Status: implemented

[English](2026-09-28-ide-panel-control-surfaces-runtime-owned.md) | 中文

## 问题

四项由运行时持有的决策在 VS Code 面板里没有可用控制，面板只能对问不出来的部分做近似。

模型选择没有任何可见效果。`model/select` 写下的默认值，SDK 服务端只在创建会话时读取，而 `extension.ts` 并未注入 `requestSelectModel`，因此选择器改的是一个偏好，页签继续与上一个模型对话。图片对任何路由都放行：`dsh-llm-deepseek` 声明 `deepseek-v4-pro` 只收文本，而运行时会为目录中不含图片模态的模型把图片投影成占位文本，附件可能在没有提示的情况下被降级。

子代理可以经它的页签观看，却无法被寻址：没有任何东西列出某会话的子代理或后代，没有任何东西继续一个可继续的子代理，也没有任何东西停止它。

审批策略只能靠切换权限预设间接更改，而预设选择器显示的是原始键，因为 `permission/list` 只回预设 id；询问与决定的审计以 `approval/asked`、`approval/decided` 事件存在，却没有面去折入它们。SpecDev 状态——活动工作流、阶段、Human Gate、下一步动作——完全不可见，其中就包括一个正在等人确认的门禁。

## 决策

每个控制都是一条 bridge 帧，解析持有该决策的运行时服务，外加驱动它的面板面。

**模型路由。** `dsh-sdk-jsonrpc-server` 发布 `sdkModelSelect`，它创建、恢复或 fork 的每个会话都装入一份 `ModelSelection`，供下一次 prompt 组装读取。`model/select` 先按运行时的模型目录校验路由，交给该服务让 live 会话采用，之后才保存为后续会话的默认值；正在运行的轮次保持它组装时使用的路由。目录的 `vision` 标志标记支持图片的模型，当附件落在不含该标志的路由上时，composer 明示图片只会以占位文本到达模型。composer 还按读到的字节声明每个附件的媒体类型——PNG、JPEG、WebP 或 GIF——只有在字节不含签名时才沿用平台的 `File.type`，因为运行时会拒绝与自身探测结果相矛盾的声明（JPEG 字节配 `image/jpg` 标签、扩展名写作 `.png` 的 WebP）。该次发送的用户气泡携带同一份字节，附件因此无需二次读取即可显示在对话中。从日志折出的会话只有持久引用，因此由 `attachment/read` 经附件存储解析它，读到的字节再补写到该气泡上；读取以单张图片为单位，被存储拒绝的一张只让那个气泡不带它。

**子代理。** `subagent/list` 从子代理目录答出某会话的子代理或后代，`subagent/prompt` 在其持久父会话的权限下继续其中一个子代理（`mode: 'continuable'`，绝不会是新的根），`subagent/interrupt` 在同一父会话下中止一个。只有当子代理可继续且未在运行时，composer 才提供发往它的地址；对空闲或已结束的子代理执行 `subagent/interrupt` 按无操作成功，因为与自然完成竞争不该读作失败。

**审批。** `approval/policy` 报告某会话的生效策略——它的覆写值，否则为配置值。`approval/policy/set` 经审批服务切换策略，该服务会持久记录这次变更并在模型下一步时告知它；面板自己从不写策略。`approval/asked` 与 `approval/decided` 折入 Timeline 行，日志持有的审计因此可见。

**SpecDev。** `specdev/snapshot` 返回工作区状态（slug、stage、门禁、各阶段步骤、loop count、next action、技术债），没有活动工作流时返回 `null`。`specdev/confirm-gate` 是唯一写入，委托给 `ctx.specdev.confirmGate`，由它持有门禁次序、工件前置条件与 `specdev/gate-decided` 的持久追加；拒绝以运行时自己的 code 与 message 到达面板。`dsh.specdevStatus` QuickPick 与面板状态卡都镜像该读取所报的内容，状态卡唯一的行动把待决门禁交回 Host，由它询问决定（通过／驳回／推迟，后两者可附说明）。

**权限预设。** `permission/list` 携带每个预设的 `name` 与 `description`，选择器因此显示产品文案而不是原始键。

SpecDev 状态是工作区状态而非日志状态。扩展因此不在本地折事件，而是在每条 `specdev/*` 事件、页签被激活、历史行被打开时重读。

## 考虑过的替代方案

**切换模型时重启 SDK 运行时。** 重启是唯一还能拾取组合变更的机制。否决：它会结束所有 live 会话及其在途轮次，而服务端已经能把新路由交给每个 live 会话的下一次 prompt 组装——切换的代价是一次往返，而不是一个会话。

**把模型选择做成只对未来会话生效的偏好，并加提示。** 这就是代码原来的行为，只需再加一句提示。否决：用户的手势针对的是眼前这段对话；承诺一件面板并不兑现的事，比为它做真实的切换更糟。

**由扩展判定门禁是否合法。** 状态卡可以本地通过或驳回并写工作区文件。否决：门禁次序、工件前置条件与持久追加属于 specdev 服务，第二个裁判会与持有它们的工作流发生漂移。

**在扩展里折入 `specdev/*` 事件。** 事件带有阶段与门禁迁移。否决：面板的断言针对运行时写入的工作区文件，而另一个窗口可以推进同一工作流；折出的副本会显示过期的门禁且无从察觉。

**用一条通用 `control/invoke` 帧承载子代理、审批与 SpecDev。** 帧种类更少。否决：每个目标应答的字段与拒绝文本都不同，通用通道要么接受未校验的载荷，要么为每个目标长出各自的 schema——这正是既有帧族已经做过的选择。

**对任何路由都放行图片，降级交给运行时。** 不读目录、不加提示。否决：composer 是用户还能看见「模型不会读这张图片」的最后一处。

## 后果

模型切换到达每个 live 会话的下一次请求；页签的路由行跟随 `request/header` 与 `request/context`，因此只有在运行时真正用过之后才报告该选择已生效。

每个控制都按会话寻址并需要 live Agent；没有 live Agent 时帧被拒绝，面板以提示展示运行时的消息。因此 `approval/policy/set` 与 `subagent/*` 不适用于 replay 页签。

SpecDev 状态按工作区作用域，因此在一个页签启动的工作流会出现在该工作区的每个页签，门禁询问由扩展的交互呈现器给出，而不是面板内部。

按设计，`subagent/interrupt` 对空闲目标报告成功；需要知道一个轮次是否真的被中止的调用方应读子会话的事件，而不是这条确认。

已发送的图片在其页签持有 composer 字节期间由这些字节显示，页签重开后则由附件存储显示：从日志折出的会话只带引用，因此面板先读回每张图片再推送该气泡的图片。运行时不可达期间打开的页签保留该消息的文本，并在之后某次打开解析成功时补上图片。

## 测试

`packages/ide/ide-bridge/tests/bridge-session-frames.spec.ts` 钉住模型、子代理、审批、SpecDev 与附件读取帧的校验与应答，含未知会话、服务缺失与拒绝文本。`packages/sdk/server/tests/server.spec.ts` 钉住选择会到达 live 会话、被拒绝的路由不会被保存。`packages/llm/llm-deepseek/tests/adapter.spec.ts` 钉住已发布目录的模态。`apps/vscode-dsh/tests/cap-conversation.spec.ts` 经 Host 驱动子代理、审批策略与 SpecDev 的往返，钉住 `specdev/*` 事件会触发重读，钉住被 prompt 的图片随乐观用户气泡一同呈现，并钉住重放图片回显在读回成功与被拒绝两种情形下的结果。`apps/vscode-dsh/tests/cap-interaction.spec.ts` 钉住门禁决定呈现器（通过不问说明，驳回与推迟各收一条）；`apps/vscode-dsh/tests/cap-webview.spec.tsx` 钉住状态卡、门禁行动、到达 composer 的地址、标签有误的附件所声明的媒体类型、用户气泡渲染的图片，以及带图补写帧为已重放气泡加上的图片；`apps/vscode-dsh/tests/cap-chat-panel.spec.ts` 钉住拒绝与图片提示。

## 相关

这些帧行走于 [IDE Host bridge](../../../../docs/subsystems/ide-bridge.zh.md)；其背后的服务见[子代理子系统](../../../../docs/subsystems/subagent.zh.md)、[审批子系统](../../../../docs/subsystems/approval.zh.md)与 [SpecDev 子系统](../../../../docs/subsystems/specdev.zh.md)。面板为这些控制搭配的读取见[IDE 读取 Agent Note](2026-09-28-ide-panel-reads-runtime-state.zh.md)，承载子代理地址与图片提示的 composer 见[斜杠目录 Agent Note](2026-09-28-ide-composer-slash-catalog.zh.md)。
