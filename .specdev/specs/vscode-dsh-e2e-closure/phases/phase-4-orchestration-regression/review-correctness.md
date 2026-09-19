# Correctness Review — Phase 4

## 视角
**Implementation Correctness** — 代码是否正确工作

## 判决
**SHOULD-FIX**

## 逐条 AC 验证

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-12 | 既有回归不得破坏；chat-ready 脚本处置如实 | `run-chat-ready-regression.sh:6-16`（头部 obsolete 注释） | ✅ | `git status` 显示该文件为 `M`（非 `D`）；头部 `set -euo pipefail` 之前新增 OBSOLETE 注释，逻辑零改动（`bash -n` 通过）；`run-layer-v-smoke.sh` 未出现在 `git status`（未改动） |
| AC-13 | 真机脚本落 `test-scripts/`，不污染 `tests/` | `run-vscode-dsh-e2e-closure.sh`（新文件） | ✅ | 新编排入口位于 `apps/vscode-dsh/test-scripts/`（`git status` 为 `??`）；`git status -- apps/vscode-dsh/tests` 无临时脚本残留 |
| AC-14 | 如实报告，不美化、不为绿灯放宽断言 | `tech-debt-registry.md`（DEBT-7/8/9/10/11） | ✅ | DEBT-7/8/9/10 如实保留「未闭环/已知缺陷」并指向「后续 feature」，未把 `panelOpen`/`viewId` 弱证据重定义为 closed；新增 DEBT-11 登记过时脚本，不静默删除；`layer-v-capabilities.json` 未被改动（无断言放宽痕迹） |
| AC-7 | 运行逐步追加 JSONL journal | 复用 `run-layer-v-capabilities.sh`（`appendJournal`） | ✅ | 编排入口每个 batch 是一次完整 `run-layer-v-capabilities.sh` 调用（`run_batch:238`），journal 逐步追加机制（`extension.cjs:66-73` `appendJournal` + `capability-runner.cjs:504-506` 每步 emit）原样继承，未重建 |
| AC-5 | 复用基座，退出码契约不改 | `run-layer-v-capabilities.sh:419-431`（case 映射） | ✅ | `layer-v-runtime.sh` / `primitives.cjs` 均未出现在 `git status`（未改动）；退出码 case 映射 0/1/2/3/4 原样；`assessClosedLoop` 未被编排入口重定义（仅注释提及，实际复用 `capability-runner.cjs:417`）；`CONCLUSION_PRECEDENCE` 复用 |

## Stub Detection（桩代码检测）

### 已注册桩（对照 registry）
| Registry ID | 文件:函数 | 状态 | 说明 |
|-------------|-----------|:--:|------|
| DEBT-11 | `run-chat-ready-regression.sh`（全文） | ⚠️ Known | 已登记为过时脚本待清理（方案 C），非新发现 |

### 新发现的未注册桩
无。本 Phase 范围内未发现未登记的桩 / 空壳函数 / 假返回值。

## 关键发现

### 🔴 Must-Fix
（无）

### 🟡 Should-Fix

1. **`batch_ids` 失败未被检查 → manifest 损坏时静默 PASS（fail-open）**
   - 位置：`run-vscode-dsh-e2e-closure.sh:227-231`（`ids="$(batch_ids "${label}")"` → `[ -z "${ids}" ]` → `return 0`）
   - 现象：`batch_ids` 通过 `node -e 'JSON.parse(readFileSync(manifest))'` 实时派生批次（`:88-95`）。若 `layer-v-capabilities.json` 因 typo/坏合并而 JSON 损坏，node 抛 `SyntaxError` 退 1，命令替换只捕获 stdout（空），`ids=""` → 两个 batch 均走「selected no capabilities; nothing to run」并 `return 0`，最终聚合 `exit 0`（PASS）。
   - 后果：0 项能力实际运行，却返回 PASS 退出码 —— 与本工作流「如实报告真机实际运行结论」的核心目标、以及仓库 fail-closed 哲学直接相悖。stderr 会打印 `SyntaxError`，但退出码仍为 0。
   - 建议：`preflight` 中校验 manifest 可被 `JSON.parse`（或检查 `batch_ids`/`count_items` 的退出码，非零即 `HARNESS_ERROR` exit 4）。成本极低，收益是消灭一个 fail-open 盲点。

### 🟢 Observations

1. **`build_closure_row` 无 plan 时 artifact dir 列显示 `` `—/` ``（尾斜杠）**：`run-vscode-dsh-e2e-closure.sh:166` 的 `rel()` 对空值返回 `—`，但行模板 `` `\`${rel(artifactDir)}/\` ``（`:204`）仍追加 `/`，故 skip/fail 行的 artifact dir 列呈现 `` `—/` ``。纯外观瑕疵，不影响结论/退出码/聚合。
2. **未知退出码（硬崩溃/信号）返回原始码而非归一为 4**：`severity_of` 对 `*` 给 severity `'4'`（`:121`），但 `aggregate_exit` 存的是 `worst_code="${code}"`（原始码，`:144`），故 batch 被 SIGINT/SIGTERM 杀（130/143）时聚合返回 130/143 而非 4。`conclusion_of` 相应打印 `UNKNOWN`。这仍是 fail-closed（非零），但 `print_help` 声明的「退出码 0-4」与信号死亡的原始码存在轻微不一致。可接受，仅记录。
3. **`set -uo pipefail`（无 `-e`）是有意为之且正确**：编排入口需捕获每个 batch 的 `$?` 做聚合，`-e` 会在 model 批 exit 3 时提前终止脚本、跳过聚合。当前写法正确，非缺陷（记录以排除误判）。

## 结论

主路径（有效 manifest、两批正常/跳过、跨 batch 聚合、索引行拼接、DEBT-6 清理）均正确实现且 `bash -n` 全过；AC-12/13/14/7/5 逐条核验通过，退出码聚合 worst-first 顺序正确（含 `SKIPPED_NO_DISPLAY=2` 显式插槽），无未登记桩、无产品代码改动。唯一实质性缺口是 `batch_ids` 失败未被检查导致的 manifest 损坏静默 PASS（fail-open），属错误路径边界未覆盖，判 **SHOULD-FIX**。
