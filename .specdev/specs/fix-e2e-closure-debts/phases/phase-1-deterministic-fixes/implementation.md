# Phase 1 实现摘要（DEBT-9 / DEBT-8 / DEBT-11）

## 变更清单（文件列表）

| 文件 | 债务 | 改动 |
|------|:--:|------|
| `apps/vscode-dsh/src/code-context/selection-ask.ts` | DEBT-9 | 新增 `isLanguageIdTokenLeaked` 完整 token 判定辅助函数；:206 由裸子串 `pointerText.includes(doc.languageId)` 改为 `isLanguageIdTokenLeaked(pointerText, doc.languageId)` |
| `apps/vscode-dsh/src/code-context/index.ts` | DEBT-9 | 导出 `isLanguageIdTokenLeaked` 供单测直接调用 |
| `apps/vscode-dsh/tests/cap-code-context.spec.ts` | DEBT-9 | 新增 CAP-CODE-CONTEXT-024~028 五个测试（词边界正反例 + `package.json` 集成路径） |
| `apps/vscode-dsh/test-scripts/layer-v-capabilities.json` | DEBT-9 | `cap-selection-ask` 探针文件 `src/index.ts` → `package.json`（open-editor-selection args + ask-about-selection expect path 两处） |
| `apps/vscode-dsh/test-scripts/layer-v-capabilities.json` | DEBT-8 | `cap-history-panel`（marker 41）与 `cap-message-list-streaming`（marker 42）`requiresModel` 翻 true + 补齐真实模型往返步骤 |
| `apps/vscode-dsh/test-scripts/run-chat-ready-regression.sh` | DEBT-11 | 删除（D） |
| `apps/vscode-dsh/tests/cap-test-harness.spec.ts` | DEBT-11 | 守卫①：移除 `chat-ready-regression.spec.ts` describe 块（CAP-TEST-HARNESS-083）+ 清理 `existsSync`/`resolve` 未用导入 |
| `scripts/check-test-scripts-syntax.sh` | DEBT-11 | 守卫②：从 pinned 清单移除该脚本 |
| `apps/vscode-dsh/tests/capability-domains.json` | DEBT-11 | 守卫③：移除 `testScripts` 对象（:20）与 `domains[test-harness].scripts` 字符串（:657）两处 |
| `apps/vscode-dsh/README.md` / `README.zh.md` | DEBT-11 | 守卫④：移除「Chat-ready Feature 回归」整节（含回归命令示例 + 等价 vitest 文件清单） |
| `.specdev/specs/fix-e2e-closure-debts/tech-debt-registry.md` | 全部 | 从上游迁移 8 条债务登记，DEBT-9/8/11 移入「已解决」，DEBT-2/3/7/10/12 保留「活跃」（目标Phase=phase-2-realmachine-infra） |

## 对每个验收标准的实现说明

### DEBT-9（AC-2 / AC-3 静态与单测部分）

- 纠偏：真实防泄漏函数是 `selection-ask.ts` 的 `askAboutSelection`（:167），registry 写的 `runAskAboutSelection` 是 `extension.ts:2531` 的命令包装器。
- 新增 `isLanguageIdTokenLeaked(pointerText, languageId)`：languageId 只有在两侧字符**均非**「路径 token 字符」（`[A-Za-z0-9._-]`）时才判泄漏；空 languageId 直接返回 false。`package.json` 中 `json` 前邻 `.`（路径 token 字符）→ 不判泄漏；`@foo/json` 中 `json` 前邻 `/` 后邻空格 → 判泄漏。
- 替换 :206 的判定条件，保留「返回 `path-unrepresentable`」的 fail-closed 语义不变。
- 经 `code-context/index.ts` 导出，单测通过 barrel 导入。
- 探针文件改回 `apps/vscode-dsh/package.json`（open-editor-selection args + ask-about-selection expect path 两处）。

### DEBT-8（AC-10 静态部分）

- `cap-history-panel` `requiresModel` false→true，steps 照抄 `cap-history-list` 范式：`reveal-editor-panel → open-activity-bar → fire-conversation-visible → host-started(wait) → new-conversation → send-prompt(marker LAYER-V-CAP-41-OK) → closed-turn(wait $assistantClosed) → history-panel-lists-the-real-session(listHistory 断言 0.firstUserPreview $contains) → screenshot`。
- `cap-message-list-streaming` `requiresModel` false→true，steps 照抄 `cap-message-store-stream-patch` 流式范式：`… → send-prompt(多段流式指令 LAYER-V-CAP-42-OK) → streamed-message(stream 步 $assistantContains, intervalMs:150, requireIncrement:true) → screenshot`。
- marker 选 41/42，与已用 14–40 无冲突（grep 复核）。

### DEBT-11（AC-11）

- 删除 `run-chat-ready-regression.sh`。
- 4 处守卫同步更新（穷尽确认无第 5 处代码守卫）：
  1. `cap-test-harness.spec.ts` 移除 CAP-TEST-HARNESS-083 describe 块 + 清理 `existsSync`（:15）与 `resolve`（:19）未用导入。
  2. `check-test-scripts-syntax.sh` pinned 清单移除该脚本。
  3. `capability-domains.json` 移除 `testScripts` 对象 + `domains[test-harness].scripts` 字符串两处。
  4. `README.md`/`README.zh.md` 移除整节（含回归命令示例）。

## 测试结果（命令 + 输出摘要）

| 命令 | 结果 |
|------|------|
| `pnpm exec vitest run apps/vscode-dsh/tests/cap-code-context.spec.ts` | Test Files 1 passed / Tests **28 passed**（新增 5 条 CAP-CODE-CONTEXT-024~028） |
| `pnpm exec vitest run apps/vscode-dsh/tests/cap-test-harness.spec.ts` | Test Files 1 passed / Tests **130 passed**（移除 CAP-TEST-HARNESS-083 后） |
| `pnpm exec vitest run apps/vscode-dsh/tests`（全量回归） | Test Files **12 passed** / Tests **560 passed** |
| `bash scripts/check-test-scripts-syntax.sh` | `check-test-scripts-syntax: 6 shell asset(s) parse`，exit **0** |
| `node_modules/.bin/tsc --noEmit -p apps/vscode-dsh/tsconfig.json` | exit **0**（无类型错误） |
| JSON 解析校验（`layer-v-capabilities.json` / `capability-domains.json`） | `JSON OK` |

DEBT-9 词边界断言（`cap-code-context.spec.ts`）实际通过项：
- `isLanguageIdTokenLeaked('@apps/vscode-dsh/package.json 的 1-2 行', 'json')` → `false` ✅
- `isLanguageIdTokenLeaked('@foo/json 的 1-2 行', 'json')` → `true` ✅
- `isLanguageIdTokenLeaked('@src/index.ts 的 1-2 行', 'typescript')` → `false` ✅
- `isLanguageIdTokenLeaked('@src/index.ts 的 1-2 行', '')` → `false` ✅
- 集成路径 `askAboutSelection` 以 `package.json`(languageId=json) 返回 `ok:true, path:'package.json'`，不再 `path-unrepresentable` ✅

## 偏差记录

| # | 偏差描述 | 影响范围 | 原因 | 影响 |
|---|---------|---------|------|------|
| 1 | DEBT-11 守卫④：移除 README.md/README.zh.md 的整个「Chat-ready Feature 回归」节（而非仅替换 :22 命令行为 `vitest`） | spec.md §产出清单 DEBT-11 守卫④ / AC-11 | 该节唯一目的即文档化被删除的脚本；「等价 vitest 文件清单」同样引用 10 个已不存在测试文件，保留单行替换会留下同类 stale 引用 | 更彻底满足 AC-11「不再引用不存在文件」；无下游影响 |
| 2 | 真机运行时验证（AC-3 正向、AC-10 真机往返、AC-3 负向 `SKIPPED_NO_CREDENTIALS`）**未在本 Phase 执行** | spec.md §验证策略 AC-3/AC-10 运行时行 | 需要真实 `DEEPSEEK_API_KEY` + Xvfb + `code` CLI + Extension Development Host，属 verifier 真机步骤；本 Phase 环境无 key/无 EDH | 静态 + 单测 + 全量回归已闭环；真机闭环交由 verifier 独立验证 |

## 说明（非偏差、不阻塞）

- `apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh:89` 注释仍提及 `run-chat-ready-regression.sh`（历史说明「该目录排序继承自该脚本」）。这是注释而非守卫，不在 AC-11 的 4 处守卫范围（`test-scripts/` ≠ `scripts/`），`bash -n` 不受注释影响。未在 DEBT-11 范围内改动，供后续留意。
- `.explore/`、`docs/wiki/` 中的脚本引用为文档产物，不属本 Phase 守卫范围（wiki 由工作流收尾的 wiki agent 维护）。
