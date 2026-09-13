# Phase 5 实现摘要 — phase-5-replaceability-docs

## 变更清单（文件列表）

| 路径 | 变更 |
|------|------|
| `packages/ide/ide-bridge/README.md` | 新增 § Replaceability contract (AD-8)：双通道不变量 + 三可替换面 + 证明指针 |
| `packages/ide/ide-bridge/README.zh.md` | 同上中文对侧 |
| `packages/ide/ide-bridge/README.i18n.yaml` | 重录配对 hash |
| `packages/ide/ide-bridge/tests/replaceability-memory-transport.spec.ts` | **新增** PassThrough/`NdjsonSocket` 内存传输证明（hello + approval） |
| `apps/vscode-dsh/README.md` | 强化 Dual channel；新增 § Replaceability (AD-8)（UI / auto-allow / 链到 ide-bridge） |
| `apps/vscode-dsh/tests/replaceability-interaction-ui.spec.ts` | **新增** 第二 `InteractionUi` 注入 + Host 审批 e2e（outcome=`rejected`） |
| `packages/bundle/ide/README.md` | 删除过期「Host interaction UI deferred / Phase-3 stubs」；指向 replaceability |
| `packages/bundle/ide/README.zh.md` | 同上中文对侧 |
| `packages/bundle/ide/README.i18n.yaml` | 重录配对 hash |
| `.specdev/.../phase-5-replaceability-docs/test-scripts/prove-replaceability.sh` | **新增** 可脚本验证（vitest + agent-loop 无改动 + 文档存在） |
| `.cursor/skills/project-build/SKILL.md` | Phase 5 构建/测试知识 |
| `.cursor/skills/project-test/SKILL.md` | Phase 5 测试命令 |

**未改动（刻意）：** `packages/core/agent-loop/**`；GAP-010/011（`timeline-store.ts` / `diff-entry.ts`）。

## 对每个验收标准的实现说明

### AC-27 — 更换 UI / transport / auto-allow 不要求改 agent-loop

- 文档写明三可替换面均落在 `ide-bridge` / Extension。
- `prove-replaceability.sh` 对 `master...HEAD` 与工作区检查：无 `packages/core/agent-loop` 路径变更。
- 测试断言 `apps/vscode-dsh/package.json` 不依赖 `dsh-agent-loop`；ide-bridge 公共面无 loop 符号。

### AC-28 — 复用 DSH 包边界；新行为在 ide-bridge / Extension

- 无新 core 包；传输证明复用既有 `NdjsonSocket` + `validateBridgeFrame`。
- UI 证明复用既有 `IdeSessionHost.setInteractionUi` / `InteractionUi` 缝。
- Auto-allow 文档指向既有 `permission/select` → `dsh-permission-presets`（不新建策略库）。

### AC-29 — 文档化替换契约 + ≥1 可验证替换路径

- **文档权威源**：`packages/ide/ide-bridge` README（传输 + 帧 + fail-closed + stdout 纯度）；`apps/vscode-dsh` README（UI + permission picker，链回 ide-bridge）。
- **证明 1（传输）**：`replaceability-memory-transport.spec.ts` — PassThrough 双工对上 `NdjsonSocket` 跑通 `hello` + `approval/request`↔`approval/response`（`allowed-once`），非法 `allow-all` 仍被 `validateBridgeFrame` 拒绝。
- **证明 2（UI）**：`replaceability-interaction-ui.spec.ts` — 显式第二 presenter（非 QuickPick）经 `setInteractionUi` 注入，fake-runtime 审批回 `rejected`。

### AC-33 — ≥1 集成测试 + ≥1 可脚本验证

- 集成：`replaceability-memory-transport.spec.ts`（真实 `NdjsonSocket` + 校验器，非空 mock）。
- 可脚本 / e2e：`replaceability-interaction-ui.spec.ts`（IdeSessionHost + fake SDK runtime 全路径）+ `test-scripts/prove-replaceability.sh`。

## 测试结果（命令 + 输出）

```text
$ PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" \
  ./node_modules/.bin/vitest run \
  packages/ide/ide-bridge/tests/replaceability-memory-transport.spec.ts \
  apps/vscode-dsh/tests/replaceability-interaction-ui.spec.ts
 Test Files  2 passed (2)
      Tests  4 passed (4)

$ bash .specdev/specs/vscode-dsh-ide/phases/phase-5-replaceability-docs/test-scripts/prove-replaceability.sh
=== AC-29/33 memory transport + InteractionUi replaceability === … Tests 4 passed
=== AC-27: no packages/core/agent-loop changes on this branch === OK (base=master)
=== AC-28: ide-bridge / vscode-dsh do not import agent-loop === OK
=== AC-29: replaceability docs present === OK
ALL PHASE-5 PROVE STEPS OK

$ node scripts/verify-translation-pairing.ts packages/ide/ide-bridge/README.md packages/bundle/ide/README.md
verify-translation-pairing: 2 named pair(s) consistent
```

## 偏差记录

无功能性偏差。设计稿中的 `IdeBridgeTransport` TypeScript 接口**未提取**为生产类型（与 Phase 1 review 一致：Duplex/`NdjsonSocket` 证明即可）。

- **偏差描述**：以 `NdjsonSocket(Duplex)` + 文档描述可替换传输面，而非落地 `interface IdeBridgeTransport { start/stop/send/onFrame }`。
- **影响范围**：design.md §核心实体 / `IdeBridgeTransport` 示意；spec.md 证明约束（「第二 transport 适配器 **或** 第二 UI presenter」）。
- **原因**：spec 明确接受 memory/loopback **或** 第二 UI；避免无生产消费者的接口抽象（packages AGENTS：require a current owner）。
- **影响**：下游仍可用同一帧契约换 Duplex；若未来需 Host DI，可再提取接口而不改 agent-loop。

## 债务注册

- GAP-010 / GAP-011：**未修改**（本 Phase 明确不强制修）。
- 无新增 `@STUB` / GAP。
