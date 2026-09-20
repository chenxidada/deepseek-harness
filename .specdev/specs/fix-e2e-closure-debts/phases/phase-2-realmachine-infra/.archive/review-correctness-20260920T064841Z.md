# Correctness Review — Phase 2 (phase-2-realmachine-infra)

## 视角
**Implementation Correctness** — 代码是否正确工作

## 判决
**PASS**

（静态/确定性部分全部正确落实；AC-4/5/6/7/8/9 的运行时真机终验留 verifier，本报告只审代码路径是否真实、桩是否缺席、AC-13 诚实登记是否成立。）

## 逐条 AC 验证

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-1 | 新增 `dsh.test.*` 命令 `VSCODE_DSH_TEST=1` 门控、注册于 `shouldRegisterTestHooks` 分支；无 agent-loop/业务逻辑变更 | `extension.ts:1012` `if (shouldRegisterTestHooks(vscodeArg))` + `:1578 queryWebviewRenderState` + `:1331+ listChildren` + `:1331+ resetToIdle`；`shouldRegisterTestHooks` 定义 `:2628`（`VSCODE_DSH_TEST==='1'/'true'`） | ✅ | 三个新命令均在 `testDisposables.push(...)` 块内（闭合于 `:1594`）；`git diff --name-only | grep packages/core/agent-loop` 为空；改动仅落 `chat-panel`/`conversation-controller`/`extension`/`webview`/`test-scripts`，无产品业务逻辑 |
| AC-4 | DEBT-2 按 AC-13 诚实登记（SDK 无 `agentPreset` 覆盖 seam） | `packages/sdk/server/src/server.ts:462-501` `createForkedSession` | ✅（登记成立） | 亲自追码确认：`createForkedSession` 入参仅 `cut?: { emptySeed?: boolean; boundarySeq?: number }`；`:473` `presets?.composedPreset(parentAgent.ctx)` 读父 preset，`:482` `meta.agentPreset = parentPreset` 硬编码继承，`:493-495` `composeFrom(childCtx, parentAgent.ctx)` 绑父 standing composition；`agentOptions` 仅 `provider/model/reasoningEffort/maxTokens`，无 preset 覆盖入口。fork RPC 确实无 `agentPreset` seam，「不改产品/SDK 分叉语义就修不动」理由成立，非狡辩 |
| AC-5 | DEBT-3 `intervalMs` 150→50 + 六段分段指令，`requireIncrement` 保持 true | `layer-v-capabilities.json` #18 stream 步 | ✅ | manifest diff 确认：`intervalMs: 50`、`requireIncrement: true` 未放宽；`sendPrompt` 指令由四行扩为六段；`$assistantContains:LAYER-V-CAP-18-OK` 原样未改。运行时稳定性留 verifier |
| AC-6 | DEBT-7：9 项 webview 能力升级为 concreteAssertion（8 项真修 + 1 项 AC-13） | `probes.ts` / `protocol.ts` / `chat-panel-host.ts` / `message-bridge.ts` / `chat-ui-store.ts` / `extension.ts` / manifest | ✅ | 见下方「AC-6 实现核查」详表；8 项 `renderState.*:true` concreteAssertion + 1 项 `cap-delete-confirm-modal` 诚实登记 DEBT-13 |
| AC-7 | DEBT-10：两项 `requiresModel:false` + 新增 `cap-delegate-subagent-model` 真实委托 | `layer-v-capabilities.json` + `conversation-controller.ts:1807 listChildren` + `extension.ts listChildren 命令` | ✅ | 两项 `requiresModel` true→false；`cap-delegate-subagent-model` `requiresModel:true`，步骤 `sendPrompt`→`wait(dsh.test.listChildren, children.0 $assistantContains)`；`tool-subagent` 确在 base bundle `cordis.patch.yml:355-360` 挂载（`provider: spawn, toolName: subagent`） |
| AC-8 | DEBT-12：idle 断言保持原语义 + 复位生效 | `extension.ts resetToIdle` + `conversation-controller.ts:1839 resetForTest` + `capability-runner.cjs:767` | ✅ | `cap-extension-activate`/`cap-test-hooks` 的 `idle` 断言原样未动（manifest 本批未改断言语义）；`resetToIdle` 调 `orchestrator?.onUserStop()`（`auto-start-orchestrator.ts:195-199`：`state='idle'`/`pending.length=0`/`autoRetryUsed=false`）+ `resetForTest()`（清 `contextSessionId` + 关 pinned 子 tab） |
| AC-9 | DEBT-12：全链每项能力前后复位、exit code 反映真实结论 | `capability-runner.cjs:724-768 runManifest` | ✅（静态） | 复位接入 `runManifest` 循环（`runCapability` 唯一调用点，覆盖单能力+全链）；`continue`（凭据跳过）在 `:747`、复位在 `:767`，跳过项不触发复位；失败 best-effort（`resetToIdle` catch 仅 journal，不改判决/退出码契约）。41 项串行 + exit code 终验留 verifier |
| AC-12 | 回归护栏 | `cap-test-harness.spec.ts:1661` mockHost | ✅（静态） | mockHost 对 `dsh.test.resetToIdle` 增 no-op 应答，属 runner 行为契约更新、非断言改动（所有 `CAP-TEST-HARNESS-*` 语义不变）。vitest/tsc 实际通过与否留 verifier 复跑 |
| AC-13 | 诚实登记：DEBT-2 + `cap-delete-confirm-modal` 真修不动不取巧 | `tech-debt-registry.md` DEBT-2/DEBT-13 | ✅ | 两处「做不动」均亲自追码确认成立（见 AC-4 与下方 DEBT-13 核查）；未放宽断言/未删 manifest 项/未改探针/未用 `forkOverride` 测试桩冒充真实分叉 |

## AC-6 实现核查（DEBT-7 渲染探测通道）

三处改动逐层追码确认真实，非空壳：

1. **webview 探测面** `probes.ts`：`DshProbes` 新增 `queryTestIds()`/`getRenderState()`；`queryTestIdsInDom()` 真实遍历 `document.querySelectorAll('[data-testid]')`；`computeRenderState()` 把 9 项映射为布尔。`data-testid` 值经核对存在：`editor-chat-root`（`App.tsx:64`）、`tab-chrome`（`TabChrome.tsx:70`）、`composer`（`Composer.tsx:55`）、`delete-confirm-modal`（`DeleteConfirmModal.tsx:17`）。
2. **协议帧** `protocol.ts`：`HostToWebviewMessage` 增 `probe/query-render-state`；`WebviewToHostMessage` 增 `probe/render-state`；`parseWebviewToHostMessage` 补分支并严格校验（`testIds` 全 string、`renderState` 全 boolean，否则 `undefined` fail-closed）。`attach()`（`chat-panel-host.ts:353-357`）已把 parse 结果接入 `onWebviewMessage`。
3. **host 接收 + 门控命令**：`chat-panel-host.ts` `onWebviewMessage` 缓存 `lastRenderState` 并 resolve 等待者；`queryWebviewRenderState(timeoutMs)` 无 port 即 reject、超时 fail-closed、成功后清除 timer；`extension.ts` `dsh.test.queryWebviewRenderState` 门控注册、catch 返回 `{ok:false,reason}`。

manifest 8 项由 `assert(dsh.showPanel + panelOpen/viewId)` 改为 `wait(dsh.test.queryWebviewRenderState + renderState.*:true, timeoutMs:15000)`。`wait` 语义（轮询重试 + 命令自身 fail-closed）与 `assessClosedLoop` 的 `actualTrigger`（命令非 UI-prep）+ `concreteAssertion`（`renderState.*` 具体布尔）匹配。

## Stub Detection（桩代码检测）

### 已注册桩（对照 registry）
| Registry ID | 文件:函数 | 状态 | 说明 |
|-------------|-----------|:--:|------|
| DEBT-2 | `server.ts:462 createForkedSession` | ⚠️ Known（AC-13 残留） | 已如实登记「本工作流外」，非桩而是 SDK 分叉语义缺口 |
| DEBT-13 | `cap-delete-confirm-modal` manifest 项 | ⚠️ Known（AC-13 登记） | modal 条件渲染无 host 触发，已登记 |

### 新发现的未注册桩
无。`git diff` 对全部改动文件 grep `@STUB`/`TODO: wire`/`FIXME`/硬编码 `return true`/`return Ok(0)` 空壳：仅命中 `probes.ts:547` `if (typeof document === 'undefined') return []`，这是 `queryTestIdsInDom()` 的 SSR 防御早退（合法，非桩）。

## 关键发现

### 🔴 Must-Fix
无。

### 🟡 Should-Fix
无（不阻塞）。

### 🟢 Observations
- **`computeRenderState` 含一段冗余/误导性代码**：`probes.ts` 中 `editorPanelViewtype`/`reactSpaHtmlBuilder`/`webviewHtmlInjection` 三者初始均赋 `rootHasChildren`，随后 `if (rootHasChildren && testIds.length > 0)` 块又把后两者重设为 `true`——该块是 no-op（两者本就是 `rootHasChildren`），注释却声称「component testid 存在也证明 SPA mounted / html-builder 产出 / webview 注入」，暗示存在额外逻辑而实际没有。不影响行为，但属误导性死代码。
- **[文档保真] 三能力语义坍缩**（供 reviewer-design 参考，不计入判决）：`cap-editor-panel-viewtype`/`cap-react-spa-html-builder`/`cap-webview-html-injection` 三项最终坍缩为同一 `rootHasChildren` 信号。其中 `editor-panel-viewtype` 旧断言 `viewId:"dsh.editorChat"` 本可直接校验 viewType，新断言 `renderState.editorPanelViewtype` 实为 `#root 有子节点`，**不再校验 viewType 本身**。代码能正确工作（返回合法布尔、属 webview 内部信号而非 host 侧弱证据），但「三项共享同一 React 挂载载体」的可区分度存疑，属语义充分性判断，移交 reviewer-design。

### AC-13 诚实登记核查结论
- **DEBT-2**：`server.ts` `createForkedSession` 硬编码继承父 preset，无 `agentPreset` 覆盖 seam，`forkOverride` 测试桩被刻意弃用——「不改产品/SDK 分叉语义就修不动」**成立**，非「做不动」借口。
- **DEBT-7 `cap-delete-confirm-modal`**：`DeleteConfirmModal` 仅 `App.tsx:131` `ui.deleteConfirm` 条件渲染；`openDeleteConfirm` 仅被 `TabChrome.tsx:208/298` 与 `HistoryPanel.tsx:249` 的 webview 内部点击调用；`protocol.ts` 无任何 host→webview 的 open-delete-confirm 帧，`dsh.test.deleteConversation` 走 `controller.deleteConversation({confirmed})` 直删、不经 modal。故「host 侧无触发 hook」**成立**，DEBT-13 登记诚实。

## 结论
五条债务的静态/确定性处置全部真实落地：三个新 `dsh.test.*` 命令门控正确、8 项 webview concreteAssertion 逐层连通、DEBT-10 两步 + base bundle `tool-subagent` 就位、DEBT-12 复位命令 + 驱动接入点正确、DEBT-3 调参未放宽断言。两处 AC-13 登记经独立追码确认理由成立。运行时（真机 + key）终验与 41 项 exit code 留 verifier。
