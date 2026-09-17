# Phase 3 范围修订 02 — 截图证据口径 + 4 条自证缺口 + lint 范围（用户裁定）

> 本文件承载 **HG-3 前**（`verifier` round-3 完成之后、`hg3` 通过之前）的**四项用户裁定**。它是这些偏离的**唯一授权依据**。

| 项 | 值 |
|---|---|
| 修订编号 | `scope-amendment-02` |
| 产生时点 | Phase 3 的 **HG-3 验收裁定**（round-3 验证完成之后，**尚未** `hg3=passed`） |
| 决策人 | **用户**（调度者以四问呈现，用户逐项选择；其中第 4 项经调度者以实测数据回退后**重裁**） |
| 日期 | 2026-09-17 |
| 效力 | 对 Phase 3 的**全部**下游 agent（implementer / reviewer×4 / verifier）**有约束力** |
| 明确未改动 | Phase ID、DAG `id` / `dependencies`、AC 归属、`ui: false` 标记、退出码/结论分类契约（`PASS` 0 / `LINK_FAILURE` 1 / `SKIPPED_NO_DISPLAY` 2 / `SKIPPED_NO_CREDENTIALS` 3 / `HARNESS_ERROR` 4） |

> 目的：把 HG-3 阶段用户授权的**范围扩张**与**验收口径变更**写成可复核的书面决策。
> 没有这份记录时，`reviewer-design` 会**正确地**把「脚本行为与 `design.md` AD-8 原文不一致」判为 MUST-FIX，
> 而该偏离实际上已获用户授权。本文件是该偏离的唯一授权依据。

---

## 1. 裁定 ① — 先修 `U-3`（= `DEBT-015`）再收口

| 项 | 内容 |
|---|---|
| 用户裁定 | **不在本轮直接验收通过**；先修复 `U-3`，再走完整审查与验证，之后才收口 |
| `U-3` 的定义 | `spec.md:199` 的「每步开始前沙箱产品状态为空」断言**恒假** —— `plan.runStartedAtMs` 在写入 plan JSON 时被初始化为 `0`，随后才被赋时间戳，故所有「早于本次运行开始」的判据永远为假、永不触发 |
| 来源 | `verification.md` §问题清单 **P3** / `reviewer-correctness` round-2 的 **F8** |
| 归属 | **可归因于本 Phase**（实现缺口）。它是本 Phase 唯一「可归因 + 已登记」的缺陷 |
| 要求 | **必须真正可失败**：修复后该断言在「沙箱内确实存在上一轮残留」时必须失败。**不得**仅把 `0` 换成一个「看起来对」的值而不验证其可失败性 |

### 1.1 该项**同时**是裁定 ④ 中的 `DEBT-015`

裁定 ① 与裁定 ④ 在 `DEBT-015` 上**重叠且一致**，不是两项独立工作。

---

## 2. 裁定 ② — 合并目标 = `new/vscode-dsh`

| 项 | 内容 |
|---|---|
| 用户裁定 | 合并目标为 **`new/vscode-dsh`** |
| 事实依据 | 本仓库**没有 `main` 分支**（`git rev-parse main` → `fatal`）；trunk 名为 `master`。`new/vscode-dsh` = `master` + 9 个提交，**Phase 1 与 Phase 2 的提交都在它上面**（HEAD = `300f492f84` = Phase 2 提交）；本 Phase 分支 `impl-phase-3-layer-v-smoke-loop` 正从它拉出 |
| 对流程规则的影响 | `.cursor/rules/spec-workflow.mdc` 的 HG-3 收口流程文本写的是「`git checkout main && git merge impl-<id>`」。**在本仓库该字面不可执行**（`main` 不存在）。执行时以本裁定为准：`git checkout new/vscode-dsh && git merge impl-phase-3-layer-v-smoke-loop` |
| 未改变 | 分支命名约定（`impl-<phase-id>`）、「implementer 不在分支上自行 commit」、HG-3 用户确认后才 commit + merge |

---

## 3. 裁定 ③ — 截图有效性判据改为「运行内不同 md5 数」（改 AC-26 / AC-28 口径）

### 3.1 缺口事实（`verifier` 独立复现，非推测）

`spec.md` 的 AC-26 只要求「5 张截图 + 稳定命名 + 合法 PNG + 被 ignore」，**完全不判画面内容**；而 AC-28 又要求**优先**使用 `reuse` 模式。
⇒ 一次**完全合规的 PASS 运行**可以产出 **5 张逐字节相同**的桌面帧（实测：`reuse` 模式下 5 张均为 3840×1080 桌面壁纸，md5 全同），**不构成任何界面证据**。
`xvfb` 模式则产出真实 EDH 窗口截图（1600×1000，md5 互异）。

### 3.2 用户裁定

**以「同一次运行内不同 md5 的数量」作为截图有效性的判据**，并**同步修订 AC-26 / AC-28 的措辞**。

### 3.3 落到 `spec.md` 的硬要求（由本修订写入，见 `spec.md` 修订段 R2）

1. **AC-26 新增子项 (e)**：同一次运行产出的 5 张截图，**其 md5 不得全部相同** —— 硬下限为 **≥ 2 个不同 md5**。实际的不同 md5 数量**必须**记入运行产物（证据可复核）。
   - **阈值说明**：选择 ≥ 2 作为硬下限的理由是——它**恰好能否定已观测到的退化形态**（全部为同一张桌面帧），且**不会**因「两个步骤恰好画面相近」产生误报（任何真实的界面运行都必然 ≥ 2）。
   - 调度者**未**把阈值定为 5/5 全异，因其可能对合理情形产生脆性失败。**用户可随时收紧该阈值**。
2. **AC-28 的 `reuse` 分支附带条件**：`reuse` **仅在能产出满足 AC-26(e) 的证据时可被采用**。
   若复用的 `DISPLAY` 无法产出有效界面证据（实测为退化帧），脚本**必须**改走 `xvfb` 分支（`display.mode === 'xvfb'`），而**不得**以退化帧作为 PASS 的依据。
3. **不得静默降级**：若 `reuse` 退化、且 `xvfb` 亦不可用/亦无法产出有效证据，**必须**按既有跳过语义（`SKIPPED_NO_DISPLAY` / 退出码 2）或带证据升级，**不得**报告 PASS。

### 3.4 与 `design.md` AD-8 的关系（**必须理解，否则会误判为违规**）

| 文档 / 条款 | 原文口径 | 本修订后的口径 |
|---|---|---|
| `design.md` AD-8（显示环境顺序） | `reuse → xvfb（已安装） → SKIPPED_NO_DISPLAY` | `reuse`（**仅当能产出满足 AC-26(e) 的有效界面证据时**）`→ xvfb → SKIPPED_NO_DISPLAY`。**顺序本身不变**，新增的是 `reuse` 的**可用性前件** |
| `design.md` AD-8 的其余部分 | 「禁止在无显示时仍报 PASS」 | **完全不变**（本次是把同一条精神延伸到「有显示但证据退化」） |
| AC-28 的 `apt`/`sudo` 禁令 | 脚本**必须不**尝试安装 Xvfb | **完全不变** |
| 退出码 / 结论分类契约 | 见 §表头「明确未改动」 | **完全不变** |

> 本修订**不**改写 `design.md`。以「叠加层」方式生效（与 `scope-amendment-01` 对 AD-14 的处理一致）。

---

## 4. 裁定 ④ — 在本 Phase 内修复 4 条自证缺口；lint 范围**限于本 Phase 自身**

### 4.1 修复范围（用户裁定：**限于本 Phase 自己制造的**）

**修**：下列四项（全部是「看起来有防线、实际不能生效」的自证缺口）：

| 债 | 缺口 | 要求（**必须真正可失败**） |
|---|---|---|
| `DEBT-014` | 冒烟脚本只检查构建产物**是否存在**，不检查其**新鲜度** ⇒ 陈旧 bundle 可产出「假 PASS」 | 产物**必须**与源码新鲜度关联（陈旧 ⇒ 不得 PASS，或带证据升级） |
| `DEBT-015` | `runStartedAtMs` 恒 `0` ⇒ 逐步骤洁净判据恒假 | 见裁定 ① |
| `DEBT-016` | `artifact-index.md` 的自断言**只 `note` 不失败** ⇒ 保护力接近于零 | 自断言**必须**能失败 |
| `DEBT-018` | `spec.md:197` 第三子项对 `.sh` / `.cjs` **物理上不可失败** | 该子项**必须**对这两类资产可失败（接入真实检查并纳入 lint 或 `check:ci:static` 链路），**或**按 `DEBT-018` 的修订建议改写子项措辞使其只覆盖 `.ts/.tsx`。**二选一，但必须消除「物理上不可失败的要求」** |

**另修**：**本 Phase 可归因的 54 条 lint 诊断**（全部为 `no-unsafe-*`，落在 3 个测试文件的**新增/改动行**上）。目标：**本 Phase 不再向仓库新增 lint 诊断**。

### 4.2 明确**排除**在本次修复之外（用户经实测数据重裁）

**仓库级 lint 基线**（`pnpm run lint` 的既有红）**不在本 Phase 内修**，另立独立工作流。实测依据：

| 口径 | 条数 | 文件数 |
|---|---:|---:|
| base 全仓 | **2218** | **107** |
| ├ `apps/vscode-dsh` | 2029 | 88 |
| └ `packages/**` | 189 | 19 |

其中 **1774 条（80%）是 `no-unsafe-*`**（需补真实类型，非格式改动）；且含 `no-unnecessary-condition`（53）、`no-unnecessary-type-assertion`（85）等**删改后会改变运行行为**的语义敏感项。
**88 个文件中有 83 个是本工作流从未触碰的**。该基线**不由任何 AC 要求** —— `spec.md:197` 只要求「lint 不因**新增** `test-scripts/**` 或 hooks 而失败」。

> ⚠️ 调度者曾把该基线的成本在提问中描述为「会显著扩大范围」。用户据该描述选择了「在本 Phase 内修复」。
> 调度者随后以实测数据**主动回退**该描述（107 文件 / 2218 条 / 80% 需补类型），用户**重裁**为「只做本 Phase 自己的」。
> 本 §4.2 是**重裁后**的口径，效力高于 §4 提问时的原选项。

### 4.3 该排除项的留痕

登记为 **`DEBT-019`**（仓库级 lint 基线，目标 = 独立工作流），避免该决策随会话丢失。

---

## 5. 对下游 agent 的硬约束

- **implementer**
  - 按 §1 / §3.3 / §4.1 落地；**不得**顺手改动 `kind` 词表、**不得**新增 `HostDiagnosticRecord` 字段、**不得**改任何 AC 的语义与退出码契约。
  - 每项修复**必须**附「**可失败性证据**」（即：故意构造违反该判据的情形 → 该判据确实失败；再恢复 → 通过）。仅有「看起来对」的代码**不满足**本要求。
  - `DEBT-018` 的修法**必须**在本地**可验证**：**不得**引入本机需要系统级安装且**无法验证**的依赖（本机 `command -v shellcheck` / `shfmt` → **均未安装**）。若选择的方案无法在本机验证，**必须**显式升级，**不得**静默登记为「已完成」。
  - 若为 `DEBT-018` 改动 `.oxlintrc*.json`，**必须**将影响面**限定**在本 Phase 的资产路径上，并在 `implementation.md` 登记该改动及其对全仓 lint 数字的影响（注意：验证者已确认本 Phase 此前**未**改动该配置）。
  - 完成后：把 `DEBT-014` / `DEBT-015` / `DEBT-016` / `DEBT-018` 移入「已解决」或按实情更新，并在 `implementation.md` 偏差台账登记本轮全部改动与偏差（接续 `D18` 之后）。
- **reviewer-design**
  - **不得**把「脚本行为与 `design.md` AD-8 原文（`reuse` 无条件优先）不一致」判为 MUST-FIX —— 该偏离已由 §3.4 授权。
  - **但必须**审查：§4.1 四项是否**真的**变得可失败（不得接受「看起来对」的判据）；§3.3 的 md5 判据是否真的能否定退化帧；`DEBT-018` 的修法是否**越界**改动了全仓 lint 面。
- **reviewer-correctness**
  - **必须**独立验证四项修复的**可失败性**（自行构造反例使其失败），**不得**仅读代码；并独立复核 54 条 `no-unsafe-*` 是否已清零或如实登记。
- **reviewer-connectivity**
  - **必须**检查 `DEBT-018` 新增的检查链路**是否真的被 lint / CI 链路调用**（「写了脚本但没人调用」正是本 Phase 反复出现的缺口形态）。
- **verifier**
  - **必须**独立验证：① `U-3`/`DEBT-015` 判据在残留场景下**确实失败**；② md5 判据能否定退化帧、且在 `xvfb` 下确实满足；③ `DEBT-014` 在陈旧 bundle 下**确实不 PASS**；④ `DEBT-016` 自断言**确实能失败**；⑤ `DEBT-018` 的检查链路**确实可达**。
- **全部 agent**
  - **不得**把 §4.2 排除的仓库级基线纳入本轮工作范围。
  - **不得**借本修订扩大边界（不改 AC 语义、不改退出码契约、`ui` 仍为 `false`）。

---

## 6. 本修订**未**改变的事项

13 条 AC 的**归属**（AC-11、AC-12、AC-23 – AC-33）与「补充证据」项（AC-10 / AC-13 / AC-14）；真机执行方式（构建顺序、单命令入口、`VSCODE_DSH_TEST=1`）；**显式清除继承的 `DSH_NODE_BIN`**；route A（`HOME` 沙箱 + 影子 preset + 2 行删除断言）；五步链路；修订 01（`DEBT-010`：`phase` 第三成员 + `schemaVersion` 恒 2）与追加裁定 R1（受控断线取字段级证据）；`schemaVersion` 的 `> 1` 分流读法；退出码 / 结论分类契约；`ui: false`。

---

## 7. 调度者裁定：`DEBT-018` 归属冲突结清（2026-09-17）

**针对**：`implementation.md` §6.2 **D24 (B)** 与 §8.2 第 8 项上报的「`DEBT-018` 归属冲突（需调度者裁决）」。

### 7.1 事实（调度者一手核验，非转述）

| 项 | 实测 |
|---|---|
| `.oxlintrc.json` | `git diff` **+53**：新增按 `apps/vscode-dsh/test-scripts/**/*.cjs` 键入的 override；注释明文引用 `DEBT-018` |
| `package.json` | `+1`：`"check:test-scripts-syntax": "bash scripts/check-test-scripts-syntax.sh"`（`package.json:67`） |
| `scripts/run-gates.ts` | `+4`：`pnpmScript('test-scripts-syntax', 'check:test-scripts-syntax', …)` 并入 **`ciSharedStaticGates()`**（`scripts/run-gates.ts:312`）⇒ 进入 `ci-static` 链路 |
| `scripts/check-test-scripts-syntax.sh` | **新增**；pinned 清单 + glob 双轨，防「重命名后空跑」 |
| mtime | 四者 **10:38–10:40**；本轮 implementer 产物为 **10:56 / 11:00 / 11:52 / 11:53** ⇒ **改动来自更早一轮** |

### 7.2 冲突源 = **调度者的派单**，不是 implementer

本文件 §4.1（10:16）对 `DEBT-018` 的定式是「**二选一**，但必须消除『物理上不可失败的要求』」，§5:125 更直接预设「**若**为 `DEBT-018` 改动 `.oxlintrc*.json`，**必须**将影响面限定在本 Phase 的资产路径上…」。而 10:53 的派单写「`DEBT-018` 已由我改完 spec 措辞，**你不用碰它**，也不要动 `.oxlintrc*.json`」——**两者冲突，责任在派单**。

implementer 的处置**正确且应记录**：按「后发且更具体」的派单执行（只复核、未实施），同时把冲突**显式上报**为 D24 (B) 而非静默择一。这符合 `spec-workflow.mdc` 的 `Stop & Escalate` 契约。

### 7.3 裁定

1. **以 §4.1 为准**：选项 (a)（接入真实检查）属本文件**已授权**范围，**不构成越界**。
2. **四项改动保留**，不 revert。中断轮已完成选项 (a) 的落地，只差报告。
3. 调度者独立复核（一手命令）：
   - `npx oxlint --config .oxlintrc.json apps/vscode-dsh/test-scripts/layer-v-driver/extension.cjs` → `Finished … on 1 file with 110 rules`（基线 **90**）、**0 warning / 0 error** ⇒ override 确已生效，非空跑；
   - `bash scripts/check-test-scripts-syntax.sh` → `check-test-scripts-syntax: 3 shell asset(s) parse`、exit **0**；
   - `npx oxlint --config .oxlintrc.json …/run-layer-v-smoke.sh` → `No files found to lint` ⇒ `.sh` 仍不可被 oxlint 读取，故 `bash -n` gate 是对症补充而非重复。
4. **对下游**：`reviewer-*` 与 `verifier` **必须**把上述四项改动（含其全仓影响面）纳入审查范围 —— 它们此前**从未被任何视角审查过**。
5. `implementation.md` §6.2 **D24 (B)** / §8.2 第 8 项所记「归属冲突」**自本节起结清**；其中「本 agent 未实施该条」描述的是**派单后的行为**，但**工作区确有实现** ⇒ **不得**据此认定 `DEBT-018` 未实施、**也不得**据本文件 §4.1 的 implementer bullet 认定该 agent 有遗漏。

### 7.4 明确留给 HG-3 用户裁定的事项

`DEBT-018` 的**最终登记状态**（移入「已解决」／ 保留活跃 ／ 残余另立条目）**不在本节裁定**。理由：`bash -n` 满足 §4.1 选项 (a) 的「仓库**自选**的 shell 解析器」，但 §5:124 又**明文排除**了 `shellcheck` / `shfmt`（本机均未安装），故「是否仍有残余、残余如何命名」属**范围判断**，须由用户决策；调度者**不得**代裁后静默关闭条目。

---

## 8. 用户裁定（2026-09-17，HG-3 验收前的第二轮范围决策）

**背景**：round-3 四视角复审合并判决 = **SHOULD-FIX**（0 🔴 / 5 🟡；见 `review.md`）。
依 `spec-workflow.mdc`，SHOULD-FIX **不触发 implementer 回流**，须随报告进入 HG-3 由用户裁定。
调度者把 5 项 🟡 与调度者自查的 U-d 一并上报（证据见 `scheduler-findings-round3.md`），用户裁定如下。

### 8.1 裁定表

| # | 事项 | 用户裁定 | 落地要求 |
|---|---|---|---|
| 1 | 🟡-1 洁净判据在 `homeSandbox` 缺失时**退化为恒真** | **本轮修** | 与 `runStartedAtMsOf` 同构：新增 `homeSandboxOf(plan)` 返回 `{ok,value}`；调用侧**不可用即 `harnessError`**；并把 `sandbox-clean-state.spec.ts:139-141` 的期望由「空即干净」**改为「空即拒绝」** |
| 2 | 🟡-5 / U-a `display-evidence.spec.ts:40:57` 1 条 `@stylistic(comma-dangle)` | **本轮修** | 补行尾逗号。**不得**用 `eslint-disable` 绕过 |
| 3 | 🟡-2 `apps/vscode-dsh/tests/tsconfig.json` 属**无人断言**的文件类归属例外 | **本轮修** | 采用 design 建议 **(a)**：在 `scripts/oxlint-contract.spec.ts` 的 probe 列表（`:52-61`）补一行 `['vscode app test', 'apps/vscode-dsh/tests', 'apps/vscode-dsh/tests/tsconfig.json']`，使该归属成为**被断言的契约**（仓库既有形态） |
| 4 | 🟡-4 / U-b `build-freshness` 只覆盖 **app 半区**，workspace 运行时产物不在比较集内 | **本轮补全** | 比较集须**纳入 workspace 半区**（`packages/**/lib` 与 `vendor/**/lib`），使 `:1165` 所提示的 `build:lib:host` 产物**真的落在校验范围内**。修后 `DEBT-014` 的诉求「PASS 无法自证对应哪一份 bundle」才算**完整**解决 |
| 5 | U-c `DEBT-018` 的最终登记状态 | **关闭**（`bash -n` 满足 §4.1 选项 (a)），**不另立条目** | 把 `DEBT-018` 迁入「已解决」并给条文级验证方式指针。**pre-commit profile（`.oxlintrc.staged.json`）无 `.cjs` 规则这一残余，经用户裁定不另立条目** —— 该事实仍需在本文件与 registry 的「已解决」条目中**如实留痕**，不得静默抹去 |
| 6 | 🟡-3 截图阈值 `MIN_DISTINCT_MD5` | **收紧到 ≥3** | `display-evidence.cjs:33` 的值由 `2` 改为 `3`；`:10` 的「the floor the user adjudicated」注释须同步改写为新裁定；`spec.md` 的〔修订段 R2〕/ AC-26(e) / AC-28 R2 中一切写死 `2` 的措辞须同步更新为 `≥3`；`display-evidence.spec.ts:94` 的边界用例须随之调整（该用例虽引用常量，仍需确认其构造仍**恰好命中**新下限） |

### 8.2 对下游 agent 的硬约束（本轮追加）

- **每项修复必须附「可失败性证据」**（故意构造违反判据的情形 → 判据确实失败；恢复 → 通过）。仅有「看起来对」的代码**不满足**本要求（沿用 §5:123）。
- **`MIN_DISTINCT_MD5` 的改动必须给出前后对照**：至少用**磁盘上真实归档运行**证明「原先判 `pass` 的 `distinctMd5=2` 运行，在 `≥3` 下改判退化 → `retry`」，并说明该改动对既有归档判定的影响面。
- **`build-freshness` 的补全必须保持 fail-closed**：workspace 半区**缺失产物**时不得静默通过；同时**必须**如实声明其判据边界（mtime 是必要性判据、非充分条件）。
- **不得**借本次改动扩大边界：不改 `schemaVersion` 语义、不改字段集（仍 18）、不改 `kind` 词表、不改退出码契约、`ui` 仍为 `false`。
- **不得**把仓库级 lint 基线（`DEBT-019`）纳入范围。
- 完成后：把 `DEBT-018` 迁入「已解决」；其余四项（🟡-1/🟡-2/🟡-5/U-b 与阈值变更）在 `implementation.md` 偏差台账**接续 `D24` 之后**登记。

### 8.3 撤销/覆盖关系声明

- 本节的第 5 项（`DEBT-018` 关闭）**覆盖** `tech-debt-registry.md` 中「`DEBT-018` 按派单『不用碰』未实施、仅复核，故留在活跃表」的**状态描述** —— 该描述是 round-2 时点的实情，现由用户裁定**取代**；原文**保留可追溯**，不得删除。
- 本节的第 6 项（阈值 `2 → 3`）**修改**了 `spec.md` 原有的〔修订段 R2.2〕口径。该修改**由用户显式授权**，**不构成**对 §5「不改 AC 语义」约束的违反 —— 后发且更具体的用户裁定优先。
- 本节**不**改变：13 条 AC 的**归属**；route A / 五步链路 / 退出码分类契约；`ui: false`；`DEBT-019` 的范围。

### 8.4 第 5 项的落地留痕（`implementer`，round-5，2026-09-17）

按 §8.1 第 5 项的落地要求，`tech-debt-registry.md` 中 `DEBT-018` 已迁入「已解决」并附条文级验证方式指针。
本节补记**同一事实在本文件内的留痕**（§8.1 第 5 项要求「本文件与 registry 的『已解决』条目中如实留痕」）：

- **`.cjs` 半的落地**：override 在 `.oxlintrc.json:341`（`files: ["apps/vscode-dsh/test-scripts/**/*.cjs"]`），且 **确在执行路径上** ——
  `package.json` 的 `lint = build:lib:host && tsx scripts/run-oxlint.ts .`，`scripts/run-oxlint.ts` 纯透传（不注入 `--config`）⇒ Oxlint 默认发现 `.oxlintrc.json`。
  本轮实测：5 个 shipped `.cjs`（`display-evidence` / `build-freshness` / `artifact-index` / `sandbox-clean-state` / `extension`）**各 0 error、退出码 0**（原始输出见 `implementation.md` §7.8）。
- **`.sh` 半的落地**：`scripts/check-test-scripts-syntax.sh`（`check:test-scripts-syntax` → `scripts/run-gates.ts` 纳入 `check:ci:static`），本轮复跑退出码 0。
- **残余如实留痕（经用户裁定**不**另立条目）**：
  1. `.oxlintrc.staged.json`（**pre-commit profile**，第三条链路：`lefthook.yml` / `lint:fix:contracts-ready`）**无任何 `overrides`**，且 `ignorePatterns` 只含 `**/*.js` / `**/*.mjs`（**不含** `**/*.cjs`）
     ⇒ 提交 `.cjs` 时该 profile **仍然产生不了任何诊断**（「0 诊断 ≠ 干净」这一机制在 pre-commit 路径上依然存在）。本项**不在** §4.1 选项 (a) 点名范围（选项 (a) 只点名 `pnpm run lint` / `check:ci:static`）。
  2. `bash -n` 是**解析级**检查，不覆盖 `shellcheck` 类语义问题（`command -v shellcheck` → 未安装，§5:124 已明文排除）。
- **不得**因 `DEBT-018` 已关闭而删除本节或 registry 中的上述残余描述（§8.1 第 5 项的「不得静默抹去」）。
