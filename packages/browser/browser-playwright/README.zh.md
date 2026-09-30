---
description: "ctx.browser 的 Playwright 浏览器后端：部署方如何启动自有浏览器或附着到已运行的浏览器，以及每个会话继承的 origin、超时与缓冲区。"
kind: "package-reference"
---

# @deepseek-ai/dsh-browser-playwright

[English](README.md) | 中文

## 概述

有了 `dsh-browser-playwright`，harness 通过浏览器服务（`ctx.browser`）驱动真实浏览器：提供方要么启动一个从头到尾由它拥有的浏览器进程，要么附着到已经运行的浏览器。当组合需要通过 Playwright 获得页面导航、无障碍快照、按 ARIA 角色的交互、渲染后的 PNG 截图、可回放的 trace 归档，以及控制台与网络历史时选择它。每个会话都继承同一份 origin 白名单、viewport、导航与交互超时，以及有界的控制台与网络缓冲区，并且提供方在插件加载时断言其全部配置，因此配置错误的后端会让启动失败，而不是让第一个会话失败。Playwright 库在第一次打开时才加载，这使插件加载与配置工具链不必依赖它。面向模型的工具位于 `dsh-tool-browser`。

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

在已加载浏览器服务的组合中挂载本提供方；它以 `playwright` 提供方身份注册，因此当它是唯一可用后端时 `ctx.browser.session()` 会自动选中它——或者用 `provider: playwright` 固定它，随包交付的 base bundle 正是这样做的。

### 何时选择

当 harness 可以拥有浏览器且环境能运行浏览器时选择 `launch` 模式；当已有浏览器以远程调试或 Playwright 服务器方式运行、且会话应复用操作者自己的 profile 时选择 `attach` 模式。两种模式执行同一份 origin 白名单、超时与缓冲区上限，区别只在所有权与状态共享。

### 最小配置

加载浏览器服务与提供方。`mode` 是必填项，因为两种默认值都不安全：附着到没人启动的浏览器会在第一个会话就失败，而在禁止启动浏览器的环境中启动浏览器也会以同样方式失败。空的 `allowedOrigins` 不接纳任何东西，这会让提供方报告自己不可用。`traceDir` 是部署方在两个方向上的决定：配置它，会话才能录制 trace；不配置它，则每次启动都会被拒绝。

```yaml
- name: '@deepseek-ai/dsh-browser'
- name: '@deepseek-ai/dsh-browser-playwright'
  config:
    mode: launch
    allowedOrigins: ['http://localhost:*', 'http://127.0.0.1:*']
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `mode` | （必填） | `launch` 启动由本提供方拥有的浏览器；`attach` 连接到已经运行的浏览器 |
| `browser` | `chromium` | 自启浏览器使用的引擎；`chrome` 与 `msedge` 表示 chromium channel |
| `channel` | （未设置） | 传给 Playwright 的启动 channel，覆盖引擎名称所隐含的 channel |
| `executablePath` | （未设置） | 启动时复用的系统浏览器可执行文件 |
| `headless` | `true` | 自启浏览器是否在没有可见窗口的情况下运行 |
| `cdpEndpoint` | （未设置） | 运行中浏览器的 Chrome DevTools Protocol 端点（attach 模式） |
| `endpoint` | （未设置） | 运行中浏览器的 Playwright 服务器端点（attach 模式） |
| `allowedOrigins` | `[]` | 会话可导航到的 origin 模式；空列表不接纳任何东西 |
| `viewport` | `1280x720` | 未提出 viewport 请求的会话所使用的 viewport |
| `navigationTimeoutMs` | `30000` | 导航超时，单位毫秒 |
| `actionTimeoutMs` | `10000` | 单次交互超时（定位器解析、点击、填充），单位毫秒 |
| `snapshotMaxChars` | `20000` | 作用于单次无障碍快照的字符上限 |
| `consoleBufferSize` | `200` | 每个会话保留的控制台条目数，先丢弃最旧的 |
| `networkBufferSize` | `200` | 每个会话保留的网络条目数，先丢弃最旧的 |
| `storageStatePath` | （未设置） | 自启上下文启动时使用的 storage state 文件 |
| `traceDir` | （未设置） | trace 归档写入的目录，缺失时创建；未设置意味着会话无法录制 |

加载时断言覆盖 schema 无法表达的内容：attach 模式要求 `cdpEndpoint` 与 `endpoint` 恰好配置其一，而 launch 模式拒绝两者；超时必须为正、有限且位于 Node 的计时器范围内；字符与条目预算必须为正；viewport 尺寸必须为正整数；每个 `allowedOrigins` 条目必须是 `*` 或带 `http`／`https` scheme 的 `scheme://host[:port]`；并且配置的 `traceDir` 不得为空白。

### origin 白名单

会话只能导航到其白名单接纳的 origin。语法为 `*`，或 `scheme://host[:port]`，其中 scheme 为 `http` 或 `https`，host 为字面主机名或 `*`，port 为十进制端口或 `*`。未指定端口的模式只接纳该 scheme 的默认端口，因此 `https://example.com` 与 `https://example.com:8443` 保持互不相通。只有绝对 http(s) URL 可以匹配，比较依据是 scheme、host 与有效端口，因此未指定端口的 URL 按其 scheme 的默认端口参与比较。

### 观测

会话按需捕获无障碍树，并为每个页面保留两个有界缓冲区：控制台消息与页面错误，以及网络响应与失败。每个缓冲区保留最新条目，超过配置容量后丢弃最旧的，一次读取返回最新的切片以及截断标志。seam 闭集之外的浏览器控制台严重级别一律保留为 `log`，因此页面输出不会丢失。

### 截图

截图观测以会话的 `actionTimeoutMs` 运行 Playwright 的页面截图，并以 PNG 字节加上当前 URL 与标题作答，不含无障碍内容。`fullPage` 决定覆盖范围：false 时为可见 viewport，true 时为整张可滚动页面。提供方把 Playwright 的缓冲区复制为 seam 的 `Uint8Array`，自身不施加任何大小限制，因此对部署的附件存储而言过大的图像会在提交图像的地方被拒绝，而不是在这里。

### trace 归档

trace 录制是浏览器库的上下文设施，需要已配置的 `traceDir`：提供方没有配置时，会话的 `startTrace()` 会以 `BROWSER_TRACE_UNAVAILABLE` 被拒绝。启动会在目录不存在时创建它，开始录制 DOM 快照与屏幕截图，并预留归档路径 `<traceDir>/trace-<UTC 时间戳>-<序号>.zip`；在一次录制进行中再次启动会以 `BROWSER_TRACE_ALREADY_RECORDING` 失败。`stopTrace()` 写出该归档并返回其绝对路径，在没有录制时以 `BROWSER_TRACE_NOT_RECORDING` 拒绝，并让会话保持可用于下一次录制。该归档是供人在 trace 查看器中打开的 zip；harness 不会把它读回。关闭会话会释放上下文，并丢弃从未停止的录制。

### 失败与恢复

失败抛出带可机器路由错误码的 `BrowserError`。本提供方对白名单之外的导航或非 http(s) URL 抛出 `BROWSER_ORIGIN_DENIED`，对已关闭会话上的任何动作、观测或 trace 调用抛出 `BROWSER_SESSION_CLOSED`，对 trace 录制抛出 `BROWSER_TRACE_UNAVAILABLE`／`BROWSER_TRACE_ALREADY_RECORDING`／`BROWSER_TRACE_NOT_RECORDING` 错误码，对没有端点的 attach 提供方抛出 `BROWSER_PROVIDER_UNAVAILABLE`；无法选出提供方的情形由 seam 的选择错误码覆盖。浏览器已死掉的会话会在下一次调用时报告浏览器自身的失败。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释提供方背后的设计决策；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计理念

本包建立在三项有意的选择之上：

- **在加载时失败，而不是在第一个会话失败。** schema 填好每个默认值，随后显式断言拒绝不可能的端点组合、非正或超出范围的预算，以及不可用的 origin 模式，因此损坏的配置绝不会存活到第一次 `open()`。
- **seam 拥有 key；提供方拥有浏览器。** `open()` 从不接收对话 key，因此会话携带提供方本地身份，而归属、复用与清理仍归 seam。
- **惰性运行时导入。** `playwright-core` 在第一次打开时动态导入，因此加载插件——无论是通过 Loader 还是配置工具链——都不需要安装该库。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：配置 schema、加载时断言、提供方注册 |
| [`src/provider.ts`](src/provider.ts) | `PlaywrightBrowserProvider`：可用性、默认值、launch 与 attach 打开、清理归属 |
| [`src/session.ts`](src/session.ts) | 单个活动会话：动作、观测、截图、trace 录制与归档路径、控制台与网络环形缓冲区、已关闭会话拒绝 |
| [`src/policy.ts`](src/policy.ts) | 纯导航策略：origin 模式解析、URL 接纳、快照截断 |
| [`src/driver.ts`](src/driver.ts) | `playwright-core` 边界：惰性加载、启动、连接 |
| [`src/types.ts`](src/types.ts) | 本提供方驱动的收窄 Playwright 接口 |
| — | 不发布运行时不变式伴生入口；提供方不持有自己的注册表或事件流，它执行的每一项关系要么在加载时断言，要么经由 seam 的会话 API 被观测。 |

### 打开与清理归属

launch 模式的打开会启动浏览器、创建上下文与页面，并把关闭整个进程的清理交给会话，因此启动之后的失败会先关闭已启动的部分再重新抛出。attach 模式的打开在两个都存在时复用运行中浏览器的第一个上下文与页面，只创建缺失的部分；其清理会关闭它创建的上下文，否则只关闭它打开的页面，不动用户的浏览器及其其他上下文。每次获取都在下一个 await 可能失败之前记录自己拥有什么，因此被取消或失败的 attach 只释放自己的对象。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级约定不够用时阅读以下页面。它们从共享词汇逐步进入服务、面向模型的工具与运行限制。

- [browser 子系统](../../../docs/subsystems/browser.zh.md)——穷尽式的会话词汇、提供方可用性与错误码。
- [browser 包映射](../README.zh.md)——三包家族与各角色。
- [dsh-browser](../browser/README.zh.md)——本提供方注册进的浏览器服务。
- [dsh-tool-browser](../tool-browser/README.zh.md)——驱动本提供方的面向模型 `browser_*` 工具。

-----

<a id="model-experience"></a>
## 模型体验

### 快照文本

#### 模型看到的内容

间接地经由 `dsh-tool-browser`，模型看到本提供方用 `ariaSnapshot` 捕获的无障碍树，渲染为 YAML 形式的 role 与 name 对，并在会话的 `snapshotMaxChars` 处——或观测自行声明的更小 `maxChars` 处——截断。提供方不追加任何提示；截断标记由消费方添加。

#### Token 影响

没有直接开销。消费方渲染的每个快照都会重复发送直到压缩（compaction），其大小由该观测解析出的字符上限约束。

#### KV Cache 影响

不改变请求前缀；渲染快照文本可能造成的失效由消费方负责。

### 控制台与网络读取

#### 模型看到的内容

间接地经由 `dsh-tool-browser`，模型看到来自会话有界缓冲区的保留控制台条目（`level`、`text`、`location`）与网络交换（`method`、`url`、`status`、`failed`、`resourceType`），最新的在最后，并按观测的严重级别或仅失败标志以及其上限过滤。

#### Token 影响

没有直接开销。缓冲区大小限制一次读取能返回的内容；消费方渲染的行会重复发送直到压缩。

#### KV Cache 影响

不改变请求前缀；渲染这些行可能造成的失效由消费方负责。

### 截图与 trace 载荷

#### 模型看到的内容

不直接可见：截图观测以 `image/png` 字节与页面身份作答，`stopTrace()` 以所写归档的绝对路径作答。经由 `dsh-tool-browser`，这些字节变成由附件支撑的图像块，模型把它作为图像读取，而该路径变成带查看提示的结果文本。

#### Token 影响

没有直接开销。消费方的图像块与结果文本拥有全部模型可见 token，图像的开销遵循附件服务自身的限制。

#### KV Cache 影响

本提供方不改变请求前缀；追加图像块或结果文本可能造成的失效由消费方负责。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制说明提供方在哪些情况下不安全或不合适。它们是当前包约束。

- **捕获的是渲染后的页面**——截图观测以单张 PNG 返回可见 viewport 或整张可滚动页面；没有按元素范围的捕获、没有 PDF，字节到达消费方之前也没有任何尺寸缩减。
- **trace 录制需要位置**——`traceDir` 没有默认值，因此省略它的部署会让每次 `startTrace()` 都以 `BROWSER_TRACE_UNAVAILABLE` 被拒绝，而归档路径由提供方在该目录内选择。
- **attach 模式的 trace 覆盖复用的上下文**——录制是上下文设施，而 attach 模式复用运行中浏览器的第一个上下文，因此 trace 捕获的是该共享上下文的活动，而不是隔离上下文的活动。
- **从未停止的录制不会留下归档**——`close()` 与提供方卸载会释放上下文并丢弃它，因此归档只来自 `stopTrace()`。
- **实际上必须配置 `allowedOrigins`**——空列表会让 `available()` 返回 false，因此在部署声明至少一个模式之前，本提供方不参与任何选择。
- **浏览器动作不受 `sandboxPolicy` 约束**——进程与文件沙箱不约束浏览器；边界是 origin 白名单，以及部署是否启用面向模型的消费方。
- **每种模式都需要浏览器真实存在**——launch 模式需要已安装的引擎及其链接的系统库；attach 模式需要端点可达的运行中浏览器；任一种失败都会在第一次打开时暴露。
- **每个会话一个上下文、一个页面**——一个会话只驱动一个页面，没有标签页模型，也没有并行页面面。
- **attach 模式共享操作者的浏览器状态**——它复用第一个上下文与页面，包括 cookie、登录态与扩展，无法让 harness 与之隔离。
- **不拦截下载**——触发下载的导航既不保存也不上报。
- **句柄不跨进程存活**——会话属于拥有它的服务，提供方卸载时会关闭它力所能及的对象，因此重启后没有任何可复用的东西。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本开发备注是维护者的工作上下文：开放问题与尚未决定的探索方向。它明确不具权威性——已交付的行为与限制以上文为准。

无。

</details>
