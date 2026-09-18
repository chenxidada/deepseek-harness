# Phase 4 验证报告（SHOULD-FIX 闭合复审 · 独立重跑）

## 判决：PASS

独立重跑确认：上一轮合并判决的 2 条 SHOULD-FIX 均**真实闭合**且无回归。SHOULD-FIX-1（钉运行中子 Tab 投影 `readonly-live`）经静态读体 + 独立协议层端到端 + **变异测试**三重核实生效；SHOULD-FIX-2（删除 `childrenOf()` 死 API）经全仓 grep + 独立 TimelineStore 边回归测试核实，`getParent`/私有 `children` map/`clearSession` 级联删除均不回归。全量套件 **0 失败**、Host tsc 干净、无未登记 `@STUB`。本 Phase `ui: false`，无视觉验证维度。

---

## 测试执行矩阵

| 场景 | 来源 | 命令 | 结果 | 证据 |
|------|:--:|------|:--:|------|
| AC-35/36/37/38/39/40/71/74/75/78/79/84 L2/L3 | spec | `vitest run apps/vscode-dsh/tests/phase4-subagent-enter-pin.spec.ts` | ✅ | `Test Files 1 passed (1)` / `Tests 12 passed (12)`，exit 0 |
| 全量回归（无回归） | verifier | `vitest run apps/vscode-dsh/tests` | ✅ | `Test Files 59 passed (59)` / `Tests 523 passed | 1 skipped (524)`，exit 0（**0 失败**） |
| Host 类型检查 | spec/impl | `tsc -p apps/vscode-dsh/tsconfig.json --noEmit` | ✅ | exit 0，无输出 |
| 独立 SHOULD-FIX 验证（本次新写） | verifier | `tsx .../test-scripts/verifier-should-fix-phase4.mts` | ✅ | `done failed=0`（25 项断言，V-FIX-1/2） |
| 既有独立 e2e（V-IND-A~E + V-SF-1 闭合） | verifier | `tsx .../test-scripts/verifier-e2e-phase4.mts` | ✅ | `done failed=0`（36 项断言） |
| 既有独立验证（V-IND-1~6） | verifier | `tsx .../test-scripts/verifier-independent-phase4.mts` | ✅ | `done failed=0`（42 项断言） |

---

## SHOULD-FIX 独立结论（本次重跑核心）

### SHOULD-FIX-1：钉「运行中」子会话 Tab 投影 `readonly-live` —— **已真实闭合 ✅**

**修复落点（读体核实）**：`conversation-controller.ts:1911-1925`，`resolvePanelProjection` 根分支：

```ts
// A pinned running child Tab stays read-only live until it ends (AD-CU-11),
// mirroring the in-panel context path — no writable live seam for a running child.
const pinnedRunning = active.pinnedSubagent === true
  && this.childRunState.get(active.sessionId) === 'running'
return {
  mode: pinnedRunning
    ? 'readonly-live'
    : active.mode === 'replay' ? 'replay' : 'live',
  ...
}
```

**发送门禁（读体核实）**：`chat-panel-host.ts:697-703`，`sendPrompt` 对 `projection.mode === 'readonly-live'` 返回 `reject('readonly-live')`，与上下文进入路径同门禁。

**结束翻转（读体核实）**：`onSubagentFinished`（`conversation-controller.ts:2027-2054`）先 `childRunState.set('ended')`（`:2028`，使 `pinnedRunning` 变 false）→ 钉 Tab 分支 `childTab.mode === 'live'` → `setMode('replay')`（`:2049-2050`）→ 投影翻 `replay`。时序原子：`ended` 先于 `setMode('replay')`，中间无 `pushFullState` 介入，无「ended 但 mode 仍 live」的瞬时可写窗口。

**独立端到端证据（V-FIX-1，走真实协议帧，不照抄 implementer 测试）**：

| 步骤 | 断言 | 结果 |
|------|------|:--:|
| 上下文进入（不钉） | `resolvePanelProjection().mode === 'readonly-live'` | ✅ |
| 钉成 Tab | `pinnedSubagent === true` + 父恢复 active | ✅ |
| 重新进入已钉 Tab | `outcome === 'activated-tab'` + active 为子 Tab | ✅ |
| **修复核心断言** | 钉运行中子 Tab 投影 `readonly-live`（非可写 `live`） | ✅ |
| 双层模型 | registry `mode` 仍为 `'live'`（`OpenTabMode` 不扩展 `readonly-live`） | ✅ |
| 真实协议帧发送 | `composer/send` → FakeWebview 收到 `ui/reject-send` reason=`readonly-live` | ✅ |
| `sendPrompt` 直接调用 | `{ ok: false, reason: 'readonly-live' }` | ✅ |
| 结束翻转 | 投影翻 `replay` + registry `mode` 翻 `replay` | ✅ |
| 结束后再发送 | `{ ok: false, reason: 'replay' }` | ✅ |

**变异测试（证明修复真实、测试真能测到缺陷）**：把 `pinnedRunning` 临时改回 `false`（还原修复前行为）→ 我的 V-FIX-1 脚本 **3 红**（`pinned RUNNING child projects readonly-live` / `ui/reject-send reason=readonly-live` / `sendPrompt reject readonly-live`）、implementer 新用例 **1 红**（`pinned running child Tab projects readonly-live and rejects send until finished`）→ 复原后复跑 **全绿**。证明：该修复非「测试写得松、恒过」的假闭合，测试对缺陷真实敏感。

### SHOULD-FIX-2：删除 `TimelineStore.childrenOf()` 死 API —— **已真实闭合 ✅**

**全仓 grep**：`childrenOf` 在 `apps/vscode-dsh` 下**零匹配**；全仓仅剩 `packages/client/connection/src/client/fixture.ts:1953` 一处同名**局部闭包**（fixture 路径遍历，与 `TimelineStore` 方法无关），属已知无关项。

**独立边回归测试（V-FIX-2，直接实例化 `TimelineStore`）**：

| 断言 | 结果 |
|------|:--:|
| 运行时确认 `childrenOf` 方法已删除（`(store).childrenOf === undefined`） | ✅ |
| `getParent(child) === parent`（面包屑族谱） | ✅ |
| `getParent(grandchild) === child`（三代链） | ✅ |
| `isDescendantOf(grandchild, parent) === true` | ✅ |
| `itemsForSessionTree(parent)` 经私有 `children` map 遍历到三代（sessionId 集合 = parent/child/grandchild） | ✅ |
| `clearSession(parent)` 级联删除：`getParent(child/grandchild)` 均清空、`isDescendantOf` 归 false、树归空 | ✅ |

结论：删除公开 `childrenOf` 未破坏私有 `children` map 驱动的内部边维护（`linkChild` / `collectTree` / `clearSession` / `isDescendantOf` / `depthOf`），`getParent` 及其 3 处消费方（`navBack` / `resolvePanelProjection` 面包屑 / `teardownDeletedSession`）仍连通。

---

## 端到端验证（数据路径表）

| 数据路径 | 结果 | 证据 |
|----------|:--:|------|
| Webview `nav/open-subagent` → `parseWebviewToHostMessage`（fail-closed）→ `openSubagentContext` → `resolvePanelProjection` → `panel/state`(contextSessionId/mode) + `messages/replace` | ✅ | V-IND-A / V-FIX-1 |
| running 子 `sendPrompt`/`composer/send` → 投影 `readonly-live` → `reject('readonly-live')` → `ui/reject-send` | ✅ | V-IND-C / V-FIX-1（含真实协议帧） |
| `subagent.finished` → `onSubagentFinished` → 卡片 running→ended + 投影翻转 `replay`（含钉 Tab registry `setMode('replay')` 兜底） | ✅ | V-FIX-1 + phase4 vitest |
| 钉 Tab `action/pin-subagent` → `registry.create` + `setPinnedSubagent` + `persistOpenTabs` → 父恢复 active | ✅ | V-IND-D / V-IND-1 |
| 已钉再进入 → `getBySessionId` 命中 → `switchTo` → `outcome:'activated-tab'` | ✅ | V-IND-D / V-FIX-1 |
| 删子 `deleteSession` → `markSubagentCardDeleted` → 再进入 `outcome:'deleted'` | ✅ | V-IND-E / V-IND-2 |
| 删父 `deleteSession` → `buildBreadcrumb` `parentDeleted:true` → `navBack` `outcome:'disabled'` | ✅ | V-IND-E |
| running 子 `session.event` → `isProjectedSession` → `messages/append`（子上下文仍推 webview） | ✅ | V-IND-5 |

---

## 残余风险

| 风险 | 严重性 | 阻塞 HG-3 | 说明 |
|------|:-----:|:--:|------|
| 钉运行中子 Tab 的 `tabStatus` 投影与 context 路径不对称（registry `active.status` 默认 `idle` vs context 派生 `running`） | 🟢 LOW | 否 | review 已记 Observation；仅状态指示器，不影响 `sendPrompt` 门控（`readonly-live` mode 独立拒绝）、不破坏任何 AC、非本轮修复引入 |
| `panel/tabs` 帧报 registry `mode`（`live`）而非投影 `readonly-live` | 🟢 LOW | 否 | design.md 双层模型（`OpenTabMode` 无 `readonly-live`）的自然结果，不构成可写缝隙（发送门禁走投影 mode） |
| `buildBreadcrumb` 把「父已删」与「父未打开」统一折叠进 `parentDeleted` 字段 | 🟢 LOW | 否 | 连通性正确（`navBack` 同步返回 `disabled`），字段名语义观察项，非缺陷 |

残余风险全部为 LOW（🟢），无阻塞项；本 Phase `ui: false`，无 `visual-blocking`。

---

## 技术债校验

- **未登记 `@STUB`**：`rg "@STUB|@stub|@TODO|@FIXME" apps/vscode-dsh/src` → **0 命中**。
- **活跃债务表**：`tech-debt-registry.md` §活跃债务为空（仅「（无）」占位行），无新增债。

---

## Pipeline 合规检查

- 当前分支：`impl-phase-4-subagent-enter-pin`（匹配 `impl-<phase-id>`）。
- 产品改动全部落在 `apps/vscode-dsh/`（src 9 文件 + webview/src 7 文件 + tests 1 新增文件），无 `packages/core/agent-loop` 等外部改动。
- Pipeline compliance: ✅ 所有变更在 `impl-*` 分支工作区；未执行 git commit（implementer/verifier 均不提交，待调度者 HG-3 统一提交）。

---

## 验证脚本（落盘）

- `test-scripts/verifier-should-fix-phase4.mts`（**本次新写**：V-FIX-1 SHOULD-FIX-1 全协议端到端 + V-FIX-2 SHOULD-FIX-2 TimelineStore 边回归，25 项断言）
- `test-scripts/verifier-e2e-phase4.mts`（V-IND-A~E + V-SF-1；**本轮更新** V-SF-1 断言从「复现旧 bug」改为「断言修复后 readonly-live」）
- `test-scripts/verifier-independent-phase4.mts`（V-IND-1~6，未改动）
- `test-scripts/run-verifier-phase4.sh`（**本轮更新**：追加 `verifier-e2e-phase4.mts` 与 `verifier-should-fix-phase4.mts` 两步）
- `test-scripts/run-phase4-l2-l3.sh`（未改动）

### 复跑命令

```bash
export PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH"
./node_modules/.bin/vitest run apps/vscode-dsh/tests/phase4-subagent-enter-pin.spec.ts
./node_modules/.bin/vitest run apps/vscode-dsh/tests
./node_modules/.bin/tsc -p apps/vscode-dsh/tsconfig.json --noEmit
./node_modules/.bin/tsx .specdev/specs/vscode-dsh-conversation-ui/phases/phase-4-subagent-enter-pin/test-scripts/verifier-should-fix-phase4.mts
./node_modules/.bin/tsx .specdev/specs/vscode-dsh-conversation-ui/phases/phase-4-subagent-enter-pin/test-scripts/verifier-e2e-phase4.mts
./node_modules/.bin/tsx .specdev/specs/vscode-dsh-conversation-ui/phases/phase-4-subagent-enter-pin/test-scripts/verifier-independent-phase4.mts
```
