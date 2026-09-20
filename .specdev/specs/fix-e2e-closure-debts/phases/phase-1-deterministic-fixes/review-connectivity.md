# Connectivity Review — Phase 1 (Deterministic Fixes)

## 视角
**Integration Connectivity** — 模块间是否真正连通

## 判决
**PASS**

## 端到端路径追踪

### Path 1: DEBT-9 — `isLanguageIdTokenLeaked` 导出 → 调用 → 单测（真实导出路径）
```
Entry: cap-code-context.spec.ts:2  (import { ..., isLanguageIdTokenLeaked, ... } from '../src/code-context/index.ts')
  → index.ts:31 重新导出 isLanguageIdTokenLeaked                    ✅ 经 barrel 导出
  → selection-ask.ts:147 定义 isLanguageIdTokenLeaked(pointerText, languageId)  ✅ 实现存在
  → selection-ask.ts:206 askAboutSelection 调用 isLanguageIdTokenLeaked(...)   ✅ 已接上（非定义未接）
Exit: CAP-CODE-CONTEXT-024~028 五条断言经真实 barrel 导入路径命中
```
**判定**: ✅ 数据路径完整。函数定义 → 导出 → barrel 再导出 → 调用点 → 单测，全链路连通，无「定义了但没接上」。

### Path 2: DEBT-8 — 新增 manifest 步骤的 command / 断言原语注册
```
cap-history-panel (layer-v-capabilities.json:36-53, requiresModel:true)
  dsh.showPanel / dsh.test.openActivityBar / fireConversationVisibility
    → extension.ts:1286 / :1255 注册                       ✅
  dsh.test.simulateStartupOnly / newConversation / sendPrompt
    → extension.ts:1243 / :1170 / :1014 注册               ✅
  dsh.test.panelSnapshot ($assistantClosed) → extension.ts:1044 ✅
  dsh.test.listHistory (0.firstUserPreview $contains) → extension.ts:1079 ✅
  $assistantClosed / $contains / $string → capability-runner.cjs:246/:233/:204 ✅

cap-message-list-streaming (layer-v-capabilities.json:55-71, requiresModel:true)
  dsh.test.sendPrompt / dsh.test.panelSnapshot ($assistantContains, requireIncrement)
    → 已注册；$assistantContains → capability-runner.cjs:237 ✅
```
**判定**: ✅ 7 个 `dsh.test.*` 命令 + `dsh.showPanel` 均在 `shouldRegisterTestHooks` 分支（extension.ts:1012）真实注册；断言原语 `$assistantClosed`/`$assistantContains`/`$contains`/`$string` 均在 `MATCHERS`/`resolveMatcher` 中真实存在。无拼写错误 → 无 LINK_FAILURE 风险。marker 41/42 与已用 14–40 无冲突。

### Path 3: DEBT-11 — 脚本删除 + 4 处守卫同步
```
① cap-test-harness.spec.ts: 无 chat-ready/run-chat-ready-regression 引用；
   import 行 15 已无 existsSync、行 19 已无 resolve(来自 node:path)     ✅
② check-test-scripts-syntax.sh: pinned=( run-layer-v-smoke.sh, layer-v-shadow-preset.sh )，无脚本 ✅
③ capability-domains.json: testScripts 无 run-chat-ready-regression.sh 条目；
   domains[test-harness].scripts 无该字符串；JSON 结构合法（无尾逗号/悬空引用） ✅
④ README.md / README.zh.md: 「Chat-ready Feature 回归」整节已移除，:22 现为 smoke 命令 ✅
脚本本体: run-chat-ready-regression.sh → 文件不存在（已删除）           ✅
AC-11 grep 范围（apps/vscode-dsh/tests、scripts/、README*.md）: run-chat-ready-regression 零命中 ✅
```
**判定**: ✅ 脚本删除 + 4 处守卫全部同步，无残留引用导致 `cap-test-harness.spec.ts` existsSync 或 `check-test-scripts-syntax.sh` 失败。

## 上下游连接检查

| 新函数/组件 | 上游（谁调用） | 连接状态 | 下游（调用谁） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| `isLanguageIdTokenLeaked()` | `askAboutSelection()` (selection-ask.ts:206) | ✅ | 纯函数，无下游 | ✅ |
| `askAboutSelection()` | `dsh.test.askAboutSelection` (extension.ts:1018→runAskAboutSelection) | ✅ | `toWorkspaceRelativePath`/`buildPointerText`/`ensureLiveTab` | ✅ |
| `cap-history-panel` sendPrompt 步 | runner 解析 manifest | ✅ | `dsh.test.sendPrompt` (extension.ts:1014) | ✅ |
| `cap-history-panel` listHistory 步 | runner 解析 manifest | ✅ | `dsh.test.listHistory` (extension.ts:1079) | ✅ |
| `cap-message-list-streaming` stream 步 | runner 解析 manifest | ✅ | `dsh.test.panelSnapshot` + `$assistantContains` | ✅ |
| `cap-selection-ask` open-editor 步 | runner 解析 manifest | ✅ | `dsh.test.openEditorWithSelection` (extension.ts:1471, resolveWorkspacePath) | ✅ |
| `cap-selection-ask` ask-about 步 | runner 解析 manifest | ✅ | `dsh.test.askAboutSelection` (extension.ts:1018) | ✅ |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| index.ts → selection-ask.ts | 导出 `isLanguageIdTokenLeaked` | `export function isLanguageIdTokenLeaked(pointerText, languageId)` | ✅ |
| spec 单测 → index.ts | `import { isLanguageIdTokenLeaked } from '../src/code-context/index.ts'` | barrel 实际导出该符号 | ✅ |
| manifest → extension.ts | `dsh.test.listHistory` 命令存在 | `registerCommand('dsh.test.listHistory', ...)` | ✅ |
| manifest → runner | `$contains:`/`$assistantContains:`/`$assistantClosed:`/`$string` 断言 | `resolveMatcher` 逐一处理 | ✅ |
| `askAboutSelection` 契约 | `{ ok:true, path:'apps/vscode-dsh/package.json' }` | 返回 `AskAboutSelectionResult`（含 path） | ✅ |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| `dsh.test.*` 命令框架 | 上游 `vscode-dsh-e2e-closure`（已冻结） | 未改动，本 Phase 只消费 | ✅ |
| `capability-runner.cjs` 断言原语 | 上游（已冻结） | 未改动 | ✅ |
| `assertion-map.md` / `capability-domains.json` 台账 | 上游 `vscode-dsh-test-consolidation`（已冻结） | 本 Phase 未改 `absorbed` 台账 | ✅ |

## 关键发现

### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
（无）

### 🟢 Observations
- `[文档保真]` `implementation.md:15/41` 表述「移除 `testScripts` 对象」与实况不符：实际只删除了 `testScripts` 数组中的 `run-chat-ready-regression.sh` 条目，`testScripts` 数组本身仍保留（16 条目，行 17-34）。底层变更（脚本引用已清除）为真、`capability-domains.json` 结构合法，属描述性失实、零交付物影响。
- `apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh:89` 注释仍提及 `run-chat-ready-regression.sh`。这是历史说明注释（非守卫），且 `test-scripts/` 不在 AC-11 的 grep 范围（`apps/vscode-dsh/tests`/`scripts/`/`README*.md`），`bash -n` 不受注释影响。implementer 已在 `implementation.md:71` 声明，供后续留意。
- `apps/vscode-dsh/tests/assertion-map.md:471` 台账行仍引用 `CAP-TEST-HARNESS-083`（该 CAP 已随守卫①删除而不再存在于 `cap-test-harness.spec.ts`）；`capability-domains.json:674` 的 `test-harness.absorbed` 仍列 `chat-ready-regression.spec.ts`。这两处指向的是「被归并的 vitest spec 文件名」与冻结台账，**不是** `run-chat-ready-regression.sh` 脚本守卫：① `assertion-map.md`/`capability-domains.json` 均非 4 处守卫、无任何活门禁（`.ts`/`.cjs`/`.sh`）消费它们（全仓 grep 仅剩文档产物引用）；② DEBT-11 范围明确是「脚本 + 4 处可执行守卫」，`absorbed` 合法记录归并前的 spec 名、无需删。属**文档滞留**，非连通断裂，供维护者知悉。

## 结论

三条债务的集成连通性全部闭环：DEBT-9 的函数导出→调用→单测链路完整、DEBT-8 的 manifest 步骤所引用命令与断言原语全部真实注册、DEBT-11 的脚本删除与 4 处守卫同步无残留。未发现端到端断裂、跨模块契约不一致、orphan 可执行引用或死链。
