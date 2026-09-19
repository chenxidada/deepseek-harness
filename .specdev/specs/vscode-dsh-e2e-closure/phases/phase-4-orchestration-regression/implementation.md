# Phase 4 实现摘要：全链编排、回归护栏与 registry 收尾

## 变更清单

| 文件 | 状态 | 说明 |
|------|:--:|------|
| `apps/vscode-dsh/test-scripts/run-vscode-dsh-e2e-closure.sh` | 新增 | 全链编排入口（AC-13 落在 `test-scripts/`） |
| `apps/vscode-dsh/test-scripts/run-chat-ready-regression.sh` | 修改 | 头部加过时标注注释（方案 C，AC-12） |
| `apps/vscode-dsh/test-scripts/run-layer-v-capabilities.sh` | 修改 | `rm -f` 一并清理 base 兜底 status/journal（DEBT-6） |
| `.specdev/specs/vscode-dsh-e2e-closure/tech-debt-registry.md` | 修改 | DEBT-2/3/8/10 改目标、DEBT-6 移已解决、新增 DEBT-11 |
| `.specdev/specs/vscode-dsh-e2e-closure/artifact-index.md` | 修改 | Produces 说明指向新编排入口 |

## 对每个验收标准的实现说明

### AC-12 — 既有回归不得破坏（含方案 C 决策）

`run-chat-ready-regression.sh` 现状引用的 10 个测试文件（`chat-ready-regression.spec.ts` /
`auto-start-orchestrator.spec.ts` / `phase1-auto-start.spec.ts` / `phase2-auto-ready.spec.ts` /
`phase3-chat-ui-chassis.spec.ts` / `phase4-new-conversation-chrome.spec.ts` /
`phase5-should-polish.spec.ts` / `phase3-restart-continue.spec.ts` /
`phase2-multitab-history-replay.spec.ts` / `panel-close-delete.e2e.spec.ts`）已被
`vscode-dsh-test-consolidation` 工作流归并为 `apps/vscode-dsh/tests/cap-*.spec.ts`，脚本本身已死。

按调度者决策采用**方案 C（原位标记 obsolete + 登记，不删除、不修复、不改守卫）**：

- 文件保留（`existsSync` 仍为 true），头部 `set -euo pipefail` 之前加过时标注注释，只标注、不改逻辑。
- 注释说明：10 个引用文件已归并为 `cap-*.spec.ts`，回归职责由
  `pnpm exec vitest run apps/vscode-dsh/tests` 覆盖，不再单独维护。
- 4 处已完成工作流守卫引用（`cap-test-harness.spec.ts` CAP-TEST-HARNESS-083、
  `scripts/check-test-scripts-syntax.sh` pinned、`tests/capability-domains.json` :20/:657、
  `apps/vscode-dsh/README.md`+README.zh.md :22）保持原样，未改动。
- 新增 `DEBT-11` 登记清理跟进（见下）。

`run-layer-v-smoke.sh` 本次未改动，其显示/Node/沙箱/凭证/进程回收/退出码契约原样保留（AC-5）。

### AC-13 — 真机脚本落在 `test-scripts/`

新增编排入口 `apps/vscode-dsh/test-scripts/run-vscode-dsh-e2e-closure.sh` 位于 `test-scripts/`，
未向 `apps/vscode-dsh/tests/` 写入任何临时脚本。

### AC-14 — 如实报告、不美化

registry 中 Phase 2/3 已登记的未闭环条目（DEBT-7 webview 内部可观测性、DEBT-8 history/streaming
模型往返、DEBT-9 selection-ask 误报、DEBT-10 subagent 真实委托）如实保留为「后续 feature」，
未将 `panelOpen`/`viewId` 等弱证据重定义为 closed。本 Phase 新增的 `DEBT-11`（过时脚本待清理）
也如实登记，不静默留破。

### AC-7 / AC-5 — 复用基座，不重建

编排入口**不重建**任何判定逻辑或 journal 能力：每个 batch 是一次独立的
`run-layer-v-capabilities.sh` 调用，per-run 隔离、machine-readable JSONL journal 逐步追加、
退出码 0/1/2/3/4 映射、closure 汇总全部由既有脚本继承。编排入口只做三件编排之外的事：
① 按 `requiresModel` 分两批（18 nonmodel + 23 model）；② 跨 batch 退出码聚合（见下）；③ 通过共享
`layer-v-support/artifact-index.cjs` 模块（smoke 脚本同一模块）为每个 batch 追加一行 index。

## 关键实现说明

### 跨 batch 退出码聚合

能力驱动的 `CONCLUSION_PRECEDENCE`（HARNESS_ERROR > LINK_FAILURE > SKIPPED_NO_CREDENTIALS > PASS）
没有 `SKIPPED_NO_DISPLAY(2)` 的槽位（该码由 shell 自行解析），编排入口因此显式定义跨 batch 的
worst-first 顺序：

```
4 HARNESS_ERROR > 1 LINK_FAILURE > 2 SKIPPED_NO_DISPLAY > 3 SKIPPED_NO_CREDENTIALS > 0 PASS
```

理由：真实 link 失败（真回归）必须压过任何 skip；无显示（2）压过无凭证（3）——无显示时什么都跑不了，
无 key 时只阻塞 model 批。未知退出码（硬崩溃而非契约五值之一）按最严重处理（fail-closed），
不假装干净。聚合只取「最坏」单码，不做数值合并、不降级、不猜测。

### 按 `requiresModel` 动态分批

batch 成员从 `layer-v-capabilities.json` 的 `requiresModel` 字段实时派生，不硬编码 id 列表，
因此 manifest 增删能力时不会出现「脚本跑的能力与实际 manifest 不一致」的静默漂移。
实测 `--list` 输出：nonmodel 18 项、model 23 项，合计 41 项，与 manifest 一致。

### artifact-index 行

每 batch 跑完后从该 batch 写出的 plan（`layer-v-capabilities-plan.json`）定位 runId 与 artifact
目录，读 summary/status 拼出 `| run(UTC) | artifact dir | conclusion | exit | closure → files |`
行，经 `artifact-index.cjs append` 落盘。batch 未到 `write_plan`（无显示跳过 / node/preflight 失败）
时，plan 缺失，行以 shell 自身 conclusion/exit 记录、closure 记为 `—`，保证 skip/fail 可见而非消失。

## 测试结果

```
$ bash -n apps/vscode-dsh/test-scripts/run-vscode-dsh-e2e-closure.sh   # OK
$ bash -n apps/vscode-dsh/test-scripts/run-chat-ready-regression.sh    # OK
$ bash -n apps/vscode-dsh/test-scripts/run-layer-v-capabilities.sh     # OK

$ bash scripts/check-test-scripts-syntax.sh
check-test-scripts-syntax: 7 shell asset(s) parse
# exit 0

$ bash apps/vscode-dsh/test-scripts/run-vscode-dsh-e2e-closure.sh --list
nonmodel (18) …  model (23)  → 合计 41 项，与 manifest 一致
```

- 真机全量编排（AC-14/15 运行时、AC-7 崩溃定位）需真实 `DEEPSEEK_API_KEY` + 显示环境，属 verifier
  独立验证职责；脚本已就绪可被 verifier 直接驱动。
- `git status` 确认 `run-chat-ready-regression.sh` 为 `M`（头部注释），非 `D`（删除）。

## 偏差记录

### 偏差 1 — AC-12 采用「标记过时 + 登记」替代「修复或归档」

- **偏差描述**：`run-chat-ready-regression.sh` 未按 spec 验证策略的「若已归档则 git status 显示删除/移动」
  执行删除/归档，而是原位加 obsolete 注释 + 登记 `DEBT-11`（方案 C）。
- **影响范围**：spec.md §验证策略 AC-12 行「若已归档则确认 git status 显示删除/移动且无残留引用」；
  约束段「run-chat-ready-regression.sh 处置二选一（修复…或标注 obsolete 归档）」。
- **原因**：该脚本被 4 处已完成工作流资产守卫引用（`cap-test-harness.spec.ts` CAP-TEST-HARNESS-083、
  `scripts/check-test-scripts-syntax.sh` pinned、`tests/capability-domains.json`、README），
  删除会破坏已完成工作流的回归（`existsSync` 断言失败）；修复引用则重复既有 `cap-*.spec.ts` 覆盖
  且指向异工作流 registry（`vscode-dsh-chat-ready`）。「不在本 feature 回归」原则下，标记过时 + 登记
  是唯一既不破坏既有回归、又不静默留破的诚实落案。
- **影响**：`git status` 中该文件呈现 `M` 而非 spec 字面的 `D`；对下游 reviewer/verifier 的影响是
  验证断言应从「删除」调整为「文件仍在 + 头部 obsolete 注释 + DEBT-11 已登记 + bash -n 通过」。
  该决策已由调度者明确下达，属授权偏差。

### 偏差 2 — 真机运行时验证未在本 Phase 执行

- **偏差描述**：AC-7 / AC-14/15 的运行时（真机）验证（journal 崩溃定位、全量 closedLoop 汇总）未由
  implementer 执行。
- **影响范围**：spec.md §验证策略 AC-7 / AC-14/15 行。
- **原因**：真机编排需真实 `DEEPSEEK_API_KEY` + 显示环境，且「独立运行验证」是 verifier 职责
  （调度者不得自己跑验证、implementer 不替 verifier 下结论）。
- **影响**：编排脚本已交付且 `bash -n`/`--list`/语法 gate 全过，由 verifier 在下一阶段独立驱动真机验证。

## Review 修复（SHOULD-FIX，续做）

四视角 review 合并判决 SHOULD-FIX，其中 2 处代码缺陷已在
`run-vscode-dsh-e2e-closure.sh` 内修复（第 3 处为 design.md 文档，由调度者回写，不在本处）。

### 修复 1 — `batch_ids` 派生失败未检查 → manifest 损坏静默 PASS（reviewer-correctness）

- **缺陷**：`batch_ids` 通过 `node -e 'JSON.parse(...)'` 实时派生批次 id，`run_batch` 只判断
  `[ -z "${ids}" ]`，不检查 node 子进程退出码。manifest 损坏（JSON 语法错误）时 node 非零退出、
  stdout 为空 → `ids=""` → 两批均走「nothing to run」并 `return 0` → 聚合 exit 0（PASS）。
  属 fail-open，违背「如实报告真机实际运行结论」目标。
- **修复**（方案 a）：
  - `batch_ids` 捕获 node 退出码（`status=$?`），非零则 `printf` HARNESS_ERROR 到 stderr 并
    `return 4`；
  - `run_batch` 在 `ids="$(batch_ids ...)"` 后立即检查 `status=$?`，非零则 `return 4`（HARNESS_ERROR），
    随聚合自然落到 exit 4。
- **边界**：manifest 合法但该 label 确实零能力（node 退出 0、stdout 空）仍走原「nothing to run」
  `return 0`，**不**误报 HARNESS_ERROR —— 符合「nonmodel 18 + model 23 恒非空，若为空不得误报」的要求。
- **验证**：构造损坏 manifest（`{ "capabilities": [ {broken json`）后 `batch_ids nonmodel` 返回 4、
  stderr 含 HARNESS_ERROR；`run_batch nonmodel` 返回 4；`{ "capabilities": [] }` 合法空清单返回 0 空串。

### 修复 2 — `aggregate_exit` 未知退出码未归一化（reviewer-connectivity）

- **缺陷**：`severity_of` 对未知退出码（硬崩溃如 137）返回 severity 4（与 HARNESS_ERROR 平手），但
  `aggregate_exit` 存 `worst_code` 原始值，平手且未知码 batch 先出现时原样吐出 137 之类非契约码，
  违反「退出码 0/1/2/3/4」五值契约。
- **修复**：`aggregate_exit` 选出 worst 时对 `worst_code` 归一化 —— 仅当码 ∈ {0,1,2,3,4} 原样保留，
  其余一律记 4（HARNESS_ERROR）。`severity_of` 语义（rank 映射）不变。
- **验证**：`aggregate_exit 137 4` / `4 137` / `137` / `130` 均返回 4；`0 2`→2、`1 3`→1、`3 2`→2、
  `0`→0，正常码不受影响。

### 验证汇总

```
$ bash -n apps/vscode-dsh/test-scripts/run-vscode-dsh-e2e-closure.sh   # OK
$ bash scripts/check-test-scripts-syntax.sh                             # 7 shell asset(s) parse, exit 0
（构造损坏 manifest 的 fail-closed 自测与 aggregate_exit 归一化自测均通过，临时文件已清理）
```
