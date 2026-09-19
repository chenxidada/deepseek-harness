# Phase 1 验证报告 — 基线冻结与能力域清单

> 工作流 `vscode-dsh-test-consolidation` · Phase `phase-1-baseline-domain-inventory` · `ui: false`
> verifier 独立执行，未复用 implementer 的测试命令结论；命令均为独立推导、独立执行。

## 判决：PASS

## 执行环境

| 项 | 值 |
|---|---|
| 权威解释器 | Node v24.3.0（`/usr/local/n/versions/node/24.3.0/bin/node`，实测 `--version` = v24.3.0） |
| 默认解释器（陷阱，未使用） | v20.16.0（`which node` → `/home/chendc/.nvm/versions/node/v20.16.0/bin/node`） |
| 当前分支 | `impl-phase-1-baseline-domain-inventory`（符合 spec.md 前置条件，非 `main`） |
| 执行命令前缀 | 所有 Node 判定命令显式携带 `env PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH"` |

## 测试执行矩阵

| 场景 | 来源 | 命令 | 结果 | 证据 |
|------|:--:|------|:--:|------|
| AC-2 双向差集（文件集 vs absorbed） | spec | 独立脚本 `verify-phase1.cjs`（见 test-scripts/） | ✅ | 61=61，缺失 `[]`，多余 `[]`，重复 `[]` |
| 文件数（57 ts + 4 tsx） | spec | `find apps/vscode-dsh/tests -type f \( -name '*.spec.ts' -o -name '*.spec.tsx' \) \| sort \| wc -l` | ✅ | 61；`.spec.ts`=57、`.spec.tsx`=4 |
| 台账行数 = 声明数 | spec | 独立声明计数 + assertion-map 数据行计数 | ✅ | 554 常规 + 2 `it.each` = 556 = 台账 556 数据行 |
| 台账表头 11 列、无「所属域」 | design | pipe-split 计数 + 含「所属域」检测 | ✅ | 11 列；无「所属域」 |
| JSON 合法性 + 10 域 schema | design | `JSON.parse` + 逐域字段校验 | ✅ | 解析成功；10 域字段齐全、`spec` 命名匹配 |
| groupMapping 对齐 | design | manifest group 集合 vs groupMapping 键值 | ✅ | 12↔12，无缺失，值全部 ∈ 域 id 集合 |
| oxlint 基线（现状配置） | AC-16 | `env PATH=… npx tsx scripts/run-oxlint.ts apps/vscode-dsh/tests` | ✅ | **1183** error / 44 文件 / 退出码 1 |
| vitest 基线 | AC-14 | `env PATH=… ./node_modules/.bin/vitest run apps/vscode-dsh/tests` | ✅ | 61 passed / 568 passed + 1 skipped / failed=0 / 退出码 0 |
| smoke 退出码基线 | AC-23 | `env PATH=… DISPLAY=:1 bash run-layer-v-smoke.sh` | ✅ | 退出码 **4**（HARNESS_ERROR, build-freshness） |
| capabilities 退出码基线 | AC-23 | `env PATH=… DISPLAY=:1 bash run-layer-v-capabilities.sh` | ✅ | 退出码 **0**（PASS） |

## 独立验证场景（verifier 自行设计）

| 场景 | 命令 | 结果 |
|------|------|:--:|
| 双向差集（含重复检测，用 Node 24.3.0 解析 JSON + 与 find 结果比对，非复用 implementer 命令） | `verify-phase1.cjs` §3 | ✅ 双向为空、无重复 |
| 逐文件声明计数（独立正则 `it|test` 含修饰符 + `.each` 分类） | `verify-phase1.cjs` §4 | ✅ 554+2=556 |
| 台账数据行「列数分布」截断检测（`\|` 转义 pipe 的误报排除） | `grep`/`awk` | ✅ 唯一「4 列」行是合法 markdown 转义 pipe（`layer-a/activity-stream.spec.ts` 标题 `done \| failed \| aborted`），非截断 |
| 标题一致性抽查 ×3 | 源文件 grep vs 台账 | ✅ 见下 |
| groupMapping 值域校验（每个值必须 ∈ 域 id 集合） | `verify-phase1.cjs` §6 | ✅ 全部合法 |

### 标题一致性抽查（台账 vs 源文件）

| 文件 | 源文件证据 | 台账 | 判定 |
|------|------|------|:--:|
| `layer-a/activity-stream.spec.ts:116` | `it('AC-27: status machine running → done \| failed \| aborted is probeable', …)` | 台账该行标题含 `done \| failed \| aborted`（`\|` 为 markdown 转义 pipe） | ✅ |
| `sandbox-clean-state.spec.ts:109` | `it('leaves the run\'s own session file alone', …)`（单反斜杠） | 台账行 545 `leaves the run\'s own session file alone`（单反斜杠） | ✅ |
| `sandbox-clean-state.spec.ts`（`it.each`） | 2 条 `it.each` 格式串 `refuses %s` | 台账行 551/553 `refuses %s`（记格式字符串，符合 AC-9） | ✅ |

## 端到端验证

| 数据路径 | 结果 | 证据 |
|------|:--:|------|
| `find 文件集 → capability-domains.json absorbed → 双向差集` | ✅ 连通且为空 | 61=61，缺失/多余/重复均 `[]` |
| `61 源文件 → 静态声明计数 → assertion-map.md 数据行` | ✅ 全链路吻合 | 556=556 |
| `Node 24.3.0 → vitest 全绿（failed=0）` | ✅ 真实运行时验证 | 568 passed / 1 skipped / exit 0 |
| `Node 24.3.0 → smoke/capabilities 真实退出码` | ✅ 与留档一致 | smoke=4 / capabilities=0 |

## 基线可复算结论（AC-14/AC-16/AC-23）

implementation.md 留档值与本 verifier 独立复跑值**全部一致**：

| 留档项 | implementation.md 留档 | verifier 实测 | 一致 |
|------|:--:|:--:|:--:|
| oxlint 现状 error 数 | 1183 | 1183 | ✅ |
| vitest 文件数 / failed | 61 passed / failed=0 | 61 passed / failed=0 | ✅ |
| vitest 用例 | 568 passed + 1 skipped | 568 passed + 1 skipped | ✅ |
| smoke 退出码 | 4 | 4 | ✅ |
| capabilities 退出码 | 0 | 0 | ✅ |

> 纠偏确认：design.md / requirements AC-16 原文「1184→203」中的 **1184 为过期值**；implementer 已实测纠偏为 **1183**，本 verifier 独立复测再次得到 **1183**，纠偏成立。

## 残余风险

| 风险 | 严重性 | 阻塞 HG-3 | 说明 |
|------|:--:|:--:|------|
| `layer-v-capabilities-phase3.spec.ts` 仍为 untracked（`git add` 未执行） | 🟢 LOW | 否 | 已由用户分派指令硬约束「不 commit、改动留工作区、HG-3 由调度者统一 commit」；implementer 已在 implementation.md D-2 显式记录。AC-2 用 `find`（非 `git ls-tree`），该文件仍正确计入 61 文件集与 `absorbed`，不影响判定。`git add` 由调度者在 HG-3 依 `git status -s` 清单统一执行。 |
| 无端到端真机凭证链路（`DEEPSEEK_API_KEY` 缺失） | 🟢 LOW | 否 | 属环境既定事实，spec.md/AC-23 边界已声明「本机 PASS(0) 分支不可达」，不关闭 DEBT-4/5。capabilities 退出码 0 是「capability 编排无需凭证」路径，不据此断言真机链路已验证。 |

## Pipeline 合规检查

| 项 | 结果 |
|------|:--:|
| 当前分支 = `impl-phase-1-baseline-domain-inventory` | ✅ |
| 非 specs 文件变更均在本 Phase 写面内（`apps/vscode-dsh/tests/` 仅新增 2 文件 + 1 未入库 spec） | ✅ |
| `git status --short apps/vscode-dsh/tests/`：`?? assertion-map.md`、`?? capability-domains.json`、`?? layer-v-capabilities-phase3.spec.ts` | ✅ 符合「纯新增、无 src/webview/packages 改动」 |
| 未触碰 `src/**`、`webview/**`、`packages/**`、`scripts/**`、`test-scripts/**`、`.oxlintrc*.json` | ✅（本 Phase 零写面，仅新增 json/md + 登记未入库 spec） |

## 验证脚本

已落盘：`.specdev/specs/vscode-dsh-test-consolidation/phases/phase-1-baseline-domain-inventory/test-scripts/verify-phase1.cjs`（Node 24.3.0 可重跑，覆盖文件集/双向差集/声明计数/台账行数/JSON schema/groupMapping 六项）。

## 结论

AC-2 双向差集为空（61=61，缺失/多余/重复均空）；台账 556 行与 556 条静态声明吻合、表头 11 列无「所属域」列、无截断；AC-14/AC-16/AC-23 三条基线独立复跑与 implementation.md 留档值**全部一致**（1183 / 61 passed / smoke=4 / capabilities=0）。无 CRITICAL/MEDIUM 残余风险。判决 **PASS**。
