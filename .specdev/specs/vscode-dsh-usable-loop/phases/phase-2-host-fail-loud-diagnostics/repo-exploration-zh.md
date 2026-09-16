# Phase 2 代码调研 — `phase-2-host-fail-loud-diagnostics`

| 项 | 值 |
|---|---|
| 模式 | **phase 级（per-Phase）**。`.specdev/specs/vscode-dsh-usable-loop/current-status.json` 中 `current_phase` = `phase-2-host-fail-loud-diagnostics`（非空） |
| 仓库根 | `/workspace/chendecheng/code/need/deepseek/deepseek-harness` |
| 工作流 slug | `vscode-dsh-usable-loop` |
| 调研范围权威 | `phases/phase-2-host-fail-loud-diagnostics/spec.md`（AC-13 – AC-22；AD-3 / AD-4 / AD-5 / AD-13 / AD-14） |
| `ui` | **`false`**（phase-plan.md DAG JSON）→ 按约定**不产出** §11 |
| 调研时刻 | 2026-09-15（分支 `new/vscode-dsh`，HEAD `5307eec361`） |
| 纪律 | 只读。未修改任何产品代码、配置或测试；只写了这两份报告文件。 |

**证据标记**：✅ CONFIRMED = 本次会话读过函数体 / 实跑过命令后确认；⚠️ HYPOTHESIS = 由相邻事实推导，未实跑；❓ UNKNOWN = 本次调研无法证实。

> 本报告中的每一个 `路径:行号` 都是本次会话读取过的。行号以 HEAD `5307eec361` 为准。

---

## 1. 任务上下文（Task Context）

### 1.1 本 Phase 目标（摘自 `spec.md` §目标）

把 Host 的**每一个启动失败边界**——Node 门槛 / bridge listen / spawn / `initialize` 握手 / 子进程退出 / 缺凭据——变成一条**可检视、已归类、已脱敏**的诊断**记录**，并让连接区在失败时显示**根因终态文案**而非进行时文案，**同时不新增第二套状态权威**（仍由 `AutoStartOrchestrator` → `ConnectionUiController` 承担）。

本 Phase 交付两个机器可读面：

1. **新增** `dsh.test.getDiagnosticsText` → `readonly HostDiagnosticRecord[]`（结构化 JSON 记录数组，**18 字段**，每条记录带 `schemaVersion`）。注册在既有 `shouldRegisterTestHooks` 门禁**之内**。
2. **扩展** `dsh.test.listPendingInteractions` 的投影，补 `toolName` / `reason`（AD-13）。

此外还有：VS Code **Output Channel**（至少一个命令能打开它，`dsh.showHostDiagnostics`，AC-13）、失败态重试记录（AC-22）、以及穿过 SDK 边界的 `TransportClosedError` 结构化细节（AD-5）。

### 1.2 本次调研必须确立的事实

- 每个 `primary_files` 条目的当前状态：现有职责、本 Phase 需要改什么、关键符号与行号。
- **≥3 条**带 `文件:行号` 锚点的 ASCII 调用链：**成功**路径、**失败**路径（记录插入点）、以及 `dsh.test.*` 注册/调用链（含门禁实际判定代码）。
- 一份**穷尽**的 `errorKind` / `StartErrorKind` / `HostStartErrorKind` / `HostFailureKind` / `.diagnostic` 消费点清单，独立复核或推翻 Phase 1 的结论。
- 继承债交叉验证：**DEBT-008**、**DEBT-009**、**DEBT-004**；以及 Phase 1 的 F-3 落地位置与 F-1 现状。
- 环境事实与门禁基线（implementer 的差量门禁依赖它们）。

### 1.3 范围边界

- **范围内（DAG JSON `primary_files`）**：`apps/vscode-dsh/src/host-diagnostics.ts`（新增）、`src/session-host.ts`、`src/interaction-coordinator.ts`、`src/extension.ts`、`apps/vscode-dsh/package.json`、`packages/sdk/client/src/client.ts`。
- **范围内（由 `spec.md` §产出清单 追加，超出 DAG JSON）**：`src/auto-start-orchestrator.ts`、`tests/host-diagnostics.spec.ts`（新增）、`tests/session-host.spec.ts`、`tests/auto-start-orchestrator.spec.ts`、`packages/sdk/client/tests/sdk-client.spec.ts`。
- **明确不在范围**：`dsh.test.answerApproval` 与 `InteractionCoordinator.resolveApproval`（属 Phase 3，AD-12）——见 §7.3。`interaction-coordinator.ts` 的改动**仅限投影字段**（`spec.md:72`）。
- **禁止**：`packages/core/agent-loop`、新增依赖、新增 `contributes.configuration`（Phase 1 已加 `dsh.nodeBin`）。

---

## 2. 仓库概览（Repository Overview）

| 项 | 值 | 证据 |
|---|---|---|
| 语言 / 模块制式 | TypeScript，**ESM**（`"type": "module"`），`strict: true` | `spec.md:74`；✅ `tsconfig*.json` 存在，相对导入带 `.ts` 扩展名（`session-host.ts:27`） |
| 单体仓库 | pnpm workspaces（`pnpm@11.7.0`），`packages/*`、`apps/*`、`vendor/*` | ✅ `package.json` 的 `workspaces`；`pnpm --version` → `11.7.0` |
| 相关 app/包 | `apps/vscode-dsh`（VS Code 扩展）、`packages/sdk/client`（JSON-RPC 传输 + 启动解析）、`packages/ide/ide-bridge`（socket bridge host server） | ✅ |
| Node pin | `.nvmrc` = `24.3.0`；根 `engines.node` = `^22.19.0 \|\| >=24.0.0` | ✅ |
| 测试框架 | Vitest。`apps/vscode-dsh/tests/**` 用鸭子类型 `vscode` 替身 + 真实子进程 fake runtime 驱动**真实生产代码** | ✅ `node-env-guard.spec.ts:576-638`、`tests/fixtures/fake-sdk-runtime.mjs` |
| Lint | `oxlint` + `tsgolint` 类型感知规则，配置 `.oxlintrc.json`；`pnpm run lint` = `build:lib:host && lint:contracts-ready` | ✅ `.oxlintrc.json`（12109 字节）、`package.json` |
| 文档门禁 | `pnpm run test:docs` = `run-gates` 聚合器（15 个门禁） | ✅ `/tmp/p2-baseline-docs.txt` |

### 2.1 塑造本 Phase 的两条事实

1. **`apps/vscode-dsh/src/**` 不在 client-UI i18n 扫描范围内**（`spec.md:75`）→ 该 app 的用户可见文案按既有惯例中英混用；Output Channel 的技术片段保持英文原文。此处**不**受 `verify-client-ui-i18n` 约束。
2. **`packages/sdk/client/src/client.ts` 受 per-file 100% 覆盖率门禁约束**（`spec.md:74`、`phase-plan.md:153`）。在 `client.ts` 里新增的每一个分支都必须有被执行的测试路径——包括目前**尚不存在**的「被信号终止」分支（§5.3）。

---

## 3. 最相关区域（Most Relevant Areas）

### 3.1 主文件（DAG JSON）

---

#### 3.1.1 `apps/vscode-dsh/src/host-diagnostics.ts` — **尚不存在** ✅ CONFIRMED

- 当前职责：无。在 `apps/vscode-dsh/src` 上做 `Glob`/`Grep` 找不到该文件；在**整个仓库中 `.specdev/` 之外**也找不到 `HostDiagnosticRecord` / `HOST_DIAGNOSTIC_SCHEMA_VERSION` / `HostFailureKind` 任一符号。
- 本 Phase 必须新建：
  - `HostFailureKind` —— AD-14 的 `kind` 词表：`'node-environment' | 'bridge-listen' | 'spawn' | 'handshake-timeout' | 'child-exited' | 'missing-credentials' | 'other'`（7 个成员，`design.md:307`）。
  - `HOST_DIAGNOSTIC_SCHEMA_VERSION = 1` —— `schemaVersion` 的**唯一**真相源（`design.md:325`、`design.md:328(c)`）。
  - `HostDiagnosticRecord` —— 18 个字段，逐字段清单见下方 §3.2。
  - **sink 端口**（按 AD-3 由扩展注入，`design.md:179`）+ **有界**记录存储（「有界」是 spec 要求——见 §7.5）。
  - `HostFailureKind` → `StartErrorKind` 的映射（AD-4，`design.md:186` 点名 Phase 2 新增 `spawn` / `handshake-timeout` / `bridge-listen`；`other` 刻意映射到既有兜底成员 `process-failed`，见 `spec.md:61`）。
- 待创建的关键符号：`HOST_DIAGNOSTIC_SCHEMA_VERSION`、`HostFailureKind`、`HostDiagnosticRecord`、sink 接口、记录器（`seq` 从 1 单调递增、`time` 单调不减、`phase: 'start' | 'retry'`、`retryOfSeq`）。
- 约束：所有文本在进入 sink **之前**先过 `redactSecrets`（`spec.md:73`）；`JSON.stringify(records)` 中不得含凭据值（`design.md:323`）。

---

#### 3.1.2 `apps/vscode-dsh/src/session-host.ts` — 归类发生地

- **当前职责**：窗口级 Host —— bridge listen、spawn、initialize、shutdown、多会话路由、交互 fail-closed（`session-host.ts:1-6`）。`start()` 执行顺序契约 **Node 门槛 → `bridge.listen` → spawn → `initialize`** ✅ CONFIRMED（`:286-317`）。
- **现有词表与错误类型**：
  - `session-host.ts:27` `import type { StartErrorKind } from './auto-start-orchestrator.ts'`（纯类型导入）。
  - `session-host.ts:43-51` 描述该类别词表的 JSDoc；`:53` `export type HostStartErrorKind = StartErrorKind`。
  - `session-host.ts:59-80` `class HostStartError extends Error`，含 `readonly kind`（`:61`）与 `readonly diagnostic: NodeEnvironmentFailure | undefined`（`:62-63`），构造函数 `:70-79`。
- **Phase 2 必须保住的不变式**：`diagnostic` **恰好当** `kind === 'node-environment'` 时存在（`:62` 的 JSDoc；`:323-327` 只有该分支传 `diagnostic`）。✅ CONFIRMED —— `:329` 抛 `HostStartError('process-failed', …)` 时**不带** `diagnostic`。
- **失败出口（唯一的 `catch`，`:318-330`）** ✅ CONFIRMED：

```318:330:apps/vscode-dsh/src/session-host.ts
    } catch (error) {
      this.status = 'error'
      const message = error instanceof Error ? error.message : String(error)
      this.errorMessage = redactSecrets(message, this.credentials)
      await this.shutdownInternal('start failed')
      if (error instanceof NodeEnvironmentError) {
        throw new HostStartError('node-environment', this.errorMessage, {
          cause: error,
          diagnostic: error.failure,
        })
      }
      throw new HostStartError('process-failed', this.errorMessage, { cause: error })
    }
```

- **本 Phase 需要改什么**（按执行顺序的具体动作）：
  1. **把已解析的可执行文件与 socket 路径提到 `try` 之外。** `nodeExecutable` 是在 `try` **内部** `:289-291` 声明的 `const`，而 `bridgePath` 存在 `this` 上（`:273`）。因此 `:318` 的 `catch` **看不到 `nodeExecutable`**。AC-14 要求记录里带 `resolvedExecutable` → implementer 必须把解析动作移到 `try` 之前（或用一个外层 `let` 捕获解析结果），且**不得**破坏「门槛先于 `bridge.listen`」的 AC-7 顺序契约（该契约由 `tests/session-host-preflight.spec.ts` 验证）。
  2. **在 `shutdownInternal` 之前/周边插入记录。** `:786-816` 的 `shutdownInternal` 会置 `this.client = undefined`（`:814-815`）并销毁 client。因此在 `:322` 之后，客户端侧字段（`exitCode`、`terminationSignal`、`stderrTail`）通过 `this.client` 已经**取不到**。它们必须来自**被抛出的 `error`**（AD-5 的结构化 `TransportClosedError.details`）或更早被捕获。⚠️ 这是一个真实陷阱：在 `catch` 里 `await` 之后再去读 `this.client` 的天真实现会静默产出空字段。
  3. **把 4 个新边界归类**为 `HostFailureKind`，并抛出 `kind` 为映射后 `StartErrorKind` 的 `HostStartError`：
     - `bridge.listen` reject（`:293`）→ `bridge-listen`，带 `socketPath`（绝对路径）。
     - `HarnessClient` spawn / 构造函数内的入口解析失败（`:299-310`）→ `spawn`，带 `resolvedExecutable` + `source`。
     - `client.initialize()` 超时（`:312-316`）→ `handshake-timeout`，带 `handshakeTimeoutMs = options.initializeTimeoutMs ?? 10_000`；抛出的类型是 `RequestTimeoutError`（`client.ts:48-54`）。
     - 其余一律 → `other`（仍必须落记录，且 `detail` 非空——`spec.md:48`）。
     - 注意：目前 `process-failed` **吞掉**以上全部。Phase 1 的 DEBT-006 恰好为 `invalid-setting` 修掉了同类压平；Phase 2 对剩余边界重复同一动作，这正是 AC-20 的意图。
  4. **`child-exited` 是第六个边界，但它不在 `start()` 里。** 传输死亡由 `watchTransport`（`:568-595`）→ `onTransportDeath`（`:597-627`）观测，后者置 `this.status = 'error'` 并调用 `notifyError`。AC-18 要求一条带 `exitCode` / `terminationSignal` 的 `child-exited` 记录。见 §7.2 —— 这是唯一位于 `start()` try/catch 之外的边界。
- **关键符号 / 行号**：`start()` `:259`…；门槛 `:289-292`；`bridge.listen` `:293`；`new HarnessClient` `:299-308`；`client.start()` `:310`；`watchTransport` `:311`；`client.initialize()` `:312-316`；成功 `:317`；catch `:318-330`；`shutdown()` `:563-566`；`watchTransport` `:568-595`；`onTransportDeath` `:597-627`；`notifyError` `:629-637`；`shutdownInternal` `:786-816`。

---

#### 3.1.3 `apps/vscode-dsh/src/interaction-coordinator.ts` — 仅投影（AD-13）

- **当前投影** ✅ CONFIRMED —— 恰好是 spec 引用的 6 个字段：

```188:199:apps/vscode-dsh/src/interaction-coordinator.ts
  listPending(): readonly PendingHostInteraction[] {
    return this.queue
      .filter(entry => entry.state === 'pending' || entry.state === 'presented')
      .map(entry => ({
        kind: entry.kind,
        id: entry.id,
        sessionId: entry.sessionId,
        state: entry.state,
        abort: entry.abort,
        ...entry.tabId === undefined ? {} : { tabId: entry.tabId },
      }))
  }
```

- **数据本身已在本地捕获** ✅ CONFIRMED —— `ApprovalEntry` 已有 `toolName: string`（`:83`）与 `reason?: string`（`:84`）；`handleApproval` 读取 `frame.toolName` / `frame.reason`（`:227-231`）。所以 AD-13 **不需要新的数据管线**，只需在 `.map()` 里多两个键，并让 `PendingHostInteraction` 联合（`:56-72`）带上这两个字段。
- **本 Phase 需要改什么**：把 `toolName` 与 `reason` 加进投影，并加进 `PendingHostInteraction` 的 `kind: 'approval'` 分支（`:57-64`）。`questions` 分支（`:65-72`）两者都没有 —— spec 的「未新增其它字段」断言（`spec.md:59`）意味着 `questions` 分支不得以占位值偷偷多出字段；请做出决定并记录（建议：这两个字段只在 `approval` 分支上必填，让联合类型自行判别）。
- **不要动**：`handleApproval` / `finishApproval` / `resolveApproval`（Phase 3，`spec.md:72`）。
- **关键符号 / 行号**：`PendingHostInteraction` `:56-72`；`ApprovalEntry` `:74-86`（`toolName` `:83`、`reason` `:84`）；`listPending()` `:188-199`；`handleApproval` `:227-…`。

---

#### 3.1.4 `apps/vscode-dsh/src/extension.ts` — 呈现 + 装配发生地（2570 行）

- **当前职责**：单个 `activate()` 注册全部内容（刻意**不**启动，`:346-347`），外加模块级单例。
- **模块级状态** ✅ CONFIRMED：`host` `:298`、`conversations` `:299`、`panelHost` `:300`、`orchestrator` `:320`、`connectionUi` `:321`、`credentialPresenceOverride` `:330`、`userStopping` `:332`、`hostCreateCount` `:334`、`stopOrchestratorWatch` `:317`。
- **当前装配**（`:391-405`）✅ CONFIRMED：

```391:405:apps/vscode-dsh/src/extension.ts
  connectionUi = new ConnectionUiController(vscode, {
    isConversationVisible: () => conversationVisible,
    applyConnectionState(state: ConnectionUiState) {
      panelHost?.applyConnectionState(state)
    },
  })
  context.subscriptions.push({ dispose: () => connectionUi?.dispose() })

  const startPort = createStartHostPort(vscode)
  orchestrator = new AutoStartOrchestrator(startPort)
  stopOrchestratorWatch?.()
  stopOrchestratorWatch = orchestrator.onChange((snap) => {
    connectionUi?.projectOrchestrator(snap)
    autoReady?.onHostReadyChanged(snap.state === 'started')
  })
```

- **`StartHostPort` 层（`invalid-setting` 的实际抛出点）** ✅ CONFIRMED：
  - `createStartHostPort(vscode)` `:2210-2284`；`start()` `:2217-2282`。
  - `readNodeBinSetting(vscode)` 在 `:2255` 调用；在 `:2185-2188` 抛 `HostStartError('invalid-setting', …)`。
  - `readNodeBinSetting` 定义 `:2180-2191`。
  - 失败时该端口会拆掉 watcher、`unbindConversations()`、置 `host = undefined`，并**保留 `Error` 身份原样重抛**（`:2271-2281`）—— 这一跳是 `.kind` 得以存活到 `startErrorKindOf` 的原因。
- **Phase 2 要扩展的命令注册点** ✅ CONFIRMED：
  - `dsh.showPanel` `:461-469`；**`dsh.statusBarAction` `:471-475`**（`await revealConversationPanel(vscode); await orchestrator?.request('status-bar')`）；**`dsh.openExtensionSettings` `:477-483`**（既有设置深链：`workbench.action.openSettings` + `@ext:deepseek-ai.dsh-vscode-dsh`）。
  - `dsh.startSession` `:504-506`；`dsh.stopSession` `:508-…`。
  - `dsh.deleteHistory` `:948`。
- **`dsh.test.*` 门禁与注册块** ✅ CONFIRMED：

```950:952:apps/vscode-dsh/src/extension.ts
  // --- L2 Host test hooks (AD-CR-10: VSCODE_DSH_TEST / injected vscode harness only) ---
  const testDisposables: { dispose(): void }[] = []
  if (shouldRegisterTestHooks(vscodeArg)) {
```

```2139:2142:apps/vscode-dsh/src/extension.ts
function shouldRegisterTestHooks(vscodeArg?: VsCodeLike): boolean {
  if (process.env.VSCODE_DSH_TEST === '1' || process.env.VSCODE_DSH_TEST === 'true') return true
  return vscodeArg !== undefined
}
```

  - 既有 `dsh.test.listPendingInteractions` 注册 `:1039-1042` → `() => host?.interactions.listPending() ?? []`。
  - 既有 `dsh.test.getStartState` `:1108-1110`；`dsh.test.requestStart` `:1140-1144`（返回 `orchestrator?.getSnapshot()`）；`dsh.test.setCredentialPresence` `:1119-1122`。
- **`VsCodeLike.window` 鸭子类型**：`createStatusBarItem?` `:153-160`；`activeColorTheme?` `:162`；`onDidChangeActiveColorTheme?` `:164` —— 缺失的 `createOutputChannel` 见 §3.1.7。
- **本 Phase 需要改什么**：
  1. 给 `VsCodeLike.window` 加 `createOutputChannel` 能力（**当前不存在** —— 在 `apps/vscode-dsh/src` 上 grep `createOutputChannel|OutputChannel` **零命中** ✅ CONFIRMED）。
  2. 只创建一次通道（通道名必须稳定：`DeepSeek Harness`，见 AC-13(a)），并 `push` 到 `context.subscriptions`。
  3. 在该通道之上实现 §3.1.1 的 sink 端口（AD-3：呈现在这里，归类不在这里）。
  4. 注册 **`dsh.showHostDiagnostics`**（新命令 → `channel.show()`），并加到 `contributes.commands`（见 §3.1.5）。
  5. 在 `testDisposables.push(…)` 块**之内**（即 `:952` 门禁之内）注册 **`dsh.test.getDiagnosticsText`**，返回 `readonly HostDiagnosticRecord[]`；其 JSDoc 必须写明「名称沿用，返回结构化 JSON 记录数组，不返回文本」（`design.md:296`）。
  6. 产出 AC-22 的重试记录对：在 `failed` 快照后，每次 `'status-bar'` / `'manual-retry'` 请求都追加一条 `phase: 'retry'` 记录，其 `retryOfSeq` 指向首启记录的 `seq`。重试入口已存在（`dsh.statusBarAction` `:471-475`）且复用同一路径（`orchestrator.request` → `runStart` → `port.start`），所以 AC-22(c) 的「复用同一路径」在结构上已成立。
  7. 修掉 DEBT-008 的两处 `(AD-10)` → `(AD-9)`（见 §附录 A.1）。
- **关键符号 / 行号**：`activate` `:351`；门禁调用 `:952`；`shouldRegisterTestHooks` `:2139-2142`；`readNodeBinSetting` `:2180-2191`；`createStartHostPort` `:2210-2284`；`collectCredentialsEnv` `:2196-2204`；`statusBarAction` `:471-475`；`openExtensionSettings` `:477-483`。

---

#### 3.1.5 `apps/vscode-dsh/package.json` — 新增一个命令贡献

- **当前状态** ✅ CONFIRMED：`contributes.configuration.dsh.nodeBin` **已经存在**（Phase 1 加入，约 57-66 行）→ Phase 2 **不得**再加第二个配置项（`spec.md:76`）。
- **`contributes.commands`** 目前列出了若干 `dsh.*` 命令，但**没有 `dsh.showHostDiagnostics`** ✅ CONFIRMED（且在整个仓库 `.specdev/` 之外都找不到该名字）。
- **本 Phase 需要改什么**：把 `dsh.showHostDiagnostics` 追加到 `contributes.commands`（title + category 沿用相邻条目的风格）。
- ⚠️ **不存在校验 `contributes` 的包级门禁**（`phase-plan.md:138`，Phase 1 的实测结论）→ 「命令已被贡献」必须由**运行时**测试证明，不得假定有门禁会拦住错误。

---

#### 3.1.6 `packages/sdk/client/src/client.ts` — AD-5 结构化细节（**per-file 100% 覆盖率**）

- **当前职责**：基于子进程 stdio 的 JSON-RPC 客户端（`client.ts:176-184`）。
- **`TransportClosedError` 目前只有消息** ✅ CONFIRMED —— 完全没有结构化字段：

```34:54:packages/sdk/client/src/client.ts
/**
 * The runtime subprocess is gone or unusable: it exited, its stdio closed, or
 * it was never launchable. The message carries the exit code and a stderr
 * tail when available.
 */
export class TransportClosedError extends Error {
  /** @param message - the failure description, including any stderr tail. */
  constructor(message: string) {
    super(message)
    this.name = 'TransportClosedError'
  }
}
```

- **必须变成结构化细节的既有捕获状态** ✅ CONFIRMED：
  - `stderrTail: string[]`（`:191`），由 `appendStderr`（`:445-451`）按 `STDERR_TAIL_LIMIT = 400`（`:29`）封顶。
  - `exitCode: number | null | undefined`（`:195`），由 `child.once('exit', (code) => …)`（`:253-258`）写入。
  - `spawnError: Error | undefined`（`:196`），由 `child.once('error', …)`（`:220-226`）写入。
  - 唯一的构造点 `closedError(reason)`（`:460-466`）—— **消息与结构化字段必须在这里同时产出以防漂移**（AD-5 `design.md:193`）：

```460:466:packages/sdk/client/src/client.ts
  private closedError(reason: string): TransportClosedError {
    const parts = [`${this.runtime.description}: ${reason}`]
    if (this.spawnError !== undefined) parts.push(`spawn error: ${this.spawnError.message}`)
    if (this.exitCode !== undefined) parts.push(`exit code: ${String(this.exitCode)}`)
    if (this.stderrTail.length > 0) parts.push(`stderr tail:\n${this.stderrTail.join('\n')}`)
    return new TransportClosedError(parts.join('\n'))
  }
```

- **🔴 `terminationSignal` 缺口（AC-18(b)）** ✅ CONFIRMED：`:253` 的 `child.once('exit', (code) => …)` **丢掉了第二个参数**（`signal`）。Node 的 `exit` 事件签名是 `(code: number | null, signal: NodeJS.Signals | null)`；进程被信号杀死时 `code === null`。因此今天 SDK **无法**上报 `terminationSignal`，只会打印 `exit code: null`。Phase 2 必须捕获 `signal` 并作为结构化字段暴露。
- **AC-14 的 `executable`**：`this.runtime.command`（`:214`、`:461`）就是 spawn 目标；除注入外，`runtime` 来自 `resolveDshLaunch`（`:202-205`）。`createProcessHarnessClient(options)`（`:470-476`）是文档化的测试构造器，直接注入 `RuntimeProcessOptions` —— 这正是 AC-14 第 (1) 层要求的、用来制造**真实** spawn 失败的入口。
- **`RequestTimeoutError`**：`:48-54`；`request()` 超时时抛出；用于 AC-15。`initialize()` 使用 `this.runtime.initializeTimeoutMs`（`:277`）。
- **本 Phase 需要改什么**：给 `TransportClosedError` 加只读结构化细节（`spec.md:47` 要求测试至少断言 `details.spawnError` 与 `details.executable`；AD-5 要求至少有退出码 / 终止信号 / stderr 尾部 / 可执行文件路径 / spawn 错误），在唯一的 `closedError` 构造点填充，消息前缀保持原文（`spec.md:69`），并**为信号分支补测试路径**，否则 per-file 覆盖率会跌破 100%。
- **关键符号 / 行号**：`STDERR_TAIL_LIMIT` `:29`；`TransportClosedError` `:39-45`；`RequestTimeoutError` `:48-54`；`SdkProtocolError` `:60-66`；私有字段 `:189-198`；`spawn` `:214-218`；`error`/`exit`/`close` 处理器 `:220-264`；`initialize` `:276-283`；`request` `:309-…`；`appendStderr` `:445-451`；`closedError` `:460-466`；`createProcessHarnessClient` `:470-476`。

---

#### 3.1.7 支撑文件（implementer 需要的事实；改动很小或为零）

| 文件 | 在 Phase 2 中的角色 | 关键符号 `文件:行号` |
|---|---|---|
| `packages/sdk/client/src/launch.ts` | **只读事实来源。** 提供 `ResolvedNodeExecutable`（`path`、`source`、`electronRunAsNode`）与默认握手超时。 | `DEFAULT_INITIALIZE_TIMEOUT_MS = 10_000` `:12`；`RuntimeProcessOptions.initializeTimeoutMs` `:22`；`resolveNodeExecutableSpec` `:131-145`；`resolveDshLaunch` `:164-…`（`command: nodeExecutable.path` `:184`） |
| `apps/vscode-dsh/src/redact.ts` | **复用，不得另写一套**（`spec.md:73`）。 | `redactSecrets` `:47-56`；`isCredentialShapedKey` `:13-15`；`redactBag` `:23-34` |
| `apps/vscode-dsh/src/node-env-guard.ts` | 提供 `NodeEnvironmentFailure`（Phase 2 要把它映射成 `nodeVersion` / `expectedRange` / `missingApis` / `hint`）。 | `NODE_BIN_SETTING` `:24`；`REQUIRED_NODE_APIS` `:27`；`NodeEnvironmentFailureKind` `:36-40`；`NodeEnvironmentFailure` `:57-76`；`NodeEnvironmentError` `:84-96`；`validateNodeEnvironment` `:115-…`；`assertNodeExecutable` `:155-158`；`formatNodeEnvironmentDiagnostics` `:167-…` |
| `apps/vscode-dsh/src/connection-ui.ts` | **不得重构**（AD-3 / AD-4）。AC-19 / AC-20 断言其 `getState()`。 | `ConnectionUiState` / `getState()` `:102-104`；`projectOrchestrator` `:110-113`；`mapSnapshot` `:115-161`；**`settingsDeepLinkAvailable = snap.errorKind === 'missing-credentials'` `:140`**；message 链 `:141-154`；`shouldShowStatusBar` `:163-171`；`apply` `:173-…` |
| `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` | AC-19/AC-20 面板侧可断言面。 | `applyConnectionState` `:276`；`pushBanner(state.message ?? '正在连接到 Host…', 'connecting')` `:281` |
| `packages/ide/ide-bridge/src/host.ts` | `bridge.listen(path)` —— AC-16 的失败边界。 | `listen(path)` `:71` |
| `apps/vscode-dsh/src/index.ts` | 库再导出面；Phase 2 的新导出应加在此处，与 `HostStartError` `:25`、`redactSecrets` `:41` 对称。 | `StartErrorKind` `:8`；`HostStartError` / `HostStartErrorKind` `:25` |

### 3.2 AD-14 —— 18 字段 `HostDiagnosticRecord`（逐字抄录自 `design.md:300-319`）

此处完整抄录，因为 implementer 与 reviewer 都依赖该清单；`host-diagnostics.spec.ts` 的契约用例会逐字比对它。

| # | 字段 | 类型 | 可空性 | 语义 |
|---:|---|---|---|---|
| 1 | `schemaVersion` | `1`（字面量） | 不可空（恒为 `1`） | 契约版本；唯一真相源 `HOST_DIAGNOSTIC_SCHEMA_VERSION` |
| 2 | `seq` | `number` | 不可空（从 `1` 起单调递增） | 记录序号；AC-22 前后成对断言的依据 |
| 3 | `time` | `number` | 不可空（epoch ms，单调不减） | 记录时刻 |
| 4 | `phase` | `'start' \| 'retry'` | 不可空 | 首启还是重试 |
| 5 | `retryOfSeq` | `number \| null` | 可空（`phase === 'start'` 时为 `null`） | 本次重试所对应的首启记录 `seq` |
| 6 | `kind` | `'node-environment' \| 'bridge-listen' \| 'spawn' \| 'handshake-timeout' \| 'child-exited' \| 'missing-credentials' \| 'other'` | 不可空 | `HostFailureKind` |
| 7 | `resolvedExecutable` | `string \| null` | 可空（与 Node 无关的失败为 `null`） | 解析到的 Node 可执行文件**绝对路径**（AC-14） |
| 8 | `source` | `'dsh-node-bin' \| 'vscode-setting' \| 'process-exec-path' \| null` | 可空 | 三级链（AD-9）中选中该路径的来源 |
| 9 | `nodeVersion` | `string \| null` | 可空 | 实际检测到的版本（AC-8(b)） |
| 10 | `expectedRange` | `string \| null` | 可空 | 期望版本范围（AC-8(c)） |
| 11 | `missingApis` | `readonly string[]` | 不可空（无缺失时为 `[]`） | 缺失的 API 名（AC-8(d)） |
| 12 | `socketPath` | `string \| null` | 可空 | bridge socket 绝对路径（AC-16） |
| 13 | `exitCode` | `number \| null` | 可空（被信号终止时为 `null`） | 子进程退出码（AC-18） |
| 14 | `terminationSignal` | `string \| null` | 可空（正常退出时为 `null`） | 终止信号名（AC-18） |
| 15 | `handshakeTimeoutMs` | `number \| null` | 可空（仅 `kind==='handshake-timeout'` 有值） | 握手超时时长（AC-15） |
| 16 | `stderrTail` | `readonly string[]` | 不可空（无 stderr 时为 `[]`） | stderr 末尾行原文，按原顺序、逐行一项、**不摘要**（AC-17） |
| 17 | `detail` | `string` | 不可空（已脱敏） | 失败原因文本（AC-14/AC-16） |
| 18 | `hint` | `string` | 不可空（已脱敏） | 可操作下一步指令（AC-8(e)） |

约束实现方式的契约规则（均来自 AD-14，均可被测试）：

- **每个字段恒存在**；不适用时取 `null` 或 `[]`，**绝不省略**（`design.md:298`）。
- `[]`（无任何记录）是合法的；**绝不**返回 `undefined` / `null` / 抛错；且对 `[]` **不做任何版本断言**（`design.md:321`）。
- 返回值必须满足 `Array.isArray(records) === true`；**禁止**包成 `{schemaVersion, records}`（`design.md:325`）。
- **禁止**返回字符串或任何整篇渲染文本字段（`text` / `renderedText` / `summary` / `log`）（`design.md:297`）。
- 对字段清单的**任何**改动**必须**在同一次改动中递增 `schemaVersion`（`design.md:327`）。
- 对 `detail` / `hint` 的断言只允许「非空」与「包含某个具体结构性 token」——**禁止**断言自然语言措辞（`design.md:322`）。

---

## 4. 关键入口 / 调用路径（Key Entry Points / Call Paths）

### 4.1 链 A —— **成功**启动（端到端，带锚点）

```
[VS Code]  activate(context, vscodeArg?)                     extension.ts:351
  ├─ connectionUi = new ConnectionUiController(vscode, …)    extension.ts:391
  ├─ startPort    = createStartHostPort(vscode)              extension.ts:399 → :2210
  ├─ orchestrator = new AutoStartOrchestrator(startPort)     extension.ts:400
  └─ orchestrator.onChange(snap => connectionUi.project…())  extension.ts:402-405

[用户]  dsh.statusBarAction / 活动栏 / 视图可见
  └─ orchestrator.request(reason)                            extension.ts:473 / :2295
       └─ runStart(reason)                                   auto-start-orchestrator.ts:198
            ├─ port.hasCredentials()?                        auto-start-orchestrator.ts:207
            └─ port.start(reason)                            auto-start-orchestrator.ts:213
                 └─ createStartHostPort().start()            extension.ts:2217
                      ├─ readNodeBinSetting(vscode)          extension.ts:2255 → :2180
                      └─ new IdeSessionHost().start({cwd, nodeBinSetting, credentials})
                                                             extension.ts:2256 → session-host.ts:259
                           ├─ resolveNodeExecutableSpec(...)  session-host.ts:289  （AD-1 唯一解析）
                           ├─ assertNodeExecutable(exec)      session-host.ts:292  → node-env-guard.ts:155
                           │     └─ validateNodeEnvironment   node-env-guard.ts:115
                           ├─ bridge.listen(bridgePath)       session-host.ts:293  → ide-bridge/host.ts:71
                           ├─ new HarnessClient({nodeExecutable, …})
                           │                                 session-host.ts:299 → client.ts:201
                           ├─ client.start()  → spawn()       session-host.ts:310 → client.ts:211 → :214
                           ├─ this.watchTransport(client)     session-host.ts:311 → :568
                           └─ client.initialize({cwd,…})      session-host.ts:312 → client.ts:276
                                └─ request('initialize', …, runtime.initializeTimeoutMs)
                                                             client.ts:277（:309；默认 10s → launch.ts:12）
                      └─ this.status = 'connected'            session-host.ts:317
            ├─ port.isConnected()? → state = 'started'       auto-start-orchestrator.ts:215-217
            └─ notify() → onChange 监听者                    auto-start-orchestrator.ts:234/:242 → :255
  └─ ConnectionUiController.projectOrchestrator(snap)        connection-ui.ts:110
       └─ mapSnapshot: state 'started' → phase 'connected'   connection-ui.ts:126-127
            └─ message = undefined                           connection-ui.ts:143-144
```

**Phase 2 在这条路径上的记录插入点**：无。成功启动**不产生**任何记录。（即 spec 的 `[]` 情形。）

### 4.2 链 B —— **失败**启动（记录插入点）

```
[start() 内部，六个边界之一抛错]
  ├─(1) Node 门槛拒绝   → NodeEnvironmentError             node-env-guard.ts:84 / assertNodeExecutable :155
  ├─(2) bridge.listen 拒绝 → Error（EADDRINUSE/EACCES/ENOTDIR…）  session-host.ts:293
  ├─(3) spawn 失败         → TransportClosedError{spawn error}    client.ts:220-226 → :460
  │      （或 HarnessClient 构造 / resolveDshLaunch 抛错 → 普通 Error）  client.ts:204 / launch.ts:114
  ├─(4) initialize 超时    → RequestTimeoutError            client.ts:48 / request() :309+
  ├─(5) 子进程退出         → TransportClosedError{exit code: N}   client.ts:253-258 → :460
  └─(6) 缺凭据             → 由 orchestrator 合成（不进入 Host）
                                                         auto-start-orchestrator.ts:208-211

  catch (error)                                          session-host.ts:318
    ├─ this.status = 'error'                             session-host.ts:319
    ├─ message = error.message                           session-host.ts:320
    ├─ this.errorMessage = redactSecrets(message, creds)  session-host.ts:321  ← redact.ts:47
    ├─ await this.shutdownInternal('start failed')       session-host.ts:322 → :786
    │     └─ this.client = undefined（!!）               session-host.ts:814-815
    ├─ [★ 记录插入点] kind = classify(error)             ← Phase 2：host-diagnostics sink
    ├─ NodeEnvironmentError → HostStartError('node-environment', …, {diagnostic})
    │                                                    session-host.ts:323-327
    └─ else                  → HostStartError('process-failed', …, {cause})
                                                         session-host.ts:329  ← Phase 2 把它拆成
                                                                                bridge-listen / spawn /
                                                                                handshake-timeout / other

  错误向上穿过 StartHostPort                            extension.ts:2256
    └─ catch → 拆 watcher、unbindConversations()、
       host = undefined、重抛同一个 Error 实例            extension.ts:2271-2280
                                                         ← 这正是 `.kind` 得以跨跳存活的原因
       └─ runStart catch: state='failed'; errorKind = startErrorKindOf(error); errorMessage = …
                                                         auto-start-orchestrator.ts:223-227
            └─ startErrorKindOf：线性扫描 START_ERROR_KINDS，否则 'process-failed'
                                                         auto-start-orchestrator.ts:53-61
            └─ notify() → onChange                       auto-start-orchestrator.ts:234 → :255
  └─ connectionUi.projectOrchestrator(snap)              extension.ts:402-405 → connection-ui.ts:110
       └─ mapSnapshot: state 'failed' → phase 'failed'   connection-ui.ts:128-130
            ├─ settingsDeepLinkAvailable = errorKind === 'missing-credentials'  connection-ui.ts:140
            └─ message = snap.errorMessage ?? 'Host connection failed.'         connection-ui.ts:147 / :154
                 （:142 的 '正在连接到 Host…' 字面量**仅**适用于 phase 'connecting'）
  └─ [AC-22] 重试入口：dsh.statusBarAction → revealConversationPanel + orchestrator.request('status-bar')
                                                         extension.ts:471-475
       └─ 重入 runStart → port.start → 新的 IdeSessionHost → 与链 A 相同的路径
            └─ [Phase 2] 追加 phase:'retry' 记录，retryOfSeq = <首启记录 seq>
```

**这条链为 implementer 确立的两条硬事实：**

1. `shutdownInternal` 在抛出**之前**执行（`:322`），而它把 `this.client` 置为 `undefined`（`:814-815`）→ 客户端侧字段**必须**来自被抛出的 `error`（AD-5 的 `details`）或在 `:322` 之前捕获。
2. 失败路径在 `failed` 快照上从不触碰 `ConnectionUiController` 的 `'connecting'` 字面量 —— AC-20 在 `connection-ui.ts:141-147` 处**结构上已满足**；Phase 2 的工作在**记录侧**（字段级 `kind`）+ 回归断言。

### 4.3 链 C —— `dsh.test.*` 注册与调用链（含门禁）

```
[测试]  activate(context, vscodeDouble)                    extension.ts:351
  └─ shouldRegisterTestHooks(vscodeArg)                    extension.ts:952（门禁调用）
       └─ 定义：                                            extension.ts:2139-2142
            return env.VSCODE_DSH_TEST ∈ {'1','true'}  ||  vscodeArg !== undefined
       ├─ true  → testDisposables.push( vscode.commands.registerCommand(…) … )  extension.ts:953-1156
       │    ├─ 'dsh.test.listPendingInteractions'          extension.ts:1039-1042
       │    │     └─ () => host?.interactions.listPending() ?? []
       │    │            └─ InteractionCoordinator.listPending()  interaction-coordinator.ts:188
       │    │                  ← AD-13：在此补 toolName / reason（数据已在 ApprovalEntry :83-84）
       │    ├─ 'dsh.test.getStartState'                     extension.ts:1108-1110
       │    │     └─ orchestrator.getSnapshot()             auto-start-orchestrator.ts:124
       │    ├─ 'dsh.test.requestStart'                      extension.ts:1140-1144
       │    └─ [★ 新增] 'dsh.test.getDiagnosticsText'       ← Phase 2 在此注册
       │          └─ 返回 readonly HostDiagnosticRecord[]（JSON 记录，永不返回文本）
       └─ false → 整块被跳过（完全不会调用 registerCommand）

[测试]  commands.get('dsh.test.getDiagnosticsText')!()
  └─ 读取 sink 的有界记录存储 → records.map(toRecord)
       └─ 每条记录在进入 sink 前已过 redactSecrets      redact.ts:47
```

**⚠️ 该门禁是 OR，不只是环境变量** —— 见 §7.1。`spec.md:21` 引用的是 `extension.ts:2124-2125` 且条件写作「`VSCODE_DSH_TEST === '1' | 'true'`」；真实定义在 `:2139-2142`，且有**第二个**析取项（`vscodeArg !== undefined`）。

---

## 5. 影响面（Likely Impact Surface）

### 5.1 `kind` 词表消费点的穷尽审计（独立复核）

使用的检索模式：全仓 `errorKind|StartErrorKind|HostStartErrorKind|HostFailureKind|\.diagnostic`（逐条检视全部结果）。Phase 1 第 3 轮的结论是：

> 「全仓**不存在**对 `StartErrorKind` 的 switch；产品侧读 `.diagnostic` 处为 0」。

**本次调研 CONFIRM 两条结论** ✅，完整枚举如下。

#### 5.1.1 词表定义 + 生产侧写入/读取点

| # | `文件:行号` | 角色 | 是 `switch` 吗 | 有 `default` 吗 | 按 `kind` 读 `.diagnostic` 吗 |
|---:|---|---|:--:|:--:|:--:|
| 1 | `auto-start-orchestrator.ts:27-32` `START_ERROR_KINDS` | 词表的**唯一真相源**（现为 `invalid-setting`、`missing-credentials`、`node-environment`、`process-failed`） | — | — | — |
| 2 | `auto-start-orchestrator.ts:43` | `export type StartErrorKind = typeof START_ERROR_KINDS[number]` | — | — | — |
| 3 | `auto-start-orchestrator.ts:53-61` `startErrorKindOf` | **守卫/映射** —— `for…of` 线性扫描 + `===`，末尾 `return 'process-failed'` | **否** | 不适用（兜底是末尾 `return`，不是 `default:` 分支） | 否 |
| 4 | `auto-start-orchestrator.ts:68` | 快照字段 `errorKind?: StartErrorKind` | — | — | — |
| 5 | `auto-start-orchestrator.ts:98, 129, 220, 226, 251` | 字段存储 / 快照投影 / 泛型写入 / 分类写入 / 清除 | — | — | 否 |
| 6 | `session-host.ts:27` | 纯类型导入 `StartErrorKind` | — | — | — |
| 7 | `session-host.ts:53` | `export type HostStartErrorKind = StartErrorKind`（别名 —— 使两个词表**结构相等**） | — | — | — |
| 8 | `session-host.ts:61, 71, 78` | `HostStartError.kind` 字段 / 构造参数 / 赋值 | — | — | — |
| 9 | `session-host.ts:324` | **写入点**：`new HostStartError('node-environment', …, {diagnostic})` | — | — | 否（写入） |
| 10 | `session-host.ts:329` | **写入点**：`new HostStartError('process-failed', …, {cause})` | — | — | 否（写入） |
| 11 | `extension.ts:34` | 导入 `HostStartError` | — | — | — |
| 12 | `extension.ts:2185-2188` | **`StartHostPort` 层的写入点**：`new HostStartError('invalid-setting', …)` | — | — | 否 |
| 13 | `extension.ts:2278-2280` | 保留 `Error` 身份的重抛（保住 `.kind` 的那一跳） | — | — | 否 |
| 14 | **`connection-ui.ts:140`** | **生产代码中唯一的 `errorKind` 读取点**：`settingsDeepLinkAvailable = snap.errorKind === 'missing-credentials'` | **否**（等值判断） | — | **否** |
| 15 | `connection-ui.ts:117-139` | `switch (snap.state)`，切换的是 **`StartOrchestratorState`** —— *状态* switch，**不是** kind switch；`default:` 是 `const _exhaustive: never` 穷尽性断言（`:134-138`） | 是（state） | 是（穷尽性断言，不是吞掉） | 否 |
| 16 | `apps/vscode-dsh/src/index.ts:8, 25` | 再导出面 | — | — | — |

**结论**：生产代码中**恰好只有一处** `errorKind` 读取点（`connection-ui.ts:140`，等值判断，既无 `switch` 也无会写错的 `default`），并且**零处**对 `StartErrorKind` 的 `switch`。`HostFailureKind` 在 `.specdev/` 之外**零出现** ✅。因此把 Phase 2 的成员加进 `START_ERROR_KINDS` 不可能因缺失 `default:` 分支而静默错路由 —— 唯一的 fail-open 风险是 Phase 2 作者**新写**一个 switch。**不要引入 switch**；沿用 `startErrorKindOf` 现有的「扫描 + 兜底」形态。

#### 5.1.2 `.diagnostic` 的生产侧读取点 —— **0** ✅ CONFIRMED

`HostStartError.diagnostic` **只**被测试与 Phase 1 验证脚本读取：

| `文件:行号` | 上下文 |
|---|---|
| `apps/vscode-dsh/tests/session-host-preflight.spec.ts:180-182` | `error.diagnostic?.source` / `.executablePath` / `.kind`（可选链 —— **未**按 `kind` 收窄） |
| `apps/vscode-dsh/tests/session-host-preflight.spec.ts:222-223` | `.kind` / `.executablePath` |
| `apps/vscode-dsh/tests/session-host-preflight.spec.ts:254-256` | `.source` / `.kind` / `.executablePath` |
| `.specdev/.../phase-1-node-env-preflight/test-scripts/v3-e2e-preflight.mts:107, 120, 135, 153-154, 189` | Phase 1 验证脚本 |

⇒ **F-3 第 (2) 条（「读 `.diagnostic` 前按 `kind` 收窄」）在现有产品代码中没有落点** —— 需要它的读取点将是 Phase 2 **新写**的代码（`host-diagnostics.ts` / `session-host.ts` 中把 `NodeEnvironmentFailure` 映射为 `nodeVersion` / `expectedRange` / `missingApis` / `hint` 之处）。见 §5.3。

#### 5.1.3 会感受到词表扩展的测试侧消费点

| `文件:行号` | 断言 | 新增成员的影响 |
|---|---|---|
| `tests/auto-start-orchestrator.spec.ts:8, 12` | 导入 `StartErrorKind` + `HostStartErrorKind` | 无 |
| `tests/auto-start-orchestrator.spec.ts:146` | `SameSet<HostStartErrorKind, StartErrorKind>` 类型级相等 | **把两个词表锁在一起** —— 只在一侧加成员会在此处编译失败 |
| `tests/auto-start-orchestrator.spec.ts:123, 162, 175` | `'missing-credentials'` / `'node-environment'` / `'process-failed'` | 无（`process-failed` 仍为兜底成员） |
| `tests/node-env-guard.spec.ts:714, 722, 735, 744` | `'node-environment'` / `'invalid-setting'` | 无 |
| `tests/phase1-auto-start.spec.ts:228, 231` | `'missing-credentials'` | 无 |
| `tests/phase4-new-conversation-chrome.spec.ts:203, 206` | `'missing-credentials'` | 无 |
| `.specdev/.../phase-1.../test-scripts/v3-e2e-preflight.mts:173` | `!(outcome instanceof HostStartError) || outcome.kind === 'process-failed'` | **安全**：正向控制抛的是 `TransportClosedError`（不是 `HostStartError`），第一个析取项已为真；这**不是**过期断言 —— 见 §5.4 |
| `.specdev/.../phase-1.../test-scripts/v3-e2e-preflight.mts:240` | `snapshot.errorKind === 'invalid-setting'` | **F-1 已修复** —— 见 §5.4 |

### 5.2 两个新命令面的爆炸半径

| 命令面 | 注册位置 | 是否贡献到 package.json | 消费方 |
|---|---|---|---|
| `dsh.test.getDiagnosticsText` | `:952` 门禁之内 → `testDisposables` | **不**贡献（仅测试用），符合 AD-14 决策 8 | Phase 3 驱动的白名单（`phase-3 spec.md:151, 185`） |
| `dsh.test.listPendingInteractions`（扩展后） | 同一门禁，`:1039-1042` | 不贡献 | Phase 3 的 AC-25 step4 断言 `toolName === 'bash'` 且 `reason` 非空（`phase-3 spec.md:183`）—— **本 Phase 的投影扩展是 Phase 3 的硬前置** |
| `dsh.showHostDiagnostics` | `activate()` 中的生产注册 | **必须**加入 `contributes.commands` | AC-13(b)(c) |

### 5.3 F-3 的具体落点（Phase 1 第 3 轮 connectivity 审查结论 → Phase 2 义务）

| F-3 要求 | 落点 | 当前状态 |
|---|---|---|
| (1) 为 `invalid-setting` 明确映射分支 | `auto-start-orchestrator.ts:53-61`（`startErrorKindOf`）**已经**接受它，`:27-32` 也已列出它 | ✅ **Phase 1 已完成。** Phase 2 **不得**令其回归：`invalid-setting` 必须保持独立成员（不得折进 `node-environment` 或 `other`） |
| (2) 读 `.diagnostic` 前按 `kind` 收窄 | **现有产品读取点为 0**（§5.1.2）。落点在**新增**的 `host-diagnostics.ts` 映射中：仅在 `kind === 'node-environment'` 路径上读 `error.diagnostic`（或用 `error.diagnostic !== undefined` 守卫），使「恰好当 `node-environment` 时存在」的不变式（`session-host.ts:62`）永不被破坏 | ⚠️ 新代码 —— 该不变式只是**文字说明**，**类型系统并不强制**（字段类型是 `… \| undefined`），因此必须防止未来的某个 `HostFailureKind` 成员意外继承它 |
| (3) `launch.ts` 原样返回设置值 → `resolvedExecutable` 绝对性**只**对 `process-exec-path` 有保证 | `launch.ts:131-145`：`DSH_NODE_BIN` 原样返回 `environmentValue`（`:134`）；`nodeBinSetting` 原样返回 `setting`（`:138`）；只有 `process.execPath`（`:141`）保证绝对。而 `client.ts:214` 把 `nodeExecutable.path` 直接作为 `command` 传给 `spawn`，`closedError` 用的是 `this.runtime.description`（`:461`） | ✅ CONFIRMED 与描述一致。**后果**：AD-14 字段 `resolvedExecutable` 被文档化为「**绝对**路径」（`design.md:308`），AC-14 的测试断言它等于测试自己传入的绝对路径 —— 因此该契约**仅在输入为绝对路径时**成立。Phase 2 必须明确决定并记录：(a) 只对 `process-exec-path` / 显式绝对输入的情况断言绝对性，还是 (b) 记录前把该值解析为绝对路径。**不得**泛化地宣称绝对性 |

### 5.4 F-1 现状 —— **已修复** ✅ CONFIRMED（独立复核）

- `v3-e2e-preflight.mts:240` 现断言 `snapshot.errorKind === 'invalid-setting'`；`:196-198` 有注释说明旧的 `process-failed` 期望已被移除且不得恢复。`:258` 断言 `'node-environment'`。
- 唯一残留的 `process-failed` 出现在 `:173` —— 它**不是** Phase 1 connectivity 审查所描述的过期断言（那段文字引用的是 `:236` 的「today」）。`:173` 是一个**正向控制的析取项**：`!(outcome instanceof HostStartError) || outcome.kind === 'process-failed'`。该正向控制使用 witness 脚本作为 `dshBin`，其失败以 `TransportClosedError` 形式出现，不是 `HostStartError`，因此第一个析取项成立，**且在 Phase 2 新增成员后依然成立**。无需处理；**不要"修"它**。
- ⇒ Phase 2 的 verifier 可以复用该脚本的断言，不会自造出假红。

### 5.5 影响 / 风险表

| 区域 | 改动 | 风险 | 缓解 |
|---|---|:--:|---|
| `START_ERROR_KINDS` +3 成员（`spawn`、`handshake-timeout`、`bridge-listen`） | 加性 | 低 —— 单一真相源（`:27-32`），`auto-start-orchestrator.spec.ts:146` 的 `SameSet` 测试把 `HostStartErrorKind` 锁在同一集合，且没有 switch 会被破坏 | **不要**加 switch；保留 `startErrorKindOf` 的「扫描 + 兜底」形态 |
| `HostStartError.diagnostic` 不变式 | 必须保持 `node-environment` 专属 | 中 —— 类型允许任意 kind 携带 `diagnostic` | 守卫读取点；保持 `:323-327` 是唯一写入点 |
| 记录插入点 vs `shutdownInternal` 的先后 | 客户端字段必须从 `error` 读，不能从 `this.client` 读 | **高** —— 静默产出空字段 | 见 §4.2 注 1；在 AC-17/AC-18 测试中断言 `stderrTail` 非空 / `exitCode` 非 null |
| `child-exited` 边界位于 `onTransportDeath` 而非 `start()` | 新的插入点在 try/catch 之外 | 中 | 见 §7.2 |
| `TransportClosedError` 新增字段 | `client.ts` 受 per-file 100% 覆盖率约束 | **高** —— 新增的 `signal` 捕获分支默认不会被执行 | 显式补一条 SIGTERM 测试（`spec.md:52(b)` 已强制要求） |
| `listPending()` 投影新增 2 个键 | 被 `phase4-new-conversation-chrome.spec.ts`、`interaction-fail-closed*` 等消费 | 低 | 让 `questions` 分支保持无字段（或明确记录该决定） |
| Output Channel 加入 `VsCodeLike.window` | `tests/**` 中所有鸭子类型替身都没有 `createOutputChannel` | 中 —— 若无条件调用 `vscode.window.createOutputChannel(...)`，**所有**激活扩展的既有测试都会抛错 | 像 `createStatusBarItem?`（`:153`）一样声明为**可选**，缺失时回退为 no-op sink |
| `contributes.commands` 新增 | 无包级门禁覆盖 `contributes` | 低 | 用运行时测试证明，不靠门禁假设 |
| `packages/core/agent-loop` | 不动 | — | `spec.md:77` 明文禁止 |

---

## 6. 既有约束（Existing Constraints）

### 6.1 测试组织方式（`apps/vscode-dsh/tests/**`）

- **用鸭子类型 `vscode`，不用 `vi.mock('vscode')`。** 规范替身是 `node-env-guard.spec.ts:587-617`（`makeVscode`），激活辅助是 `:629-638`（`activateWith`），后者调用 `activate({subscriptions: [], extensionPath, workspaceState}, vscode as never)`。✅ CONFIRMED（完整读过）。
- **门禁是 OR 的后果**：任何注入替身的测试都会**注册全部** `dsh.test.*` 钩子，与 `VSCODE_DSH_TEST` 无关（见 §7.1）。
- **真实代码、真实子进程。** `spec.md:38` 要求主验证面是 Node 层用 fake runtime（`apps/vscode-dsh/tests/fixtures/fake-sdk-runtime.mjs`）驱动真实生产路径。既有先例：`node-env-guard.spec.ts:1-6`（「Every case executes a real subprocess; none is a static assertion」）与 `session-host-preflight.spec.ts`（驱动真实 `IdeSessionHost`）。
- **AC-14/15/16 等的断言风格**：**只做 JSON 记录的字段级断言**；除 AC-19/AC-20 对 UI `message` 的要求外禁止文本匹配（`spec.md:40`）。
- 测试文件平铺在 `apps/vscode-dsh/tests/`（50 个测试文件 / 该目录共 55 个文件），命名 `*.spec.ts`；辅助代码放在非 spec 的同级文件里（如 `spike-*.ts`）—— **不要**用 spec 命名放辅助代码。
- 逐文件清理是惯例：`afterEach` → `deactivate()` + `vi.restoreAllMocks()` + `commands.clear()`（`node-env-guard.spec.ts:580-585`）。

### 6.2 Lint / typecheck 口径

- `pnpm run lint` = `npm run build:lib:host && npm run lint:contracts-ready`；`build:lib:host` = `tsc -b tsconfig.host.json && tsdown --env.DSH_BUILD_FACE host`。✅ CONFIRMED —— 基线运行中 `tsc -b tsconfig.host.json` **成功**（随后 tsdown 执行），即 host 包的类型构建当前是绿的。
- 本 Phase 的 DSL 会撞上的零容忍规则：
  - `typescript(no-non-null-assertion)` —— `auto-start-orchestrator.ts:236` 与 `interaction-coordinator.ts:328` 已在触发。
  - `@stylistic(arrow-parens)` / `@stylistic(indent)` / `typescript(require-await)` / `typescript(no-unnecessary-condition)` / `typescript(no-confusing-void-expression)` / `typescript(no-base-to-string)` / `typescript(unbound-method)`。
  - **实务含义**：带可选方法的 JSDoc 接口上，不要对检查器已证明非空的值用 `?.`（否则 `no-unnecessary-condition` 触发，见 `connection-ui.ts:154`、`extension.ts:2272/2274`）；命令回调要用带括号 + 花括号的箭头函数（`no-confusing-void-expression`）。
- **导出需 JSDoc**（`spec.md:74`），由 `pnpm run verify-export-jsdoc`（`package.json:130`）强制，它也是 `test:docs` 的一个门禁 —— **它当前在通过集合里**，所以缺 JSDoc 的新导出会是**新增**失败。

### 6.3 格式 / 文件卫生

- 文件末尾**恰好一个换行**（`spec.md:74`）。Markdown 的 `verify-md-wrap` 已红，但 TS 文件由 lint/prettier 类规则检查。
- ESM：相对导入带 `.ts` 扩展名（`session-host.ts:27-32`）；需要加载 CJS 模块时用 `createRequire`（`extension.ts:79, 341-342`）。

### 6.4 覆盖率门禁 —— `packages/sdk/client/src/client.ts`

- per-file **100%**（`statements`/`branches`/`functions`/`lines`），`perFile: true`，由 `scripts/test-invariants.ts` 强制（`thresholds` 在 `:348`，`uncoveredLocationsReporter` 在 `:14`，排除清单在 `:70`/`:80`/`:106`/`:127`）。✅ CONFIRMED（上一会话读过；Phase 1 未改动）。
- **只能**用 `pnpm run test:coverage` / `pnpm run test:coverage:partitioned`；**禁止** `vitest run --coverage <path>` 过滤，因为那会把其他文件排除出报告（`phase-plan.md:138`）。
- 该包今天的基线是**绿的**：`pnpm run test packages/sdk/client` → 3 文件 / 84 用例全过，退出码 0 ✅（见 §附录 B）。

### 6.5 `spec.md:67-77` 的产品代码约束

- AD-3：归类在 `IdeSessionHost`，呈现在扩展；**禁止**在 `extension.ts` 里通过解析错误消息字符串做分类。
- AD-4：**禁止**新增 `StartOrchestratorState` / `ConnectionUiPhase` 成员。
- AD-5：消息前缀 `exit code: N` / `stderr tail:` / `spawn error:` 保持原文。
- AD-13：只扩展投影；**禁止**新增读取会话日志的 `dsh.test.*` 命令。
- 脱敏：复用 `redact.ts`；**禁止**另写一套。
- 不新增依赖；不新增 `contributes.configuration`；不动 `packages/core/agent-loop`。
- 文案语言：`apps/vscode-dsh/src` 不在 i18n 扫描范围；用户可见文案沿用既有扩展风格，Output Channel 技术片段保持英文原文，两者都不得含密文。

---

## 7. 风险与未知（Risks / Unknowns）

### 7.1 🔴 `shouldRegisterTestHooks` 门禁是 **OR**，而 `spec.md:21` 引用有误

- `spec.md:21` 称门禁在 `extension.ts:2124-2125`，条件为 `VSCODE_DSH_TEST === '1' | 'true'`。
- **实测**：该函数在 `extension.ts:2139-2142`，且为：

```2139:2142:apps/vscode-dsh/src/extension.ts
function shouldRegisterTestHooks(vscodeArg?: VsCodeLike): boolean {
  if (process.env.VSCODE_DSH_TEST === '1' || process.env.VSCODE_DSH_TEST === 'true') return true
  return vscodeArg !== undefined
}
```

- **为什么这影响 AC-13(d)**（`spec.md:46`）与 `spec.md:61` 的边界用例：反向用例的措辞是「`VSCODE_DSH_TEST` 未设置时 `dsh.test.getDiagnosticsText` **必须不存在**（断言 `registerCommand` 未被调用）」。但**所有既有测试都是注入 `vscode` 替身后激活扩展**（`node-env-guard.spec.ts:629-638`），而仅 `vscodeArg !== undefined` 就足以让门禁返回 `true`。另一条路 —— 不传替身直接 `activate(context)` —— 会走 `loadVscodeApi()`（`extension.ts:340-343`），它执行 `require('vscode')`，在纯 Node 测试进程中会**抛错**。✅ 两者均已读代码确认。
- **因此该反向断言无法按字面在当前测试框架下观测。** implementer 必须选择一种做法并写入 `implementation.md`：
  - (a) 通过 stub `createRequire` / `node:module` 间接观测门禁函数行为（这是唯一能让 `activate(ctx)` 在 `vscodeArg === undefined` 下跑起来的方式），或
  - (b) 保留注入替身，转而断言门禁语义的**另一半**（环境变量关闭 + 替身存在 ⇒ 已注册；并单独测试该谓词的两个析取项），同时记录「未注册」这一方向在进程内不可观测，或
  - (c) 若认为 (a)/(b) 都不充分，升级给用户澄清 spec 措辞。
- **不要**修改 `shouldRegisterTestHooks` 本身 —— 那会把既有 30 多个 `dsh.test.*` 钩子推到更严格的门禁之后，破坏整个测试套件。⚠️ 这是**spec 与仓库现状的落差**，不是代码缺陷。

### 7.2 🟡 `child-exited` 边界位于 `start()` 的 try/catch 之外

- `spec.md:52(AC-18)` 与 `spec.md:61` 要求带 `exitCode` / `terminationSignal` 的 `child-exited` 记录；`spec.md:54(AC-20)` 要求 `kind` ∈ {…, `child-exited`, …}。
- 但**连接成功之后**才退出的子进程由 `watchTransport`（`session-host.ts:568-595`）→ `onTransportDeath`（`:597-627`）观测，后者置 `status = 'error'` 并调用 `notifyError` —— **不是** `start()` 的 catch。
- ❓ 调研时点为 UNKNOWN：`start()` 的 `initialize()` 窗口是否也能观测到退出并归类为 `TransportClosedError` —— 能（`client.request` 在 `:313-316` 抛 `closedError('… is not running')`），且该路径**在** `start()` 内，所以让子进程在握手完成**之前**退出即可满足 AC-18。但 AC-18 的措辞（「当子进程退出时」）并未区分这两种情形。
- **后果**：记录器需要在 `onTransportDeath` 有第二个插入点，并且 `HostFailureKind → StartErrorKind` 映射必须回答「连接后的 `child-exited` 产生什么 `errorKind`？」—— 今天 `onTransportDeath` **不碰** `errorKind`；它流向 `extension.ts:2243-2249` → `onUnexpectedDisconnect()` → `disconnected` / `disconnected-retrying`，**不是** `failed`。AC-20 只要求快照 `phase !== 'connecting'`，所以这是可满足的，但该映射决定必须**显式**做出并记录。
- 给 implementer 的建议：用 `start()` 内**握手前**的退出路径满足 AC-18（该路径会产生 `failed` 快照与 `errorKind`），并把连接后的退出作为 `child-exited` **记录**处理，附一条关于快照的说明。若该解读被否决，这是**编码前就值得升级的 spec 歧义**，不是编码后的。

### 7.3 ✅ 前置事实复核：`dsh.test.answerApproval` / `resolveApproval` 属 Phase 3

- 全仓检索 `answerApproval|resolveApproval` **只**命中 `.specdev/` 下的文档（design / plan / spikes / phase-3 spec）。✅ CONFIRMED —— 无任何产品或测试源码提及它们。
- `phase-plan.md:155` 与 `spec.md:72` 都声明这里**不**交付。`interaction-coordinator.ts` 的改动仅限投影。
- ⇒ implementer **不得**「顺手」实现它们（`spec.md:71` 禁止 `getDiagnosticsText` 之外的新 `dsh.test.*` 面；AD-13 把本文件限制在投影上）。

### 7.4 ✅ 前置事实复核：正常路径上真实 spawn 失败不可达

- `spec.md:47` 的「重要前置事实」：Phase 1 之后门槛会拒绝不存在 / 不可执行的 Node 路径，且三个来源共用同一条解析链（AD-1），因此产品路径上真实的 spawn 失败不可达 —— 这正是 AC-7 想要的。
- **代码印证**：`session-host.ts:289-292` 在 `:310` 的 `client.start()`/`spawn()` **之前**完成解析与校验；`launch.ts:131-145` 是唯一的解析入口。✅ CONFIRMED。
- ⇒ AC-14 的两层取证是**必要的**，不是图方便：第 (1) 层用 `createProcessHarnessClient({command: '<不存在的绝对路径>'})`（`client.ts:470-476`）在 SDK 层制造**真实** `spawn` 失败；第 (2) 层用生产 `TransportClosedError` 类型驱动 Host 的失败出口。
- ⚠️ 注意：`spec.md:47` 把第 (2) 层描述为「步骤 (1) 产出的同一类型」。用生产构造函数构造该错误是可接受的，但 reviewer 可能追问「这是手工构造的对象而非产出的那个」；AC-14 原文允许这种用法（它写的是「用生产类 `TransportClosedError`（步骤 (1) 产出的同一类型）」）。

### 7.5 🟡 「有界记录存储」是硬要求，但没有给界值

- `phase-plan.md:147` 要求「sink 端口 + **有界**记录 + 脱敏」。`spec.md` 与 AD-14 都没给界值，任何 AC 都没有断言具体容量。唯一与无界增长相关的约束是 `seq` 单调递增，以及 AC-21 对 `JSON.stringify(records)` 的断言。
- ❓ UNKNOWN：reviewer/verifier 是否会测这个界。建议：把界做成带 JSDoc 的导出具名常量（可参照 `client.ts:29` 的 `STDERR_TAIL_LIMIT = 400`）并记录淘汰规则；在 `host-diagnostics.spec.ts` 中断言超出后按最旧优先淘汰，且 `seq` 保持单调。

### 7.6 🟡 `resolvedExecutable` 的绝对性

见 §5.3 第 (3) 条。`resolvedExecutable` 在契约上是「**绝对**路径」（`design.md:308`），但 `launch.ts:134/138` 会**原样**返回 `DSH_NODE_BIN` 与设置值。相对路径或形似空值的值会被原样记录。请决定并记录；不要静默假定绝对性。

### 7.7 🟡 Output Channel 不得打碎既有 50 个测试文件

`tests/**` 中每个鸭子类型 `vscode` 替身都没有 `window.createOutputChannel`。若扩展无条件调用它，**所有**激活扩展的测试都会失败（包括 Phase 1 的回归套件）。✅ CONFIRMED：没有任何替身提供它（全仓检索 `createOutputChannel` 在 `.specdev/` 之外**零命中**）。

缓解：在 `VsCodeLike.window` 上把它声明为可选，位置紧挨 `createStatusBarItem?`（`extension.ts:153-160`），缺失时回退为 no-op sink —— 但随后 AC-13(a)（「`createOutputChannel` 恰好调用一次、通道名稳定」）必须用**提供该方法的**替身来断言，同时 no-op 回退分支也必须被覆盖（否则该分支无覆盖率）。

### 7.8 🟡 本 Phase 的 git 分支**不存在**

- `current-status.json` 记录 `impl-phase-2-host-fail-loud-diagnostics` 已创建。**今日实测**：`git branch --list 'impl-*'` 只有 `impl-phase-1-build-outdir`、`impl-phase-1-sdk-server-specdev-ref`、`impl-phase-4-build-green-tsdown`、`impl-phase-4-subagent-enter-pin`；当前分支是 **`new/vscode-dsh`**，HEAD `5307eec361`（Phase 1 的提交）。`git reflog --all | grep phase-2-host` → **无输出**。✅ CONFIRMED。
- **后果**：`pipeline-gate.sh` 会在当前分支不是 `impl-<current_phase>` 时阻断 `implementer` 派发。调度者必须在派发 implementer **之前**执行 `git checkout -b impl-phase-2-host-fail-loud-diagnostics`（本次调研之后再建分支正是 `spec-workflow.mdc` 记录的顺序：code-explorer → 建分支 → implementer）。
- 这是**编排状态层面的落差**，对 implementer 而言是信息性的，不是代码阻塞。列出它是为了不让任何人误以为「分支已经在了」。

---

## 8. 未证事项（Uncertain / Unverified）

| # | 事项 | 标记 | 为何重要 | 如何解决 |
|---:|---|---|---|---|
| 8.1 | `IdeSessionHost.start()` 能否观测到**握手之后**的子进程退出并给出归类（而非落到 `onTransportDeath`）？ | ❓ UNKNOWN | 决定 AC-18 需要一个还是两个插入点（§7.2） | 对照 fake runtime 的退出时序读 `client.request` 的前置检查（`client.ts:313-316`）；或直接用握手前退出路径覆盖 AC-18 |
| 8.2 | AC-13(d) 的反向用例（「门禁关闭 ⇒ 未注册」）今天是否有任何进程内可观测手段？ | ⚠️ HYPOTHESIS：没有，除非 stub `node:module` | §7.1；影响 implementer 能否按字面完成边界用例清单 | 用临时测试试做法 (a)，或升级请求澄清措辞 |
| 8.3 | 除 `node-env-guard.spec.ts:587-617` 之外，是否还有其他鸭子类型 `vscode` 替身（如 `interaction-fail-closed*.spec.ts` 中的）也需要补 `createOutputChannel`？ | ❓ UNKNOWN（本次只完整读过一处替身） | 决定 Output Channel 改动会触及多少个测试文件 | 实现前逐个 grep 每个激活型 spec 里的 `vscode` 字面量 |
| 8.4 | `HostFailureKind → StartErrorKind` 对 `other` 与 `child-exited` 的映射 | ⚠️ HYPOTHESIS：`other → 'process-failed'`（`spec.md:61` 已写明）；`child-exited → ?`（AD-4 只把 `spawn` / `handshake-timeout` / `bridge-listen` 列为 Phase 2 新增，`design.md:186`） | `START_ERROR_KINDS` 缺成员会经兜底静默退化为 `process-failed`，使 AC-20 的 `kind` 断言通过而快照归类其实是错的 | 显式决定；若 `child-exited` 不需要 `StartErrorKind` 成员（因为它从不构成启动失败），在 `implementation.md` 记录该决定 |
| 8.5 | 记录存储的界是否会被下游 reviewer/verifier 断言 | ❓ UNKNOWN | §7.5 | 把界 + 淘汰规则做成具名常量并自测 |
| 8.6 | 当首次启动**没有**产生记录时（例如记录器尚未接好的启动），AC-22 的 `retryOfSeq` 关联应为何值？ | ❓ UNKNOWN | AC-22(b) 要求成对；找不到 `retryOfSeq` 目标的重试在 spec 中未定义 | 取最近一条 `phase === 'start'` 记录的 `seq`；并定义退化情形（`retryOfSeq: null`？或直接禁止） |
| 8.7 | `vscode.window.createOutputChannel` 是否必须经 `context.subscriptions` **dispose** | ⚠️ HYPOTHESIS：是，沿用既有模式（`:397`、`:1159+`） | 测试中反复 `activate`/`deactivate` 时泄漏的通道可能造成跨测试状态 | 沿用既有 `context.subscriptions.push(...)` 模式 |
| 8.8 | `stderrTail` 应沿用客户端的 400 行上限，还是记录用另一套上限 | ❓ UNKNOWN | AC-17 要求 ≥20 行原文；AD-14 未设上限 | 复用客户端尾部（`STDERR_TAIL_LIMIT = 400`，`client.ts:29`）并记录 |
| 8.9 | AC-20 的 UI 断言是否需要覆盖 `disconnected*` 阶段 | ⚠️ HYPOTHESIS：不需要 —— AC-20 说的是「Host 启动**已经**失败」 | 避免过度扩到 `connection-ui.ts`（AD-3 禁止重构它） | 断言只针对 `failed` 快照 |

**未发现 ⚫ CRITICAL 级发现。** 唯一需要人类决策的冲突是 §7.1（spec 引用错误 + OR 门禁使字面反向断言不可观测），其次是 §7.2（`child-exited` 插入点）。两者都不会使已完成的 Phase 1 工作失效，因此不构成 Stop-the-World 升级条件。

---

## 9. 桩检测（Stub Detection）

### 9.1 Registry 交叉验证 —— 活跃债务（3 条，全部 🟡 非阻塞）

| ID | Registry 描述 | 代码现状（今日实测） | 判定 |
|---|---|---|---|
| **DEBT-008** | 4 处引用/来源句失真，零行为影响；行号 `extension.ts:224` / `:2173`、`session-host.ts:43`、`auto-start-orchestrator.ts:36` | **四个行号今天仍然准确。** `extension.ts:224` = `* Read this extension's settings (AD-10).`；`extension.ts:2173` = `* Read the \`dsh.nodeBin\` Node executable setting (AD-10).`；`session-host.ts:43` = `* Class of a failed {@link IdeSessionHost.start}, identical to the`；`auto-start-orchestrator.ts:36` = `* the \`HostStartErrorKind\` vocabulary \`IdeSessionHost.start\` throws with, so a` | ✅ **描述属实**。目标 Phase 已是 `phase-2-host-fail-loud-diagnostics`（用户裁定并入）。两个文件都在 `primary_files` 内 → 在本 Phase 修 |
| **DEBT-009** | `phases/phase-1-node-env-preflight/implementation.md` §2.3 把 `.cursor/skills/project-build/SKILL.md` 归类失实；该工具树故意不入库 | 属产物侧债务（一个 `.specdev` 文档），**不在**本 Phase 的 `primary_files` 内；`.cursor/skills/project-build/SKILL.md` **确实**在当前工作区被修改（`git status -s` 第 1 行）✅ CONFIRMED | ✅ **不是本 Phase 的义务** —— 不要在这里尝试修它；也**不要** `git add` `.cursor/` 树（§7.8 / `AGENTS.md`：Phase 提交惯例上几乎不含 `.cursor/`） |
| **DEBT-004** | ide profile 主会话不可写；用户裁定本工作流不修（route A 绕过） | 完全在 `apps/vscode-dsh` 与 `packages/sdk/client` 之外；该条目点名的文件都不在 `primary_files` 内 | ✅ **不在范围内** —— 必须在 Phase 4 / HG-3 汇报中保持可见，但不在此解决 |

### 9.2 DEBT-008 明细 —— 精确修复清单（F-3 落点，零行为变更）

| # | 位置 | 当前文本 | 应改为 |
|---:|---|---|---|
| 1 | `extension.ts:224` | `Read this extension's settings (AD-10).` | `(AD-9)` —— `design.md:225` 的 AD-9 =「提供 `dsh.nodeBin` 设置项 + 三级 fail-loud 链」 |
| 2 | `extension.ts:2173` | `Read the \`dsh.nodeBin\` Node executable setting (AD-10).` | `(AD-9)` |
| 3 | `session-host.ts:43-44` | 「Class of a failed `{@link IdeSessionHost.start}`」—— 该来源句**未覆盖** `invalid-setting`（它由 `extension.ts:2185` 在 `StartHostPort` 层抛出） | 扩为覆盖两者，例如「Class of a failed Host start, thrown by `IdeSessionHost.start` or its `StartHostPort`」 |
| 4 | `auto-start-orchestrator.ts:36` | 「the `HostStartErrorKind` vocabulary `IdeSessionHost.start` throws with」 | 同样扩写；且该词表说明现在还应提到 Phase 2 的成员 |

> reviewer 的核对锚点：`design.md:225` = AD-9，`design.md:243` = AD-10（AC-2/AC-3 的文档落点）。本次会话均已核实 ✅。另注意 `session-host.ts:48-50` **已经**把 `invalid-setting` 记为成员 —— 只有**来源句**是过期的，所以这是注释保真修复，不是词表修复。

### 9.3 本 Phase 范围的未登记桩扫描

在 Phase 2 范围内检索 `@STUB`、空实现、硬编码 return、`// TODO: wire`。**结论：未发现未登记的桩。** ✅ CONFIRMED

| 位置 | 模式 | 判定 |
|---|---|---|
| `session-host.ts:329` | `throw new HostStartError('process-failed', …)` 吞掉 5 个不同边界 | **不是桩** —— 它是**被精确文档化的**兜底成员（`session-host.ts:50-51`、AD-4 `design.md:186`）。Phase 2 正是**拆分**它的那次改动；不需要登记债务，且同类拆分对应的 DEBT-006 已解决 |
| `session-host.ts:815` | 拆解后 `this.client = undefined` | 不是桩 —— 刻意的 dispose 语义 |
| `connection-ui.ts:134-138` | `default:` + `const _exhaustive: never` | 不是桩 —— 穷尽性断言（`design.md:184` 依赖该 switch 渲染 `failed`） |
| `auto-start-orchestrator.ts:57-60` | `for…of` 扫描 + 末尾 `return 'process-failed'` | 不是桩 —— 文档化的「无法识别的 `kind` ⇒ 落兜底成员」策略（`:45-52`） |
| `packages/sdk/client/src/client.ts:318-319` | `/* v8 ignore next */` + throw | 不是桩 —— 为覆盖率标注的不可达分支 |
| `host-diagnostics.ts` | — | 文件不存在 ⇒ 无可扫描内容 |
| Phase 2 的测试文件 | — | `host-diagnostics.spec.ts` 尚不存在 |

**边界**：本扫描**只**覆盖 Phase 2 范围。它**不是**全仓桩扫描，且刻意不对 `packages/sdk/client` 之外的 `packages/**` 作任何宣称。

### 9.4 给 implementer 的 registry 卫生提示

由于 DEBT-008 的目标 Phase 已是 `phase-2-host-fail-loud-diagnostics`，修复后的正确终态是：**把 DEBT-008 从「活跃债务」移到「已解决」**，并写明验证方式（四处引用现已分别读作 `AD-9` / 扩写后的来源句）—— **不要**新开条目，也**不要**声称 DEBT-004/009。

---

## 10. 推荐后续阅读（Recommended Next Reads）

给 implementer 的优先级顺序（每条都很便宜，且能消除一个已知未知）：

1. `apps/vscode-dsh/src/session-host.ts:255-330` —— `start()` 主体与需要重构的 catch（最重要的一读）。
2. `apps/vscode-dsh/src/session-host.ts:560-640` + `:786-820` —— `shutdown()` / `watchTransport` / `onTransportDeath` / `shutdownInternal`，对应 §7.2 与 `this.client = undefined` 的时序陷阱。
3. `packages/sdk/client/src/client.ts:186-270` 与 `:440-476` —— 字段捕获 + 唯一的 `closedError` 构造点（AD-5 要求两者同源）。
4. `.specdev/.../phase-2-host-fail-loud-diagnostics/spec.md:44-63` —— AC 表**和**边界/反向用例清单；契约用例与版本分流用例在那里逐条列明。
5. `.specdev/.../design.md:289-332`（AD-14）—— 18 字段表 + 决策 9-12（版本策略）—— 本报告 §3.2 已复刻。
6. `apps/vscode-dsh/src/extension.ts:950-1156` —— 整个 `testDisposables.push(…)` 块，看新 `dsh.test.*` 命令的既有风格与插入位置。
7. `apps/vscode-dsh/src/extension.ts:391-405` + `:2210-2284` —— 装配与 `StartHostPort` 那一跳（`invalid-setting` 的出处）。
8. `apps/vscode-dsh/tests/node-env-guard.spec.ts:576-748` —— 规范的激活 + 快照断言模式（`makeVscode` / `activateWith` / `dsh.test.requestStart`），含既有的 `node-environment` 与 `invalid-setting` 快照断言可供新 kind 参照。
9. `apps/vscode-dsh/tests/fixtures/fake-sdk-runtime.mjs` —— fake runtime 的旋钮，AC-15（永不应答 `initialize`）、AC-17（25 行 stderr 后 `exit(1)`）、AC-18(a)（`exit(7)`）、AC-18(b)（SIGTERM 自杀）都要用。
10. `apps/vscode-dsh/src/interaction-coordinator.ts:56-90` + `:188-199` + `:227-260` —— 投影 + `ApprovalEntry`（确认 `toolName`/`reason` 已在存储）。
11. `apps/vscode-dsh/src/connection-ui.ts:115-161` —— 确认 AC-19/AC-20 **不需要**产品代码改动（只要回归断言）。
12. `apps/vscode-dsh/package.json`（`contributes.commands` / `contributes.configuration`）—— 在新增 `dsh.showHostDiagnostics` 之前。
13. `.specdev/.../tech-debt-registry.md:24-36` —— 活跃表 + 规则块，动 DEBT-008 之前先读。
14. `.specdev/.../phases/phase-1-node-env-preflight/implementation.md` —— Phase 1 自己对 `invalid-setting` 拆分的记录（本 Phase 各次拆分最接近的先例）。

---

## 附录 A —— 继承债交叉验证汇总

| 项 | 描述 | 判定 | Phase 2 的动作 |
|---|---|---|---|
| DEBT-004 | ide profile 不可写；本工作流不修 | ✅ 不在范围 | 无（须在 Phase 4/HG-3 保持可见） |
| DEBT-008 (E-1) | `extension.ts:224`、`:2173` 引 `(AD-10)`，应为 `(AD-9)` | ✅ **属实**，行号准确 | 修这两处引用 |
| DEBT-008 (E-2) | `session-host.ts:43`、`auto-start-orchestrator.ts:36` 的来源句未覆盖 `StartHostPort` 层 | ✅ **属实**，行号准确 | 扩写两处来源句（并提到 Phase 2 成员） |
| DEBT-009 | Phase 1 `implementation.md` §2.3 归类失实 | ✅ 真实但**不在本 Phase 范围** | 本 Phase 不做；不要提交 `.cursor/` |
| F-1 | `v3-e2e-preflight.mts` 中过期的 `errorKind === 'process-failed'` 断言 | ✅ **已修复**（`:240` 现为 `invalid-setting`；`:173` 是合规的正向控制析取项） | 无；不要"修"`:173` |
| F-3 (1) `invalid-setting` 映射分支 | ✅ Phase 1 已完成 | 不得令其回归；保持为独立成员 |
| F-3 (2) 读 `.diagnostic` 前按 `kind` 收窄 | ⚠️ 现有产品读取点为 0 → 落在新代码 | 在新映射中守卫该读取 |
| F-3 (3) `resolvedExecutable` 绝对性仅对 `process-exec-path` 有保证 | ✅ `launch.ts:131-145` 已印证 | 决定并记录（§7.6） |
| Phase Entry Gate | 「目标 Phase = phase-2 且 🔴阻塞」⇒ 预期为空 | ✅ 活跃表 3 条，**全部 🟡非阻塞** → 继承的阻塞债 = **空**（与 `current-status.json` 的 D-HG3-6 一致） | 可继续 |

---

## 附录 B —— 环境事实与门禁基线（2026-09-15 实测，HEAD `5307eec361`）

### B.1 环境

| 项 | 值 |
|---|---|
| `PATH` 上默认 Node | `v20.16.0` —— **不合格**（不满足 `engines.node ^22.19.0 \|\| >=24.0.0`） |
| 合格 Node | `/usr/local/n/versions/node/24.3.0/bin/node`（与 `.nvmrc` = `24.3.0` 一致） |
| 每条 `pnpm` 命令的前置 | `PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH` |
| pnpm | `11.7.0` |
| git | `2.50.1` → 历史上那个 `--config.verify-deps-before-run=false` 绕行在此版本**已不需要**；本次会话包管理脚本均正常运行 ✅ |
| 分支 / HEAD | `new/vscode-dsh` / `5307eec361`「Phase phase-1-node-env-preflight: …」 |
| `impl-phase-2-…` 分支 | **不存在**（见 §7.8） |
| 工作区 | 脏（`.specdev/**`、`AGENTS.md`、`.cursor/**`、`pnpm-lock.yaml`、`apps/vscode-dsh/webview/dist/**` 等）—— HG-3 必须显式列举改动文件，绝不 `git add -A` |

### B.2 门禁基线 —— 除 SDK client 套件外，**四条门禁基线即为红**

本 Phase 的差量口径是**零新增失败**，不是全绿（`phase-plan.md:138`、`spec.md`）。

| 门禁 | 基线（今日实测） | 给 implementer 的提示 |
|---|---|---|
| `pnpm run lint` | **退出码 1**，**10 381** 条 `error` 级诊断，覆盖 **262 个不同文件** | 与 `current-status.json` 记录的数目一致（「lint 按权威 `.oxlintrc.json` 10381 条」）。`lint` 内部的 `tsc -b tsconfig.host.json` **成功**（其后 tsdown 执行了） |
| `pnpm run test apps/vscode-dsh` | **退出码 0 但为红**：`Test Files 4 failed \| 46 passed (50)`；`Tests 6 failed \| 351 passed \| 1 skipped (358)`；4 个 unhandled error；根因追至 `scripts/test-invariants.ts:188` | 完整日志在 `/tmp/p2-baseline-vscode-dsh.txt`。implementer 必须新增 `host-diagnostics.spec.ts` 而**不**扩大失败集合 |
| `pnpm run test packages/sdk/client` | **退出码 0，全绿**：`Test Files 3 passed (3)`；`Tests 84 passed (84)` | 完整日志在 `/tmp/p2-baseline-sdkclient.txt`。该套件必须保持全绿，且 `client.ts` 必须维持 per-file 100% 覆盖率 |
| `pnpm run test:docs` | **退出码 1**，`run-gates: 9 passed, 6 failed` | 6 个失败门禁：`markdown links`、`translation pairing`、`markdown wrap`、`agent note format`、`doc budgets`、`documentation standard tests`。**`verify-export-jsdoc` 在通过集合里** → 缺 JSDoc 的新导出会是**新增**失败 |

#### B.2.1 Phase 2 `primary_files` **内部**的既有 lint 诊断（不要把它们算到自己的改动上，也未必需要修）

| 文件 | 条数 | 行号（规则） |
|---|:--:|---|
| `apps/vscode-dsh/src/extension.ts` | 22 | `:2109:1`、`:2110:1`、`:2111:1`（`@stylistic(indent)`）；`:271:17`（`no-unnecessary-type-parameters`）；`:375:27`、`:380:29`、`:385:28`（`no-confusing-void-expression`）；`:407:50`、`:662:16`、`:750:18`、`:1102:48`、`:2272:9`、`:2274:9`（`no-unnecessary-condition`）；`:425:39`、`:1418:41`、`:1450:53`、`:1492:49`、`:1534:36`、`:1791:5`（`require-await`）；`:1004:76`（`no-base-to-string`）；`:1152:26`（`no-unnecessary-boolean-literal-compare`）；`:2109:45`（`unbound-method`） |
| `apps/vscode-dsh/src/interaction-coordinator.ts` | 9 | `:233:24`、`:411:54`（`arrow-parens`）；`:328:25`（`no-non-null-assertion`）；`:394:13`、`:421:15`、`:425:13`、`:446:13`、`:449:13`（`no-unnecessary-condition`）；`:412:62`（`no-confusing-void-expression`） |
| `apps/vscode-dsh/src/connection-ui.ts` | 2 | `:77:34`（`unbound-method`）；`:154:21`（`no-unnecessary-condition`） |
| `apps/vscode-dsh/src/session-host.ts` | 1 | `:597:3`（`require-await`） |
| `apps/vscode-dsh/src/auto-start-orchestrator.ts` | 1 | `:236:24`（`no-non-null-assertion`） |
| `apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts` | 4 | `:53:9`、`:96:9`（`prefer-const`）；`:52:39`、`:95:36`（`arrow-parens`） |
| `apps/vscode-dsh/src/host-diagnostics.ts` | 0 | 文件不存在 |
| `packages/sdk/client/src/client.ts` | **0** | 今天干净 → 此处任何新诊断**就是**新增失败 |
| `packages/sdk/client/src/launch.ts` | **0** | 干净 |
| `apps/vscode-dsh/src/redact.ts` | **0** | 干净 |
| `apps/vscode-dsh/tests/session-host.spec.ts` | **0** | 干净 |
| `packages/sdk/client/tests/sdk-client.spec.ts` | **0** | 干净 |

> Phase 1 用过、本 Phase 同样适用的差量方法：取 `git diff -U0`，检查**新增行**是否产生零新诊断，而不是要求全局计数下降。

### B.3 复现本报告全部事实的命令

```bash
# 环境
node --version; cat .nvmrc; git --version
PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH pnpm --version
git branch --show-current; git log -1 --oneline; git branch --list 'impl-*'

# 基线
PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH pnpm run lint                    # → 退出码 1，10381 条 error / 262 文件
PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH pnpm run test apps/vscode-dsh    # → 4 文件 / 6 用例失败
PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH pnpm run test packages/sdk/client # → 3 文件 / 84 用例全绿
PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH pnpm run test:docs               # → 9 passed / 6 failed
```

---

*Phase 2 代码调研结束。§11（UI / Design System 清单）因本 Phase `ui: false` 按约定省略。*
