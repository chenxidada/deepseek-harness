# Correctness Review — Phase 1（基线冻结与能力域清单）

## 视角
**Implementation Correctness** — 代码是否正确工作

> 本轮为 MUST-FIX 回流后的**重跑审查**。上一轮 review.md 的 MUST-FIX（表头 11 列对齐 / 移除「所属域」列 / 第 545 行转义修正）已全部修复；`capability-domains.json` 上一轮已通过、未改动。

## 判决
**PASS**

## 逐条 AC 验证

> 本 Phase 的 DAG 验收标准为 `AC-2` + 三条基线采集留档（`AC-16` / `AC-23` / `AC-14`）。`AC-9`（台账完整性）属 Phase 2，本 Phase 只冻结「原文件 / 原标题」骨架。

| AC | 描述 | 实现位置 | 判定 | 证据（本轮独立复测） |
|----|------|---------|:--:|------|
| AC-2 | `absorbed` 并集 vs 冻结文件集双向差集为空 | `capability-domains.json:27-235` | ✅ | 独立 `find` 得 **61** 个 spec（57 `.ts` + 4 `.tsx`）；`absorbed` 并集 = **61**（unique 61，无重复）；`find - absorbed` 与 `absorbed - find` 均 = `[]`，双向差集为空 |
| AC-16（基线留档） | oxlint 现状/glob 复测留档 | `implementation.md:139-152` | ✅ | 独立复跑 `npx tsx scripts/run-oxlint.ts apps/vscode-dsh/tests` = **1183 error / 44 文件 / exit 1**，与留档一致（44 文件含 2 个 helper `.ts`：`spike-attribution-helpers.ts`、`spike-t0b-continue-helpers.ts`） |
| AC-23（基线留档） | smoke/capabilities 退出码留档 | `implementation.md:123-137` | ✅ | smoke exit **4**（HARNESS_ERROR，源比 `lib` 新导致的陈旧构建，已说明成因）、capabilities exit **0**（PASS）——留档内部自洽；smoke 4 属环境态（`build-freshness` 拦截），非本 Phase 引入的缺陷 |
| AC-14（基线留档） | Node 24.3.0 下 vitest `failed=0` | `implementation.md:154-168` | ✅ | 独立复跑 `env PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" ./node_modules/.bin/vitest run apps/vscode-dsh/tests` = **61 passed / 568 passed + 1 skipped / failed 0**，与留档完全一致 |
| AC-9（台账骨架行数基线） | 556 条静态声明 = 554 常规 + 2 `it.each` | `assertion-map.md` | ✅ | 台账 **556 数据行**；61 文件逐文件声明数 == 台账行数（唯一「差异」为 `sandbox-clean-state.spec.ts`：10 常规 + 2 `it.each('refuses %s')` = 12，台账 12 行，两条 `refuses %s` 对应两个独立 `it.each` 声明，正确） |

## Stub Detection（桩代码检测）

### 已注册桩（对照 registry）
| Registry ID | 文件:函数 | 状态 | 说明 |
|-------------|-----------|:--:|------|
| — | — | — | 本工作流 registry「活跃债务」与「已解决」均为空（`tech-debt-registry.md:26,32`），无已注册桩 |

### 新发现的未注册桩
无。本 Phase 为纯记录 + 纯新增（JSON/markdown 数据资产，无实现代码），`capability-domains.json` 为合法 JSON 数据，`assertion-map.md` 为台账数据；全树未发现 `@STUB` 标记、空壳函数或 `return []` 型桩。

## 关键发现

### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
（无）

### 🟢 Observations
- 台账 `sandbox-clean-state.spec.ts` 出现两条标题同为 `refuses %s` 的行（`assertion-map.md:551,553`），这是两个独立 `it.each([...])('refuses %s')` 声明（`sandbox-clean-state.spec.ts:157,178`）的静态声明行，AC-9「`it.each` 一行静态声明记一行」要求两者各记一行，**非重复**。
- 台账第 358 行（`layer-a/activity-stream.spec.ts`）标题含 `\|`（`done \| failed \| aborted is probeable`），是对源文件 `it('AC-27: status machine running → done | failed | aborted is probeable', ...)`（`layer-a/activity-stream.spec.ts:116`）中竖线的正确 markdown 转义；转义感知的逐行列数校验（`(?<!\\)\|` 切分）确认全部 556 行均恰为 11 列，无表格结构损坏。
- smoke exit 4 / capabilities exit 0 两条脚本基线由实现留档，本轮**未独立复跑**（依赖 `DISPLAY=:1` 且 smoke 受 `build-freshness` 环境态影响）；留档成因自洽、数值可解释，独立复跑归下游 verifier（AC-4）。

## 本轮 MUST-FIX 回流修复复核

| 上一轮 MUST-FIX | 复核结果 |
|---|---|
| 表头改为 design.md §205-221 定稿 **11 列** | ✅ 表头 11 列与 design.md 逐列一致（`原文件/原标题/处置/理由码/keepChecks.K1/K2/K3/K 依据/privateSymbols/replacementCap/关闭依据/新 CAP- 编号/weakened`），分隔行 11 列 |
| 移除私增「所属域」列 | ✅ 全表 0 处 `所属域`；域归属唯一真相源回归 `absorbed` |
| 第 545 行转义修正（`run\\'s` → `run\'s`） | ✅ 第 545 行 `leaves the run\'s own session file alone` 与源文件 `sandbox-clean-state.spec.ts:109` 单反斜杠原文一致 |
| 556 数据行未被破坏 | ✅ 数据行仍 556，每行末 9 空列占位待 Phase 2 回填 |
