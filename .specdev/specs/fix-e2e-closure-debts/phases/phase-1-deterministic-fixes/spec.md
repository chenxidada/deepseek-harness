# Phase 1: 确定性修复（DEBT-9 / DEBT-8 / DEBT-11）

## 目标

修复三条改动面清晰、可静态/单测/轻量真机直接验证的债务：
- **DEBT-9**：修复 `selection-ask.ts:182` 的防泄漏检查用裸子串 `pointerText.includes(doc.languageId)` 误判合法路径的产品 bug，改用「languageId 是否作为完整 token 泄漏」的词边界判定，使 `cap-selection-ask` 能直接以 `apps/vscode-dsh/package.json` 为探针文件真机闭环。
- **DEBT-8**：修正 `cap-history-panel` / `cap-message-list-streaming` 两项的 `requiresModel` 为 `true`，并补足真实模型往返步骤。
- **DEBT-11**：删除过时的 `run-chat-ready-regression.sh` 并同步更新 4 处守卫引用，清理后既有回归保持通过。

## 前置条件

- 依赖 spec：`../requirements.md`（AC-1/2/3/10/11/12/13）、`../design.md`（§实现方案 DEBT-9/8/11、§API 域、§权衡/替代方案）、`../repo-exploration.md`（§3/§5，workflow 级）。
- 依赖 Phase：无（本 Phase 是 DAG 起点）。
- 债务需求源：`.specdev/specs/vscode-dsh-e2e-closure/tech-debt-registry.md:26-33`（DEBT-9/8/11 的「当前行为 / 预期行为 / 位置」）。
- 前置动作：进入实施前，按调度者 Phase Entry 决策，把 8 条债务从上游 registry 迁移登记到本工作流 `.specdev/specs/fix-e2e-closure-debts/tech-debt-registry.md` 活跃表（当前为空 sentinel）。

## 验收标准

| AC | 内容摘要 |
|----|---------|
| AC-1 | 范围授权：修复 DEBT-9 改 `src/`（仅 `selection-ask.ts` 防泄漏判定）属合法改动；除此之外不得引入新产品业务逻辑变更（DEBT-7 的 webview 渲染探测通道 / DEBT-10 真实委托 capability / DEBT-12 复位命令均属 Phase 2，本 Phase 不涉及） |
| AC-2 | DEBT-9：对 languageId 恰为路径子串的文件（`package.json`/json），防泄漏检查不得误判；判定须基于完整 token（词边界 / `/` 分隔符），非裸子串 `includes` |
| AC-3 | DEBT-9：`cap-selection-ask` 以 `apps/vscode-dsh/package.json` 探针驱动时，`ask-about-selection` 返回 `{ok:true, path:"apps/vscode-dsh/package.json"}`，不再需 `src/index.ts` 规避 |
| AC-10 | DEBT-8：`cap-history-panel` / `cap-message-list-streaming` 经真实模型往返获得可断言结果，`requiresModel` 与实际驱动方式一致（置 true） |
| AC-11 | DEBT-11：清理 `run-chat-ready-regression.sh`，使其不再引用 10 个不存在测试文件，并更新 4 处守卫；清理后既有回归保持通过 |
| AC-12 | 回归护栏：`pnpm exec vitest run apps/vscode-dsh/tests` 与既有真机冒烟/回归脚本保持全绿 |
| AC-13 | 诚实登记：修复需新增测试钩子/探测通道而无法在本 Phase 完成时，如实登记债务，不得放宽断言/重试/删 manifest 项/改探针规避 |

## 验证策略

| AC | 验证类型 | 验证方法 | 预期结果 |
|----|---------|---------|---------|
| AC-1 | 静态检查 | `git diff --name-only` 与 `git diff` 审查本 Phase 改动：确认 `src/` 下仅 `apps/vscode-dsh/src/code-context/selection-ask.ts` 一处改动；确认 `git diff --name-only | grep packages/core/agent-loop` 为空 | 无 agent-loop / 无其他业务逻辑改动；`selection-ask.ts` 改动仅限 :182 防泄漏判定 |
| AC-2 | 单元测试（正向 + 反向 + 边界） | 在既有 `selection-ask` 测试文件（若存在）补正反例，或新增最小单测：① `isLanguageIdTokenLeaked('@apps/vscode-dsh/package.json 的 1-2 行', 'json')` → `false`（不误判）；② `isLanguageIdTokenLeaked('@foo/json 的 1-2 行', 'json')` → `true`（完整 token 仍判泄漏）；③ `('@src/index.ts 的 1-2 行', 'typescript')` → `false`；④ 空 languageId → `false` | 四条断言全通过 |
| AC-2 | 编译验证 | `pnpm run typecheck`（或 `tsc --noEmit`）对 `selection-ask.ts` 通过 | exit 0，无类型错误 |
| AC-3 | 运行时（真机 + key，单能力） | `LAYER_V_CAPABILITY_ONLY="cap-selection-ask" DEEPSEEK_API_KEY=<key> bash apps/vscode-dsh/test-scripts/run-layer-v-capabilities.sh` | `cap-selection-ask` 的 `ask-about-selection` 步返回 `{ok:true, path:"apps/vscode-dsh/package.json"}`；`conclusion=PASS` + `closedLoop.closed=true` |
| AC-3 | 运行时（负向，无 key） | `env -u DEEPSEEK_API_KEY` 单跑 `cap-selection-ask` | `SKIPPED_NO_CREDENTIALS` exit 3（`requiresModel:true` fail-closed） |
| AC-10 | 静态检查 | 检查 `layer-v-capabilities.json` 中 `cap-history-panel`（:40）与 `cap-message-list-streaming`（:53）的 `requiresModel` 均为 `true`，且 steps 含 `sendPrompt` → `listHistory`（断言 `firstUserPreview`）/ `$assistantContains` 流式断言 | 两项 `requiresModel:true` 且步骤含真实模型往返断言 |
| AC-10 | 运行时（真机 + key，单能力） | 单跑 `LAYER_V_CAPABILITY_ONLY="cap-history-panel,cap-message-list-streaming"`（带 key） | 两项 `conclusion=PASS` + `closedLoop.closed=true`（`actualTrigger`/`concreteAssertion`/`realScreenshot` 三齐） |
| AC-11 | 静态检查 | `git status` 确认 `run-chat-ready-regression.sh` 为 `D`（删除）；`grep -r "run-chat-ready-regression" apps/vscode-dsh/tests scripts/ apps/vscode-dsh/README.md apps/vscode-dsh/README.zh.md` 仅剩「无引用」或「已替换为 vitest」 | 脚本删除 + 4 处守卫不再引用该脚本 |
| AC-11 | 回归验证 | `pnpm exec vitest run apps/vscode-dsh/tests` 与 `bash scripts/check-test-scripts-syntax.sh` | 两命令均 exit 0，无因删除脚本导致的失败 |
| AC-12 | 回归验证 | `pnpm exec vitest run apps/vscode-dsh/tests`（全量）+ `bash -n` 对改动后的 shell 脚本 | 既有回归全绿，shell 语法通过 |
| AC-13 | 运行时 + 审查 | 若 DEBT-9 修复后真机仍发现更多误报（假设 A2 不成立），或 DEBT-8 真实往返遇到 `isHistoryEligibleSession` 排除空 title 等阻塞，如实登记到 registry，不得改探针规避 | 无法完成的缺口有 registry 条目 + 缺口原因，无「放宽断言/改探针」的取巧 |

> 说明：AC-2 的单元测试文件位置由 phase 级 code-explorer 精确定位（`apps/vscode-dsh/tests/` 下是否已有 `selection-ask` 相关测试）；若无既有文件，按 requirements 约束「不得把 phase 临时验证脚本写入 `apps/vscode-dsh/tests/`」——单测属产品代码修复的常规配套，落 `apps/vscode-dsh/tests/` 是允许的（该约束针对「验证基建改动落 test-scripts、临时脚本不落 tests」）。

## 约束（来自 design.md）

1. DEBT-9 判定算法：完整 token 判定（两侧均非「路径 token 字符」字母/数字/`./-/_`），禁用裸子串 `includes` 与正则 `\b` 词边界（`\b` 把 `.` 当边界仍误判 `package.json`）。
2. DEBT-8 断言参照既有范式：`cap-history-panel` 用 `sendPrompt`→`listHistory` 断言 `firstUserPreview`（参照 `cap-history-list` :649）；`cap-message-list-streaming` 用 `$assistantContains` 流式断言（参照 :270 流式指令）。
3. 不改退出码契约（0/1/2/3/4）、不改 `closedLoop`/`classifyAssertionStrength`/断言原语。
4. DEBT-11 删除脚本后必须穷尽 4 处守卫（`cap-test-harness.spec.ts:1403`、`check-test-scripts-syntax.sh:27`、`capability-domains.json:20/:657`、`README.md:22`/`README.zh.md:22`），并确认无第 5+ 处遗漏（phase 级 code-explorer 复核）。
5. 本 Phase 不新增 `VSCODE_DSH_TEST=1` 门控 hook。DEBT-7（webview 渲染探测通道，Phase 2 真修）、DEBT-10（真实委托 capability + `listChildren`）、DEBT-12（`resetToIdle` 复位命令）的门控 hook 均属 Phase 2。

## 产出清单

```
apps/vscode-dsh/src/code-context/selection-ask.ts             # 修改：DEBT-9 防泄漏词边界判定（唯一 src/ 改动）
apps/vscode-dsh/test-scripts/layer-v-capabilities.json        # 修改：DEBT-9 探针文件（:412-413）+ DEBT-8 requiresModel/steps（:40/:53）
apps/vscode-dsh/test-scripts/run-chat-ready-regression.sh     # 删除：DEBT-11
apps/vscode-dsh/tests/cap-test-harness.spec.ts                # 修改：DEBT-11 守卫①（:1403）
scripts/check-test-scripts-syntax.sh                          # 修改：DEBT-11 守卫②（:27）
apps/vscode-dsh/tests/capability-domains.json                 # 修改：DEBT-11 守卫③（:20/:657）
apps/vscode-dsh/README.md / README.zh.md                      # 修改：DEBT-11 守卫④（:22）
apps/vscode-dsh/tests/（selection-ask 单测，如已有则修改/新增） # DEBT-9 单元测试
.specdev/specs/fix-e2e-closure-debts/tech-debt-registry.md    # 迁移登记 8 条债务活跃表 + DEBT-9/8/11 已解决回填
```
