# Phase 4 验证报告 — phase-4-orchestration-regression

## 判决：PASS

## 验证范围与方法

本 Phase 交付物是**验证基础设施**（全链编排入口 + 回归护栏 + registry 收尾），`ui:false`。verifier 独立设计并执行验证场景，不信任 implementer/reviewer 结论。真机验证受环境约束（有 `DISPLAY=:1` + Xvfb + 已构建产物，但**无 `DEEPSEEK_API_KEY`**），故模型批（23 项）真机全量未跑，以「单项非模型 smoke + 静态交叉核验 + SHOULD-FIX 逻辑直测」覆盖，如实标注未跑部分，不伪造。

## 测试执行矩阵

| 场景 | 来源 | 命令 | 结果 | 证据 |
|------|:--:|------|:--:|------|
| AC-12: `run-layer-v-smoke.sh` 未破坏 | spec | `git status -s` + `git diff --stat`（静态） | ✅ | 该文件不在改动清单；`bash -n` 通过 |
| AC-12: `run-chat-ready-regression.sh` 为 M 非 D | spec | `git status -s` + `git diff` | ✅ | 状态 `M`，diff 仅 +12 行 obsolete 注释，无逻辑改动 |
| AC-12: chat-ready `bash -n` 通过 | spec | `bash -n apps/vscode-dsh/test-scripts/run-chat-ready-regression.sh` | ✅ | exit 0 |
| AC-13: 新脚本落 `test-scripts/` | spec | `git status -s apps/vscode-dsh/test-scripts/` | ✅ | `run-vscode-dsh-e2e-closure.sh` 为新增（`??`），位于 `test-scripts/` |
| AC-13: `tests/` 无临时脚本残留 | spec | `git status -s apps/vscode-dsh/tests/` + `git ls-files --others --exclude-standard apps/vscode-dsh/tests/` | ✅ | 两者均空 |
| AC-7: 编排入口 `--list` | spec | `bash apps/vscode-dsh/test-scripts/run-vscode-dsh-e2e-closure.sh --list` | ✅ | exit 0，输出 nonmodel 18 + model 23 = 41 项 |
| AC-7: 编排入口 `--help` | spec | `bash .../run-vscode-dsh-e2e-closure.sh --help` | ✅ | exit 0，退出码契约五值（0/1/2/3/4）文档正确 |
| AC-5: 编排入口 `bash -n` | spec | `bash -n .../run-vscode-dsh-e2e-closure.sh` | ✅ | exit 0 |
| AC-5: `layer-v-runtime.sh`/`primitives.cjs` 未改 | spec | `git status -s apps/vscode-dsh/test-scripts/layer-v-support/` | ✅ | 空（未改动） |
| AC-5: `capability-runner.cjs` 未改（不新起判定逻辑） | spec | `git status -s apps/vscode-dsh/test-scripts/layer-v-capability-driver/` + `grep -c assessClosedLoop` 编排入口 | ✅ | 空；grep 计数 0（未重定义判定） |
| AC-7: 非模型单项真机 smoke + journal 落盘 | verifier | `bash .../run-layer-v-capabilities.sh --capability cap-extension-activate` | ✅ | exit 0 / PASS，journal 4 行 JSONL 落 per-run 目录（见 §端到端验证） |
| AC-15: DEBT-6 基座孤儿清理 | spec | 运行前后比对 base 目录孤儿文件 | ✅ | 运行前存在 2 个孤儿文件，运行后被清除（见 §DEBT-6） |
| AC-14: 无「放宽断言」痕迹 | spec | 读 implementation.md + registry | ✅ | 未闭环项如实登记，无弱证据重定义 |
| SHOULD-FIX-1: `batch_ids` fail-closed | review | 提取 shipped 函数直测（损坏/空/真实 manifest） | ✅ | 22 断言全过（见 §SHOULD-FIX 复核） |
| SHOULD-FIX-2: `aggregate_exit` 归一化 | review | 提取 shipped 函数直测 | ✅ | 22 断言全过（见 §SHOULD-FIX 复核） |

## 独立验证场景（verifier 自己设计）

| 场景 | 命令 | 结果 | 证据 |
|------|------|:--:|------|
| `aggregate_exit 137 4` / `4 137` / `137` / `130` / `143` 均归一化为 4 | 提取 shipped `aggregate_exit`+`severity_of` | ✅ | 均输出 `4` |
| `aggregate_exit 0 2`→2、`1 3`→1、`3 2`→2、`0 0`→0、`3 3`→3、`2 2 0 0`→2（正常码不受影响） | 同上 | ✅ | 均符合预期 |
| 损坏 manifest `{ "capabilities": [ {broken json` → `batch_ids` exit 4 + stdout 空 | 提取 shipped `batch_ids`，`MANIFEST_PATH` 指向临时坏 JSON | ✅ | exit 4，stdout 空 |
| 合法空 manifest `{ "capabilities": [] }` → `batch_ids` exit 0 + stdout 空（不误报 HARNESS_ERROR） | 同上 | ✅ | exit 0，stdout 空 |
| 真实 manifest：`batch_ids nonmodel`=18 项、`model`=23 项、无交叉污染 | 同上 | ✅ | `count_items` 18/23；nonmodel 不含 `cap-auto-start-orchestrator`，model 含 |
| manifest 总数 41、id 无重复 | `node -e 'require(...).capabilities'` | ✅ | total=41 model=23 nonmodel=18 distinct ids=41 |
| 编排入口不重定义判定逻辑（复用 `assessClosedLoop`） | `grep -c 'assessClosedLoop\|classifyAssertionStrength'` 编排入口 | ✅ | 计数 0 |

> 说明：上述「提取 shipped 函数」= 用 `sed -n '86,114p'`（batch_ids/count_items）与 `sed -n '121,160p'`（severity_of/conclusion_of/aggregate_exit）从**已交付脚本原文**抽取函数体后 `eval` 直测——测的是真实 shipped 代码，非手写复本。临时测试脚本置于 `/tmp` 并在验证后删除（本 Phase 要求「临时脚本放临时目录验证后删除」）。

## Reviewer 建议的验证场景

review 合并判决 PASS，三处 SHOULD-FIX 均已闭合。reviewer 建议的核心验证即为 SHOULD-FIX-1（`batch_ids` fail-closed）与 SHOULD-FIX-2（`aggregate_exit` 归一化），已在 §SHOULD-FIX 复核中独立直测通过；SF-3（design.md 回写方案 C）已静态确认。

## 端到端验证

| 数据路径 | 结果 | 证据 |
|------|:--:|------|
| 编排入口 → `batch_ids` 派生 18/23 → `LAYER_V_CAPABILITY_ONLY` → `run-layer-v-capabilities.sh`（每批一次独立调用） | ✅ | 静态：`run_batch` 第 255 行 `LAYER_V_CAPABILITY_ONLY="${ids}" bash "${CAPABILITIES_SCRIPT}"`；`--list` 实测 41 项 |
| 非模型单项：宿主启动 → `startup-hook-responsive` 断言 PASS → `extension-activate` 截图 → conclusion PASS | ✅ | 单次运行 exit 0，约 18s；driver conclusion: PASS |
| journal 逐步追加（per-run 隔离 + JSONL） | ✅ | `runs/20260919T194002Z-3529229/layer-v-capabilities-journal.jsonl` 4 行，逐步记录 `step`/`kind`/`verdict`/`evidence`（见下） |
| 截图证据落 per-run 目录 | ✅ | `cap-extension-activate.png`（757 KB） |

journal 内容（逐步追加，含 capability/step/kind/verdict/evidence）：

```jsonl
{"ts":"2026-09-19T19:40:16.739Z","capability":"cap-extension-activate","step":"startup-hook-responsive","kind":"assert","verdict":"PASS","evidence":[],"detail":"assertion startup-hook-responsive (dsh.test.simulateStartupOnly) passed"}
{"ts":"2026-09-19T19:40:16.985Z","capability":"cap-extension-activate","step":"extension-activate","kind":"screenshot","verdict":"PASS","evidence":["cap-extension-activate.png"],"detail":"screenshot cap-extension-activate.png captured"}
{"ts":"2026-09-19T19:40:16.985Z","event":"conclusion","conclusion":"PASS"}
{"ts":"2026-09-19T19:40:16.985Z","event":"driver-done","conclusion":"PASS"}
```

> 说明：编排入口不自行写 journal，而是通过**组合** `run-layer-v-capabilities.sh`（该脚本内 per-run 隔离 + JSONL journal 机制在 Phase 1 已验收，本 Phase 未改）继承。上面的单项真机 smoke 即证明该委托链路的 journal 逐步追加与 per-run 隔离在本环境可用。**中途 kill host 定位失败点（spec AC-7 运行时形态）未执行**——需全量 run 中途 kill，模型批无 key 无法跑全，已如实标注为残余风险（🟢 LOW）。

## SHOULD-FIX 复核（关键）

### SF-1 `batch_ids` fail-closed — ✅ 修复有效

- 缺陷：manifest 损坏时 node 非零退出、stdout 空 → `ids=""` → 「nothing to run」`return 0` → 聚合 exit 0（fail-open）。
- 修复后行为（直测 shipped 代码）：损坏 manifest → `batch_ids` return 4（HARNESS_ERROR）、stdout 空；`run_batch` 检查 `$?` 非零即 return 4 传播。
- 边界保留：合法空清单（`{ "capabilities": [] }`）→ node exit 0、stdout 空 → 仍走「nothing to run」return 0，**不误报** HARNESS_ERROR。✅ 与修复说明一致。

### SF-2 `aggregate_exit` 归一化 — ✅ 修复有效

- 缺陷：未知退出码（硬崩溃如 137）原样透传，违反五值契约。
- 修复后行为（直测 shipped 代码）：`137 4`/`4 137`/`137`/`130`/`143` 均返回 4；`0 2`→2、`1 3`→1、`3 2`→2、`0`→0 等正常码不受影响。✅ 与修复说明一致。

### SF-3 design.md 回写方案 C — ✅ 已回写

- `design.md` §设计修订记录 第 6 条（2026-09-20）记录了 chat-ready 脚本方案 C 决策（原位标记 obsolete + 登记 DEBT-11，不删除不改守卫）。✅

## DEBT-6 清理（运行时复核）

- 运行前：base 目录存在 2 个孤儿文件（`layer-v-capabilities-journal.jsonl` / `-status.json`，mtime 9月19 19:04，即 in-host driver `activate()` fallback 写出的历史孤儿）。
- 运行后：`ls` 报 `No such file or directory`——`run-layer-v-capabilities.sh` 的 `rm -f` 现在一并清 `${ARTIFACT_DIR}/layer-v-capabilities-{status,journal}`，孤儿被正确清除。✅ 与 DEBT-6 已解决说明一致。

## 残余风险

> 本 Phase 交付（编排入口 + 回归护栏 + registry 收尾）的执行风险。仅含 🟢 LOW。

| 风险 | 严重性 | 阻塞 HG-3 | 说明 |
|------|:--:|:--:|------|
| 全量 41 项真机编排未在本环境跑全（模型批 23 项需 `DEEPSEEK_API_KEY`，本环境无 key） | 🟢 LOW | 否 | 模型批无 key 时按 AC-10 以 exit 3 fail-closed（该行为已在 Phase 3 验证），非缺陷；编排入口对 exit 3 的聚合/归一化已直测通过。非模型批的单项 smoke 已真机 PASS |
| spec AC-7「中途 kill host 定位失败点」运行时形态未执行 | 🟢 LOW | 否 | 需全量 run 中途 kill，模型批无 key 无法跑全；journal 逐步追加机制本身已通过单项真机 smoke 验证 |
| 全量 closedLoop 汇总（AC-14/15 运行时）未在本环境跑全 | 🟢 LOW | 否 | 属环境约束（无 key）；非模型单项已产出完整 `closedLoop` 证据，汇总逻辑由既有 `run-layer-v-capabilities.sh` 继承，未在本 Phase 改动 |

## 已登记缺口（AC-15 预期转交后续 feature，非本 Phase 缺陷）

> 以下为 Phase 2/3 真机驱动后**如实登记**的「未闭环」能力缺口，AC-15 明确「不在本 feature 回归补齐」，交由后续 feature。它们是 registry 的正确收尾产物，不是本 Phase 交付缺陷，**不参与 PASS/MEDIUM 判定**。

| ID | 缺口 | 目标 |
|----|------|------|
| DEBT-2 | `forkFromClosedTurn` emptySeed 分叉子会话自启动语义，retry 首轮往返未达 | 后续 feature（forkFromClosedTurn emptySeed 自启动语义） |
| DEBT-3 | #18 `cap-message-store-stream-patch` 流式增量跨 run 时序波动 | 后续 feature（流式增量观测稳健性） |
| DEBT-7 | webview 内部 9 项能力缺 host 侧渲染探测通道（弱证据 `panelOpen`/`viewId`） | 后续 feature（webview 探测通道） |
| DEBT-8 | history/streaming 2 项缺模型往返（`requiresModel:false` 无法触发真实历史/流式） | 后续 feature（history/streaming 模型往返闭环） |
| DEBT-9 | `runAskAboutSelection` 防泄漏检查裸子串误报（`package.json`/`json` 冲突） | 后续 feature（修复 selection-ask 防泄漏误报） |
| DEBT-10 | subagent 2 项 `injectSubagent` 测试注入，无真实模型委托 | 后续 feature（subagent 真实模型委托闭环） |
| DEBT-11 | `run-chat-ready-regression.sh` 过时脚本 + 4 处守卫引用待清理（方案 C） | 后续 feature（清理 chat-ready 过时脚本及其守卫引用） |

## Pipeline 合规检查

- 分支：当前分支 `impl-phase-4-orchestration-regression`，与 DAG `current_phase` 一致。✅
- 非 specs 文件变更均在 `impl-*` 分支：`git status` 显示本 Phase 产物改动（`run-vscode-dsh-e2e-closure.sh` 新增、`run-chat-ready-regression.sh` M、`run-layer-v-capabilities.sh` M）均在本分支；无 `main` 分支外的非 specs 文件改动。✅
- Pipeline compliance: ✅ 所有变更在 impl-* 分支。

## 验证脚本

验证脚本（SHOULD-FIX 直测 + batch_ids/aggregate_exit 断言）临时置于 `/tmp`，运行后已删除（本 Phase 约束「临时脚本放临时目录验证后删除」）。可复现命令已完整记录在本报告 §独立验证场景 / §SHOULD-FIX 复核，核心提取方式：

```bash
SCRIPT="apps/vscode-dsh/test-scripts/run-vscode-dsh-e2e-closure.sh"
eval "$(sed -n '86,114p' "$SCRIPT")"   # batch_ids + count_items
eval "$(sed -n '121,160p' "$SCRIPT")"  # severity_of + conclusion_of + aggregate_exit
# 随后按 §独立验证场景 表格逐条断言
```

## 结论

Phase 4 交付物（`run-vscode-dsh-e2e-closure.sh` 全链编排入口、`run-chat-ready-regression.sh` 方案 C 处置、DEBT-6 基座孤儿清理、registry 收尾）全部验收标准通过：AC-12 回归护栏未破坏、AC-13 资产归属正确、AC-14 诚实报告、AC-7 journal 机制（静态 + 单项真机 smoke）验证、AC-5 基座契约复用未重建。两处 SHOULD-FIX 修复经 22 项断言直测通过。未闭环能力缺口已按 AC-15 如实登记为「后续 feature」转交，非本 Phase 缺陷。
