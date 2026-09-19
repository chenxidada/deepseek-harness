# Correctness Review — Phase 1（基线冻结与能力域清单）

## 视角
**Implementation Correctness** — 代码是否正确工作。本 Phase 为纯记录/纯新增（无实现代码），「正确性」落在：清单/台账数据是否与仓库真实状态一致、基线是否可复算、JSON 是否合法、有无未登记桩。

## 判决
**PASS**

## 逐条 AC 验证（Phase 1 范围 = AC-2 + AC-16/AC-23/AC-14 基线留档）

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-2 | `capability-domains.json` 产出，`absorbed` 并集与整合前文件集双向差集为空 | `apps/vscode-dsh/tests/capability-domains.json` | ✅ | 亲自 `find` 采集 61 文件（57 `.spec.ts` + 4 `.spec.tsx`），与全部 `absorbed` 并集（61）双向差集为空：缺失 `[]`、多余 `[]`、重复 `[]`（Python 脚本实测） |
| AC-16(基线) | oxlint 现状 error 数复测留档 | `implementation.md` §4 | ✅ | 亲自复跑 `npx tsx scripts/run-oxlint.ts apps/vscode-dsh/tests` → 退出码 1，error **1183** 条、涉及 **44** 文件，与实现报「1183 / 44」一致（纠偏 design 原记 1184） |
| AC-16(基线) | glob 化 error 数留档 | `implementation.md` §4 | ✅ | 实现报 glob=203；未独立重跑（需临时改 `include`，跑完已还原，`git diff apps/vscode-dsh/tests/tsconfig.json` 为空佐证「已还原」）。203 在 Phase 1 仅作基线留档，非验收退出码，见 Observation |
| AC-23(基线) | smoke / capabilities 退出码采集留档 | `implementation.md` §3 | ✅ | 亲自复跑：`run-layer-v-capabilities.sh` 退出码 **0**（PASS）；`run-layer-v-smoke.sh` 退出码 **4**（HARNESS_ERROR，build-freshness 陈旧产物），与实现报「4 / 0」一致 |
| AC-14(基线) | Node 24.3.0 下 vitest 全绿留档 | `implementation.md` §5 | ✅ | 亲自复跑 `env PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" ./node_modules/.bin/vitest run apps/vscode-dsh/tests` → `Test Files 61 passed (61)`、`Tests 568 passed | 1 skipped`、`failed = 0`，与实现报完全一致 |

## Stub Detection（桩代码检测）

### 已注册桩（对照 registry）
| Registry ID | 文件:符号 | 状态 | 说明 |
|-------------|-----------|:--:|------|
| — | — | — | 本 Phase 无写面，registry 活跃债务为空（`—` 占位） |

### 新发现的未注册桩
| 文件:函数:行号 | 当前行为 | 严重性 | 处理建议 |
|---------------|---------|:--:|---------|
| — | — | — | 无 |

> `capability-domains.json` 各域 `entryAssertions[].caps` 为 `[]`，**非桩**：spec.md 明确约定「`entrypoint` 骨架本 Phase 填、`caps` 数组留空待 Phase 2 回填（`caps` 依赖 `CAP-` 编号）」，属 Phase 分阶段交付的既定骨架，不是空实现/占位。AC-11（caps 非空）归 Phase 2，不在本 Phase 验收范围。

## 关键发现

### 🔴 Must-Fix
无。

### 🟡 Should-Fix
无。

### 🟢 Observations
- **[文档保真]** `implementation.md` §1 变更清单与 §偏差 D-2 存在轻微范围张力：变更清单第 4 行写「`layer-v-capabilities-phase3.spec.ts` 仅登记，`git add` 由调度者在 HG-3 执行」；spec.md「约束」原文要求本 Phase「未入库 spec 纳入版本控制（`git add`）」。二者均在实现内**显式、非静默**记录，且符合用户分派指令「不 commit、改动留工作区由调度者统一 commit」。`find` 已采到该未入库文件，AC-2 不受影响。属「陈述/范围标注」层面的事实说明，不影响交付物正确性。供 HG-3 由用户确认「git add 时机」。
- **断言编号基线（前瞻提示）**：台账 556 行中已见大量旧标题仍含 `AC-<n>` 与 `DEBT-0xx` 前缀（如 `AC-27: …`、`DEBT-010: …`）。这是 Phase 1 骨架如实记录整合前标题的结果，本 Phase 不涉及 AC-6/AC-10（迁移 CAP- 编号），不构成本 Phase 缺陷；Phase 2 需按 AC-10 把 `it`/`test` 标题中的裸 `AC-<n>` 迁移走。
- **glob 复测（203）未独立重跑**：为避免临时改动 `tsconfig.json`（改动后需还原，有污染风险），本审查仅复核了「现状配置 1183」与「tsconfig 已还原」两条，未对「glob=203」做第三次独立复跑。203 属基线留档值，AC-16 的验收退出码 0 在 Phase 4 才判定，此处不影响本 Phase 判决。
- **`assertion-map.md` 表头 6 列**：与 design.md 数据模型 §2 的完整列集合（含 `keepChecks.K1/K2/K3`、`K依据`、`privateSymbols`、`replacementCap`、`关闭依据`、`weakened`）相比，Phase 1 骨架只放了 6 列（原文件/原标题/所属域/处置/理由码/新编号）。spec.md Phase 1 只要求「表头 + 全量声明行（原文件/原标题填实，其余留空待 Phase 2）」，故属 Phase 1 既定骨架；但「是否需在 Phase 2 补满 design 全列」是设计一致性范畴，归 reviewer-design。

## 数据一致性复核记录（本人实测）

| 项 | 实测值 | 实现报 | 一致 |
|----|:--:|:--:|:--:|
| `find` 文件数 | 61（57+4） | 61（57+4） | ✅ |
| `absorbed` 并集数 | 61 | 61 | ✅ |
| 双向差集（缺失/多余/重复） | 空/空/空 | 空/空/空 | ✅ |
| 台账数据行数 | 556 | 556（563 行 = 7 表头 + 556 数据） | ✅ |
| 源码 `it`/`test` 声明数 | 556（554 常规 + 2 `it.each`） | 556（554 + 2） | ✅ |
| oxlint 现状 error / 文件 / 退出码 | 1183 / 44 / 1 | 1183 / 44 / 1 | ✅ |
| vitest | 61 passed / 568 passed / 0 failed | 61 passed / 568 passed / 0 failed | ✅ |
| smoke / capabilities 退出码 | 4 / 0 | 4 / 0 | ✅ |
| JSON 域数 / groupMapping | 10 / 12 | 10 / 12 | ✅ |
| `scripts` 字段覆盖 16 文件、无重复无孤儿 | ✅ | ✅（D-1 已说明归属策略） | ✅ |

## 台账标题保真抽查（5 文件）

| 文件 | 抽查结果 |
|------|---------|
| `sandbox-clean-state.spec.ts` | 12 条声明标题与台账逐一对应；2 个 `it.each` 记格式字符串 `refuses %s`（台账 2 行，静态声明 1 行/个）✅ |
| `layer-a/activity-stream.spec.ts` | 5 条标题一致，含含 `\|` 标题（`…running → done \| failed \| aborted…`）在台账以转义 `\|` 正确落库 ✅ |
| `host-diagnostics.spec.ts` | 标题一致（AC-13/AD-14/AC-19/AC-21/AC-22/DEBT-010 系列）✅ |
| `gap-005-009-debt-fix.spec.ts` | 8 条标题一致，域=interaction ✅ |
| `layer-a-rtl/editor-chat-shell.spec.tsx` | 5 条标题一致，域=webview ✅ |

> 台账域列（第三列）的值集合 = 10 域 id 集合（`session-host/conversation/timeline/interaction/code-context/change-list/search/chat-panel/webview/test-harness`），与 `capability-domains.json` 一致。
