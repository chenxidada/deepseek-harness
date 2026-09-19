# Correctness Review — Phase 4 (lint program 与收口)

## 视角
**Implementation Correctness** — 代码是否正确工作

## 判决
**PASS**

## 独立复跑证据（不采信 implementer 自报，逐条重跑）

| 检查 | 命令 | 实测结果 | 结论 |
|---|---|---|---|
| AC-16 oxlint | `env PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" npx tsx scripts/run-oxlint.ts apps/vscode-dsh/tests` | `=== EXIT: 0 ===`（0 error 0 warning） | ✅ |
| AC-14 vitest | `env PATH=".../node/24.3.0/bin:$PATH" ./node_modules/.bin/vitest run apps/vscode-dsh/tests` | `Test Files 12 passed / Tests 556 passed`，exit 0 | ✅ |
| AC-18 tsc | `npx tsc -p apps/vscode-dsh/tests/tsconfig.json --noEmit` | **219 条** error TS（108 tests + 13 webview/src + 98 vendor） | ✅ 与 DEBT-019 完全一致 |
| AC-24 src 红线 | `git diff --name-only` | 测试改动全部落在 `apps/vscode-dsh/tests/`，无 `src/**`/`webview/**`/`packages/**` | ✅ |

## 逐条 AC 验证

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-13 | 完整域文件运行留痕 | `implementation.md:104-112` | ✅ | 记录了 `vitest run apps/vscode-dsh/tests/cap-session-host.spec.ts` → 144 passed（完整域文件无过滤运行）。留痕在 implementation.md，verifier 会在 verification.md 正式化 |
| AC-14 | vitest 失败用例数=0 | 独立复跑 | ✅ | 12 files / 556 tests 全绿，exit 0，与自报 556 完全一致 |
| AC-15 | tsconfig include 改 glob | `tests/tsconfig.json:25-28` | ✅ | `include` 为 `["**/*.ts","**/*.tsx"]`，无任何逐文件白名单；15 个 `.ts/.tsx` 文件（12 spec + 3 helper）全部被 glob 覆盖 |
| AC-16 | oxlint 退出码 0 | 独立复跑 | ✅ | exit 0，0 error |
| AC-17 | 头部注释更新 | `tests/tsconfig.json:1-14` | ✅ | 新注释陈述 glob 口径 + 残 ts 错误记 registry；无「目录过大不可作为 program」陈述 |
| AC-18 | tsc 口径显式记录 | `tech-debt-registry.md:28` | ✅ | `DEBT-019` 已登记，含文件:行号 / 当前行为（219 条，分类 108/13/98）/ 预期行为 / 目标Phase（不关闭）/ 阻塞（🟡非阻塞）/ 来源 |
| AC-24 | 不得改 src/** | `git diff --name-only` | ✅ | 无 src/webview/packages 改动；`EditorChatWebviewPanel` import 修复是在测试侧改 import 来源，未改 src |

## Stub Detection（桩代码检测）

### 已注册桩（对照 registry）
无。

### 新发现的未注册桩
无。改动文件内无 `@STUB` / `return undefined` 空壳 / `throw not implemented`。唯一 `ctx.skip(...)`（`cap-session-host.spec.ts:1345`）是条件跳过 `ctx.skip(located.length === 0, ...)`——环境缺 pinned node 时跳过，非本次改动引入，非空白跳过。

## 断言语义变更检查（AC-29 ③）

`git diff` 中 `expect(` 删除行 = 33，新增行 = 33，**净删除 0**。全部为等价变换：

- 移除冗余 `String()`（`no-unnecessary-type-conversion`）：`b.text` / `uri.fsPath ?? ''` 已为 `string`，幂等，去 `String()` 不变值。
- 布尔简化 `x === true` → `x`、`!x !== true` → `!x`：对象为 boolean 类型，等价。
- 非空断言 `lines[0]!` / `contentBlocks[0]!`：补 `!`（`no-unnecessary-condition` 已对 tests 关闭，此为非空断言相关，类型层不改变运行时）。
- `getFollowState` 解构 → `probes.getFollowState()`（`unbound-method`）：**修潜在 bug**（解构丢失 `this` 绑定），非削弱断言；复跑 556 全绿证明返回值 'on'/'off' 正确。
- `await waitFor(() =>{  expect(...) })`（`no-confusing-void-expression`）：加花括号使回调为 void 语句，waitFor 重试语义等价。
- `MockInstance<(tabIdArg?: string) => Promise<...>>`（`continueSpy`）：仅精确 mock 类型签名，运行时 `vi.fn()` 行为不变。

**无 `it.skip` / `it.todo` / `.only` / 删除断言 / expect 改弱**。台账无需 `weakened` 标记，与 implementation.md 自陈一致。

## 偏差 D-1/D-2/D-3 核实

| 偏差 | implementer 主张 | 核实结果 |
|---|---|---|
| D-1 加 `jsx: react-jsx` | glob 化后 `cap-webview.spec.tsx` 进入 program，但 base 无 jsx 字段 → 35 条 TS17004 | ✅ 属实。`tsconfig.json:22` 确有 `"jsx": "react-jsx"`，与 `webview/tsconfig.json` 一致；加后 tsc 251→219（消除 35 条 config 假错误） |
| D-2 oxlint 起点 145≠203 | 203 是 Phase 2 归并前（61 文件）旧基线 | ✅ 属实且诚实。repo-exploration §7.2/§7.3 已明示 203 为 HYPOTHESIS/过时，要求 implementer 改 include 后立即复测。最终态 0 error 为 AC-16 真实要求 |
| D-3 tsc 219≠15 | 调研「15 条」来自已删 probe，复现报 TS5058 路径不存在 | ✅ 属实。独立复跑 tsc = **219 条**，分布（cap-session-host 74 / cap-timeline 14 / cap-test-harness 8 / cap-conversation 6 / cap-chat-panel 4 / cap-code-context 1 / cap-change-list 1 = 108；webview/src 13；vendor cordis 60/loader 24/cosmo 6/schemastery 4/include 4 = 98）与 DEBT-019 逐项吻合 |

三条偏差均真实存在、已在 implementation.md 记录、未掩盖真实缺陷（tsc 219 是诚实暴露而非隐瞒；oxlint 0 是真实修复+窄豁免，非伪造）。

## 关键发现

### 🔴 Must-Fix
无。

### 🟡 Should-Fix

1. **`no-deprecated` 处置方式偏离 design.md 步骤 4，且引用误导**（`implementation.md:64`；`design.md:304`）
   - 事实：25 处 `buildThinChatHtml` 的 `no-deprecated` 未按 design.md 步骤 4「改为引用 `buildEditorChatSpaHtml` 或移除 fixture 路径」修复，而是加了 25 个行级豁免注释（`// oxlint-disable-next-line typescript/no-deprecated -- fixture-only legacy HTML (AD-ECP-8)`）。
   - implementation.md 将该处置标注为「见 design.md 决策」，但 design.md 中关于 `buildThinChatHtml` 的内容只有：① 现状依据（`:21-22`，fixture-only 已废弃）；② 修复处方（`:304`，替换）——**并无「豁免/抑制」的决策**。该引用误导（指向了相反结论）。
   - 性质判断：豁免**不削弱断言**（保留了 fixture HTML 与相关断言，规避了 repo-exploration §7.6 R-3 警告的「替换会削弱 fixture 断言」风险），且行级窄豁免 + 理由符合仓库既有惯例（`.oxlintrc.json:83` 注释「intentional 需要窄豁免 + 理由」）。因此**不是代码缺陷、不需 MUST-FIX**。
   - 但这是**未经记录的方案偏差**（D-1/D-2/D-3 之外的第 4 个偏差未列入「偏差记录」章节），且「见 design.md 决策」引用不实。建议：① 在 implementation.md 偏差章节补记「D-4：no-deprecated 用行级豁免替代 design.md 步骤 4 的替换，理由是替换会触发 R-3 断言语义变更」；② 修正「见 design.md 决策」的误导引用为「见 design.md:21-22 现状依据 + R-3 风险」。此项是否改法由 reviewer-design 定夺（替换 vs 豁免是设计一致性问题）。

### 🟢 Observations

1. **AC-13 留痕位置**：spec.md AC-13 措辞为「verification.md 记录完整域文件运行命令与输出」，但当前留痕在 `implementation.md:104-112`（`cap-session-host.spec.ts` 144 passed）。verifier 尚未运行，verification.md 未产出，此为正常时序，非缺陷——verifier 需在 verification.md 正式补录。
2. **遗留物 `_probe-tsconfig.tsbuildinfo`**（`implementation.md:158`）：调研阶段残留的未被 git 跟踪文件，不影响 glob/lint/test，未删除合理。
3. **非本 Phase 元文件改动**：工作区另有 `.cursor/skills/project-build/SKILL.md`、`.gitignore`、其他 workflow 的 specdev 文件处于 modified 状态，均非 `src/**`，与本 Phase lint 工作无关，不构成 AC-24 违规。
