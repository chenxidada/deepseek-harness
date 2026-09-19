# Phase 2 验证报告（phase-2-drive-nonmodel）

## 判决：PASS

## 验证场景列表

本验证独立于 implementer 的结论，围绕 spec.md 的 4 项验收标准（AC-3/4/6/15）与 AC-14 诚实报告设计并执行了以下场景：

| # | 场景 | 类型 | 对应 AC |
|---|------|------|:--:|
| S-1 | 本批 18 项 `evidence` 字段每条 `路径:行号` 路径存在、行号不越界 | 静态 | AC-3 |
| S-2 | `obsolete-features.md` 存在 + thin HTML 路径未纳入本批驱动选择器 | 静态 | AC-4 |
| S-3 | 终版 3 个 run 的 status.json 逐项核对：18 项每项有 PNG（非退化）+ ≥1 断言 ok:true | 运行时（真机） | AC-6 |
| S-4 | 7 项闭环的 `closedLoop.concreteAssertion===true` 且非 `panelOpen:true` 充数 | 运行时（真机） | AC-6 |
| S-5 | 独立复跑 `cap-extension-activate`：新 runId 独立、结论一致、退出码契约正确 | 运行时（真机） | AC-15 |
| S-6 | 11 项未闭环在 registry DEBT-7/8 有「缺哪条+原因+建议 feature」三元组，`missing` 与 status.json 一致 | 静态 | AC-15 |
| S-7 | 诚实报告复核：无降断言/跳用例/隐藏失败取巧 | 静态+运行 | AC-14 |
| S-8 | Pipeline 合规：变更是否落在 `impl-*` 分支、是否误改产品代码 | 静态 | 合规 |

## 每 AC 结论

| AC | 结论 | 证据摘要 |
|----|:--:|------|
| AC-3 | ✅ PASS | 脚本枚举 41 项 manifest：18 项 `requiresModel:false` 全部 `evidence` 路径存在、行号不越界，`FAILURES: 0`；本批 18 项 id/group 与 `repo-exploration.md` §1 覆盖组一致 |
| AC-4 | ✅ PASS | `obsolete-features.md` 存在；`buildThinChatHtml`（`chat-panel-provider.ts:190`，fixture-only）与 `buildSidebarMigrationHtml`（`:151`）行号实测命中；`chat-panel-provider` 未出现在 manifest 任一 capability 内 |
| AC-6 | ✅ PASS | 终版 3 run 共 18 项，每项 ≥1 条 assert/wait/stream 步骤 `ok:true` + 有效非退化 PNG（3840×1080，RGB stddev 99–102，非纯色）；7 项闭环 `concreteAssertion:true` 且 `actualTrigger:true`，非 `panelOpen` 充数 |
| AC-15 | ✅ PASS | 独立复跑 `cap-extension-activate`：exit 0、conclusion PASS、新 runId `20260919T173024Z-2126081` 不覆盖旧 run、`closedLoop.closed:true`；11 项未闭环 registry 三元组完整且 `missing` 与 status.json 一致 |
| AC-14 | ✅ PASS | 无降断言（弱 `panelOpen` 被如实判 `closed:false` 而非强判闭环）、无跳用例（18 项全驱动）、无隐藏失败（中间迭代 LINK_FAILURE run 保留落盘 + 偏差 1 如实记录） |

## 测试执行矩阵

| 场景 | 来源 | 命令 | 结果 | 证据 |
|------|:--:|------|:--:|------|
| AC-3 静态：evidence 路径/行号 | spec | `node -e '<枚举 41 项 evidence 逐条校验>'` | ✅ | `total capabilities: 41 / batch count: 18 / FAILURES: 0` |
| AC-4 静态：obsolete 行号 | spec | `sed -n '151p;190p' chat-panel-provider.ts` + `grep chat-panel-provider layer-v-capabilities.json` | ✅ | 151=`buildSidebarMigrationHtml`、190=`buildThinChatHtml`；manifest 内 NONE |
| AC-6 运行时：PNG 非退化 | spec | `python3 PIL 遍历 18 张 PNG 校验尺寸+stddev` | ✅ | `total PNGs: 18 / degenerate: 0`，全部 3840×1080 |
| AC-6 运行时：每项 ≥1 断言+截图 | spec | `node -e '<枚举 18 项 steps 校验>'` | ✅ | `failures: 0` |
| AC-15 静态：missing↔registry | spec | `node -e '<3 终版 run 交叉校验>'` | ✅ | `registry covers exactly the 11 notClosed: true`，`missing != {actualTrigger,concreteAssertion}: 0` |
| AC-15 运行时：复跑 | spec | `bash run-layer-v-capabilities.sh --capability cap-extension-activate` | ✅ | `conclusion: PASS (exit 0)` |
| AC-14 诚实：无取巧 | spec | 通读 6 个 run 的 status/summary + registry | ✅ | 中间 run 171215Z 为 `LINK_FAILURE`（已保留、未删除） |

## 独立验证场景（我自己设计的）

| 场景 | 命令 | 结果 |
|------|------|------|
| 复跑同一能力验证可重复 + runId 隔离（implementer 未宣称由第三方复跑过） | `bash apps/vscode-dsh/test-scripts/run-layer-v-capabilities.sh --capability cap-extension-activate` | ✅ 新 runId `20260919T173024Z-2126081` 独立落盘，6 个旧 run 无一被覆盖；结论与 implementer 声称一致（闭环） |
| PNG 像素级退化检测（implementer 未做过 stddev 分析，仅 driver 记录 size） | `python3 -c 'PIL 计算 RGB stddev'` | ✅ 18 张均 stddev 99–102，含真实渲染内容，非纯色/空白退化图 |
| 中间迭代 run 的失败回溯（排除「反复重试强判 PASS」） | 读取 6 个 run 的 summary.json | ✅ 171215Z 为 LINK_FAILURE（singleton `new-conversation` 断言失败），后续经 `setCredentialPresence(true)` 修复；失败证据未删除 |
| `setCredentialPresence` 测试钩子真实性（偏差 1 声明核对） | `grep -n setCredentialPresence src/extension.ts` | ✅ `extension.ts:1251` 确为既有 `dsh.test.setCredentialPresence` 注册，非本 Phase 新增产品代码 |

## Reviewer 建议的验证场景

review.md 判决 SHOULD-FIX（SF-1 已闭合：design.md 回写「设计修订记录」第 3 条）。reviewer-connectivity / correctness 均 PASS，未遗留需 verifier 补验的具体场景；其建议的「核对 18 项 closedLoop 结论、退出码契约、registry 三元组」已由 S-3/S-4/S-6 覆盖。

## 端到端验证

| 数据路径 | 结果 | 证据 |
|------|------|------|
| 编排 shell → 显示解析(`reuse DISPLAY=:1`) → Node 解析 → 沙箱 HOME → `code --extensionDevelopmentPath` 启动真机 EDH → 层 V 驱动扩展 `activate()` → 逐 step 执行 → status/journal/screenshot 落盘 → 退出码映射 | ✅ 全链路连通 | 复跑日志：`reusing DISPLAY=:1` → `launching the Extension Development Host` → `driver conclusion: PASS` → `conclusion: PASS (exit 0)` |
| `cap-extension-activate` 具体数据路径：`dsh.test.simulateStartupOnly` → `{ok:true, startState:"idle"}` → ffmpeg x11grab 截图（753551 bytes） | ✅ 闭环 | 新 run status.json：closedLoop `closed:true, actualTrigger:true, concreteAssertion:true, realScreenshot:true` |
| `cap-editor-panel-singleton` 数据路径：`setCredentialPresence(true)` → `fireConversationVisibility(true)` → `simulateStartupOnly{startState:started}` → `newConversation{outcome:created,mode:live}` → re-reveal 前后 `panelSnapshot` 同 sessionId/tabId | ✅ 闭环 | 终版 run 171809Z：singleton `closed:true`，before/after reveal `sessionId=f79af660-...` 一致（单例无重复） |

## 已登记缺口（转交后续）

> 下列条目是 **AC-15 明确要求、已如实登记并转交后续 Phase/feature 的预期缺口**，不是本 Phase 交付后的未解决执行风险。保留 🟡 MEDIUM 标注以如实反映其性质。

| 缺口 | 严重性 | 阻塞 HG-3 | 说明 |
|------|:--:|:--:|------|
| 本批 11 项能力仅有弱断言（`panelOpen:true`/`viewId`），无「实际触发 + 具体结果断言」，仍处于未真机闭环状态 | 🟡 MEDIUM | 否 | 这是 AC-15 的预期产物（能闭环则闭环、不能则登记缺口），已如实登记 DEBT-7（9 项，webview 内部组件无 host 侧探测 hook）/ DEBT-8（2 项，依赖模型往返），**不在本 feature 回归补齐**，交后续 feature（webview 探测通道）与 Phase 3 带 key 驱动 |
| 本 Phase 仅覆盖 `requiresModel:false` 的 18 项；23 项 `requiresModel:true` 能力无真机证据（含 registry DEBT-4 的 change-list 3 项 🔴阻塞、DEBT-5 的 `cap-selection-ask`） | 🟡 MEDIUM | 否 | 分阶段范围的既定安排（Phase 3 承接），非本 Phase 缺口；但「能力清单 41 项中当前仅 18 项已驱动」这一覆盖率事实持续存在 |

## 残余风险

| 风险 | 严重性 | 阻塞 HG-3 | 说明 |
|------|:--:|:--:|------|
| shell 侧 `resolve_node` 命中 v24.3.0，而 driver 记录的 `nodeVersion` 为 v22.22.0 | 🟢 LOW | 否 | 两者是不同对象：前者是编排侧写 plan/读 status 的 Node，后者是 Extension Host 内嵌 Node；driver 实测 v22.22.0 与 implementer 记录一致，无功能影响 |
| implementation.md「共 18 张 PNG」措辞不精确（6 个 run 目录实为 31 张：中间 13 + 终版 18） | 🟢 LOW | 否 | 文档保真级笔误；底层主张（18 项各 1 张终版 PNG）为真，对交付物零影响 |
| 本 Phase 未改动产品代码，故未触发 AC-12 回归护栏（`vitest run apps/vscode-dsh/tests`）全量重跑 | 🟢 LOW | 否 | Phase 产物仅 `layer-v-capabilities.json`（测试基础设施 manifest）+ 文档 + 测试 artifacts，未触碰 `src/`/`webview/src/`/`tests/`，回归风险为零 |

## Pipeline 合规检查

- **当前分支**：`impl-phase-2-drive-nonmodel`（符合 `impl-<phase-id>` 命名，phase-id 与 DAG JSON 一致）。
- **非 specs 文件变更**：仅 2 处，均在 `impl-*` 分支工作区 —— `M apps/vscode-dsh/test-scripts/layer-v-capabilities.json`、`?? apps/vscode-dsh/test-scripts/obsolete-features.md`。
- **产品代码误改**：无。`src/` / `webview/src/` / `tests/` 均无改动，符合 spec §约束「不改产品代码」。
- **结论**：✅ Pipeline compliance — 所有变更在 `impl-*` 分支，无产品代码越界改动。

## 验证脚本

本验证未创建需要落盘的临时脚本 —— 静态核对与 PNG 分析均通过一次性 `node -e` / `python3 -c` 内联执行（无残留文件），复跑直接复用既有 `run-layer-v-capabilities.sh --capability <id>`。复跑证据落盘于既有 artifact 目录：

- 复跑 run 目录：`apps/vscode-dsh/test-artifacts/layer-v-capabilities/runs/20260919T173024Z-2126081/`（含 status/summary/journal + `cap-extension-activate.png`，作为可追溯的独立复验证据保留）。

## 判决说明（为什么不是 PARTIAL / FAIL）

- 本 Phase 的 4 项 AC 全部满足且经独立复跑证实：AC-3/AC-4 静态零失败；AC-6 的 18 项均有真实 PNG + ≥1 断言，7 项闭环为具体结果断言（非 `panelOpen` 充数）；AC-15 可重复运行（同 id 两轮独立 run 结论一致、runId 隔离）。
- 11 项未闭环**是 AC-15 明确要求的诚实登记结果**，不是实现失败 —— spec 明确「能闭环则闭环、不能则登记缺口、不在本 feature 回归补齐」。这些项已被 driver 如实判为 `closed:false` 并配 `missing + reason`，registry DEBT-7/8 三元组完整，未以弱断言冒充闭环。
- AC-14 诚实报告成立：中间迭代的 LINK_FAILURE run 未被删除、弱断言未被强判为闭环、`setCredentialPresence` 修复为既有测试钩子（`extension.ts:1251`）而非降断言取巧。
- 无 CRITICAL 残余风险；MEDIUM 风险均为「已登记缺口 / 分阶段范围外」的预期状态，不阻塞 HG-3。
- 本 Phase 的 MEDIUM 缺口均为 AC-15 预期登记项，已移至「已登记缺口（转交后续）」区块，非本 Phase 未解决的执行风险。
