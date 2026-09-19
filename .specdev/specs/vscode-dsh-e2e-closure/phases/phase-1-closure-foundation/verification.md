# Phase 1 验证报告 — phase-1-closure-foundation

## 判决：PASS

> 5 项 AC（AC-1/AC-2/AC-5/AC-7/AC-8）全部经独立验证通过。核心缺口（真机单项 run）已补做：真实 Extension Dev Host launch 成功、exit 0、per-run 隔离路径真连通、journal 逐行追加、退出码契约运行时佐证齐备。**关键证据**：真机 `cap-react-spa-root` 跑出 `conclusion=PASS` 但 `closedLoop.closed=false`（`missing=[actualTrigger, concreteAssertion]`），正是 AC-2「弱证据不得记验证通过」的正交语义在真实运行时正确生效。

## 测试执行矩阵

| 场景 | 来源 | 命令 | 结果 | 证据 |
|------|:--:|------|:--:|------|
| AC-1 三元判定：三条齐备 → closed:true | spec | `node` require + `assessClosedLoop` | ✅ | `closed:true` + `missing:[]` |
| AC-1 缺 screenshot → closed:false + `[realScreenshot]` | spec | `node` require | ✅ | missing 仅含 realScreenshot |
| AC-1 缺具体断言 → closed:false + `[concreteAssertion]` | spec | `node` require | ✅ | weak-only → 仅缺 concreteAssertion |
| AC-1 仅 UI-prep 命令 → closed:false + `[actualTrigger]` | spec | `node` require | ✅ | `dsh.showPanel` only → 缺 actualTrigger |
| AC-1 正交性：concrete 断言但命令是 UI-prep → actualTrigger=false、concreteAssertion=true | 独立 | `node` require | ✅ | 两维度独立判定不误伤 |
| AC-1 真机正交性（反向） | spec | 真机 `run-layer-v-capabilities.sh --capability cap-react-spa-root` | ✅ | `conclusion=PASS` 但 `closedLoop.closed=false`，`missing=[actualTrigger,concreteAssertion]`、`realScreenshot=true` |
| AC-2 `{panelOpen:true}`/`{viewId:'x'}`→weak；`$assistantContains:`/`hits:[{$contains}]`→concrete；未知→unknown+reason | spec | `classifyAssertionStrength` | ✅ | 14 断言全过（含 `$array:1`/`ok:false`/`outcome:created`/`$string`/`{}` 边界） |
| AC-5 `primitives.cjs` / `layer-v-runtime.sh` 既有函数体未改 | spec | `git diff` | ✅ | 仅 3 文件 diff，两共享文件零改动 |
| AC-7 journal 逐行追加（真机） | spec | 真机 run 后读 `journal.jsonl` | ✅ | 5 行：3 step + conclusion + driver-done，按 step 顺序 |
| AC-7 崩溃可定位（mock host） | spec | mock host 抛错 + journal 回调 | ✅ | crash journal 命名 prior `ok-step` 与 `dying-step` |
| AC-8 无 key+requiresModel→SKIPPED_NO_CREDENTIALS / 空选择→HARNESS_ERROR / 全 PASS→PASS | spec | mock host `runManifest` | ✅ | 三者结论正确 |
| AC-8 LINK_FAILURE outranks PASS | 独立 | mock host `runManifest` | ✅ | 一 PASS 一 LINK_FAILURE → LINK_FAILURE |
| AC-8 真机退出码 | spec | 真机 run | ✅ | `REAL_RUN_EXIT=0`，summary `exitCode:0` |
| AC-8 shell case 映射 0/1/2/3/4 | spec | 静态 grep | ✅ | PASS→0 / LINK_FAILURE→1 / SKIPPED_NO_DISPLAY→2 / SKIPPED_NO_CREDENTIALS→3 / 其余→4 |
| closureSummary total/closed/notClosed/skipped/byGroup（真机） | 独立 | 读真机 `summary.json` | ✅ | `total=1, closed=0, notClosed=1, skipped=0`，`byGroup.react-spa-main={1,0,1}` |

## 独立验证场景（我自己设计的，非 implementer 复述）

| 场景 | 命令 | 结果 |
|------|------|------|
| 正交性边界：concrete 断言的 command 恰好是 UI-prep（`dsh.showPanel`）时，actualTrigger 与 concreteAssertion 是否独立判定 | `node` 直接喂 `assessClosedLoop` | ✅ actualTrigger=false、concreteAssertion=true，`missing=['actualTrigger']` 单一维度 |
| `classifyAssertionStrength` 边界扩展：`$array:1`→concrete、`$string`→weak、`ok:false`→concrete、`{}`→weak、`123`/`null`→unknown | `node` 直接调用 | ✅ 14 断言全过，无假阴/假阳 |
| `runCapability` 端到端确认 `closedLoop` 字段真实附加到返回值 | mock host 驱动完整 cap | ✅ `closedLoop.closed===true` |
| 真机反向正交：`cap-react-spa-root`（弱证据断言）跑真机，确认「run 通过但未闭环」 | 真机 run | ✅ `conclusion=PASS` 但 `closedLoop.closed=false`（缺 actualTrigger+concreteAssertion） |
| closureSummary 真机核对：单 cap 未闭环汇总 | 读真机 `summary.json` | ✅ notClosed=1，notClosedDetails 含 `missing`+`reason` |
| 桩检测（参数变化测试）：`classifyAssertionStrength` 14 组、`assessClosedLoop` 5 组输入产出不同输出 | `node` 直接调用 | ✅ 输出随输入变化，非桩 |

## Reviewer 建议的验证场景

- reviewer-correctness：fixture dry-run 11/11 分类 + 三元判定 4 场景 + mock host 退出码复验 —— 已独立复现（临时脚本 28 断言全过），结论一致。
- reviewer-connectivity：主链路 plan.artifactDir 双向、per-run journal、fail-closed、closureSummary、退出码映射 —— **真机已连通验证**（见 §端到端验证）。
- DEBT-6（`activate()` 兜底路径孤儿文件 + reason 丢失）：已知 🟡 非阻塞债务，按 registry 规则跳过行为验证，未重复判定。

## 端到端验证（真机）

| 数据路径 | 结果 | 证据 |
|------|:--:|------|
| shell `write_plan`（artifactDir=RUN_DIR）→ driver `resolveArtifactDir` → status/journal/screenshot 落 per-run 目录 | ✅ | `driver.artifactDir` = `…/runs/20260919T164452Z-1719351`；`planPath` = 稳定 base 路径；4 产物同目录 |
| 真机 host launch → 步执行 → journal 逐行 → status.json → summary.json | ✅ | `conclusion: PASS (exit 0)`；journal 5 行 |
| 截图取证（真实 PNG） | ✅ | `cap-react-spa-root.png`，PNG 3840×1080，727616 bytes，`pngVerdict.ok=true` |
| manifest → selectCapabilities → 凭证门控 → runCapability → matchesExpect → closedLoop → 聚合结论 | ✅ | mock host 28 断言 + 真机闭环判定 |

**真机 run 摘要**（runId `20260919T164452Z-1719351`）：
- `conclusion: PASS`，`exitCode: 0`（summary 与 shell 双一致）。
- journal.jsonl 5 行：`command reveal-editor-panel` → `assert editor-panel-open` → `screenshot react-spa-root` → `conclusion PASS` → `driver-done PASS`，逐行、按序。
- status.json `capabilities[0].closedLoop` = `{closed:false, actualTrigger:false, concreteAssertion:false, realScreenshot:true, missing:["actualTrigger","concreteAssertion"], reason:"未闭环：缺 actualTrigger、concreteAssertion"}`。
- 该 cap 的断言是弱证据（`{viewId, panelOpen:true}`）且 command 为 `dsh.showPanel`（UI-prep）→ 正确判「未闭环」，截图维度正常通过。**这是本 Phase 核心语义（正交于退出码的闭环判定 + AC-2 弱证据封禁）在真实运行时的直接证据。**

## 视觉验证

- 不适用：本 Phase `ui:false`，无 UI 变更，`reviewer-visual` 返回 N/A。无 `visual-blocking`。

## 残余风险

| 风险 | 严重性 | 阻塞 HG-3 | 说明 |
|------|:--:|:--:|------|
| 真机 kill -9 崩溃恢复未字面复现 | 🟢 LOW（非阻塞） | 否 | 字面「真机 SIGKILL」未做：`cap-react-spa-root` 仅 3 步、实际步执行窗口 ~250ms，kill 时序不可稳定命中（其余含 wait 步的非模型 cap 属 DEBT-5 从未真机执行、状态迁移不确定，不硬凑）。但 AC-7「崩溃可定位」已由三点闭合：① `appendJournal` 用同步 `appendFileSync`（每步 emit 在控制权离开该步前完成，SIGKILL 无法打断一次已完成的小写写入）；② mock host crash 测试命名 dying-step + prior-step；③ 真机 journal 逐行时间戳递增佐证同步追加。故降级为 LOW 说明项，已闭合。 |

## Pipeline 合规检查

- ✅ 所有非 specs 文件变更均在 `impl-phase-1-closure-foundation` 分支（`git branch --show-current` = `impl-phase-1-closure-foundation`）。
- ✅ 改动面仅 3 个 test-scripts 文件；`primitives.cjs` 与 `layer-v-runtime.sh` 零改动（AC-5）。
- ✅ 无未注册 `@STUB` 桩；新函数经参数变化测试确认有真实逻辑。
- ✅ 验证脚本以临时目录方式执行（28 断言全过），验证后已删除，未落 `apps/vscode-dsh/tests/`（AC-13）。

## 验证脚本

- 临时脚本（`mktemp -d`）覆盖 AC-1 / AC-2 / AC-7（mock crash）/ AC-8 共 28 项断言，`node <script>` 退出码 0（28 passed, 0 failed），验证后已删除。
- 真机验证命令：`bash apps/vscode-dsh/test-scripts/run-layer-v-capabilities.sh --capability cap-react-spa-root`（退出码 0）。
