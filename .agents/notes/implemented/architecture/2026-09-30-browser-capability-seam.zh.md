# Agent Note: 新增浏览器能力缝：Playwright 提供方与面向模型的工具

Status: implemented

[English](2026-09-30-browser-capability-seam.md) | 中文

## Problem

Harness 此前能读取网页（`web_search`、`web_fetch`），但无法驱动浏览器。因此 agent 既不能验证自己刚做完的前端改动，也读不到页面的 console 与网络活动，更无法操作那些只有在渲染之后、或只有在用户本人已登录的会话里才有意义的页面。Playwright 早已是 GUI e2e 套件的 devDependency，而 `ide` profile 现在默认使用通用 `standard` 预设，宿主注册的工具面在那里可以到达模型——缺的是能力本身，而不是启动路径。

## Decision

### 三个角色，一条能力缝（`ctx.browser`）

`dsh-browser` 拥有 provider 注册表、执行期选择与会话生命周期；`dsh-browser-playwright` 拥有浏览器；`dsh-tool-browser` 拥有面向模型的词汇。选择语义沿用 `ctx.web` 的形状（配置了 id 就必须存在且可用；未配置时必须恰好一个可用 provider，因此注册顺序从不决定结果），action/observation 两个联合是封闭的，新增成员意味着跨已知包的协同改动。`BrowserProvider.resolve(request): BrowserSessionSpec` 是显式的默认化步骤，对应 `dsh-shell` 的 request/spec 拆分。

### 会话按对话归属，由能力缝持有

`session(key, request?, signal?)` 每个 key 只打开一次——并发调用共享同一次 open——`close(key)` 幂等。服务销毁会关闭全部会话；卸载某个 provider 只会关闭它自己打开的会话，因此 HMR 重载不会把浏览器泄漏在一个已死的注册表条目后面。open 失败会忘记该 key，下次调用重试。

### Provider 惰性且携带策略

`playwright-core` 在 `open()` 内部动态导入，因此加载插件（以及引导它的目录生成器）从不要求该包或浏览器存在。`mode` 必填且无默认：`launch` 启动一个由 provider 拥有的浏览器并在关闭时结束整个进程；`attach` 通过 `cdpEndpoint` 或 Playwright server 的 `endpoint` 连接，并且只关闭自己打开的页面，绝不关闭用户的浏览器或上下文。`allowedOrigins` 没有宽松默认值——空白名单让 provider 处于不可用状态，白名单之外的导航在页面发生任何移动之前就以 `BROWSER_ORIGIN_DENIED` 失败。

### 工具在一次模型往返内组合能力缝调用

注册十一个工具：`browser_navigate`、`browser_snapshot`、`browser_click`、`browser_type`、`browser_press`、`browser_console`、`browser_network`、`browser_screenshot`、`browser_trace_start`、`browser_trace_stop`、`browser_close`。交互工具用 ARIA role 与 accessible name 定位元素——也就是快照打印出来的词汇——并在动作之后重新读取快照，因此一次模型调用既改变页面又报告页面。`execute` 返回 canonical JSON，`format.ts` 里的纯函数产出模型文本，`presentationMeta` 携带 URL 与标题供可重放的呈现使用。交互工具仅在 `interact` 为 true 时注册，`browser_screenshot` 仅在 `screenshot` 为 true 且已挂载附件服务时注册，两个 trace 控制工具仅在 `trace` 为 true 时注册。

### 截图经附件提交；trace 保持为文件

`screenshot` 观测以 `BrowserScreenshot`（`image/png` 加一个 `Uint8Array`）与页面身份作答，`browser_screenshot` 是它唯一的消费方：该工具要求已挂载 `ctx.attachments`，且被路由到的模型 `inputModalities` 含 `image`，用 `saveImage` 提交该 PNG，并把文本信封渲染在图像块旁边，因此模型收到的是一个已存储的附件，而不是它无法寻址的字节。`BrowserSession.startTrace()`／`stopTrace()` 产出 `BrowserTraceArtifact`，由 Playwright provider 写入其配置的 `traceDir` 之下；模型只收到该路径，因为 trace 归档是人的回放产物，不属于任何请求。

### 部署侧是 opt-in

`dsh-base` 挂载能力缝与 provider（惰性：在会话打开之前不会启动任何浏览器），并让 `tool-browser` 行保持 `disabled: true`。部署方在同一份 overlay 里启用该行并声明 provider 的 origin 白名单。因此随附组合的工具列表保持不变，已录制的会话工具 schema sidecar 也依然有效。

## Alternatives considered

**通过 `dsh-mcp-client` 挂载官方 `@playwright/mcp`。** 这是最快的路径，也是很好的实验，但大约 25 个固定 schema 会随每次请求一起发送，dsh 侧拿不到 origin 策略、拿不到呈现元数据，也无法裁剪工具集。作为产品级能力缝被否决；作为部署选项仍然可用。

**在工具结果里以原始字节返回截图。** 否决：图像块必须引用一个已持久提交的对象，而附件存储本就拥有图像准入限制与回放路径，因此该工具改为把 `ctx.attachments` 与路由的图像模态门禁组合起来。

**把 trace 记录进会话日志。** 否决：归档是供人在查看器中回放的 zip，而不是模型上下文；provider 把它写在部署的 `traceDir` 之下，模型只看到路径。

**手写 CDP 客户端。** 否决：Playwright 是本仓库已有且持续维护的依赖，而模型所依赖的行为正是它的自动等待定位器。

**采用 agent 向 MCP server 的 ref 式元素寻址。** 本轮否决：ref 需要一张以快照为作用域的 id 表，其生命周期就得由能力缝承担。role 加 accessible name 直接经 `getByRole` 解析，并与快照打印的内容一致。

**宽松的默认白名单（`*`）。** 否决：该能力可以到达任意 origin 并在那里动作，所以部署方必须声明它允许什么，而不是继承沉默。

## Consequences

- 在部署方启用后，模型获得浏览器能力；所有随附组合与快照 sidecar 保持不变。
- `playwright-core` 进入 `dsh-base` 的发布闭包；浏览器二进制仍由部署方提供（`npx playwright install`）或通过 attach 模式使用已有浏览器。
- 浏览器动作不受 `sandboxPolicy` 约束（后者管进程与文件）：边界是 origin 白名单加上启用开关。每个包 README、子系统页与工具目录都写明了这一点。
- 只有当组合挂载了附件服务且被路由到的模型声明图像输入时，截图才会到达模型；没有该存储时工具不会注册，而纯文本或无法解析的路由会在触碰页面之前拒绝调用。
- trace 是 Playwright provider 写在 `traceDir` 之下的文件，模型只读取其路径，因此未配置 trace 位置的部署会拒绝每次启动。
- `docs/subsystems/browser.md`、各生成物目录（工具、配置、Cordis、模块图、能力缝、执行管线）、`packages/README.md` 以及网站子系统注册表均已重录。

## Testing

`pnpm exec vitest run packages/browser` 通过 10 个文件 / 174 个测试，三个 `src` 树均达到逐文件 100% 覆盖率。覆盖范围包括单元套件、mock `playwright-core` 的 driver 套件、真实组合的 Loader 套件，以及一个在假 `playwright-core` 与记录型附件存储之上启动真实能力缝、provider 与工具的集成套件，因此一次面向模型的调用会穿越工具、能力缝、provider、会话、导航策略、图像提交与 trace 归档写入，只替换了浏览器库与持久化存储。截图行为经由附件能力缝与路由图像门禁固定，trace 行为经由假会话加真实归档写入临时目录固定。`pnpm run verify-cordis-config` 通过 147 个配置文件，`pnpm run test:docs` 通过全部 15 道门禁。
