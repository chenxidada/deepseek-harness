# Agent Note: VS Code 面板从运行时读取会话状态

Status: implemented

[English](2026-09-28-ide-panel-reads-runtime-state.md) | 中文

## 问题

VS Code 扩展用自己的副本回答了几个运行时本就持有答案的问题。历史行、标题与「路径→会话」检索档来自扩展写进 `workspaceState` 的索引；token 计量保留的是从用量事件折出的计数；打开历史行时假定该会话仍然存在；也没有任何面报告一次请求实际使用的 provider 与模型。副本与运行时逐渐分叉：被另一个窗口删除或改名的会话仍然列着，而会话正文完全不可检索，因为 `ide` profile 把 `session-query-sqlite` 挂成 `openAt: never`，且 bridge 没有查询服务的读取帧。

三条协议项没有可用端点：`error` 帧没有发送方；`session/continue-capability` 没有发送方，而扩展对同一个问题做静态判断；四条 Webview intent（`ui/search-open`、`ui/open-timeline`、`action/delete`、`action/new-conversation`）也完全没有发送方。反过来，Host 已发送的若干帧没有 Webview 消费方，于是面板在 Host 持有事实之处显示自己的默认值。

## 决策

四条 bridge 帧暴露这些读取，各自解析持有该事实的运行时服务：

| 帧 | 数据来自 |
|---|---|
| `session/stat` | `sessionPersistence`：运行时是否仍能找到该会话，连同其体积与 mtime |
| `projection/read` | 投影注册表，按会话与可选 key 列表寻址 |
| `session/search` | `sessionQuery.searchEvents`，保持该接口的页大小、snippet 与 cursor 规则 |
| `session/rename` | live 会话上的 `sessionTitle.rename`，应答新标题 |

`ide` patch 用 `openAt: first-search` 把 `session-query-sqlite` 行重述到 Harness home 下的持久路径，运行时的派生索引因此在用户首次正文检索时打开；并新增 `session-stats` 与 `session-turn-outline` 两行，使整日志的轮次与步骤计数可作为投影读取，而不必重放日志。

扩展在此前自行推导之处改为读取：

- 打开历史行先问 `session/stat`；`found: false` 会撤下该行，而不是去启动一个运行时无法恢复的会话。
- token 计量的压力信号来自 `projection/read` 的 `contextPressure`，即运行时对下一次请求的体积估算，与面板已累计的用量总数并列。
- `dsh.searchSessions` 把运行时的正文命中并列为 tier 3，与扩展自己的标题/预览（tier 1）和路径（tier 2）命中并列，并以运行时的 snippet 作为行详情；读取被拒或 profile 未挂索引时，元数据两档仍是答案。
- `dsh.renameConversation` 经 `session/rename` 写入并重读标题投影，因为会话日志中的标题由运行时持有。
- 页签最近一次请求的路由取自 `request/header` 与 `request/context` 事件，并以 `session/route` 帧推送，因此面板报告的是请求实际使用的 provider 与模型，而不是用户所做的选择。
- 历史列表与 `session/list` 对齐，因此扩展从未打开过的会话也会出现。

Host 早已推送的帧现在有了消费方：页签 chrome、`change/diff-content` 渲染、`change/mark-reviewed`、`change/revert-many`、`change/reveal-source` 配合 `scroll/reveal`、`ui/banner.kind` 样式、`ui/theme`，以及 `action/restore-more` 背后的 `deferredRestoreCount`。三条死协议项与四条未使用的 Webview intent 已删除。

## 考虑过的替代方案

**保留扩展索引作为历史行的唯一来源。** 最小改动是用 `workspaceState` 回答一切。否决：两个窗口随后会对同一个会话给出不同说法，且运行时无法恢复的行仍会被启动。索引仍保留扩展独有的事实——本窗口创建过哪些会话，以及运行时读取落地前的标题——运行时行与它并列。

**由扩展读取会话正文做检索。** `session/read-log` 已能返回日志行，扩展可以扫描它们。否决：运行时已有带分页、snippet 与 cursor 的派生索引，第二个扫描器等于对压缩 JSONL 重述这些规则；诚实的读法是读持有它们的服务。

**在扩展里从事件流折出投影值。** 事件同在这条通道上，`contextPressure` 可以在客户端算。否决：投影注册表才是该计量单位与折叠顺序的持有者，第二次折叠恰好在面板本应权威之处产生漂移。

**用一条 `session/read` 帧承载 stat、投影与检索。** 帧种类更少，一次往返。否决：这四项读取的归属、作用域与失败文本各不相同——被禁用索引拒绝的检索不该把 token 计量一并清空——而且 `session/rename` 会写入。

**为外部消费方保留 `error` 与 `session/continue-capability` 帧。** 否决：运行时并不存在发送方，而「能否继续」只有扩展自己的静态启发式在回答；保留这些帧等于保留一条这条通道并不兑现的承诺。

**从模型选择器的状态报告路由。** 不必读事件、不必新增帧。否决：选择器持有的是请求而非答案——运行时可以按请求回落到选择器从未命名的模型，而 `request/header` 记录了它实际做了什么。

## 后果

面板现在陈述用户可以据以行动的运行时事实：窗口之外被删除的会话不再提供打开，每个页签显示的模型是运行时实际请求使用的那个。

每条新增读取都需要 live bridge。`session/stat` 让每次打开历史多一次往返，读取失败时保留上一行而不报错；正文命中只在挂载了查询索引的 profile 上出现，因此扩展的元数据两档仍是检索的下限。

首次正文检索会在 Harness home 下打开一个 SQLite 索引，该 profile 现在会写它；即使此时还不存在任何会话，检索同样会打开。

扩展仍为标题与路径保留自己的 `workspaceState` 索引，因此 tier 1 与 tier 2 的新鲜度取决于上次索引刷新；另一个窗口创建的会话能命中正文，但只带有运行时的标题。

## 测试

`packages/ide/ide-bridge/tests/bridge-session-frames.spec.ts` 钉住四条帧的校验与应答，含未知会话、服务缺失与失败文本。`apps/vscode-dsh/tests/cap-conversation.spec.ts` 经 Host 对 fake runtime 驱动 `session/stat`、`projection/read`、`session/search` 与 `session/rename`，钉住正文命中的 tier 3 合并，并钉住 `request/header` 产生的路由帧。`apps/vscode-dsh/tests/cap-chat-panel.spec.ts` 钉住 token 采样的 `contextPressure` 修正与改名路径；`apps/vscode-dsh/tests/cap-webview.spec.tsx` 钉住渲染出的路由与带档位标注的检索行。`apps/vscode-dsh/tests/fixtures/fake-sdk-runtime.mjs` 提供这些测试使用的旋钮（`FAKE_STAT_LOG`、`FAKE_PROJECTION_LOG`、`FAKE_SEARCH_LOG`、`FAKE_SEARCH_ERROR`）。

## 相关

这些帧行走的通道及其帧族见 [IDE Host bridge 子系统](../../../../docs/subsystems/ide-bridge.zh.md)；挂载它们的 profile 见 [`ide` profile bundle](../../../../packages/bundle/ide/README.zh.md)。token 计量与路由所依据的读取见[投影 token 用量与请求上下文](../architecture/2026-07-29-projected-token-usage-and-request-context.zh.md)，消费这些目录的 composer 面见[斜杠目录 Agent Note](2026-09-28-ide-composer-slash-catalog.zh.md)。经运行写入的控制面见[IDE 控制面 Agent Note](2026-09-28-ide-panel-control-surfaces-runtime-owned.zh.md)。
