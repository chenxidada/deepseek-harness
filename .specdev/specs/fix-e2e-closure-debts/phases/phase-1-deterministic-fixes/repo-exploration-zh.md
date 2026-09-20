# 仓库调研报告 — Phase 1 确定性修复（DEBT-9 / DEBT-8 / DEBT-11）

## 1. 任务背景

工作流 `fix-e2e-closure-debts` 的 Phase 1 修复三条改动面确定、可静态/单测/轻量真机直接验证的债务：

- **DEBT-9**（产品 bug）：`selection-ask.ts` 防泄漏检查用裸子串 `includes(languageId)`，文件名恰含自身 `languageId`（如 `package.json`，`languageId=json`）时被误判为 `path-unrepresentable`。
- **DEBT-8**（manifest 修正）：`cap-history-panel` / `cap-message-list-streaming` 标 `requiresModel:false` 却需真实模型往返；翻 `true` 并补真机步骤。
- **DEBT-11**（脚本清理）：删除过时的 `run-chat-ready-regression.sh` 并更新 4 处守卫引用。

本报告精确给出每条债务的改动点（`路径:行号`）与参照范式，使 `implementer` 无需再次探索。

## 2. 仓库概览

- **语言/框架**：TypeScript（strict）、ESM、VS Code 扩展 host（`apps/vscode-dsh`）+ Node shell 测试 harness（`apps/vscode-dsh/test-scripts`）。
- **包管理**：pnpm workspaces。测试用 `vitest`（`pnpm exec vitest run apps/vscode-dsh/tests`）。
- **相关目录**：
  - `apps/vscode-dsh/src/code-context/` — 产品代码（DEBT-9）。
  - `apps/vscode-dsh/tests/` — vitest spec + 域清单（DEBT-9 单测、DEBT-11 守卫）。
  - `apps/vscode-dsh/test-scripts/` — shell 脚本 + 能力清单 `layer-v-capabilities.json`（DEBT-8、DEBT-11 脚本）。
  - `scripts/` — 仓库级门禁（DEBT-11 守卫）。

## 3. 最相关区域

| 文件 | 债务 | 角色 |
|---|---|---|
| `apps/vscode-dsh/src/code-context/selection-ask.ts` | DEBT-9 | 唯一产品代码改动（防泄漏检查 :182） |
| `apps/vscode-dsh/src/code-context/index.ts` | DEBT-9 | 再导出面；新辅助函数需在此导出供单测 |
| `apps/vscode-dsh/tests/cap-code-context.spec.ts` | DEBT-9 | 既有 `askAboutSelection` 单测宿主 |
| `apps/vscode-dsh/test-scripts/layer-v-capabilities.json` | DEBT-8 + DEBT-9 | `cap-selection-ask` 探针（DEBT-9）、`cap-history-panel`/`cap-message-list-streaming`（DEBT-8） |
| `apps/vscode-dsh/test-scripts/run-chat-ready-regression.sh` | DEBT-11 | 删除（整个文件） |
| `apps/vscode-dsh/tests/cap-test-harness.spec.ts` | DEBT-11 | 守卫① CAP-TEST-HARNESS-083 |
| `scripts/check-test-scripts-syntax.sh` | DEBT-11 | 守卫② pinned 清单 |
| `apps/vscode-dsh/tests/capability-domains.json` | DEBT-11 | 守卫③（2 处引用：`:20` + `:657`） |
| `apps/vscode-dsh/README.md` / `README.zh.md` | DEBT-11 | 守卫④ 回归命令示例 |

## 4. 关键入口点 / 调用链

### DEBT-9 — 选区提问防泄漏检查

```
extension.ts:runAskAboutSelection(vscode)  （命令处理器包装，:2531）
   └─ ensureHostForSend + revealConversationPanel
   └─ askAboutSelection(deps)              selection-ask.ts:143   ← 真正的产品函数
        ├─ editor = deps.getActiveEditor()                        :144
        ├─ doc = editor.document                                  :154
        ├─ relativePath = toWorkspaceRelativePath(doc.uri.fsPath) :164
        ├─ pointerText = buildPointerText(relativePath, ...)      :175
        └─ if (doc.languageId !== undefined
              && pointerText.includes(doc.languageId))            :182  ← BUG（裸子串）
              return { ok:false, reason:'path-unrepresentable' }  :184
```

> ⚠️ 命名注意：registry / design / spec 一律把该函数写作 `runAskAboutSelection`。
> 但代码里 `runAskAboutSelection` 是 `extension.ts:2531` 的**命令包装器**；
> `:182` 的防泄漏检查位于 `askAboutSelection`（`selection-ask.ts:143` 导出，经 `code-context/index.ts:29` 再导出）。
> `implementer` 应定位 `askAboutSelection`，而非包装器。

### DEBT-8 — 历史 / 流式模型往返（参照范式）

```
cap-history-list (layer-v-capabilities.json:635)   requiresModel:true
   reveal-editor-panel → open-activity-bar → fire-conversation-visible
   → host-started(wait) → new-conversation
   → send-prompt（marker LAYER-V-CAP-37-OK）
   → closed-turn（wait $assistantClosed）
   → listHistory（断言 firstUserPreview $contains marker）
   → screenshot

cap-message-store-stream-patch (layer-v-capabilities.json:258)   requiresModel:true
   → send-prompt（多行流式指令）
   → stream 步（kind:"stream"，$assistantContains marker，intervalMs:150，requireIncrement:true）
   → screenshot
```

## 5. 影响面

| 改动 | 文件:行 | 风险 |
|---|---|---|
| 新增 `isLanguageIdTokenLeaked` + 替换 :182 | `selection-ask.ts`（~:181 插辅助函数；:182 改判定） | 🟡 — 唯一 `src/` 改动，须落在 AC-1 范围内 |
| 导出辅助函数供单测 | `code-context/index.ts:28-38` | 🟢 |
| 新增/核对 DEBT-9 单测 | `cap-code-context.spec.ts`（~:156 块） | 🟢 |
| `cap-selection-ask` 探针 → `package.json` | `layer-v-capabilities.json:412-413` | 🟢 |
| `cap-history-panel` requiresModel:true + 步骤 | `layer-v-capabilities.json:40-46` | 🟡 |
| `cap-message-list-streaming` requiresModel:true + 步骤 | `layer-v-capabilities.json:53-59` | 🟡 |
| 删除脚本 | `run-chat-ready-regression.sh`（整个文件） | 🟡 — 须同改动 4 处守卫 |
| 守卫① 删除 CAP-TEST-HARNESS-083 | `cap-test-harness.spec.ts:1398-1408` + 导入 :15/:19 | 🟡 — 删除后需清理未用导入 |
| 守卫② 取消 pinned | `check-test-scripts-syntax.sh:27` | 🟢 |
| 守卫③ 删除 2 处引用 | `capability-domains.json:20` + `:657` | 🟢 |
| 守卫④ 替换命令 | `README.md:22` + `README.zh.md:22` | 🟢 |

## 6. 既有约束 / 约定

1. **DEBT-9 算法**（design.md §约束1）：完整 token 判定 —— `languageId` 的每次出现，仅当其前一字符与后一字符**都不是**「路径 token 字符」（`[A-Za-z0-9._-]`）时才判泄漏。禁止裸 `includes` 与正则 `\b`（`\b` 把 `.` 当边界，仍误判 `package.json`）。
2. **DEBT-8 断言**（design.md §约束2）：`cap-history-panel` 照抄 `cap-history-list` 的 `sendPrompt → listHistory` 断言 `firstUserPreview`；`cap-message-list-streaming` 照抄 `cap-message-store-stream-patch` 的流式 `$assistantContains` 步骤。
3. **冻结契约**（design.md §约束3）：不改退出码（0/1/2/3/4）、不改 `closedLoop`、`classifyAssertionStrength`、断言原语（`$contains:` / `$assistantContains:` / `$assistantClosed:` / `$string:` / `$array:` / `$number:`）。
4. **AC-1 范围**：唯一 `src/` 改动是 `selection-ask.ts` 防泄漏判定；无 `agent-loop` 改动；本 Phase 不新增 `VSCODE_DSH_TEST=1` 门控 hook。
5. **单测位置**：既有 `askAboutSelection` 测试在 `apps/vscode-dsh/tests/cap-code-context.spec.ts`（非独立 `selection-ask.spec.ts`）；DEBT-9 新测试归入此文件。
6. **测试导入面**：测试从 `../src/code-context/index.ts`（而非 `selection-ask.ts`）导入，故 `isLanguageIdTokenLeaked` 若要经 barrel 导入则须在 `index.ts` 导出（或测试直接导入 `selection-ask.ts` —— 两者皆可，但既有文件约定是 barrel `index.ts`）。

## 7. 风险 / 未知

- ✅ CONFIRMED — 防泄漏检查的确切代码是 `selection-ask.ts:181-185`，其中 `pointerText.includes(doc.languageId)` 在 `:182`。
- ✅ CONFIRMED — `pointerText` 在 `:175` 由 `buildPointerText(relativePath, startLine, endLine)`（`:83-94`）生成，形如 `@<path> 的 N-N 行`（含空格路径则 `@"…"`）。
- ✅ CONFIRMED — `doc.languageId` 是 `TextDocumentLike`（`selection-ask.ts:23`）上的可选 `languageId?: string`，来源于 `editor.document`（`:154`）。
- ✅ CONFIRMED — `cap-selection-ask` 当前探针为 `apps/vscode-dsh/src/index.ts`（manifest `:412`），expect path 为 `apps/vscode-dsh/src/index.ts`（`:413`）；`requiresModel:true`（`:404`）。
- ✅ CONFIRMED — `cap-history-panel` `requiresModel:false`（`:40`）、`cap-message-list-streaming` `requiresModel:false`（`:53`），两者步骤都只有 `reveal-editor-panel → editor-panel-open → screenshot`。
- ✅ CONFIRMED — 参照 `cap-history-list`（`:635-652`）与 `cap-message-store-stream-patch`（`:258-274`）提供了确切的断言形态。
- ⚠️ HYPOTHESIS — DEBT-8 的新 marker 必须唯一（`LAYER-V-CAP-<NN>-OK`）；已用编号含 14–40。`implementer` 须选不冲突的编号（design 用 `XX` 占位）。
- ❓ UNKNOWN — 真机上 `cap-history-panel` 的 `listHistory` 是否在往返后真的能给出 `firstUserPreview`（取决于 `isHistoryEligibleSession` 是否排除空 title 会话 —— registry DEBT-8 已标注）。这是 AC-10 的真机关注点，非静态/单测关注点。

## 8. 不确定 / 未核实

- `extension.ts` 里的 `dsh.test.openEditorWithSelection` 与 `dsh.test.askAboutSelection` 命令处理器未逐行读函数体（只读了 `:2531` 的 `runAskAboutSelection` 包装与 `:1019` 的测试 hook 注册引用）。其行为假定正确；DEBT-9 只改 `selection-ask.ts`，故不影响本修复，但 `implementer` 应核对探针 `openEditorWithSelection` 对工作区相对路径 `apps/vscode-dsh/package.json` 的接受方式与 `src/index.ts` 一致。

## 9. 桩检测与注册表交叉校验

8 条上游债务位于 `.specdev/specs/vscode-dsh-e2e-closure/tech-debt-registry.md:26-33`；本工作流自身 registry（`.specdev/specs/fix-e2e-closure-debts/tech-debt-registry.md`）为空 sentinel 待迁移。三个目标面上未发现桩代码（空函数体 / 硬编码返回值）——`selection-ask.ts:182` 的防泄漏检查是「算法错误（子串）的真实逻辑」而非桩。

### Registry 校验结果
| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|---|---|---|---|---|
| DEBT-9 | `selection-ask.ts`（`askAboutSelection` :182） | 🟡 已知缺陷（误报边界） | 裸子串 `includes(doc.languageId)` 确实存在 | ✅ 匹配（函数名实为 `askAboutSelection` 非 `runAskAboutSelection`） |
| DEBT-8 | `layer-v-capabilities.json`（:40/:53） | 🟡 已知缺陷（缺模型往返） | 两项均 `requiresModel:false`、步骤无模型往返 | ✅ 匹配 |
| DEBT-11 | `run-chat-ready-regression.sh`（全文） | 🟡 已知缺陷（过时待清理） | 文件存在、头部 obsolete 注释、引用 10 个不存在文件 | ✅ 匹配 |

### 桩检测汇总
- ✅ 已确认桩：0（无桩代码；三处均为「真实但错误」或「过时产物」）。
- ⚠️ Registry 不一致：1 — registry 把产品函数写作 `runAskAboutSelection`，实际函数为 `askAboutSelection`（包装 `runAskAboutSelection` 在 `extension.ts:2531`）。
- 🔴 未注册桩：0。

## 10. 建议的后续阅读

1. ⭐ 必读 — `apps/vscode-dsh/src/code-context/selection-ask.ts`（全文；防泄漏检查 :181-185，辅助函数插入点）。
2. ⭐ 必读 — `apps/vscode-dsh/test-scripts/layer-v-capabilities.json:36-60`（DEBT-8）+ `:258-274`（流式参照）+ `:635-652`（历史参照）+ `:400-418`（DEBT-9 探针）。
3. 🔷 应读 — `apps/vscode-dsh/tests/cap-code-context.spec.ts:1-10`（导入）+ `:156-317`（既有 `askAboutSelection` 测试结构）。
4. 🔷 应读 — `apps/vscode-dsh/tests/cap-test-harness.spec.ts:1398-1408` + `:15/:19`（删除 CAP-TEST-HARNESS-083 后需裁剪的导入）。
5. 🔹 可选 — `scripts/check-test-scripts-syntax.sh:24-28`、`apps/vscode-dsh/tests/capability-domains.json:17-35` + `:653-669`、`README.md:17-40` / `README.zh.md:17-40`。

---

## 附录 A — DEBT-9 精确改动点

**现有代码（`selection-ask.ts:181-185`）：**

```181:185:apps/vscode-dsh/src/code-context/selection-ask.ts
  // Defense: never leak languageId / selection body into pointer text (AD-CCD-15).
  if (doc.languageId !== undefined && pointerText.includes(doc.languageId)) {
    deps.notify('引用生成异常，已中止。', 'path-unrepresentable')
    return { ok: false, reason: 'path-unrepresentable' }
  }
```

**修复**：在 `askAboutSelection` 之前（或 `buildPointerText` 旁）插入 `isLanguageIdTokenLeaked` 辅助函数（design.md 骨架），并把 `:182` 改为：

```typescript
if (doc.languageId !== undefined && isLanguageIdTokenLeaked(pointerText, doc.languageId)) {
```

**导出供单测**：把 `isLanguageIdTokenLeaked` 加入 `selection-ask.ts` 的导出，并（若测试经 barrel 导入）加入 `code-context/index.ts`（当前 28-38 行）。design 骨架是模块私有；AC-2 测试直接调用它，故必须导出。

## 附录 B — DEBT-8 参照范式（照抄形态）

**历史范式（`cap-history-list` :641-650），用于 `cap-history-panel`：**

```json
{ "kind": "command", "step": "reveal-editor-panel", "command": "dsh.showPanel" },
{ "kind": "command", "step": "open-activity-bar", "command": "dsh.test.openActivityBar" },
{ "kind": "command", "step": "fire-conversation-visible", "command": "dsh.test.fireConversationVisibility", "args": [true] },
{ "kind": "wait", "step": "host-started", "command": "dsh.test.simulateStartupOnly", "expect": { "ok": true, "startState": "started", "hostStatus": "connected" }, "timeoutMs": 240000 },
{ "kind": "assert", "step": "new-conversation", "command": "dsh.test.newConversation", "expect": { "outcome": "created" } },
{ "kind": "assert", "step": "send-prompt", "command": "dsh.test.sendPrompt", "expect": { "ok": true }, "args": ["...请只回复下面这一行...：LAYER-V-CAP-<NN>-OK"] },
{ "kind": "wait", "step": "closed-turn", "command": "dsh.test.panelSnapshot", "expect": "$assistantClosed:LAYER-V-CAP-<NN>-OK", "timeoutMs": 300000 },
{ "kind": "assert", "step": "history-lists-the-real-session", "command": "dsh.test.listHistory", "expect": { "0.sessionId": "$string", "0.firstUserPreview": "$contains:LAYER-V-CAP-<NN>-OK", "0.continueHint": "$string" } }
```

**流式范式（`cap-message-store-stream-patch` :270-271），用于 `cap-message-list-streaming`：**

```json
{ "kind": "assert", "step": "send-prompt", "command": "dsh.test.sendPrompt", "expect": { "ok": true }, "args": ["...逐段生成...LAYER-V-CAP-<NN>-OK"] },
{ "kind": "stream", "step": "streamed-message", "command": "dsh.test.panelSnapshot", "expect": "$assistantContains:LAYER-V-CAP-<NN>-OK", "timeoutMs": 300000, "intervalMs": 150, "requireIncrement": true }
```

## 附录 C — DEBT-11 守卫引用穷尽清单

全仓 grep `run-chat-ready-regression` 命中**恰好 4 处代码守卫（6 个物理行）**，其余为 `.specdev/**` spec 文档（不应编辑）：

| # | 文件 | 行 | 性质 | 最小修复 |
|---|---|---|---|---|
| ① | `apps/vscode-dsh/tests/cap-test-harness.spec.ts` | `:1400-1406`（断言在 `:1405`） | CAP-TEST-HARNESS-083 断言 `existsSync(script) === true` | 删除 `describe('chat-ready-regression.spec.ts')` 块（`:1398-1408`）；同时去掉此刻未用的 `existsSync`（导入 `:15`）与 `resolve`（导入 `:19`） |
| ② | `scripts/check-test-scripts-syntax.sh` | `:27` | `pinned=(...)` 数组（`:24-28`）中的 `"${scan_dir}/run-chat-ready-regression.sh"` | 删除第 27 行 |
| ③a | `apps/vscode-dsh/tests/capability-domains.json` | `:20` | `testScripts` 数组中的对象：`{ "path": "run-chat-ready-regression.sh", ... }` | 删除第 20 行（对象） |
| ③b | `apps/vscode-dsh/tests/capability-domains.json` | `:657` | `domains[test-harness].scripts` 数组（`:656-669`）中的字符串 | 删除第 657 行（字符串） |
| ④a | `apps/vscode-dsh/README.md` | `:22` | `bash apps/vscode-dsh/test-scripts/run-chat-ready-regression.sh` | 替换为 `pnpm exec vitest run apps/vscode-dsh/tests`（或删除该节） |
| ④b | `apps/vscode-dsh/README.zh.md` | `:22` | 同上命令（中文 README） | 同样替换 |

**穷尽性已确认**：无第 5+ 处代码守卫。`run-vscode-dsh-e2e-closure.sh`、`run-layer-v-capabilities.sh`、`run-layer-v-smoke.sh` 均无引用。其余命中均为 `.specdev/specs/**` 工作流文档（design.md、spec.md、requirements.md、phase-plan.md、repo-exploration*.md，以及上游 `vscode-dsh-e2e-closure` 文档）—— 这些是 spec 文档而非守卫，本 Phase 不得编辑。

**AC-11 验证 grep 范围**（spec.md:40）恰为 `apps/vscode-dsh/tests scripts/ apps/vscode-dsh/README.md apps/vscode-dsh/README.zh.md` —— 完成上述 6 处编辑 + 脚本删除后，该 grep 零命中。

> 说明（范围外，仅供知悉）：`README.md:25-38` / `README.zh.md:25-38` 仍列出 10 个过时 vitest 文件名作为「等价 vitest 清单」，且 `README.md:40` 引用 `tests/chat-ready-regression.spec.ts`（同样过时）。这些是相邻的过时引用，非 `run-chat-ready-regression.sh` 守卫；spec 的 DEBT-11 范围是「脚本 + 4 处守卫」。提示 `implementer` 自行决定是仅替换命令行，还是整节「Chat-ready Feature regression」一并删除。
