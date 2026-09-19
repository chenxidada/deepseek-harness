# Phase 3: 模型能力批真机驱动（真实 LLM + fail-closed）

## 目标

对 `requiresModel:true` 的 23 项能力逐项真机驱动：用真实 key 做模型往返（AC-9/10），无 key 时 fail-closed（exit 3，不伪造通过）。重点解决 React SPA 的强制渲染与流式末块断言，升级「仅面板打开」为具体结果断言。

覆盖组（以 design.md 能力分批表 + manifest 现状为准）：`session-main-path`(8 model) + `subagent`(2) + `code-context` 的 `selection-ask`(1) + `change-list`(3) + `search`(2) + `fork`(2) + `continue`(3) + `history`(2) = 23 项。注：`react-spa-main` 组 8 项全部 `requiresModel:false`（已在 Phase 2 覆盖），本 Phase 无 react-spa-main 模型项。

## 前置条件

- Phase 1、Phase 2 已完成且 HG-3 通过（`requiresModel` 分支依赖 Phase 1 的 `classifyAssertionStrength`/`assessClosedLoop`；`react-spa-main` 的 model 断言依赖 Phase 2 已升级的非 model 断言模式）。
- `DEEPSEEK_API_KEY` 可用；无 key → `SKIPPED_NO_CREDENTIALS`（exit 3，本 Phase 的 fail-closed 即按此路径验证）。

## 验收标准

| AC | 内容（节选） |
|----|------|
| AC-9 | 模型往返能力用真实 key 驱动；模型未就绪时以专用退出码 fail-closed（跳过并如实登记），不得伪造/桩化模型响应 |
| AC-10 | 模型能力断言必须到具体结果（`$assistantContains`/`$titleContains`/`$userContains`/stream last-chunk 非空），禁用弱证据（仅 `panelOpen`/命令注册/`fetch ok`）作为闭环依据 |
| AC-6 | 每项能力产出真实桌面截图（PNG）+ ≥1 条可独立判定的端到端断言 |
| AC-11 | 模型能力需 `dsh.test.*` 触发 + 断言具体结果 + 截图三条齐备才能「闭环通过」；React SPA 强制渲染 + 流式末块断言纳入验证 |
| AC-15 | 可重复运行；逐项给结论，未闭环登记「缺哪条 + 原因 + 建议何种 feature」 |

## 验证策略

| AC | 验证类型 | 验证方法 | 预期结果 |
|----|---------|---------|---------|
| AC-9 | 运行时（真机，正向） | 有 key 时跑 `run-layer-v-capabilities.sh --capability session` 等模型组，断言模型能力正常往返（stream last-chunk 非空、`$assistantContains` 命中） | 模型能力闭环通过 |
| AC-9 | 运行时（fail-closed，反向） | 无 key（`unset DEEPSEEK_API_KEY`）跑模型组，断言 `verdict=SKIPPED_NO_CREDENTIALS` 且 `exit 3`，status.json 中该项 `closedLoop.closed=false`、`reason` 记录「无凭证」 | 无 key 不伪造通过，exit 3 |
| AC-10 | 静态检查 | grep `layer-v-capabilities.json` 中 `requiresModel` 组的断言：必须出现 `$assistantContains`/`$titleContains`/`$userContains`/`lastChunk`/`stream` 之一，不得仅 `panelOpen`/`command registered` | 模型组断言均为具体结果 |
| AC-10 | 运行时（反向） | 对一个模型能力临时改回 `panelOpen:true` 断言，跑 `classifyAssertionStrength`，断言返回 `weak` 且该项 `closedLoop.concreteAssertion=false`（验证后还原） | 弱证据被识别为未闭环 |
| AC-11 | 运行时（真机） | 历史窗口 + 流式末块断言：`history` 组（`cap-history-list`/`cap-open-from-history`）与流式末块（`stream` 步 + `$assistantContains` + `requireIncrement:true`）纳入验证；断言 `closedLoop` 三条齐备 | history 组 + 流式末块闭环 |
| AC-6 | 运行时（真机） | 逐项读取 status.json，断言每项 `closedLoop.realScreenshot=true`（非退化 PNG，`MIN_DISTINCT_MD5=3` 校验通过） | 每项有真实截图 |
| AC-15 | 运行时 | 完整跑模型批后，逐项有 `closedLoop`；未闭环项在 registry 有「缺口三元组」条目；重复跑两次 run 目录独立 | 逐项结论 + 可重复 |

## 约束

- 真实 key 强制：不注入 fake/mock 响应；`DEEPSEEK_API_KEY` 缺失即 `SKIPPED_NO_CREDENTIALS`（exit 3），不得补桩。
- 不改产品代码（`src/`/`webview/src/`）。
- 模型能力运行时长风险：模型组逐组分批跑（`session`/`search`/`agent`/`skill-render`/`preset`/`pdc`/`sandbox`/`guard`），每批限制组数，避免单次超时。
- `interaction-ask` / 纯 webview 渲染能力若 host 侧无 `dsh.test.*` 暴露具体结果，如实登记未闭环，建议后续 feature 补探测通道（AC-15），不在本 Phase 硬造断言。
- 复用 Phase 1 的 `assessClosedLoop` / `classifyAssertionStrength`，不另起判定逻辑。

## 产出清单

- `apps/vscode-dsh/test-scripts/layer-v-capabilities.json`（改：模型组断言升级 + 流式末块断言）
- `apps/vscode-dsh/test-artifacts/layer-v-capabilities/runs/<runId>/`（模型批 status + PNG + journal）
- `tech-debt-registry.md`（新增模型能力「未闭环」条目，如有）
