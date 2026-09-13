# Correctness Review — Phase 5 (`phase-5-replaceability-docs`)

## 视角
**Implementation Correctness** — 代码是否正确工作

## 判决
**PASS**

## 逐条 AC 验证

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-27 | 更换 UI / Host bridge transport / auto-allow 不要求改 `packages/core/agent-loop` | `prove-replaceability.sh`；`replaceability-memory-transport.spec.ts`；`replaceability-interaction-ui.spec.ts`；README 契约 | ✅ | 本审查独立重跑：`master...HEAD` / 工作区无 `packages/core/agent-loop` 路径变更；`rg` 在 `ide-bridge/src` 与 `vscode-dsh/src` 无 agent-loop import；`apps/vscode-dsh/package.json` 依赖含 `dsh-ide-bridge` 且不含 `agent-loop`。替换证明走 `NdjsonSocket` / `setInteractionUi`，不触达 loop。 |
| AC-28 | 复用既有 DSH 包边界；新行为在 `ide-bridge` / Extension | 同上测试 + 文档；无新 core 包 | ✅ | 传输证明复用既有 `NdjsonSocket` + `validateBridgeFrame`；UI 证明复用既有 `IdeSessionHost.setInteractionUi` → `InteractionCoordinator.setUi`；auto-allow 文档指向既有 `permission/select` → `dsh-permission-presets`（`danger-full-access` → `approval: 'never'` 在 presets 包已有真实映射）。无新增 core 包或 loop 依赖。 |
| AC-29 | 文档化 Host bridge / UI 替换契约 + ≥1 可验证替换路径 | `packages/ide/ide-bridge/README.md` § Replaceability；`apps/vscode-dsh/README.md` § Replaceability；两套 proof 测试 | ✅ | 文档写明双通道不变量（stdout 专属 SDK；bridge fail-closed）、三可替换面与证明指针；中文对侧 `README.zh.md` 含「可替换性契约（AD-8）」。bundle/ide 已去掉过期「Host interaction UI deferred」表述。可验证路径 ≥2：memory Duplex 传输 + 第二 `InteractionUi`。 |
| AC-33 | ≥1 集成测试 + ≥1 独立 e2e/可脚本验证 | `replaceability-memory-transport.spec.ts`；`replaceability-interaction-ui.spec.ts`；`test-scripts/prove-replaceability.sh` | ✅ | 本审查独立执行：`vitest run` → **2 files / 4 tests passed**；`prove-replaceability.sh` → **ALL PHASE-5 PROVE STEPS OK**（含 vitest + agent-loop 无改动 + 文档锚点存在）。 |

## Stub Detection（桩代码检测）

### 已注册桩（对照 registry）

| Registry ID | 文件:函数 | 状态 | 说明 |
|-------------|-----------|:--:|------|
| GAP-010 | `timeline-store.ts:applySessionEvent(tool/result)` / `narrowDiffs` | ⚠️ Known | 🟡非阻塞；本 Phase 故意未修 — **不判 MUST-FIX**（任务明示） |
| GAP-011 | `diff-entry.ts:openTimelineDiff` / `looksAbsolute` | ⚠️ Known | 🟡非阻塞；本 Phase 故意未修 — **不判 MUST-FIX**（任务明示） |

工作区 / `master...HEAD` 未见对上述 GAP 源文件的 Phase 5 实现改动；与 implementation「未改动（刻意）」一致。

### 新发现的未注册桩

| 文件:函数:行号 | 当前行为 | 严重性 | 处理建议 |
|---------------|---------|:--:|---------|
| — | 无 | — | Phase 5 新增测试与文档路径无 `@STUB` / 空壳返回 / 硬编码假成功 |

## 关键发现

### 🔴 Must-Fix
- 无

### 🟡 Should-Fix
- 无（下列弱点未阻断任何 AC，记入 Observations）

### 🟢 Observations
- **`prove-replaceability.sh` 对「过期文案已删除」用了 `grep -qv`**：该写法在「文件仍含坏句 + 另有不含坏句的行」时仍会 exit 0。当前 README 已用正确 `! grep -q` 复核确认为 absent；建议后续改为 `if grep -q '…'; then fail`。不升格 SHOULD-FIX：产物正确，AC-29 文档义务已满足。
- **vitest 内 AC-27 静态断言偏弱**：memory 套件只查 index 无 `runAgentLoop` 导出；真正的「无 loop 改动 / 无 import」由 prove 脚本的 `git diff` + `rg` 承担，且本审查已复跑通过。
- **未提取 `IdeBridgeTransport` 生产接口**：与 implementation 偏差记录及 Phase 1 review 一致；spec 接受 memory transport **或** 第二 UI presenter。以 `NdjsonSocket(Duplex)` 证明合法。
- **auto-allow 面以文档 + 既有 presets 行为为证**：无本 Phase 专属 auto-allow 新测试；AC-29 只需 ≥1 可验证替换路径（传输 + UI 已覆盖），不构成缺口。

## 独立重跑命令（本审查）

```text
$ vitest run packages/ide/ide-bridge/tests/replaceability-memory-transport.spec.ts \
            apps/vscode-dsh/tests/replaceability-interaction-ui.spec.ts
 Test Files  2 passed (2)
      Tests  4 passed (4)

$ bash .specdev/specs/vscode-dsh-ide/phases/phase-5-replaceability-docs/test-scripts/prove-replaceability.sh
… Tests 4 passed
OK: no agent-loop path changes (base=master)
OK: no agent-loop package imports/deps in Extension / ide-bridge
OK: docs + stale Phase-3 stub wording removed from bundle/ide
ALL PHASE-5 PROVE STEPS OK
```
