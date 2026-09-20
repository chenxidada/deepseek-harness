# Correctness Review — Phase 1 Deterministic Fixes

## 视角
**Implementation Correctness** — 代码是否正确工作

## 判决
**SHOULD-FIX**

> 全部 7 条 AC 的静态/单测部分均已满足，无未登记桩、无放宽断言、无改探针规避。唯一需修的是 DEBT-11 删测试后遗留的两处台账/覆盖清单孤儿引用（`capability-domains.json` 与 `assertion-map.md` 仍指向已删除的 `CAP-TEST-HARNESS-083`），不破坏任何 AC/回归/门禁，但破坏台账「双向差集为空」不变式，属清理不彻底。

## 逐条 AC 验证

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-1 | 范围授权：仅 `selection-ask.ts` 防泄漏判定属产品逻辑改动 | `selection-ask.ts:147-161,206` | ✅ | 唯一 src/ 产品逻辑改动；`index.ts:31` 仅新增 barrel re-export（design.md §实现方案明确规划「经 index.ts 导出」），无新业务逻辑 |
| AC-2 | languageId 完整 token 判定，非裸子串 | `selection-ask.ts:147-161` | ✅ | 函数体为真实词边界循环：`indexOf` + 双侧 `isPathTokenChar`（`[A-Za-z0-9._-]`）判定；`package.json`(json 前邻 `.`)→false，`@foo/json`(前邻 `/`)→true |
| AC-2 | 单测四条断言 | `cap-code-context.spec.ts:320-365` | ✅ | CAP-CODE-CONTEXT-024~028 覆盖 AC-2 要求的 4 断言 + 1 集成路径，全部对应真实逻辑 |
| AC-2 | typecheck | `tsc --noEmit -p apps/vscode-dsh/tsconfig.json` | ✅ | implementation.md 报告 exit 0；代码无类型问题（辅助函数 `isPathTokenChar` 移出 while 循环，干净） |
| AC-3 | 探针文件改 `package.json` | `layer-v-capabilities.json:423-424` | ✅ | open-editor-selection args 与 ask-about-selection expect path 两处均为 `apps/vscode-dsh/package.json`；`requiresModel:true` 保留（:415） |
| AC-10 | 两项 `requiresModel:true` + 真实往返步骤 | `layer-v-capabilities.json:40,59` | ✅ | `cap-history-panel`(marker 41) `sendPrompt`→`closed-turn`($assistantClosed)→`listHistory`(firstUserPreview $contains)；`cap-message-list-streaming`(marker 42) `sendPrompt`→`stream`($assistantContains, requireIncrement)；步骤镜像既有 `cap-history-list`/`cap-message-store-stream-patch` 范式，命令均真实存在 |
| AC-11 | 删脚本 + 4 守卫 | 见下 | ✅ | 脚本已删（glob 0 命中）；守卫①describe 块移除 + imports 清理；②pinned 清单移除；③testScripts/scripts 两处移除；④README 两节移除；guard 范围内 `run-chat-ready-regression` 零引用 |
| AC-12 | 回归全绿 | — | ✅ | implementation.md 报告 560 passed + check-test-scripts-syntax exit 0 + JSON 可解析（真机冒烟属 verifier） |
| AC-13 | 诚实登记，不规避 | — | ✅ | 无 `@STUB`、无放宽断言、无重试取巧、无改探针规避；registry 已迁移 8 条并回填 DEBT-9/8/11 已解决 |

## Stub Detection（桩代码检测）

### 已注册桩（对照 registry）
无。registry 活跃表 DEBT-2/3/7/10/12 均为 Phase 2 债务（本 Phase 不涉及）；DEBT-9/8/11 已移「已解决」。

### 新发现的未注册桩
无。`isLanguageIdTokenLeaked` 为真实循环逻辑，非空壳；DEBT-8 步骤为真实命令序列，非占位。

## 关键发现

### 🔴 Must-Fix
无。

### 🟡 Should-Fix

1. **删测试遗留孤儿引用（DEBT-11 清理不彻底）**：implementer 移除 `cap-test-harness.spec.ts` 的 `CAP-TEST-HARNESS-083` describe 块后，未同步清理两处跟踪该断言的元数据：
   - `apps/vscode-dsh/tests/capability-domains.json:766` — `domains[test-harness].entryAssertions[].caps` 仍列 `CAP-TEST-HARNESS-083`
   - `apps/vscode-dsh/tests/assertion-map.md:471` — 台账仍保留 `chat-ready-regression.spec.ts` → `CAP-TEST-HARNESS-083` 的 `keep` 行

   **影响**：破坏测试归并工作流确立的「台账 ↔ 树 双向差集为空」不变式（台账声称 keep、entryAssertions 声称覆盖，但树中已无该用例）。当前无任何运行中测试/门禁程序化校验该一致性（`apps/vscode-dsh/tests/*.ts` 与 `scripts/` 均未消费 `entryAssertions`/`assertion-map`），故不导致回归失败；但台账作为「唯一追溯载体」出现「keep 却无对应用例」的矛盾，属清理不彻底。

   **处理建议**：二选一——(a) 按 design.md 守卫①的另一分支「改写断言」保留该用例（把 `existsSync(script)===true` 改为断言「脚本已删除」），台账/entryAssertions 保持不变；(b) 若维持删除，则同步把 `assertion-map.md:471` 的 `keep` 改为 `drop`（附理由）并从 `capability-domains.json:766` 移除 `CAP-TEST-HARNESS-083`。

### 🟢 Observations

- **边界字符集合的残余误判风险（DEBT-9）**：`isPathTokenChar` 用 `[A-Za-z0-9._-]`。若 languageId 两侧相邻字符是路径名中合法但不在该集合的字符（如 `+`/`$`/`!`），可能误判。但：① 无标准 VS Code languageId 含这些字符；② 该集合是 design.md §约束1 冻结的「路径 token 字符」定义，实现与冻结算法逐字一致。另注：路径本身含 languageId 作为**完整目录 token**（如 `src/json/config.json` 的 `json` 目录）时仍判泄漏——这是「完整 token」启发式的固有保守性，且**旧 `includes` 实现同样拒绝**该路径，非本 Phase 引入的回归，也超出 AC-2（`package.json`/`json` 子串）的收窄范围。

- **`index.ts` 是第二个被改动的 src/ 文件（AC-1）**：AC-1 验证方法字面写「src/ 下仅 selection-ask.ts 一处改动」，但 `index.ts:31` 新增 `isLanguageIdTokenLeaked` re-export。此为 design.md §实现方案明示规划 + repo-exploration §6 note 6 推荐（单测经 barrel 导入）的**机械导出面改动**，无新业务逻辑，属 AC-1「不得引入新产品业务逻辑变更」的授权范围内。建议把 AC-1 措辞理解为「仅 selection-ask.ts 有**逻辑**改动」。

- **DEBT-8 步骤验证的是「历史会话往返」而非「HistoryPanel 组件渲染」**：`cap-history-panel` 的 concreteAssertion 来自 `listHistory.firstUserPreview`（会话数据），非 HistoryPanel DOM；`cap-message-list-streaming` 的断言来自 `panelSnapshot` 流式快照。二者语义上验证「历史/流式会话链路可闭环」，与能力标题（组件渲染）存在轻微错位。registry DEBT-8 已登记 `isHistoryEligibleSession` 空 title 排除风险，真机能否 `closedLoop.closed=true` 属 AC-10 运行时、verifier 职责，非本 Phase 静态正确性缺陷。

- **[文档保真] 偏差表 #2 措辞**：implementation.md 把「真机运行时验证（AC-3 正向 / AC-10 真机 / AC-3 负向）未在本 Phase 执行」记为「偏差」。这实为正常分工（implementer 不跑真机，verifier 独立验证），非「偏差」；底层事实为真、零交付物影响。

- **`run-layer-v-smoke.sh:89` 注释仍提 `run-chat-ready-regression.sh`**：implementer 已在 implementation.md「说明」章节主动披露（注释非守卫、`test-scripts/` ∉ AC-11 grep 范围）。属残留 stale 注释，建议后续顺手清理，不阻塞本 Phase。
