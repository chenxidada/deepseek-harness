# Phase 1 实现摘要 — 基线冻结与能力域清单

> 工作流 `vscode-dsh-test-consolidation` · Phase `phase-1-baseline-domain-inventory` · `ui: false`
> 本 Phase 只做三件事：冻结整合前基线 + 产出能力域清单骨架 + 产出台账骨架。**未搬动 / 未归并 / 未改任何既有 spec 文件内容**，未触碰 `src/**`、`webview/**`、`packages/**`、`scripts/**`、`test-scripts/**`、`.oxlintrc*.json`。

## 变更清单（文件列表）

| 文件 | 动作 | 说明 |
|---|---|---|
| `apps/vscode-dsh/tests/capability-domains.json` | 新增 | 10 能力域 + `groupMapping`（12 group → 10 域）+ `absorbed` + `entryAssertions` 骨架 |
| `apps/vscode-dsh/tests/assertion-map.md` | 新增 | 台账骨架：表头 + 556 行整合前用例声明（只填「原文件 / 原标题 / 所属域」三列） |
| `.specdev/specs/vscode-dsh-test-consolidation/phases/phase-1-baseline-domain-inventory/implementation.md` | 新增 | 本文件（基线留档） |
| `apps/vscode-dsh/tests/layer-v-capabilities-phase3.spec.ts` | 仅登记 | 未入库 spec，已登记进 `absorbed`（test-harness）+ assertion-map；`git add` 由调度者在 HG-3 执行（见「偏差记录」） |

> 仅新增上述 2 个文件（json/md）+ 本 implementation.md；未修改任何既有 spec 文件内容。

---

## 基线快照（每条可复算）

### 1. 整合前文件集（AC-2 判定对象）

**采集命令**：

```bash
find apps/vscode-dsh/tests -type f \( -name '*.spec.ts' -o -name '*.spec.tsx' \) | sort
```

**实测输出**：**61 个** = **57 个 `.spec.ts` + 4 个 `.spec.tsx`**（`.tsx` 全部在 `webview` 域，与 repo-exploration §3.1 一致）。

完整清单（相对 `apps/vscode-dsh/tests/`，按字典序）：

```
artifact-index.spec.ts
auto-start-orchestrator.spec.ts
build-freshness.spec.ts
chat-ready-regression.spec.ts
chat-ux-activity-stream.spec.ts
chat-ux-fork-retry-branch.spec.ts
chat-ux-refs-changes-diff.spec.ts
chat-ux-session-search.spec.ts
chat-ux-streaming-cancel-follow.spec.ts
conversation-registry.spec.ts
display-evidence-shell.spec.ts
display-evidence.spec.ts
editor-chat-panel.lifecycle.spec.ts
gap-003-004-debt-fix.spec.ts
gap-005-009-debt-fix.spec.ts
host-diagnostics.spec.ts
interaction-approval-resolution.spec.ts
interaction-fail-closed.e2e.spec.ts
interaction-fail-closed.integration.spec.ts
layer-a/activity-stream.spec.ts
layer-a/foundation-render-probe.spec.ts
layer-a/protocol-decision-smoke.spec.ts
layer-a/refs-changes-diff.spec.ts
layer-a/streaming-cancel-follow.spec.ts
layer-a-rtl/editor-chat-phase2.spec.tsx
layer-a-rtl/editor-chat-shell.spec.tsx
layer-v-capabilities-phase3.spec.ts
layer-v-capability-runner.spec.ts
layer-v-inject-disconnect.spec.ts
message-store-index.spec.ts
multi-tab-dispose.e2e.spec.ts
multi-tab-session.integration.spec.ts
node-env-guard.spec.ts
panel-close-delete.e2e.spec.ts
panel-l2-l3-protocol.spec.ts
phase1-auto-start.spec.ts
phase1-code-context.spec.ts
phase2-auto-ready.spec.ts
phase2-change-list-display.spec.ts
phase2-history-delete-host.spec.ts
phase2-multitab-history-replay.spec.ts
phase3-chat-ui-chassis.spec.ts
phase3-restart-continue.spec.ts
phase3-review-revert-replay.spec.ts
phase4-new-conversation-chrome.spec.ts
phase4-subagent-enter-pin.spec.ts
phase5-should-polish.spec.ts
replaceability-interaction-ui.spec.ts
sandbox-clean-state.spec.ts
session-host-preflight.spec.ts
session-host.spec.ts
spike-attribution-snapshot.spec.ts
spike-t0a-replay-rebuild.spec.ts
spike-t0b-continue-capability.spec.ts
timeline-diff.e2e.spec.ts
timeline-diff.integration.spec.ts
timeline-projector.spec.ts
verifier-phase1/layer-a-rtl.spec.tsx
verifier-phase1/layer-b-lifecycle.spec.ts
verifier-phase2/layer-a-rtl.spec.tsx
verifier-phase2/layer-b-host.spec.ts
```

**AC-2 双向差集校验**（冻结文件集 vs `capability-domains.json` 全部 `absorbed` 并集）：

| 校验项 | 结果 |
|---|---|
| 冻结文件数 | 61 |
| `absorbed` 并集数 | 61 |
| 缺失（在 find、不在 absorbed） | `[]`（空） |
| 多余（在 absorbed、不在 find） | `[]`（空） |
| 重复（一个文件被多域吸收） | `[]`（空） |

→ **双向差集为空**，每个整合前 spec 恰好归属一个域。

### 2. 用例声明集（AC-9 台账行数基线依据）

**静态计数命令**（对 61 文件的逐条 `it`/`test`/`it.each` 声明提取）：

```bash
# 对每个 spec 文件提取 \b(it|test)(\.modifiers)*\s*\(\s*('...'|"..."|`...`) 与 \b(it|test)\.each... 声明
```

**实测总数**：**556 条静态声明** = 554 条常规 `it`/`test`（含 `it.skip`/`test.skip`/`it.each` 以外的修饰符）+ **2 条 `it.each`**。

**vitest 运行时对照**（见 §5）：568 passed + 1 skipped = 569 运行时用例。差额 569 − 556 = 13，来自 2 条 `it.each` 展开为 15 个运行时用例（静态 1 行 vs 运行时 N 个）。台账以「静态声明」为最小单元，故行数为 556。

> 台账 `assertion-map.md` 共 556 行（表头 7 行 + 556 数据行 = 563 行）。Phase 2 的 AC-9 双向差集以此 556 为基线。

### 3. 脚本退出码基线（AC-23）

运行环境：Node 24.3.0（脚本内部 `layer-v-support/layer-v-runtime.sh` 自行解析，不信任 PATH）；`DISPLAY=:1` 可用（Xvfb）。

```bash
cd apps/vscode-dsh/test-scripts && bash run-layer-v-smoke.sh
cd apps/vscode-dsh/test-scripts && bash run-layer-v-capabilities.sh
```

| 脚本 | 退出码 | 语义 | 实测结论 |
|---|---|:--:|---|
| `run-layer-v-smoke.sh` | **4** | `HARNESS_ERROR` | 在 `build-freshness` 阶段失败：`apps/vscode-dsh/src/extension.ts` 比 `apps/vscode-dsh/lib` 下所有产物新（source `2026-09-18T16:10:19Z` > artifacts `2026-09-18T15:58:15Z`），即**构建产物陈旧**，提示先 `pnpm run build:lib:host`。这是当前环境状态，非本 Phase 要修的缺陷。 |
| `run-layer-v-capabilities.sh` | **0** | `PASS` | 成功在 `:1` 启动 Extension Development Host，capability driver 结论 `PASS`（本机 `DISPLAY=:1` 可用，capability 编排无需凭证即可 PASS）。 |

> 说明：smoke 在 `build-freshness` 检查即被挡下（未到凭证/显示判定）；capabilities 无 `build-freshness` 前置检查，直接 PASS。二者都属当前环境的可复现事实，留档供 Phase 3 AC-23 对比。

### 4. oxlint 基线（AC-16 复测留档）

```bash
# 现状配置（tests/tsconfig.json 的 12 文件逐文件白名单）
npx tsx scripts/run-oxlint.ts apps/vscode-dsh/tests
```

| 口径 | 命令/条件 | error 数 | 涉及文件数 | 退出码 |
|---|---|:--:|:--:|:--:|
| 现状配置 | 12 文件白名单 include | **1183** | 44 | 1 |
| 仅改 include 为 glob | 临时 `"include": ["**/*.ts","**/*.tsx"]`（跑完已还原） | **203** | 33 | 1 |

> 复测纠偏：design.md §现状依据 / requirements AC-16 记载「1184→203」，本 Phase 独立复测现状为 **1183**（非 1184），glob 化为 **203**（一致）。**1183 为本 Phase 实测值**，后续引用以此为准；203 现已被本 Phase 复测确认（不再是「未复测」的 UNKNOWN，repo-exploration R-2 关闭）。
> `tsconfig.json` 已在 glob 复测后**原样还原**（`git diff apps/vscode-dsh/tests/tsconfig.json` 为空），未留下任何改动。

### 5. vitest 基线（AC-14）

```bash
env PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" ./node_modules/.bin/vitest run apps/vscode-dsh/tests
```

**实测输出**（Vitest v4.1.8）：

```
Test Files  61 passed (61)
     Tests  568 passed | 1 skipped (569)
   Duration  8.21s
```

→ **`failed` = 0**（全绿），退出码 0。整合前基线确认，符合 AC-14 预期基线「全绿（failed = 0）」。

### 6. Node 解释器路径与版本

| 项 | 值 |
|---|---|
| 默认 `node`（`which node`） | `/home/chendc/.nvm/versions/node/v20.16.0/bin/node` → **v20.16.0**（环境陷阱，`~/.bashrc:151` 写死） |
| 权威解释器 | `/usr/local/n/versions/node/24.3.0/bin/node` → **v24.3.0**（满足 `engines: ^22.19 || >=24`） |
| 实测确认 | smoke 脚本输出 `[layer-v] resolved Node v24.3.0 at /usr/local/n/versions/node/24.3.0/bin/node` |

> npm 在默认 Node 20 下告警 `npm v11.5.2 does not support Node.js v20.16.0`，佐证默认解释器陷阱；所有判定命令均已显式携带 `env PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH"`。

---

## 对每个验收标准的实现说明

| AC | 说明 |
|---|---|
| AC-2 | `capability-domains.json` 已产出：10 域条目（`id`/`spec`/`scripts`/`absorbed`/`entryAssertions`/`verifierSources`），`absorbed` 并集与冻结 61 文件集双向差集为空（§1 表格）。域 id 与 `design.md` 定稿 10 域一致；`spec` 均为 `cap-<domain>.spec.ts`（`webview` 为 `.spec.tsx`）。 |
| AC-16（基线） | 现状 1183 error / glob 203 error 均已实测留档（§4），并标注「1183 为本 Phase 实测值、203 已复测确认」。 |
| AC-23（基线） | smoke exit 4 / capabilities exit 0 已实测留档（§3），含失败原因。 |
| AC-14（基线） | Node 24.3.0 下 `vitest run apps/vscode-dsh/tests` = 61 passed / `failed` 0，已留档（§5）。 |

`entryAssertions` 每域已填 `entrypoint` 骨架（`caps: []` 留空待 Phase 2 回填）：`activate`（session-host）、`dsh.test.newConversation`、`dsh.test.listHistory`、`dsh.test.injectApproval`、`dsh.test.resolveAtPath`、`dsh.test.listChanges`、`dsh.test.searchSessions`、`dsh.showPanel`、`message-bridge`、`dsh.test.simulateStartupOnly`。

---

## 偏差记录

| # | 偏差描述 | 影响范围 | 原因 | 影响 |
|---|---|---|---|---|
| D-1 | `capability-domains.json` 的 `scripts` 字段：8 个产品域（conversation/timeline/interaction/code-context/change-list/search/chat-panel/webview）填 `[]`；16 个 test-scripts 文件全部归入 `session-host`（4：smoke 链路）与 `test-harness`（12：自测 + capability harness + 共享运行时），每文件恰归属一个域 | design.md §数据模型（`scripts` 字段语义）；repo-exploration §3.4 | design.md 只给 session-host 示例，未给 16 文件的逐域 `scripts` 映射；AC-19 的完整 4 类分层 + 唯一归属域是 Phase 3 写面。本 Phase 以「每个 test-scripts 文件恰好归属一个域、无遗漏无重复」落骨架，产品域的能力覆盖关系由 `groupMapping`（12 group → 10 域）承载 | Phase 3（AC-19）落地 4 类分层时以此 16 文件覆盖为基线，无需重排；若 Phase 3 裁定某些共享文件（如 `layer-v-support/layer-v-runtime.sh`）应归属其他域，届时更新本字段 |
| D-2 | 未执行 `git add apps/vscode-dsh/tests/layer-v-capabilities-phase3.spec.ts` | spec.md §约束（「纳入版本控制（git add）」） | 用户分派指令硬约束「不 commit。所有改动留在工作区，由调度者在 HG-3 时统一 commit」，且明确「未入库 spec 必须在 absorbed 里登记 + 在 assertion-map.md 里登记其用例（它已在工作区，无需你移动它）」——未授权 implementer 执行 `git add` | 该文件已按用户指令登记进 `absorbed`（test-harness）与 assertion-map（其用例已逐条提取）；实际 `git add` 由调度者在 HG-3 依 `git status -s` 清单统一执行（会自然纳入该文件）。AC-2 判定用 `find`（非 `git ls-tree`），不因未 `git add` 受影响 |

---

## 债务注册

本 Phase 无写面、无桩代码、无 `@STUB`，**无新增债务**。

- 现有 `DEBT-1`（镜像原语双拷贝，`vscode-dsh-e2e-closure`）本 Phase **不解决**（属 Phase 3 写面），已在 repo-exploration §9 交叉校验匹配。
- `DEBT-4` / `DEBT-5`（`layer-v-capabilities.json` 部分 capability 从未真机执行）本 Phase **不关闭**，仅随 AC-23 退出码留档。

## 测试结果

本 Phase 为纯记录/纯新增（无实现代码），无集成测试可写；以三条基线运行时验证代替：

- oxlint（现状/glob）：见 §4，两组数值留档。
- smoke / capabilities 退出码：见 §3。
- vitest 全绿：见 §5（`failed` = 0）。

## 结论

61 文件双向差集为空；oxlint 现状/glob、脚本退出码（smoke/capabilities）、vitest 三条基线均已实测留档；无新增债务。
