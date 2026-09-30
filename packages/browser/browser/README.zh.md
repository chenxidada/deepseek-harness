---
description: "浏览器自动化服务（ctx.browser）：部署方与插件作者如何通过可互换的提供方打开浏览器会话，并共享同一套选择策略、会话生命周期与错误词汇。"
kind: "package-reference"
---

# @deepseek-ai/dsh-browser

[English](README.md) | 中文

## 概述

任何插件或工具都可以通过 `dsh-browser`（`ctx.browser`）打开页面、对页面执行操作、读取其状态、把页面截取为图像，并录制可回放的 trace，而无须绑定某一种浏览器实现。后端以提供方身份注册，服务在会话打开时解析出一个可用的提供方，因此调用方从不需要关注会话背后运行的是哪个引擎。当你要构建浏览器工具或另一个后端时选择它；随包交付的面向模型工具（`dsh-tool-browser`）会自动挂载它。服务自身不启动浏览器，也不注册面向模型的工具：必须先挂载一个提供方，会话才能打开。会话复用、提供方选择、拆除与清理以及错误词汇都只有一个归属方，所以「这个 harness 驱动哪个浏览器、驱动多久」只有一个地方回答。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

需要浏览器自动化的组合加载 `dsh-browser` 服务并挂载一个后端；插件或工具作者随后直接调用 `ctx.browser.session(key)`，并使用返回会话的 `act()`、`observe()`、`startTrace()` 与 `stopTrace()`。服务按 key 解析一次后端，因此除非自行配置，调用方永远看不到提供方 id。

### 何时选择

当插件或工具必须驱动浏览器而不硬编码某个引擎时选择本服务；只使用随包交付的 `browser_*` 工具的部署通过 `dsh-tool-browser` 免费获得它。组合从不打开页面时则不需要它。服务不附带自己的浏览器：没有至少一个可用的提供方时，每次 `session()` 调用都以结构化 `BrowserError` 失败。

### 最小配置

加载服务，让唯一挂载的后端自动被选中，或用 `provider` 固定一个提供方 id。环境变量 `$DSH_BROWSER_PROVIDER` 供给同一个字段，并不是一条独立的优先级链。提供方专属设置属于后端自身的配置；本行只接受提供方 id。

```yaml
- name: '@deepseek-ai/dsh-browser'
- name: '@deepseek-ai/dsh-browser-playwright'
  config:
    mode: launch
    allowedOrigins: ['http://localhost:*', 'http://127.0.0.1:*']
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `provider` | （未设置） | 固定的提供方 id；未设置时在恰好一个已注册提供方可用时自动选中 |

### 打开与复用会话

`session(key)` 打开由某个对话 key 拥有的浏览器会话并返回它；之后用同一个 key 调用会返回该会话，而请求只在会话创建时生效。同一个 key 的并发调用共享同一次打开，因此两个并行的工具调用绝不会启动两个浏览器。打开失败会忘记该 key，使下一次调用重试。`close(key)` 是幂等的：未知 key 是无操作，而失败的打开没有任何东西需要关闭。

```text
// One conversation, one session: both calls return the same session.
const session = await ctx.browser.session(key)
const reused = await ctx.browser.session(key)
```

### 动作与观测

`act()` 执行一个 `BrowserAction`，并返回操作之后的页面状态：`navigate`（自带快照开关）、`click`、`type`（可选用 submit）与 `press`。`observe()` 在不改变页面的前提下读取：无障碍 `snapshot`、以 PNG 字节与页面身份作答的渲染 `screenshot`、保留的 `console` 条目，或保留的 `network` 交换记录。两者都是本包拥有的闭集联合类型，因此新增动作或观测是跨 browser 各包的协同变更，而不是插件扩展。

### 截图捕获

`observe({ kind: 'screenshot', fullPage })` 捕获可见 viewport；当 `fullPage` 为 true 时捕获整张可滚动页面，并以 `BrowserScreenshot` 作答——媒体类型 `image/png` 加上编码后的 `Uint8Array`——与页面的 URL 和标题并列。这些字节以数据形式离开 seam：图像最终去往何处（附件、模型请求、文件）由消费方决定，而随包交付的工具通过附件服务提交捕获结果。

### Trace 录制

`startTrace()` 记录会话的上下文——连同每次动作的 DOM、无障碍与屏幕状态——直到 `stopTrace()` 写出一个归档文件，并以它的绝对路径作答，即一个 `BrowserTraceArtifact`。该归档供人在 trace 查看器中回放；seam 的唯一结果就是该路径，归档的任何部分都不会进入模型请求。在另一次录制进行中启动会以 `BROWSER_TRACE_ALREADY_RECORDING` 失败，没有录制就停止会以 `BROWSER_TRACE_NOT_RECORDING` 失败，而提供方未配置归档位置的会话每次启动都会以 `BROWSER_TRACE_UNAVAILABLE` 失败。归档写在哪里归提供方所有；seam 的会话 spec 不携带 trace 字段。

### 提供方选择

每个会话在打开时解析自己的提供方，注册顺序或加载顺序从不影响结果。已配置的提供方 id 在已注册且可用时胜出；没有配置 id 时，服务运行唯一可用的提供方，否则明确失败：

| 情形 | 结果 |
|---|---|
| 已配置 id 已注册且可用 | 通过该提供方打开 |
| 已配置 id 未注册 | `BROWSER_PROVIDER_CONFIGURED_MISSING` |
| 已配置 id 已注册但不可用 | `BROWSER_PROVIDER_CONFIGURED_UNAVAILABLE` |
| 无 id，恰好一个已注册且可用的提供方 | 通过它打开 |
| 无 id，没有可用提供方 | `BROWSER_PROVIDER_UNAVAILABLE` |
| 无 id，多个可用提供方 | `BROWSER_PROVIDER_AMBIGUOUS` |

提供方的可用性是一次廉价的本地检查——例如是否配置了 origin 白名单——绝不会启动浏览器或连接端点，因此选择始终快速且确定。

### 会话生命周期

服务拥有它打开的每一个会话，以调用方的 key 为键，并标记打开它的提供方。销毁服务会关闭全部会话，注销提供方会关闭该提供方打开的会话，因此被重载的插件绝不会泄漏它启动的浏览器。关闭会话会释放其上下文，并丢弃从未停止的录制：只有 `stopTrace()` 写出过，归档才存在。取消以调用为单位：被取消的动作让会话保持打开且可复用，而被取消的打开会释放它已获取的资源。

### 失败与恢复

失败抛出带稳定、可机器路由错误码的 `BrowserError`；消息补充细节，例如缺失的提供方 id、有歧义的候选集合或已关闭的会话。要更换某个会话使用的后端，请关闭该会话并重新配置固定的 id、挂载或卸载提供方，或修复提供方配置使其可用性检查通过。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释服务背后的设计决策；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计理念

本包建立在两项有意的分离之上：

- **seam 拥有归属关系；提供方拥有浏览器。** 服务决定哪个提供方运行、会话何时创建与何时消亡；打开浏览器进程或连接、应用默认值与执行导航策略都属于提供方，而提供方从看不到对话 key。
- **默认值只解析一次，且是显式的。** `BrowserProvider.resolve(request)` 在 `open()` 之前把调用方的可选请求变成完全指定的 `BrowserSessionSpec`，因此打开与执行阶段永不重新取默认值，更换提供方也不会悄悄改变会话打开时的约定。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`BrowserRuntime` 服务、提供方注册表、执行期选择与会话撤销 |
| [`src/types.ts`](src/types.ts) | 词汇：会话请求与 spec、闭集 `BrowserAction` 与 `BrowserObservation`、条目与结果类型（包括截图载荷与 trace 产物），以及 `BrowserError` |
| — | 不发布运行时不变式伴生入口；提供方映射与会话映射都是私有的，选择与撤销通过公开的 `session()`／`close()` 调用被运用，seam 不发布独立的注册表或会话观测流。 |

### 数据模型

请求、spec、动作与观测类型定义了调用方构建其上的规范化词汇，`BrowserScreenshot` 与 `BrowserTraceArtifact` 承载两个非文本结果，穷尽式字段与 JSDoc 位于 [`src/types.ts`](src/types.ts) 和 [browser 子系统](../../../docs/subsystems/browser.zh.md)参考文档中。两项有意的选择塑造了它们：`BrowserAction` 与 `BrowserObservation` 是本包拥有的闭集联合类型，因此新增成员会在每个提供方与消费方处造成编译错误，直到被处理；`BrowserSessionRequest` 让每个字段保持可选，而 `BrowserSessionSpec` 声明了每一个承载策略的字段，这正是默认值步骤得以显式的原因。

### 会话流程

`session(key)` 在 key 已知时返回既有条目；否则它先解析提供方、解析 spec，并在等待之前把进行中的打开以该 key 存入映射，因此同一个 key 的并发调用会汇入同一次打开，而不是启动第二个浏览器。被拒绝的打开会移除该 key；`close(key)` 先移除条目，忽略已经交付给打开方的那次拒绝，然后关闭那次打开产出的东西。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级约定不够用时阅读以下页面。它们从共享词汇逐步进入随包交付的后端与面向模型的工具。

- [browser 子系统](../../../docs/subsystems/browser.zh.md)——穷尽式的会话词汇、提供方可用性与错误码。
- [browser 包映射](../README.zh.md)——三包家族与各角色。
- [dsh-browser-playwright](../browser-playwright/README.zh.md)——随包交付的 Playwright 后端、其模式与白名单。
- [dsh-tool-browser](../tool-browser/README.zh.md)——构建于本服务之上的面向模型 `browser_*` 工具。

-----

<a id="model-experience"></a>
## 模型体验

### 面向模型的行为

#### 模型看到的内容

本服务没有任何内容直接进入模型请求：[browser 工具](../tool-browser/README.zh.md)拥有每个工具名称、描述、参数与结果文本，`ctx.browser` 自身不贡献提示词区段。因此服务所做的决定只会以一次 browser 工具调用成功或失败的形式被模型看到。

#### Token 影响

没有直接的 token 开销；所有面向模型的 token 归上述消费方所有。

#### KV Cache 影响

不会直接导致失效；任何请求前缀变化均由上述消费方负责。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制说明服务在哪些情况下自身并不完整。它们是当前包约束。

- **没有提供方状态观测面**——既没有提供方变更事件，也没有能力状态查询；可用性只能通过调用 `session()` 并路由抛出的错误码来观测，而无提供方失败是通用的 `BROWSER_PROVIDER_UNAVAILABLE`，没有逐提供方的原因枚举。
- **每个 key 一个会话，每个会话一个页面**——seam 为一个对话 key 复用恰好一个会话，不提供标签页模型、第二个页面，也无法从同一个对话寻址两个页面。
- **请求不携带按会话的策略**——viewport 与 storage state 是它仅有的输入；origin 白名单、超时、缓冲区大小与 trace 位置来自所挂载提供方的配置，因此同一部署的每个对话都运行在相同的限制之下。
- **捕获以数据形式离开 seam**——`observe({ kind: 'screenshot' })` 以编码后的 PNG 字节作答，`stopTrace()` 以绝对路径作答；二者在此都不会成为模型请求，图像是被存储、展示还是丢弃由消费方决定。
- **trace 录制需要提供方侧的位置**——会话 spec 不携带 trace 字段，因此提供方未配置归档目录的会话每次 `startTrace()` 都会以 `BROWSER_TRACE_UNAVAILABLE` 失败。
- **从未停止的录制不会留下归档**——只有 `stopTrace()` 写出过，归档才存在；关闭会话或销毁服务会丢弃正在进行的录制。
- **会话句柄不跨进程存活**——销毁会关闭 seam 拥有的每个会话，因此重启后的 harness 没有任何可复用的东西，已存储的 key 也不指向任何对象。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本开发备注是维护者的工作上下文：开放问题与尚未决定的探索方向。它明确不具权威性——已交付的行为与限制以上文为准。

#### 未来：观测提供方状态

目前既不存在提供方变更事件，也不存在能力状态查询；消费方只能通过打开会话并路由抛出的错误码来观测可用性。一个小的观测面可以报告逐提供方的原因，但目前没有消费方需要它。

</details>
