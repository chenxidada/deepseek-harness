# 正确性审查 — Phase 5（`phase-5-replaceability-docs`）

## 视角
**实现正确性** — 代码是否真正可工作

## 判决
**PASS**

## 逐条 AC 验证

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-27 | 更换 UI / Host bridge 传输 / auto-allow 不要求修改 `packages/core/agent-loop` | `prove-replaceability.sh`；两套 replaceability 测试；README 契约 | ✅ | 独立复跑：`master...HEAD` 与工作区无 `packages/core/agent-loop` 变更；`ide-bridge` / `vscode-dsh` 源码无 agent-loop 引用；Extension `package.json` 不依赖 agent-loop。替换证明走 `NdjsonSocket` / `setInteractionUi`。 |
| AC-28 | 复用既有 DSH 包边界；新行为落在 `ide-bridge` / Extension | 同上 | ✅ | 传输复用 `NdjsonSocket` + `validateBridgeFrame`；UI 复用 `setInteractionUi`；auto-allow 指向既有 `permission/select` → `dsh-permission-presets`。无新 core 包。 |
| AC-29 | 文档化替换契约 + ≥1 可验证替换路径 | ide-bridge / vscode-dsh README；两套证明测试 | ✅ | 文档含双通道不变量（stdout 纯度、fail-closed）与三可替换面；中文 README 对齐。可验证路径：memory 传输 + 第二 `InteractionUi`。bundle/ide 过期「UI 延期」文案已清除。 |
| AC-33 | ≥1 集成测试 + ≥1 可脚本验证 | memory transport 测试；InteractionUi e2e；`prove-replaceability.sh` | ✅ | 独立执行 vitest **4/4 通过**；prove 脚本 **全部步骤 OK**。 |

## 桩代码检测

### 已注册桩（对照 registry）

| Registry ID | 文件:函数 | 状态 | 说明 |
|-------------|-----------|:--:|------|
| GAP-010 | `timeline-store.ts` / `narrowDiffs` | ⚠️ 已知 | 🟡非阻塞；本 Phase 故意未修 — **不判 MUST-FIX** |
| GAP-011 | `diff-entry.ts` / `looksAbsolute` | ⚠️ 已知 | 🟡非阻塞；本 Phase 故意未修 — **不判 MUST-FIX** |

### 新发现的未注册桩
无。

## 关键发现

### 🔴 Must-Fix
无

### 🟡 Should-Fix
无

### 🟢 观察
- prove 脚本用 `grep -qv` 检查「过期文案已删」逻辑偏弱（坏句仍在时也可能通过）；当前文档已用 `! grep -q` 复核确认为 absent，不升格。
- vitest 内「无 agent-loop」断言偏弱；真正证据由 prove 的 `git diff` + `rg` 提供，已复跑通过。
- 未落地 `IdeBridgeTransport` 生产接口：符合 spec「transport **或** 第二 UI」与既有偏差记录。
- auto-allow 以文档 + 既有 presets 行为证明即可；AC-29 不要求第三套专属测试。

## 独立重跑命令（本审查）

```text
$ vitest run …/replaceability-memory-transport.spec.ts …/replaceability-interaction-ui.spec.ts
 Test Files  2 passed (2) / Tests  4 passed (4)

$ bash …/test-scripts/prove-replaceability.sh
ALL PHASE-5 PROVE STEPS OK
```
