# Phase 3 — 调度者独立核验留存（round 3）

> **本文件是调度者（Cursor Agent）自己的产物**，不属于任何 reviewer agent。
> 用途：记录在合并 4 份 `review-*.md` 之前，调度者**亲自跑过**的核验及其原始输出，
> 以便合并判决可追溯、且不必依赖任何 agent 的自述。
> 创建时间：2026-09-17（round 3，即四次修复后、四视角复审期间）

---

## 0. 为什么有这份文件

本轮出现一个反复的形态：**lint 漏网由非 reviewer 的角色发现**（`D16` ← verifier round-1、`D17` ← verifier round-3、本次 `@stylistic(comma-dangle)` ← connectivity reviewer）。
这说明「逐点抓」的方法学不可靠，故本轮调度者改用**穷尽扫描**，并把结果独立留痕，不转述任何 agent 的结论。

---

## 1. 穷尽 lint 扫描（调度者一手执行）

**口径**：`npx tsx scripts/run-oxlint.ts <显式路径>`。
**理由**：全仓口径受 768 个既存未跟踪构建孪生影响、跨树不可比（见 `DEBT-018` / `implementation.md` D18(C)），故一律用显式路径。

### 1.1 本 Phase 全部 `.cjs` 资产

| 文件 | error 条数 |
|---|:--:|
| `apps/vscode-dsh/test-scripts/layer-v-driver/extension.cjs` | 0 |
| `apps/vscode-dsh/test-scripts/layer-v-driver/sandbox-clean-state.cjs` | 0 |
| `apps/vscode-dsh/test-scripts/layer-v-support/artifact-index.cjs` | 0 |
| `apps/vscode-dsh/test-scripts/layer-v-support/build-freshness.cjs` | 0 |
| `apps/vscode-dsh/test-scripts/layer-v-support/display-evidence.cjs` | 0 |

> 佐证 override 生效（非空跑）：`extension.cjs` 单跑报 `Finished … on 1 file with 110 rules`（配置基线为 **90** 条）。

### 1.2 本 Phase 改动的 4 个既有 spec（`DEBT-014`–`DEBT-017` 之外的 54 条 `no-unsafe-*` 目标）

| 文件 | error 条数 |
|---|:--:|
| `apps/vscode-dsh/tests/host-diagnostics.spec.ts` | **0** |
| `apps/vscode-dsh/tests/node-env-guard.spec.ts` | **0** |
| `apps/vscode-dsh/tests/session-host.spec.ts` | **0** |
| `apps/vscode-dsh/tests/layer-v-inject-disconnect.spec.ts` | **0** |

⇒ implementer 声称的「54 条清零」在调度者独立口径下**成立**。

### 1.3 本 Phase 新增的 4 个 spec

| 文件 | error 条数 |
|---|:--:|
| `apps/vscode-dsh/tests/artifact-index.spec.ts` | 0 |
| `apps/vscode-dsh/tests/build-freshness.spec.ts` | 0 |
| `apps/vscode-dsh/tests/sandbox-clean-state.spec.ts` | 0 |
| `apps/vscode-dsh/tests/display-evidence.spec.ts` | **1** |

**唯一残留诊断（调度者独立复现，原文输出）**：

```
apps/vscode-dsh/tests/display-evidence.spec.ts:40:57: error @stylistic(comma-dangle): Missing trailing comma.
```

**定位**（`sed -n '38,42p'` 原文）：

```ts
const require = createRequire(import.meta.url)
const { measureFrames, judgeEvidence, MIN_DISTINCT_MD5 } = require(
  '../test-scripts/layer-v-support/display-evidence.cjs'   // ← :40，行尾缺 trailing comma
) as {
```

**结论**：本 Phase 向仓库**新增的 lint 诊断恰为 1 条**（`display-evidence.spec.ts:40:57`）。

> ⚠️ **调度者自我更正（同日，读取 `spec.md` 原文后）**：本文件初稿曾写「该诊断**直接违反** `spec.md` 回归行第三子项」——**该措辞过度，已撤回**。
> 回归行第三子项的**字面量程**是「`pnpm run lint` **不因新增 `test-scripts/**` 或新增 hooks** 失败」；
> 而 `display-evidence.spec.ts` 位于 `apps/vscode-dsh/tests/`，**既不是** `test-scripts/**`、**也不是** hook
> ⇒ 它**不违反**该子项的字面量程。
> **U-a 依然成立**，但成立的理由是**另一条**：该诊断属用户裁定的 lint 范围（「本 Phase 自己制造的 lint 问题」），
> 且本 Phase 新增文件向仓库**净增 1 条诊断**这一**事实**不因 AC 措辞而消失 —— **不得**用「AC 没覆盖」当免罚理由。

**发现来源如实标注**：`review-connectivity.md` 🟡-2。调度者已独立复现（上列命令与输出）。
**另记**：这是本 Phase 第 3 次「lint 漏网」（前两次为 `D16` / `D17`，均由 verifier 发现），
三次的共同点 = 诊断落在**本 Phase 新增/改动行**上，而 reviewer 的审查口径未系统性覆盖 lint。

### 1.4 附：`lint` 链路的真实 config（调度者一手核实 —— 修正一处 prior 误述）

> **动机**：`tech-debt-registry.md` 的 `DEBT-018` 条目把工具链写作
> 「工具链 = `package.json:31` `lint` → `scripts/run-oxlint.ts` → **`.oxlintrc.staged.json`**」。
> 若该表述为真，则新增在 `.oxlintrc.json` 的 `.cjs` override **不在门禁链路上** ——
> 那正是本 Phase 反复出现的「脚本写了但不在执行路径上」形态。故必须核实。

**核实结果：该表述对 `lint` 链而言是错的（张冠李戴）。**

| 链路 | 实际 config | 证据 |
|---|---|---|
| `pnpm run lint` | **`.oxlintrc.json`**（oxlint 默认发现） | `lint = 'npm run build:lib:host && npm run lint:contracts-ready'`；`lint:contracts-ready = 'tsx scripts/run-oxlint.ts .'` —— **无 `--config`** |
| `scripts/run-oxlint.ts` | 纯透传，**不开** config | 全文只做 `spawnSync(oxlint, args)`；无 `--config` 注入逻辑 |
| pre-commit（lefthook） | `.oxlintrc.staged.json` | `lefthook.yml:21` = `tsx scripts/run-oxlint.ts --config .oxlintrc.staged.json --fix …` |
| `lint:fix:contracts-ready` | `.oxlintrc.staged.json`（仅 fixture 目录） | `package.json:34` |

⇒ **`.oxlintrc.json` 的 `.cjs` override 确实在 `pnpm run lint` 链路上（生效）**，
`DEBT-018` 的 `.cjs` 半**不是**「写了没接线」。独立佐证：correctness reviewer 在默认发现口径下实测
`number_of_files: 5`、`number_of_rules: 110`（registry 旧文声称的 90 是**另一份** profile 的数字）。

**同时暴露的残余（供 U-c 裁定）**：`.oxlintrc.staged.json`（**pre-commit profile**）
`ignorePatterns` 含 `**/*.js` / `**/*.mjs`（**不含** `**/*.cjs`），且**无任何 override** ⇒
提交 `.cjs` 文件时该 profile **仍无法对其产生任何诊断**（即「0 诊断 ≠ 干净」的老机制在 pre-commit 路径上**依然存在**）。
**边界**：§4.1 的选项 (a) 只要求接入「`pnpm run lint` **或** `check:ci:static`」——
pre-commit profile 属**第三条**链路，未被 §4.1 点名 ⇒ 本条**不构成**选项 (a) 未达成，
但它是「`DEBT-018` 是否可关闭」的一个**须由用户知情**的事实。

---

## 2. `build-freshness` 覆盖缺口（对 `review-connectivity.md` 🟡-1 的独立核验）

### 2.1 事实

`assert_build_freshness()`（`run-layer-v-smoke.sh:1144`）的实际比较集：

```1144:1148:apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh
assert_build_freshness() {
  local verdict problem
  verdict="$("${NODE_TOOL}" "${BUILD_FRESHNESS_MODULE}" "${APP_DIR}/lib" "${APP_DIR}/lib/extension.js" "${APP_DIR}/src" 2>/dev/null || true)"
  if [ -z "${verdict}" ]; then
```

即只比对 **`apps/vscode-dsh/lib` × `apps/vscode-dsh/src`** 这一对。

但同函数的失败提示（`:1165`）指向的是**另一半**：

```
run `pnpm run build:lib:host` (or `cd apps/vscode-dsh && pnpm run build:host`) before this smoke
```

`build:lib:host` = `tsc -b tsconfig.host.json && tsdown --env.DSH_BUILD_FACE host` —— 它构建的是 **workspace 包**。

### 2.2 调度者实测：另一半产物真实存在

```
$ find . -path '*/.git' -prune -o -path '*/lib/*' -name '*.js' -newermt '2026-09-17 00:00' -print | head
./vendor/logger-console/lib/browser.js
./vendor/loader/lib/index.js
./vendor/group/lib/index.js
./vendor/cordis/lib/index.js
./packages/ide/ide-bridge/lib/index.js
./packages/interaction/user-questions/lib/index.js
```

⇒ workspace 运行时产物落在 `packages/**/lib/**` 与 `vendor/**/lib/**`，**存在且有今日 mtime**；
EDH 运行时加载它们。**它们不在 `assert_build_freshness` 的比较集内。**

### 2.3 与 `DEBT-014` 关闭的关系（**需用户裁定**）

`DEBT-014` 的诉求原文是「**脚本的 PASS 无法自证对应哪一份 bundle**」。
app 半已覆盖、**workspace 半未覆盖** ⇒ 该诉求**只解决了一半**，
但 `tech-debt-registry.md` 已把 `DEBT-014` 迁入「已解决」。

**调度者立场**：本条存在一个内部不一致 —— **提示你跑的命令，其产物不在校验范围内**。
故「已解决」的登记**可能过早**。但它是否属本 Phase 必须完成，取决于对 `DEBT-014` 范围的解读，
属**范围判断**，故调度者**不代裁**，留待 HG-3 由用户裁定（选项见 §4）。

**边界声明**：调度者**未**独立验证「EDH 运行时确实加载 `packages/**/lib`」这条因果链的每一跳
（只验证了产物存在 + 被 `.gitignore` 的 `lib/` 规则忽略 + 构建命令的语义）。若用户需要，可另行取证。

---

## 3. 其它已核验事项（结论：无问题）

| 事项 | 调度者核验方式 | 结论 |
|---|---|---|
| `tech-debt-registry.md` 表格完整性 | **只数未被反斜杠转义的管道符**（`(?<!\\)\|`）逐行比对：活跃表各行恒 **13 列**、已解决表各行恒 **6 列** | 活跃表**无**残缺行；implementer 自曝的「搬移时吞掉 `DEBT-013` 后半截」已恢复（该行 13 列齐备、尾部字段完整）。**例外**：`DEBT-010` 在已解决表下占 **7 列** → 见 **U-d** |
| 调度者自身查法的更正（留痕） | 首次核验时用 `awk` 数管道符，**漏了还原 `\|` 转义**，一度把 `DEBT-018` 读成「16 列」（该行确含 `rg 'shellcheck\|shfmt'` 这类转义）→ 误判为自己编辑引入了缺陷 | **实为查法不一致**。改用 `(?<!\\)\|` 负向断言后，`DEBT-018` = 13 列，**与同类行一致** ⇒ 调度者的 registry 编辑**未**破坏表格 |
| `.oxlintrc.json` 的 `.cjs` override 是否真生效 | `npx oxlint --config .oxlintrc.json …/extension.cjs` → `on 1 file with 110 rules`（基线 90）、0 error | 生效，非空跑 |
| `.sh` 是否可被 oxlint 读取 | `npx oxlint --config .oxlintrc.json …/run-layer-v-smoke.sh` → `No files found to lint` | **不可** ⇒ 新增的 `bash -n` gate 是对症补充而非重复 |
| `check-test-scripts-syntax.sh` 是否可执行 | `bash scripts/check-test-scripts-syntax.sh` → `check-test-scripts-syntax: 3 shell asset(s) parse`，exit **0** | 可执行且通过 |
| `DEBT-018` 归属冲突 | 见 `scope-amendment-02.md` §7 | **已结清**：冲突源为调度者派单，四项配置改动来自 10:38–10:40 中断轮、按 §4.1 已授权 → 保留 |

---

## 4. 提交给 HG-3 的未决项（调度者不代裁）

| # | 未决项 | 为什么需要用户 |
|---|---|---|
| **U-a** | `display-evidence.spec.ts:40:57` 的 1 条 `@stylistic(comma-dangle)` 是否本轮修 | 一行改动、零行为影响。**理由已更正**（见 §1.3 的自我更正）：它**不违反** AC-25 回归行子项的字面量程（该子项只管 `test-scripts/**` 与 hooks，而此文件在 `tests/`），但**它确实是本 Phase 新增文件向仓库净增的 1 条诊断** ⇒ 落在用户裁定的 lint 范围内。**不得**以「AC 未覆盖」为由免罚 |
| **U-b** | `DEBT-014` 的 workspace 半覆盖缺口：立即补全 / 保留 app 半 + 残余登记 / 接受现状 | 属**范围判断**：`DEBT-014` 诉求原文「脚本的 PASS 无法自证对应哪一份 bundle」只解了一半（app 半已覆盖、`packages/**/lib` + `vendor/**/lib` 未覆盖），但条目已登记为「已解决」 |
| **U-c** | `DEBT-018` 的最终登记状态（`bash -n` 是否足以关闭；`shellcheck`/`shfmt` 残余如何命名；**pre-commit profile 残余是否另立条目**） | `bash -n` 满足 §4.1 选项 (a) 的「仓库**自选**的 shell 解析器」，但 §5:124 又**明文排除**了那两个工具。**本轮新增事实（§1.4）**：`.cjs` override 确在 `pnpm run lint` 链路上且生效（§4.1 选项 (a) **已达成**），但 **pre-commit profile `.oxlintrc.staged.json` 仍无 `.cjs` 规则** ⇒ 提交 `.cjs` 时它产生不了任何诊断；pre-commit 属**第三条**链路、未被 §4.1 点名。是否值得另立条目属范围判断 |
| **U-d** | `tech-debt-registry.md` 的 `DEBT-010` 行**表格结构缺陷**（本 Phase 搬表引入） | 该行在**已解决表（6 列表头）**下占 **7 格** —— 其「描述」被一个**未转义的 `\|`** 切成两格（字段 3 尾「…失败边界」/ 字段 4 首「给 `HostDiagnosticRecord.phase` 增加…」），渲染会**整体错位一列**。HEAD 版本中该行在**活跃表（13 列）**，说明缺陷产生于本 Phase 的**搬表重写**。**修法**：把该分隔符替换为 `\|`（转义）或语义分隔符（如 `；`），文本零丢失。**调度者已暂缓执行** —— 设计 reviewer 正在读该文件，避免读写竞态；待其返回后修复 |

---

## 5. 范围声明

- 本文件**只**记录调度者亲手执行的命令与结论；**未**转述任何 agent 的自述作为结论。
- 调度者**未**修改任何代码 / 测试 / 脚本 / 配置文件。
- 调度者**未**执行任何 git 操作（本 Phase 工作区内改动仍未提交，待 HG-3 用户确认后统一提交）。
- 本文件**不**构成判决；判决以合并后的 `review.md` 为准。
