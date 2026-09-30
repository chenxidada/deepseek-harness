# 浏览器自动化

[English](browser.md) | 中文

浏览器自动化 seam 在同一个 `ctx.browser` 服务上横跨**两项操作**（动作与观测）以及 trace 录制，并拆分到多个包：Service Definition（[dsh-browser](../../packages/browser/browser)，`ctx.browser` + 提供方注册表）、Service Provider（[dsh-browser-playwright](../../packages/browser/browser-playwright)）与 Consumer（[dsh-tool-browser](../../packages/browser/tool-browser)，即十一个 `browser_*` 工具）。浏览器自动化是**一项可选能力**，不属于 agent loop（智能体循环）主干，因此其词汇定义在此而非 [core.md](core.zh.md) 中。更换后端不会改变模型要求页面做什么，更换提供方也不会改变对话使用的会话 key。截图离开 seam 时是 PNG 字节，录制离开 seam 时是写入提供方自有位置的归档文件；把图片经附件服务提交、并由此进入模型请求，属于消费方。

源码：[`packages/browser/browser/src/types.ts`](../../packages/browser/browser/src/types.ts)

## 会话请求与已解析的 spec

调用方要求的很少：`BrowserSessionRequest` 只携带可选的 `viewport` 与可选的 `storageStatePath`，其余字段都由提供方决定。`BrowserSessionSpec` 是该决定的结果——origin 白名单、导航与动作超时、快照字符上限、控制台与网络缓冲区大小、生效的 viewport，以及可选的 storage state——由 `BrowserProvider.resolve(request)` 在 `open()` 之前产出。因此默认值只有一个来源，打开与执行阶段永不再取默认值。`BrowserSessionKey` 是调用方从其服务的对话派生出的品牌化不透明身份；提供方从看不到它，因为 `open()` 只接收已解析的 spec。

## 动作

`BrowserAction` 是闭集联合类型；提供方对它的分支以 `assertNever(...)` 收尾，因此新增成员是跨 browser 各包的协同变更，而不是插件扩展。

| 动作 | 携带 | 效果 |
|---|---|---|
| `navigate` | `url`、`snapshot` | 在 origin 白名单之下加载 URL，可选择在同一次往返中捕获快照 |
| `click` | `role`、`name` | 点击无障碍树所命名的元素 |
| `type` | `role`、`name`、`text`、`submit` | 替换所命名字段的内容，并可选择按下 Enter |
| `press` | `key` | 把一个键盘按键发送给获得焦点的元素 |

`act()` 返回动作之后立即取得的 `BrowserPageState`：当前 URL、文档标题，以及被请求的快照或 `null`。

## 观测

`BrowserObservation` 是永不改变页面的读取操作的闭集联合类型。每个分支携带自己的过滤条件，每个结果都以相同的 `kind` 作为判别标记。

| 观测 | 携带 | 结果 |
|---|---|---|
| `snapshot` | 可选 `maxChars` | `BrowserSnapshot`：无障碍文本及其截断标志 |
| `screenshot` | `fullPage` | `BrowserScreenshot`，与当时的 `BrowserPageState` 并列 |
| `console` | `level`、`limit` | 保留的 `BrowserConsoleEntry` 值及截断标志 |
| `network` | `failedOnly`、`limit` | 保留的 `BrowserNetworkEntry` 值及截断标志 |

控制台条目携带页面的严重级别（映射到闭集 `error` | `warning` | `info` | `debug` | `log`，其他严重级别保留为 `log`）、消息文本，以及 `url:line:column` 位置或 `null`。网络条目携带方法、URL、响应状态或 `null`、`failed`，以及浏览器报告的资源类型；`failed` 覆盖传输错误、中止，以及状态码 400 及以上的任何响应。`screenshot` 是唯一以数据而非文本作答的观测分支：`BrowserScreenshot` 是 `mediaType: 'image/png'` 加上编码后的 `Uint8Array`，`fullPage` 在可见 viewport 与整张可滚动页面之间取舍，其旁的页面状态携带 URL 与标题，`snapshot` 为 `null`。

## Trace 录制

`BrowserSession.startTrace()` 记录会话的上下文——连同每次动作的 DOM、无障碍与屏幕状态——直到 `BrowserSession.stopTrace()` 写出一个归档文件并以 `BrowserTraceArtifact` 作答，即部署的 trace 查看器所打开的绝对路径。归档位置归提供方所有：Playwright 后端在配置的 `traceDir` 缺失时创建它，未配置时以 `BROWSER_TRACE_UNAVAILABLE` 拒绝启动，因为会话 spec 不携带 trace 字段。生命周期归 seam 所有：录制进行中再启动为 `BROWSER_TRACE_ALREADY_RECORDING`，没有录制就停止为 `BROWSER_TRACE_NOT_RECORDING`，只有 `stopTrace()` 写出归档文件，而关闭会话会丢弃从未停止的录制。归档永不进入模型请求；seam 的唯一结果就是它的路径。

## 提供方可用性

提供方的 `available(): boolean` 是一次廉价的**本地**检查（是否配置了白名单、是否配置了端点），**必须不**启动浏览器或连接端点。它是执行期选择的输入，不是健康检查系统：`session()` 读取它来挑选可用提供方，而选择失败会以调用方据以路由的结构化 `BrowserError` 呈现。

选择从不依赖注册、配置或 HMR（热模块替换）顺序：一项能力要么有显式提供方 id（配置 `provider`，或供给同一字段的 `$DSH_BROWSER_PROVIDER`），要么在恰好一个可用提供方注册时自动选中；没有配置 id 而有多个可用提供方时为 `BROWSER_PROVIDER_AMBIGUOUS`，而不是先到先得。

## 会话归属与清理

服务拥有每个会话，以调用方的 `BrowserSessionKey` 为键，并标记打开它的提供方。同一个 key 的并发调用汇入同一次进行中的打开，因此一个对话不会意外打开两个页面。`close(key)` 是幂等的，而失败的打开会忘记该 key，使下一次调用重试。关闭会话会释放其上下文，这也会丢弃从未停止的录制。销毁服务会关闭它拥有的每个会话，注销提供方会关闭该提供方打开的会话——正是这条归属规则让被重载的插件不会泄漏浏览器。

## 服务

`BrowserRuntime` 注册提供方，对重复 id 抛出 `BROWSER_DUPLICATE_PROVIDER`，在会话打开时解析提供方，并把已解析的 spec 交给该提供方。浏览器、页面，以及观测背后的每个缓冲区都归提供方所有。

错误按归属方划分。seam 抛出选择与注册错误码：`BROWSER_DUPLICATE_PROVIDER`、`BROWSER_PROVIDER_CONFIGURED_MISSING`、`BROWSER_PROVIDER_CONFIGURED_UNAVAILABLE`、`BROWSER_PROVIDER_UNAVAILABLE` 与 `BROWSER_PROVIDER_AMBIGUOUS`。Playwright 后端对其白名单之外的导航补充 `BROWSER_ORIGIN_DENIED`，对已关闭的会话补充 `BROWSER_SESSION_CLOSED`，并补充 trace 错误码 `BROWSER_TRACE_UNAVAILABLE`、`BROWSER_TRACE_ALREADY_RECORDING` 与 `BROWSER_TRACE_NOT_RECORDING`。`BrowserError extends HarnessError`，带开放式字符串 `code`，因此提供方可以抛出自己的错误码，消费方必须容忍它们。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxbrowser--browserruntime"></a>

### `ctx.browser` — `BrowserRuntime`

The browser automation service. Registered as `ctx.browser` (one instance per context). It owns provider selection and session lifetime; the selected provider owns the browser itself.

Selection semantics (resolved at execution time, never order-dependent):

- A configured id that is registered and `available()` → that provider.
- A configured id not registered → `BROWSER_PROVIDER_CONFIGURED_MISSING`.
- A configured id registered but unavailable → `BROWSER_PROVIDER_CONFIGURED_UNAVAILABLE`.
- No id configured, exactly one registered usable provider → that provider.
- No id configured, multiple usable providers → `BROWSER_PROVIDER_AMBIGUOUS`.
- No id configured, no usable provider → `BROWSER_PROVIDER_UNAVAILABLE`.

```ts cordis-catalog
/**
 * Register a provider. Throws {@link BrowserError} `BROWSER_DUPLICATE_PROVIDER`
 * if its id is already registered. Returns a disposer; disposed with the
 * calling fiber.
 * @param provider - the provider; its `id` is the registry key.
 * @returns the disposer that unregisters the provider.
 */
registerProvider(provider: BrowserProvider): () => void

/**
 * Open or reuse the session owned by one key. The request is applied only
 * when the session is created; later calls with the same key reuse the
 * existing session and ignore the request. A failed open forgets the key so
 * the next call retries.
 * @param key - opaque conversation identity owned by the consumer.
 * @param request - optional viewport/storage-state request; the provider owns
 *   the defaults, applied through `BrowserProvider.resolve`.
 * @param signal - cancels only the open this call starts.
 * @returns the live session for `key`.
 */
async session(key: BrowserSessionKey, request: BrowserSessionRequest = {}, signal?: AbortSignal): Promise<BrowserSession>

/**
 * Close and forget the session owned by one key. Idempotent: an unknown key
 * is a no-op, and an open that failed owns nothing to close.
 * @param key - the identity passed to {@link session}.
 * @returns a promise that settles when teardown quiesces.
 */
async close(key: BrowserSessionKey): Promise<void>
```

Source: [`packages/browser/browser/src/index.ts`](../../packages/browser/browser/src/index.ts)
<!-- END GENERATED cordis-surface -->
