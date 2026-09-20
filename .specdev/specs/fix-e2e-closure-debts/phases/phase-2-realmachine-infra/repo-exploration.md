# Repository Exploration Report — Phase 2: Real-Machine Infra (phase-2-realmachine-infra)

## 1. Task Context

This phase closes five real-LLM / real-machine infrastructure debts in the vscode-dsh Layer-V e2e harness:

- **DEBT-2** — fork `emptySeed` child sessions self-start via the shadow preset's self-orchestrating persona, so the `retry` prompt is queued behind the autonomous loop rather than triggering the first turn (`cap-fork-from-closed-turn` `child-replied` times out).
- **DEBT-3** — `cap-message-store-stream-patch` #18 streaming-increment observation (`requireIncrement:true, intervalMs:150`) fluctuates across runs.
- **DEBT-7** — nine webview-internal capabilities lack a host-side render-detection channel (`data-testid` + `probe/render-state` frame + `dsh.test.queryWebviewRenderState`).
- **DEBT-10** — ① set `requiresModel:false` on `cap-open-subagent-context` / `cap-pin-subagent-tab`; ② add `cap-delegate-subagent-model` walking a real model-delegation chain.
- **DEBT-12** — full-chain entry must call `dsh.test.resetToIdle` before/after each capability (orchestrator → idle + clear `readonly-live`).

Three preconditions (R5/R3/R4) must be verified before the manifest can be written. They are resolved in §4 and §7/§8.

## 2. Repository Overview

- **Language/stack**: TypeScript (ESM, `"type": "module"`), strict `noImplicitAny`; pnpm workspaces; Node `^22.19 || >=24`.
- **Relevant top-level areas**:
  - `apps/vscode-dsh/` — VS Code extension host + React webview + the Layer-V test harness (`test-scripts/`).
  - `packages/sdk/server/` — session fork / seed logic (`server.ts`).
  - `packages/subagent/` — subagent capability seam (`tool-subagent`, `subagent-spawn-in-process`, `subagent-fork-in-process`).
  - `packages/preset/` / `packages/specdev/specdev-presets/` — agent presets.
  - `packages/bundle/base/`, `packages/bundle/sdk-app/` — plugin-bundle patch layers.

## 3. Most Relevant Areas

| Debt | Area | Files (👁 = manually explored) |
|---|---|---|
| DEBT-2 | fork emptySeed + shadow preset | `packages/sdk/server/src/server.ts`, `apps/vscode-dsh/src/conversation-controller.ts`, `apps/vscode-dsh/test-scripts/layer-v-shadow-preset.sh`, `apps/vscode-dsh/test-scripts/run-layer-v-capabilities.sh` |
| DEBT-3 | stream increment observability | `apps/vscode-dsh/test-scripts/layer-v-capabilities.json`, `apps/vscode-dsh/test-scripts/layer-v-capability-driver/capability-runner.cjs` |
| DEBT-7 | webview render probes | `apps/vscode-dsh/webview/src/probes.ts`, `apps/vscode-dsh/webview/src/App.tsx`, `.../components/{TabChrome,Composer,DeleteConfirmModal}.tsx`, `apps/vscode-dsh/src/chat-panel/{protocol.ts,chat-panel-host.ts,editor-chat-panel.ts}`, `apps/vscode-dsh/webview/src/{bridge/message-bridge.ts,store/chat-ui-store.ts,main.tsx}` |
| DEBT-10 | subagent real delegation | `apps/vscode-dsh/test-scripts/layer-v-capabilities.json`, `apps/vscode-dsh/src/extension.ts`, `packages/specdev/specdev-presets/presets/specdev-orchestrator/agent.cordis.yml`, `packages/bundle/base/cordis.patch.yml`, `packages/subagent/tool-subagent/src/index.ts` |
| DEBT-12 | per-capability reset | `apps/vscode-dsh/src/extension.ts`, `apps/vscode-dsh/src/auto-start-orchestrator.ts`, `apps/vscode-dsh/test-scripts/layer-v-capability-driver/capability-runner.cjs`, `apps/vscode-dsh/test-scripts/run-vscode-dsh-e2e-closure.sh`, `apps/vscode-dsh/test-scripts/run-layer-v-capabilities.sh` |

## 4. Key Entry Points / Call Paths

### ① DEBT-10 — real delegation reachability (R5)

```
Parent session preset: specdev-orchestrator
  packages/specdev/specdev-presets/presets/specdev-orchestrator/agent.cordis.yml
    :4  - id: persona
    :23 - id: tool-fs-search
    :28 - id: orchestrator-tool-policy   ← NO tool-subagent row
  packages/specdev/specdev-presets/src/tool-policy.ts:21 ORCHESTRATOR_ALLOW = read/read_image/grep/glob/bash
    → the parent preset does NOT mount tool-subagent, and its policy restricts tools to read/grep/glob/bash

subagents capability providers (base bundle):
  packages/bundle/base/cordis.patch.yml
    :337-340 subagent-spawn-in-process  (providerName: spawn)
    :342-345 subagent-fork-in-process   (providerName: fork)
    :355-360 tool-subagent              (provider: spawn,  toolName: subagent, backgroundMode: continuable)
    :368-373 tool-subagent-fork         (provider: fork,   toolName: subagent_fork)

e2e host launch: dsh --profile ide  (apps/vscode-dsh/src/session-host.ts:430)
  profile patch layer (run-layer-v-capabilities.sh:280-291) patches ONLY agent-presets:
    default: specdev-orchestrator; roots: [shadow root, shipped presets root]
  → the preset file itself carries no tool-subagent / subagents provider rows
```

### ② DEBT-7 — host↔webview render detection (R3)

```
Webview boot:
  apps/vscode-dsh/webview/src/main.tsx → mountDshProbes() + createMessageBridge() → <App/>
  apps/vscode-dsh/webview/src/probes.ts:27 mountDshProbes() → window.__dshProbes
  apps/vscode-dsh/webview/src/probes.ts:12-19 DshProbes (6 signals):
    getFollowState / getActiveTabId / getComposerState / queryMessages / getStreaming / getStatusText

Protocol:
  apps/vscode-dsh/src/chat-panel/protocol.ts:58  HostToWebviewMessage union (panel/state :60, messages/replace :109, messages/append :114, messages/patch :123, status/set :134)
  apps/vscode-dsh/src/chat-panel/protocol.ts:240 WebviewToHostMessage union (ready :241, composer/send :242)
  apps/vscode-dsh/src/chat-panel/protocol.ts:301 parseWebviewToHostMessage(value)
  → NO probe/render-state frame in either union today

Host dispatch:
  apps/vscode-dsh/src/chat-panel/chat-panel-host.ts:353  void this.onWebviewMessage(message)   ← subscribe dispatch
  apps/vscode-dsh/src/chat-panel/chat-panel-host.ts:741  private async onWebviewMessage(...)    ← per-type switch
  apps/vscode-dsh/src/chat-panel/chat-panel-host.ts:994  private post(message: HostToWebviewMessage)  ← host→webview push
```

### ③ DEBT-12 — reset command entry points (R4)

```
Test-hook gate:
  apps/vscode-dsh/src/extension.ts:1012   if (shouldRegisterTestHooks(vscodeArg)) {
  apps/vscode-dsh/src/extension.ts:2575   function shouldRegisterTestHooks() { env VSCODE_DSH_TEST === '1'/'true' }
  existing hooks: dsh.test.sendPrompt :1014 / closeConversation :1026 / switchConversation :1093 / navBack :1299
  → dsh.test.resetToIdle and dsh.test.queryWebviewRenderState are NOT yet registered

Orchestrator reset:
  apps/vscode-dsh/src/auto-start-orchestrator.ts:195 onUserStop(): void
    :196 generation += 1; :197 state = 'idle'; :198 pending.length = 0; :199 autoRetryUsed = false
  getSnapshot() :131 / getStartState() :143 / request() :152

Capability walk loops:
  apps/vscode-dsh/test-scripts/layer-v-capability-driver/capability-runner.cjs:717 runManifest(manifest, host, options)
    :724 for (const cap of selected) { ... :750 await runCapability(cap, host, options) }
  apps/vscode-dsh/test-scripts/layer-v-capability-driver/capability-runner.cjs:501 runCapability(cap, host, opts)
    :507 for (let index...) walk cap.steps
  full-chain entry: run-vscode-dsh-e2e-closure.sh:237 run_batch → :255 bash run-layer-v-capabilities.sh
  → dsh.test.resetToIdle belongs in the runManifest loop (before/after runCapability), not the per-step loop
```

## 5. Likely Impact Surface

| Change | Files | Risk |
|---|---|---|
| Fork child preset for non-self-orchestrating test | `run-layer-v-capabilities.sh`, `layer-v-shadow-preset.sh`, new preset row | 🟡 MEDIUM — touches harness-only config |
| Tune #18 stream `intervalMs` / prompt | `layer-v-capabilities.json` (single step) | 🟢 LOW |
| `probe/render-state` frame + `queryWebviewRenderState` + probes | `protocol.ts`, `chat-panel-host.ts`, `probes.ts`, `extension.ts` | 🔴 HIGH — protocol change + host/webview dual side |
| `requiresModel:false` + `cap-delegate-subagent-model` | `layer-v-capabilities.json` | 🟡 MEDIUM — depends on R5 |
| `dsh.test.resetToIdle` + reset in walk loop | `extension.ts`, `capability-runner.cjs` | 🟡 MEDIUM |

## 6. Existing Constraints / Conventions

- Test hooks are gated behind `shouldRegisterTestHooks` (`extension.ts:1012` / `:2575`), env `VSCODE_DSH_TEST` — new `dsh.test.*` commands must register inside this branch.
- Fail-closed: `capability-runner.cjs` treats `requiresModel && !hasCredential` as `SKIPPED_NO_CREDENTIALS` (`:731-748`); stream steps gate on `requireIncrement` (`:575-576`).
- Host owns decision state; webview may hold probeable presentation state (`chat-panel-host.ts:3`).
- Preset patch REPLACES the whole `config` block; root order is load-bearing (`run-layer-v-capabilities.sh:273-278`).
- No hardcoded tunables — deployment-varying choices are config fields (`AGENTS.md`).

## 7. Risks / Unknowns

- **① R5 (DEBT-10 reachability) — ✅ CONFIRMED**: `specdev-orchestrator` preset mounts only `persona` + `tool-fs-search` + `orchestrator-tool-policy` and does **not** mount `tool-subagent`; the `subagents` providers are `spawn` (`subagent-spawn-in-process`) and `fork` (`subagent-fork-in-process`) from the base bundle. ⚠️ HYPOTHESIS (unverified end-to-end): whether those base-bundle rows are layered into the `ide` profile's parent session at runtime (the profile patch only touches `agent-presets`). → DEBT-10 step ② must either add a `tool-subagent` row to the test parent preset or confirm the base bundle is already layered; otherwise AC-13 cannot be written against a reachable tool.
- **② R3 (DEBT-7 mapping) — ✅ CONFIRMED**: four of nine capabilities target React DOM nodes with `data-testid` already present; five target store/bridge/viewtype/html-builder/injection surfaces with **no** DOM testid and **no** `__dshProbes` signal today. `__dshProbes` has 6 signals, missing `queryTestIds()` / `getRenderState()`; protocol has no `probe/render-state` frame.
- **③ R4 (DEBT-12 entry points) — ✅ CONFIRMED**: `shouldRegisterTestHooks` at `extension.ts:1012`/`:2575`; `onUserStop()` at `auto-start-orchestrator.ts:195` (idle + clear pending + reset autoRetryUsed); capability walk loop is `runManifest` at `capability-runner.cjs:724`; existing `navBack`/`closeConversation`/`switchConversation` hooks are at `extension.ts:1299`/`:1026`/`:1093`.

## 8. Uncertain / Unverified

| Function | Signature confirmed | Behavior unverified |
|---|---|---|
| `specdev-orchestrator` runtime tool set in `ide` profile | ✅ | ❓ whether base bundle `tool-subagent`/`subagents` rows actually mount into the parent session (R5 ⚠️) |
| `chat-panel-host.ts:994 post()` public push path for a new `probe/query-render-state` frame | ✅ signature exists (`private post`) | ❓ no public method to send an arbitrary frame from host→webview today; a new public query method is required |
| `capability-runner.cjs runManifest` reset seam | ✅ loop at `:724` | ❓ no reset command exists yet; insertion point is design, not implemented |

## 9. Stub Detection & Registry Cross-Validation

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| DEBT-2 | `server.ts:513 forkSeedFromParent` (emptySeed→`seed:[]` at `:517-518`) + `conversation-controller.ts:866 forkFromClosedTurn` (retry `:898-924`) | 空种子分叉 + shadow preset 自启动 | `emptySeed` 返回空 seed（`server.ts:517-518`）；shadow preset 删除 `orchestrator-tool-policy` 后仍保留 `persona`（自编排） | ✅ 匹配 |
| DEBT-3 | `layer-v-capabilities.json:269/282` #18 stream `requireIncrement:true, intervalMs:150` | 流式增量跨 run 波动 | `:282` 步骤确为 `requireIncrement:true, intervalMs:150`；`capability-runner.cjs:575-576` 增量门控真实存在 | ✅ 匹配 |
| DEBT-7 | `probes.ts`（6 信号）+ 9 项能力 | 缺 host 侧渲染探测 | `probes.ts:12-19` 仅 6 信号，无 `queryTestIds`/`getRenderState`；`protocol.ts:58/240` 无 `probe/render-state` | ✅ 匹配（缺口仍在） |
| DEBT-10 | `layer-v-capabilities.json:345/364`（两项 `requiresModel:true`）+ `extension.ts:1315 injectSubagent` | 测试注入而非真实模型委托 | `:349/368` 仍 `requiresModel:true`；步骤 `:357/376` 用 `dsh.test.injectSubagent`；无 `cap-delegate-subagent-model` | ✅ 匹配 |
| DEBT-12 | `run-vscode-dsh-e2e-closure.sh:237 run_batch` | 串行状态污染 | `capability-runner.cjs:724` 循环无 per-capability reset；`extension.ts` 无 `dsh.test.resetToIdle` | ✅ 匹配 |

### Stub Detection Summary

- ✅ Confirmed stubs: 0 (five debts are "功能缺失/已知缺陷" gaps, not empty-shell stubs)
- ⚠️ Registry mismatch: 0
- 🔴 Unregistered stubs: 0

## 10. Recommended Next Reads

1. ⭐ MUST READ — `.specdev/specs/fix-e2e-closure-debts/phases/phase-2-realmachine-infra/spec.md`（AC 与前置条件 R3/R4/R5）
2. ⭐ MUST READ — `apps/vscode-dsh/src/chat-panel/protocol.ts` + `chat-panel-host.ts`（DEBT-7 帧扩展）
3. 🔷 SHOULD READ — `apps/vscode-dsh/test-scripts/layer-v-capability-driver/capability-runner.cjs`（DEBT-3/12 门控与 walk 循环）
4. 🔷 SHOULD READ — `packages/specdev/specdev-presets/presets/specdev-orchestrator/agent.cordis.yml` + `packages/bundle/base/cordis.patch.yml`（DEBT-10 R5）
5. 🔹 OPTIONAL — `apps/vscode-dsh/src/auto-start-orchestrator.ts`（DEBT-12 `onUserStop`）
