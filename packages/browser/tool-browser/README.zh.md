---
description: "构建于 ctx.browser 之上的面向模型浏览器工具（browser_navigate、browser_snapshot、browser_click、browser_type、browser_press、browser_console、browser_network、browser_screenshot、browser_trace_start、browser_trace_stop、browser_close）：部署方如何启用与配置它们，以及模型看到的内容。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-browser

[English](README.md) | 中文

## 概述

有了 `dsh-tool-browser`，模型可以打开页面、读取其无障碍树、对该树列出的元素执行操作、检查页面记录了哪些日志与请求、把页面捕获为图像，并录制一段供人回放的 trace，这一切都通过浏览器服务（`ctx.browser`）完成。当模型需要驱动真实浏览器时选择本包；三个交互工具、截图工具与两个 trace 控制工具各自独立注册，因此部署用一个配置字段即可分别关掉每一组。每个浏览器都属于打开它的对话：每个对话 key 一个会话，后续调用复用它，由 `browser_close` 或 seam 自身的清理释放。导航只限于部署允许的 origin，被拒绝的 URL 会以说明原因的方式失败，而不是加载。随包交付的 base bundle 以禁用状态挂载本行。

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

在已挂载浏览器服务与一个后端的组合中加载本包；它把 `browser_*` 工具加入模型的工具集。随包交付的 base bundle 以 `disabled: true` 挂载本行，因此部署需在自己的 overlay 中启用它。

### 何时选择

当模型需要导航页面并与之交互、而不只是抓取文本时选择本包：`browser_navigate` 打开 URL 并返回页面的无障碍快照，`browser_snapshot` 再次读取当前树，`browser_click`、`browser_type` 与 `browser_press` 对该树列出的元素执行操作，`browser_console` 与 `browser_network` 报告页面记录的日志与请求，`browser_screenshot` 把页面捕获为图像，`browser_trace_start` 与 `browser_trace_stop` 录制一段供人回放的会话，`browser_close` 释放浏览器。以 `interact: false` 配置的只读部署会注册除 `browser_click`、`browser_type` 与 `browser_press` 之外的全部工具。

### 最小配置

在同一个 overlay 中启用本行并声明提供方的 origin 白名单；base bundle 已挂载 seam 及其 Playwright 提供方。

```yaml
- id: browser-playwright
  config:
    mode: launch
    allowedOrigins: ['http://localhost:*', 'http://127.0.0.1:*']
- id: tool-browser
  disabled: false
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `interact` | `true` | 注册 `browser_click`、`browser_type` 与 `browser_press` |
| `screenshot` | `true` | 注册 `browser_screenshot`；该工具还需要已挂载的附件服务 |
| `trace` | `true` | 注册 `browser_trace_start` 与 `browser_trace_stop`；录制还需要提供方的 `traceDir` |
| `maxConsoleEntries` | `50` | 一次 `browser_console` 调用返回的条目数量上限 |
| `maxNetworkEntries` | `50` | 一次 `browser_network` 调用返回的条目数量上限 |

两个读取上限都必须是正整数，并在插件加载时断言；模型给出的 `limit` 会被夹到配置上限与至少一个条目之间。`screenshot` 与 `trace` 默认为 true，其余由部署的组合决定：只有在附件服务已挂载时 `browser_screenshot` 才会注册，而在提供方拥有 trace 位置之前录制都会失败。

### 十一个工具

| 工具 | 作用 |
|---|---|
| `browser_navigate` | 打开绝对 http(s) URL，并返回页面标题、其 URL 与无障碍快照 |
| `browser_snapshot` | 再次读取当前无障碍快照；可选的 `maxChars` 声明本次读取的字符上限 |
| `browser_click` | 点击由 ARIA role 与 accessible name 指定的元素，然后返回页面状态与新的快照 |
| `browser_type` | 填充指定字段，可选择按下 Enter，然后返回页面状态与新的快照 |
| `browser_press` | 在获得焦点的元素上按下一个键盘按键，然后返回页面状态与新的快照 |
| `browser_console` | 读取保留的控制台消息与页面错误，并按严重级别过滤 |
| `browser_network` | 按请求顺序读取保留的网络交换，可选择只要失败的 |
| `browser_screenshot` | 通过附件服务把页面捕获为 PNG，并将其与页面身份一起返回；可选的 `fullPage` 覆盖整张可滚动页面 |
| `browser_trace_start` | 开始录制本对话浏览器会话的 trace |
| `browser_trace_stop` | 停止录制、写出归档文件，并报告其路径与查看方式 |
| `browser_close` | 关闭本对话的会话并释放它持有的浏览器 |

### 与页面交互

`browser_navigate` 返回的无障碍快照把页面元素列为 ARIA role 与 accessible name 对，而正是这些对用于寻址 `browser_click` 与 `browser_type`。每次交互都在同一次工具调用内先执行动作、再重新读取页面，因此模型无需另一次往返即可看到点击或按键的结果；`browser_press` 把一个按键发送给当前获得焦点的元素。参数来自快照而非 HTML：名称必须与快照展示的一致。

```text
browser_navigate({ url: 'https://example.com' })
browser_click({ role: 'link', name: 'More information...' })
```

### 把页面捕获为图像

`browser_screenshot` 捕获当前页面，通过附件服务提交该 PNG，并以文本信封加上一个模型可直接查看的图像块作答。`fullPage` 默认为 false；整页捕获更大、更可能超出部署的图像限制，违反限制的捕获会失败，并提示改为捕获可见 viewport 或减小会话的 viewport。该工具捕获的是浏览器渲染后的页面，这正是它与 `browser_snapshot` 并存的原因：版式、样式、图表与渲染部件都没有无障碍树。

两个条件为该调用设门，且都在捕获任何内容之前检查。必须已挂载 `ctx.attachments`——没有它，该工具根本不会注册。调用 agent 所在的路由必须声明图像输入：工具会解析被路由到的提供方与模型，除非 `inputModalities` 包含 `image`，否则拒绝，因此纯文本或无法解析的路由得到的是明确原因，而不是模型无法读取的图像。

```text
<type>screenshot</type>
<page>{title|(untitled)} — {url}</page>
<content>
Screenshot of {the visible viewport|the whole scrollable page}: image/png image, {W}x{H} px, {N} bytes
</content>
```

### 录制 trace

`browser_trace_start` 开始录制本对话的浏览器会话——从那一刻起记录每次动作及其 DOM、无障碍与屏幕状态——并返回 `{ recording: true }`。`browser_trace_stop` 结束录制、写出一个归档文件，并返回 `{ path }`，其文本给出文件名以及供人打开它的方式。录制需要提供方的 `traceDir`：没有配置时启动会以 `BROWSER_TRACE_UNAVAILABLE` 失败，录制进行中再次启动会以 `BROWSER_TRACE_ALREADY_RECORDING` 失败，没有录制就停止会以 `BROWSER_TRACE_NOT_RECORDING` 失败。该归档是一个供人在 Playwright trace 查看器中回放的 zip，并且永远不会成为模型请求的一部分：录制会话正是部署为之后检查它的真人留下证据的方式。

### 每个对话的会话身份

每个工具都用调用对话的 key——即该对话的 session id——通过 seam 解析会话，因此后续调用会到达同一个页面，而第二个对话会得到自己的浏览器。`browser_close` 关闭该会话，下一次 browser 调用会打开一个新会话。没有所属对话的调用会失败，而不是凭空造一个 key，因为那会泄漏一个浏览器。

### 失败与恢复

失败的 seam 调用会变成错误工具结果，其文本是 `BrowserError` 消息——其中包括白名单之外的导航（`BROWSER_ORIGIN_DENIED`）、已关闭的会话（`BROWSER_SESSION_CLOSED`）、trace 错误码（`BROWSER_TRACE_UNAVAILABLE`、`BROWSER_TRACE_ALREADY_RECORDING`、`BROWSER_TRACE_NOT_RECORDING`），或缺失、不可用、有歧义的提供方。`browser_screenshot` 会报告自己的拒绝原因：没有挂载附件服务、路由无法解析、模型路由未声明图像输入，以及捕获超出部署的图像限制。没有所属对话的调用会报告它需要这样一个对话。缺失或类型错误的必填参数会在执行前被工具 schema 拒绝。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释工具背后的设计决策；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计理念

本包建立在两条规则之上：

- **消费方拥有面向模型的约定。** 工具名称、参数名称、描述、结果格式化与卡片标题都定义在这里；提供方选择、默认值与导航策略留在 `ctx.browser` 及其提供方内。工具绝不枚举提供方，也绝不调用 `available()`。
- **启用状态驱动注册。** 工具在组合启用它时注册，与后端可用性无关，因此插件加载顺序、配置状态与 HMR（热模块替换）时机永远不会进入面向模型的约定。`browser_screenshot` 还跟随附件服务的生命周期：`ctx.attachments` 挂载期间它才注册，该存储卸载时它随之撤销。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：配置 schema、加载时上限断言、工具注册 |
| [`src/tools.ts`](src/tools.ts) | 十一个工具定义：参数、seam 调用、输出 schema、呈现元数据 |
| [`src/format.ts`](src/format.ts) | 纯格式化器：页面报告、快照、控制台与网络读取、截图信封、trace 报告 |
| [`src/key.ts`](src/key.ts) | 从所属 agent 派生的对话会话 key |
| — | 不发布运行时不变式伴生入口；这个面向模型的适配器不持有自己的生命周期，它使用的每一项关系都归 browser seam 或工具注册表所有。 |

### 交互流程

一次交互先解析会话、执行动作，再通过第二次 seam 调用读取快照后才作答，因此一次工具调用报告的就是交互之后的页面。两次调用都会收到该工具的取消信号，并且 `browser_navigate` 与三个交互工具都会声明 60 秒的协作式工具调用预算，交由 `dsh-tool-call-timeout-policy` 强制执行。

### 读取流程

`browser_console` 与 `browser_network` 把模型的 `limit` 夹到配置上限，并把过滤（`level`、`failedOnly`）交给 seam，然后渲染最新的条目，并在较旧的保留条目被丢弃时附加提示。`browser_snapshot` 把可选的字符上限转发给 seam，并按导航完全相同的格式渲染快照文本。

### 截图与 trace 流程

`browser_screenshot` 在读取页面之前先检查附件服务与调用路由的图像模态，随后经由 seam 捕获，用附件存储的 `saveImage` 提交字节，并返回一个规范值，其渲染同时产生文本信封与图像块；存储因尺寸、像素或字节限制而拒绝时，会被翻译成唯一仍可能成功的那种修复。两个 trace 工具保持轻量：`browser_trace_start` 调用 `startTrace()` 并返回 `{ recording: true }`，`browser_trace_stop` 调用 `stopTrace()` 并渲染返回的路径以及供人打开它的两种方式。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级约定不够用时阅读以下页面。它们从共享词汇逐步进入服务与其背后的后端。

- [browser 子系统](../../../docs/subsystems/browser.zh.md)——穷尽式的会话词汇、提供方可用性与错误码。
- [browser 包映射](../README.zh.md)——三包家族与各角色。
- [dsh-browser](../browser/README.zh.md)——工具经由其执行的浏览器服务。
- [dsh-browser-playwright](../browser-playwright/README.zh.md)——随包交付的后端、其模式与 origin 白名单。

-----

<a id="model-experience"></a>
## 模型体验

### 工具定义

#### 模型看到的内容

十一个 `browser_*` 工具及其描述与参数：`browser_navigate` 接受一个绝对 `url`；`browser_click` 与 `browser_type` 接受 ARIA `role` 与 accessible `name`，输入时再加 `text` 与 `submit`；`browser_press` 接受一个 `key`；`browser_snapshot` 接受可选的 `maxChars`；`browser_console` 接受 `level` 与 `limit`；`browser_network` 接受 `failedOnly` 与 `limit`；`browser_screenshot` 接受可选的 `fullPage`；两个 trace 工具与 `browser_close` 不接受任何参数。

#### Token 影响

每个已注册工具都会为每次请求增加固定的描述与 schema token 开销；`interact: false` 会连同其描述一起移除三个交互工具定义，`screenshot: false` 或未挂载附件服务会移除 `browser_screenshot`，`trace: false` 会移除两个 trace 定义。

#### KV Cache 影响

只要已注册工具集合及其描述不变，前缀就保持稳定；启用或禁用交互、截图或 trace，或插件生命周期，可能使从第一个变化的工具定义起的复用失效。

### 页面报告

#### 模型看到的内容

`browser_navigate`、`browser_click`、`browser_type` 与 `browser_press` 返回 `Page: <title>`、`URL: <url>`、一个空行以及无障碍快照，页面没有标题时显示 `(untitled)`。被截断的快照以 `[snapshot truncated to fit the character cap; narrow the target or read a smaller region]` 结尾，而没有任何无障碍内容的页面渲染为 `(the page reported no accessibility content)`。`browser_snapshot` 只返回快照文本。

#### Token 影响

数据相关结果会重复发送直到压缩（compaction）；快照大小由提供方解析出的字符上限约束，交互的读回不额外增加往返。

#### KV Cache 影响

仅追加；新可见内容位于可复用请求前缀之后，不会使现有 KV Cache 条目失效。

### 控制台与网络读取

#### 模型看到的内容

`browser_console` 渲染 `Console messages (<count>):` 以及每个条目一行 `[<level>] <text> (<location>)`，或者 `No console messages were recorded for this session.`。`browser_network` 渲染 `Network requests (<count>):`，每个交换一行 `<method> <url> -> <status> (<resourceType>)`，没有响应时显示 `no response`，失败的交换带 `[failed]` 后缀，或者 `No network requests were recorded for this session.`。当请求的上限丢掉了更早的保留条目时，两者都会追加 `[older entries omitted; read again with a larger limit]`。

#### Token 影响

每次调用由 `maxConsoleEntries` 与 `maxNetworkEntries` 设界；保留的结果会重复发送直到压缩。

#### KV Cache 影响

仅追加；新可见内容位于可复用请求前缀之后，不会使现有 KV Cache 条目失效。

### 截图与 trace 结果

#### 模型看到的内容

`browser_screenshot` 以信封 `<type>screenshot</type>`、一行包含标题与 URL 的 `<page>`，以及一行说明捕获区域、媒体类型、像素尺寸与字节数的 `<content>` 作答，旁边是由所存附件支撑的图像块。`browser_trace_start` 返回 `Trace recording started; call browser_trace_stop to write the archive.`，`browser_trace_stop` 返回 `Trace recording saved to <path>. Open it with "npx playwright show-trace <path>" or by dropping the file onto https://trace.playwright.dev — the archive is a zip only a person can read.`

#### Token 影响

trace 文本是两个只在对应工具运行时才保留的短结果；图像块的请求开销取决于被路由到的模型与附件服务自身的限制，而捕获只报告页面身份、不读取无障碍树，因此它绝不替代快照。

#### KV Cache 影响

仅追加；新可见内容位于可复用请求前缀之后，不会使现有 KV Cache 条目失效。

### 失败结果

#### 模型看到的内容

失败的调用会变成错误结果，其文本是 seam 的消息，例如被拒绝的 origin、已关闭的会话或有歧义的提供方，或是工具自述的截图与 trace 拒绝之一。`browser_close` 成功时返回 `Browser session closed.`，而没有所属对话的调用会报告 `browser tools require an owning agent session`。

#### Token 影响

只有失败调用会增加这些保留 token。

#### KV Cache 影响

仅追加；错误位于可复用请求前缀之后，不会使现有 KV Cache 条目失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制说明工具在哪些情况下不完整或需要部署配合。它们是当前包约束。

- **截图需要支持图像的模型路由与存储**——除非附件服务已挂载且调用路由的模型声明图像输入，否则该工具不捕获任何内容；不具备图像能力或无法解析的路由会被拒绝，超出部署图像限制的捕获会失败，而不是被缩减。
- **trace 归档是给人看的**——`browser_trace_stop` 报告路径以及打开它的方式；该 zip 永远不进入模型的上下文，也没有工具会把它读回。
- **追踪需要提供方的 `traceDir`**——没有配置时 `browser_trace_start` 会以 `BROWSER_TRACE_UNAVAILABLE` 失败，而随包交付的 base bundle 未配置任何位置。
- **交互需要 accessible name**——没有选择器、坐标或 frame 参数，因此无障碍树未命名的元素无法被寻址。
- **`maxChars` 可以提高快照上限**——工具把它原样转发给 seam，而提供方只在参数缺省时应用其配置上限；夹住更大的值应当属于 seam 的快照观测。
- **启用与否是部署的决定**——随包交付的 base bundle 以禁用状态交付本行，而一旦启用，唯一的导航限制是后端的 origin 白名单。
- **每个对话一个浏览器**——会话 key 是该对话的 session id，因此两个对话绝不共享浏览器，一个对话在关闭之前只保留一个页面。
- **没有页面状态能撑过会话关闭**——`browser_close`、提供方卸载或服务销毁都会连同其 cookie 与页面状态结束会话，之后的调用从零开始。
- **被截断的快照只是被截断，没有分页**——截断的快照附带提示，模型必须重新读取更小的目标；没有续读或窗口化读取。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本开发备注是维护者的工作上下文：开放问题与尚未决定的探索方向。它明确不具权威性——已交付的行为与限制以上文为准。

无。

</details>
