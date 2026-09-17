# Correctness Review — Phase 3（第 3 轮复审 · round-5 改动）

## 视角
**Implementation Correctness** — 代码是否正确工作。只审实现正确性；设计一致性 / 集成连通性 / 视觉分别由并行视角负责。

## 判决：PASS

> **被审对象**：分支 `impl-phase-3-layer-v-smoke-loop` 上 round-5 implementer 的改动（任务 A/B/C/D，见 `implementation.md` §7.8 / §8.1a / §8.2a / §10.2 与 D25–D34）。
> **本轮方法**：不采信自述。凡「修复真实性 / 可失败性 / fail-closed」三类主张，一律以**执行 shipped 代码**（模块 CLI、shell 探针、真实运行产物）或**变异测试**取证；静态交叉核对只用于补充。
> **自清理**：直接路径上已存在的上一份同名报告（17:37 写入，属并行的另一次派发）已按启动自清理协议归档为 `.archive/review-correctness-20260917T094023Z.md`（`mv`，未删除、未动 git、未动 `current-status.json`）。两份判决一致（均 PASS），无冲突需升级。

---

## 逐条 AC 验证（本轮改动相关面）

| AC / 债务 | 描述 | 实现位置 | 判定 | 独立证据（我执行的，非自述） |
|---|---|:--:|---|
| AC-26(e) | 同一运行 5 帧不同 md5 数 ≥ 3，且**实际数记账进运行产物** | `display-evidence.cjs:39/110`；`display-evidence-shell.sh:121-147`；`run-layer-v-smoke.sh:2676→2708` | ✅ | **真实运行 `20260917T093538Z-698103`**（round-5 期间产出）的 `layer-v-report-meta.json`：`displayEvidence = {criterion, minDistinctMd5:3, distinctMd5:5, frames:5, mode:"reuse", forced:false, action:"pass", reason:"AC-26(e) satisfied (distinct md5 = 5/5, floor 3)", attemptCount:1, retried:false, attempts:[{attempt:1, mode, forced, evidence:{ok:true, frames:5, md5:{5 个具体 hash}, distinctMd5:5, degenerate:false, action:"pass", reason}}]}`，`conclusion:"PASS"` / `exitCode:0`。写入链位于**每次结论必经的退出路径**：`exit_now():268 → finish():2903 → write_report_meta():2653 → display_evidence_record_json():2676`（不是可选分支）。对照：旧归档 `20260916T170431Z-2270421` 的 meta **没有**该块 ⇒ 该块确为本轮链路所产出 |
| AC-26(e) 消费侧 | 判决必须经变量而非 stdout 到达调用方（DEBT-017 核心） | `display-evidence-shell.sh:55-88`（stdout 空）、`run-layer-v-smoke.sh:283-286`（source）、`:3023`（直接调用） | ✅ | 独立探针（模拟调用方环境、真实 source 该模块）实测：`display_evidence_verdict` 的 stdout 为**空**，模块日志落在 stderr；动作只经 `DISPLAY_EVIDENCE_ACTION` 到达；`:65/:66` 只截取 node 自身两行 verdict。调用侧 `:3023` 为直接调用（无 `$( … )`），`:183-184` 注释与实测一致。调度者的变异（包进 `$( … )`）⇒ A5 测试红，见下 |
| AC-26(e) 四分支 | `pass` / `retry` / `skip` / `*` 四分支均可达且有承接 | `display-evidence-shell.sh:196-216` | ✅ | **模块侧用真实抓取的帧驱动**：`judge <archive/20260916T170431Z-2270421> reuse 0` → `retry`（distinct=2 < floor 3，理由同时引用 AC-26(e) 与 AC-28 R2.3）；`judge <当前运行目录> reuse 0` → `pass`（distinct=5）。`skip` / `fail-closed` 由真实帧目录配 `xvfb` / 非法 mode 触达。shell 侧四个 case 各置正确后果，`retry)` 于 `:202` 置 `DISPLAY_RETRY_REQUIRED="true"`；`*)` 于 `:213` `fail_harness`（fail-closed） |
| AC-26(e) 非 PASS 路径 | 非 PASS 结论不得被改写成 harness 错误（单向规则） | `display-evidence-shell.sh:192-194` | ✅ | 实测：driver 结论为 `LINK_FAILURE` 时只 `note` 并保持结论，`action=pass` 仍被记账；与 `record_evidence_violation` 同规则。A5 用例「非 PASS 保留原结论」可失败（变异 `*` 分支时转红） |
| AC-28 R2.3 | `reuse` 仅在能产出合格证据时采用；退化则换成本脚本自有的显示 | `display-evidence-shell.sh:201-205`；`run-layer-v-smoke.sh:3024-3026 / 3132-3146` | ✅ | 重试闭环：`:3024-3026` 为真则 `return` 回 `main` → `main:3137-3138` 落 note + `discard_attempt`（`:3084` 复位 flag）→ `:3142-3145` `DISPLAY_ATTEMPT ≥ 2` ⇒ `fail_harness`，否则 +1 重跑。**终止性双保险**：第二次尝试 `forced=true`，而模块仅在 `mode==='reuse' && !forced` 时返回 `retry` ⇒ 第二次不再请求重试，循环不可能自旋 |
| AC-26(e) 阈值 | `MIN_DISTINCT_MD5` `2→3` 的影响面 | `display-evidence.cjs:39`（唯一写值）、`:110`（唯一判据）、`:147`（文案）；`display-evidence-shell.sh:151-157`（从模块读取） | ✅ | 常量在模块内**仅** `:110` 被消费 ⇒ 影响面 = `distinct == 2` 的 `reuse` 运行。对**全部 17 个含完整 5 帧的归档**独立重算 md5：`distinct=1 ×9`、`=2 ×1`、`=5 ×7` ⇒ 只有 1 个运行（`20260916T170431Z-2270421`，实测 4 帧同 hash + 1 帧不同）由 `pass` 变 `retry`，其余 16 个判定不变。无「不该判退化却被判退化」的误伤（该运行确为 `reuse` 模式且确为退化帧）。shell 侧不重述该常量，而是 `:151-157` 向模块读取、空值即 `fail_harness` ⇒ 阈值与判据不可能漂移 |
| DEBT-014（workspace 半区） | `build:lib:host` 的 workspace 产物面也须纳入新鲜度比较，缺失/陈旧/不可读一律拒绝 | `build-freshness.cjs`（`evaluateSiblingFreshness` / 聚合分支）；`run-layer-v-smoke.sh:1175-1182` | ✅ | **执行 shipped 模块**：无 `lib` ⇒ `ok:false`；`lib` 早于 `src` ⇒ `ok:false`（stale）；`lib` 新于 `src` ⇒ `ok:true`；对缺/空/陈旧/类型错误（`lib` 是文件）四类变异均 `ok:false` 且原因码正确。**比较集与 `tsdown.config.ts:19` 逐项对齐**：shell 展开 `packages/*/*` + `vendor/*`（`:1175-1177`）成逐成员 `--sibling`（`:1178-1182`）；实测该两 tier 下 **257 + 9 = 266 个目录全部含 `package.json`**（`NO_PKG` 命中 0）⇒ 既无成员漏比、也无非成员被误纳入；app 由调用方按 `APP_DIR/lib` vs `src` 自比（`build-freshness.spec.ts` 有断言 `:355-357`），`apps/cli` 为有理由的排除（同文件断言 `:373-378`）。测试含反空跑护栏 `expect(members.length).toBeGreaterThan(3)` 与 `uncovered === []`（`:359-370`） |
| DEBT-017 可失败性 | 新增 A5 测试须真的驱动 shipped 模块与 shipped shell，且能失败 | `apps/vscode-dsh/tests/display-evidence-shell.spec.ts`（11 例） | ✅ | ① 该 spec 读取 `display-evidence-shell.sh` 本体并在 bash 中 source，**仓库内无逻辑复制品**（其自建的只有「调用方环境」这一测替身）。② **我自行设计的新变异**：把 `display_evidence_record_json` 的 `distinctMd5` 直接写成常量 ⇒ **4 条断言转红**，还原后 11/11 绿。③ 调度者的变异（`:3023` 包 `$( … )`）⇒ 1 红。⇒ 非恒真可失败 |
| DEBT-018（lint 门禁两半） | `.cjs` 半 + `.sh` 半均对本 Phase 新增资产可失败 | `.oxlintrc.json:341`；`scripts/check-test-scripts-syntax.sh` | ✅ | 执行 `bash scripts/check-test-scripts-syntax.sh` ⇒ `4 shell asset(s) parse` / 退出码 0 —— 第 4 个正是本轮抽出的 `display-evidence-shell.sh`，说明新 `.sh` 资产确被纳入解析门禁。`.oxlintrc.json:341` 的 `apps/vscode-dsh/test-scripts/**/*.cjs` override 覆盖仓库内 5 个 shipped `.cjs`（`find` 实测 5 个） |
| `spec.md:199`（洁净判据） | 沙箱 home 缺失 ⇒ 拒绝，不得退化为「空即干净」 | `sandbox-clean-state.cjs:homeSandboxOf`；`extension.cjs:2293-2299` | ✅ | 执行 shipped 模块：7 类不可用输入（缺字段 / 空串 / 绝对不存在 / 相对不存在 / number / null / 非对象）**全部 `ok:false`**；`staleProductState('')` 抛 `TypeError`。调用侧 `:2293-2299` `ok !== true` ⇒ `harnessError('sandbox-clean-state-check-unavailable')`；`harnessError` ⇒ `StageError('HARNESS_ERROR')` ⇒ `extension.cjs:2359-2377` 写入 `conclusion` ⇒ shell `:3042-3044` 映射**退出码 4**（非静默继续、非 PASS） |
| AC-33 / DEBT-016 | `artifact-index` 自断言可失败 | 本轮**未触碰**该链路 | ➖ 不适用本轮 | 沿用 round-4 证据；`git diff` 范围内无该文件改动。不作为本轮判定项 |

**测试面复核**：`npx vitest run`（5 个受影响 spec：`display-evidence-shell` / `display-evidence` / `sandbox-clean-state` / `build-freshness` / `scripts/oxlint-contract`）⇒ **5 passed / 85 tests passed**，退出码 0（含 dispatch 提及的 90s 级 `oxlint-contract.spec.ts`，本次已实跑，未跳过）。

---

## Stub Detection（桩代码检测）

### 已注册桩（对照 registry）

| Registry ID | 文件:函数 | 状态 | 说明 |
|---|-----------|:--:|---|
| `DEBT-014` | `build-freshness.cjs`（workspace 半区） | ⚠️ 活跃（如实保留） | 修复已在工作区且本轮**独立验证**成立；registry 将其保持活跃、以「独立验证完成」为关闭条件，属流程状态而非实现缺陷 |
| `DEBT-017` | `display-evidence-shell.sh`（消费侧） | ⚠️ 活跃（如实保留） | 同上：消费侧缺陷已解除（本轮实测），keep-active 是刻意保守 |

### 新发现的未注册桩

| 文件:函数:行号 | 当前行为 | 严重性 | 处理建议 |
|---|---------|:--:|---|
| — | 无 | — | 对 `test-scripts/**` 与本轮 4 个新 spec 复扫 `@STUB` / `TODO` / 空壳返回，零命中。`artifact-index.cjs` 的 `placeholderReplaced` 是 `## Runs` 表体占位符语义，非桩 |

---

## 关键发现

### 🔴 Must-Fix
- 无。

### 🟡 Should-Fix
- 无。功能契约均成立；未发现「能用但边界实质缺失」的项。

### 🟢 Observations
- **消费侧未对「模块存在但函数缺失」加 `declare -F` 守卫**，记录为纵深防御建议，**不列为 Should-Fix**，理由是三条独立防线已覆盖全部现实事故面：① 文件缺失 ⇒ `run-layer-v-smoke.sh:3097` preflight 直接 `HARNESS_ERROR`（退出码 4，且 `source` 在 `:283-286` 被 `-f` 守护，理由写在 `:281-282` 注释里）；② 语法错误 ⇒ `check-test-scripts-syntax.sh` 的 `bash -n` 门禁（DEBT-018 `.sh` 半）；③ 函数被删/改名或 `source` 行被删 ⇒ A5 spec 的行为用例与静态契约（`:423-438`）同时失败。注意 `set -u` 在此**不构成**守卫：`DISPLAY_RETRY_REQUIRED` 等在 `:161-167` 已全局初始化，故「未 source」不会触发 unbound variable —— 真正的守卫是上述 ①③。
- `display-evidence-shell.sh:61/66` 的 `DISPLAY_EVIDENCE_JSON` 在 `pass` / `retry` / `skip` 三个分支不被外部消费（仅 `*` 分支的错误证据与模块内部记账使用）。属接口冗余，非缺陷。
- `display-evidence-shell.spec.ts` 中 `expect(ACTIONS).toContain(summary.action)` 是**恒真断言**（`ACTIONS` 为常量表）；所幸紧随其后的精确值断言（`toBe('pass')` 等）才是有效断言，其余 10 例均可失败（已由两次变异验证）。记为零成本清理项，不参与判决。
- `mode==='reuse' && forced===true`（`:301-310` 对应分支）在生产路径不可达：`start_xvfb` 两条实现都会置 `DISPLAY_MODE="xvfb"`，故第二次尝试恒为 `xvfb`。属防御性分支且被 spec 直接驱动，无害，记录为事实。
- **变异测试的现场完整性**：我在 `display-evidence-shell.sh` 上施过变异并已还原；验证方式是「变异前的备份副本与工作区文件 md5 逐字节相同」（`/tmp/rc3/backup/display-evidence-shell.sh` ≡ 工作区 `dce5601d17f82eb91ab351022ff76f10`），另加残留标记 grep 零命中、5 个 spec 全绿。shipped 文件未留下任何改动。

---

## 偏离裁定：`scope-amendment-02.md` §8.1 第 3 项改用 `owned` 数组

**结论：`owned` 形态构成同等且更强的实现，不必升级用户重新裁定。**

理由（三级）：

1. **字面形态在此目录物理不可满足，且其断言对象与诉求无关**。§8.1 第 3 项要求补一行探针 `['vscode app test','apps/vscode-dsh/tests','apps/vscode-dsh/tests/tsconfig.json']`。而该 tsconfig 用**显式列举文件名**（`include` 9 项，无 glob），scratch 探针文件不在列举内 ⇒ 必须解析为 `<none>`（调度者 `OXC_LOG=debug` 实证）。即：该行的期望值与实现永不可能相等，只能靠「预期 `<none>`」写死 —— 而那就把契约从「归属正确」偷换成了「归属失败是常态」，与诉求**反向**。
2. **`owned` 形态把契约钉在真实对象上**：`scripts/oxlint-contract.spec.ts:120-123` 断言两个**确在该 tsconfig `include` 内**的真实 spec 归属为 `apps/vscode-dsh/tests/tsconfig.json`，`:124/148-150` 断言 `chat-ux-session-search.spec.ts`（确**不在** include 内）为 `<none>` 作为边界。诉求的实质是「使该文件类归属成为**被断言的契约**」——`owned` 直接断言承载 `no-unsafe-*` 风险的两个真实文件的归属，而探针只能断言一个临时文件的归属。
3. **它可失败，且失败面正确**：把任一新 spec 移出 `include`（或改名/移位）即令断言报 `Got tsconfig …: <none>`。此处也印证了第 2 点的**必要性**：这条断言的存在使 `apps/vscode-dsh/tests/tsconfig.json` 的 `include` 不再是无人看守的自由文本。

我判断无需升级：这是「按字面实现会得到一个恒红/恒真的空断言」时，用更强形态落实意图的正常工程判断；`implementation.md` D28 已如实披露并标注需调度者确认，属流程留痕而非实现缺陷。

---

## 复现命令（供 verifier / 调度者复核）

```bash
# AC-26(e) 记账（真实运行产物）
node -e 'const m=require("./apps/vscode-dsh/test-artifacts/layer-v/layer-v-report-meta.json");console.log(m.conclusion,m.exitCode,JSON.stringify(m.displayEvidence,null,2))'

# 四分支：用真实抓取的帧驱动 shipped 模块
node apps/vscode-dsh/test-scripts/layer-v-support/display-evidence.cjs judge \
  apps/vscode-dsh/test-artifacts/layer-v/.archive/20260916T170431Z-2270421 reuse 0   # → retry（distinct=2）
node apps/vscode-dsh/test-scripts/layer-v-support/display-evidence.cjs judge \
  apps/vscode-dsh/test-artifacts/layer-v reuse 0                                     # → pass（distinct=5）

# 归档运行的 distinct 分布（阈值影响面）
cd apps/vscode-dsh/test-artifacts/layer-v/.archive
for d in */; do n=$(ls "$d"step-*.png 2>/dev/null|wc -l); [ "$n" -eq 5 ] || continue; \
  md5sum "$d"step-*.png | awk '{print $1}' | sort -u | wc -l; done | sort -n | uniq -c
# → 9 个 distinct=1 / 1 个 =2 / 7 个 =5

# 比较集与 tsdown workspace 对齐
rg -n 'workspace:' tsdown.config.ts
for d in $(find packages -mindepth 2 -maxdepth 2 -type d) $(find vendor -mindepth 1 -maxdepth 1 -type d); do
  [ -f "$d/package.json" ] || echo "NO_PKG $d"; done   # → 无输出（266/266 均为真实成员）

# 门禁两半
bash scripts/check-test-scripts-syntax.sh                 # → 4 shell asset(s) parse / exit 0
rg -n 'test-scripts' .oxlintrc.json                       # → :341 override

# 受影响 spec 全量
npx vitest run apps/vscode-dsh/tests/display-evidence-shell.spec.ts \
  apps/vscode-dsh/tests/display-evidence.spec.ts \
  apps/vscode-dsh/tests/sandbox-clean-state.spec.ts \
  apps/vscode-dsh/tests/build-freshness.spec.ts scripts/oxlint-contract.spec.ts
# → 5 files / 85 tests passed
```
