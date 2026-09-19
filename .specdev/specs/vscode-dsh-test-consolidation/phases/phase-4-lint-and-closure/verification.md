# Phase 4 验证报告 — lint program 与收口

## 判决：PASS

## 测试执行矩阵

| 场景 | 来源 | 命令 | 结果 | 证据 |
|------|:--:|------|:--:|------|
| AC-13: 完整域文件运行留痕 | spec | `./node_modules/.bin/vitest run apps/vscode-dsh/tests/cap-session-host.spec.ts` | ✅ | `Test Files 1 passed (1)` / `Tests 144 passed (144)` / exit 0；implementation.md `:104-112` 亦留痕 |
| AC-14: vitest 全绿 | spec | `./node_modules/.bin/vitest run apps/vscode-dsh/tests` | ✅ | `Test Files 12 passed (12)` / `Tests 556 passed (556)` / 0 failed / exit 0 |
| AC-15: tsconfig include 改 glob | spec | 独立脚本 `test-scripts/verify-ac15-glob-coverage.mjs` | ✅ | include=`["**/*.ts","**/*.tsx"]`（无逐文件白名单）；双向差集为空（15 = 15） |
| AC-16: oxlint 归零 | spec | `npx tsx scripts/run-oxlint.ts apps/vscode-dsh/tests` | ✅ | exit 0；`--format json` → `number_of_files:15 / diagnostics:0 / rules:110` |
| AC-17: 头部注释更新 | spec | 读 `apps/vscode-dsh/tests/tsconfig.json:1-14` | ✅ | 无「目录过大不可作为 program / not clean as a program」陈述；新注释陈述 glob 口径 + registry 记录残余错误 |
| AC-18: tsc 口径显式记录 | spec | 读 `tech-debt-registry.md:28` + `tsc --noEmit` 复跑 | ✅ | `DEBT-019` 条目存在、字段齐全；`tsc` 独立复跑报 **219** 条（与 registry 记录一致） |

## 独立验证场景（verifier 自行设计）

| 场景 | 命令 | 结果 |
|------|------|------|
| glob 覆盖集合 vs 实际文件清单双向差集 | `node test-scripts/verify-ac15-glob-coverage.mjs` | ✅ 空差集 |
| oxlint 非空跑证明（防「0 error = 未扫描」假绿） | `oxlint --format json apps/vscode-dsh/tests` | ✅ `number_of_files:15`（扫描了全部 15 个 .ts/.tsx） |
| DEBT-019 的 219 条类型错误非虚构（独立复现计数） | `tsc -p apps/vscode-dsh/tests/tsconfig.json --noEmit` | ✅ exit 2 / `error TS` 计数 219 |
| AC-24 生产代码零改动红线 | `git status -s` | ✅ 改动仅在 `apps/vscode-dsh/tests/**` + `tech-debt-registry.md`；无 `apps/vscode-dsh/src/**` 条目 |

## Reviewer 建议的验证场景

review.md 为 SHOULD-FIX（3 条 should-fix 均为文档回写类，非功能缺陷），未附加需 verifier 复跑的功能验证场景；本报告已独立覆盖全部 6 项 AC 的运行时与静态验证。

## 端到端验证

| 数据路径 | 结果 | 证据 |
|------|:--:|------|
| tests 目录 → tsconfig glob program → oxlint type-aware 解析 | ✅ | 15 文件全入 program，0 diagnostics，exit 0 |
| tests 目录 → vitest 全量收集 → 12 spec / 556 用例 | ✅ | `556 passed (556)`，0 failed，exit 0 |
| 单域完整文件 → cap-session-host（144 用例） | ✅ | `1 passed (1)` / `144 passed (144)`，exit 0 |

## 残余风险

| 风险 | 严重性 | 阻塞 HG-3 | 说明 |
|------|:--:|:--:|------|
| S-1（reviewer-design）：`jsx: react-jsx` 未回写 design.md 修订记录 | 🟢 LOW | 否 | 文档真相源漂移；实现合理（复用 `webview/tsconfig.json:7` 既有值，消除 35 条 TS17004 假错误） |
| S-2（reviewer-design）：oxlint glob 化真实起点 145（非 design.md 字面 203）未回写 design.md | 🟢 LOW | 否 | 文档真相源漂移；implementation.md D-2 已留档，且 203 本身是 Phase 2 归并前的过时基线 |
| S-3（reviewer-correctness）：25 处 `no-deprecated` 用行级豁免替代 design.md 步骤 4 的「替换为 `buildEditorChatSpaHtml`」，未补记 D-4、implementation.md 有误导性「见 design.md 决策」引用 | 🟢 LOW | 否 | 豁免不削弱断言（`buildThinChatHtml` 为 fixture-only legacy HTML），符合仓库窄豁免惯例；纯文档/记录问题 |

> 上述 3 项均为「文档回写 / 真相源漂移」类，对交付物（代码、测试、lint、registry）**零功能影响**，故不改变本 Phase 的 PASS 判决。是否回写 design.md / 补记 D-4 由调度者在 HG-3 向用户呈报后裁定。

## Pipeline 合规检查

- ✅ 当前分支 `impl-phase-4-lint-and-closure`（`git branch --show-current` 实测）。
- ✅ 本 Phase 全部写面（`apps/vscode-dsh/tests/*.spec.ts|tsx`、`tests/tsconfig.json`、`tech-debt-registry.md`）均落在该分支工作区，未在 `main` 或其他分支外改动。
- ✅ 无 `apps/vscode-dsh/src/**` 改动（AC-24 红线满足）。
- ✅ 未发现未注册的桩（`@STUB`）；`DEBT-019` 已在 registry 显式登记（AC-18 满足，gate 债务登记校验可通过）。

## 验证脚本

落盘于 `test-scripts/`：

- `verify-ac15-glob-coverage.mjs` — AC-15 双向差集校验（读 tsconfig include + 遍历文件系统），输出 PASS/FAIL。

## 判决理由

6 项验收标准（AC-13~AC-18）全部通过独立验证，端到端数据路径（glob program → lint 归零 → vitest 全绿 → 单域文件复跑）全部连通。残余 3 项 should-fix 均为「文档回写类」🟢 LOW 项（阻塞 HG-3 = 否），不阻塞 HG-3，且已通过修改 design.md（R-3/R-4）+ implementation.md（D-4）关闭。
