# Design Consistency Review — Phase 3（第 3 轮复审 / round-5 改动）

## 视角

**Design Consistency** — 代码是否遵循架构设计（`design.md` / `constitution.md §2` / 仓库既有约定）。

审查对象：round-5 `implementer` 的工作区改动（任务 A/B/C/D + `scope-amendment-02.md` §8.1 六项裁定）。
归档说明：启动自清理协议已执行 —— 直接路径无 `review-design.md` / `review-design-zh.md`，无需归档（上一轮报告已在 `.archive/review-design-20260917T090329Z.md`）。

## 判决：SHOULD-FIX

无 MUST-FIX。三条 SHOULD-FIX 均为**契约的覆盖面/留痕**问题，**不影响行为**，且**未改变任何 AC 判定**；建议在本 Phase 内就地修正（合计约 3 处一行级改动），也可按用户裁定顺延。

---

## 架构决策对照

| design.md / constitution 决策 | 实现是否遵循 | 证据 | 判定 |
|:---|:---|------|:--:|
| AD-15 决策 3 确立的形态先例：子职责**外置**为独立资产，**禁止主脚本二次实现** | 是 | 消费侧只在 `layer-v-support/display-evidence-shell.sh` 一处；`rg '^display_evidence\|^assert_display' run-layer-v-smoke.sh` → **0 命中**（内联函数已完全迁出） | ✅ |
| §1.1 组件职责：主脚本 = 编排入口；子职责落在 `test-scripts/` 下的独立文件 | 是 | 新模块与它所消费的 3 个 `.cjs` 同目录 `layer-v-support/` | ✅ |
| AD-8 三类结论契约**不得互换** | 是 | 全显示退化 ⇒ `fail_display` = `SKIPPED_NO_DISPLAY`/2（`:236-239`，经 `:207` 调用）；帧不可判 ⇒ `fail_harness` = 4（`:186`）；未出现把显示类塞进 `LINK_FAILURE`/`HARNESS_ERROR` 的路径 | ✅ |
| AD-8 / R2.3：`reuse` 只在能产出 AC-26(e) 证据时可成立；退化则换到自有显示，**只允许一次替换** | 是 | `retry` ⇒ `DISPLAY_RETRY_REQUIRED="true"`（`:201-204`）⇒ `main` 替换一次（`:3136-3145`）⇒ 第二次退化判 `skip` ⇒ `SKIPPED_NO_DISPLAY` | ✅ |
| AD-7：截图 git-ignored、索引 git 追踪 | 未触及（本轮未改产物目录/索引） | `git status` 无产物目录新增 | ✅ |
| `DEBT-017` 关闭条件：消费契约须**可被测试驱动** | 是 | 新增 `tests/display-evidence-shell.spec.ts`，`spawnSync('bash')` + **source shipped 模块** + 真帧 + 真 `.cjs` | ✅ |
| `DEBT-014` 关闭条件 (iii)：比较集 = `tsdown.config.ts` 的 workspace 集，**无成员落在比较之外** | **部分** | 比较集 = `packages/*/*` + `vendor/*`（= 用户 §8.1 第 4 项口径）；但 `apps/cli` 是 tsdown 成员且**在比较之外**，真实契约是「被比较**或**被显式列入 `OUTSIDE_THE_GLOBS`」——措辞与条件 (iii) 不一致 | ⚠️ 🟡-2 |
| `constitution.md §2.1` 单一职责 | 是 | 模块只做「verdict → 动作 + 记账」，不含判据实现 | ✅ |
| `constitution.md §2.2` 依赖方向 | 是 | shell → `.cjs` 单向（`:64` CLI、`:152` 公开导出）；`.cjs` 不反向依赖 shell/驱动 | ✅ |
| `constitution.md §2.3` 接口隔离 | 是 | 接口在模块头部 `:15-24` 显式声明，且**不设默认值**（`:23-24`「an unset one has to fail」）；只经 CLI 与 `MIN_DISTINCT_MD5` 公开导出交互，不触内部实现 | ✅ |
| §8.2 硬约束「不得扩大边界：不改 `schemaVersion`/字段集/`kind` 词表/退出码契约」 | 是 | 本轮未触碰 `host-diagnostics`/`session-host` 面；退出码仍 0/1/2/3/4 | ✅ |

---

## 模块 / 命名 / 结构审查

### 目录合理性

| 新文件 | 所在目录 | 是否合理 | 说明 |
|--------|---------|:--:|------|
| `layer-v-support/display-evidence-shell.sh`（新增） | `apps/vscode-dsh/test-scripts/layer-v-support/` | ✅ | 与它消费的 `display-evidence.cjs` 同目录；该目录既是"层 V 支持模块"的既有归属，也让「判据 + 消费」成对可读 |
| `tests/display-evidence-shell.spec.ts`（新增） | `apps/vscode-dsh/tests/` | ✅ | 仓库约定测试在包级 `tests/`；同时被 `tests/tsconfig.json` 认领 |
| `layer-v-driver/sandbox-clean-state.cjs`（改） | 未移动 | ✅ | 判据与驱动同层，与 `runStartedAtMsOf` 同构处理 |

### 命名规范审查

| 文件 / 符号 | 实际命名 | 应遵循规范 | 判定 |
|-----------|---------|-----------|:--:|
| 模块文件名 | `display-evidence-shell.sh` | 仓库 `.sh` 一律 kebab-case，且与 `display-evidence.cjs` 成对 | ✅ |
| 函数 | `display_evidence_verdict` / `display_evidence_reason_text` / `assert_display_evidence` / `read_display_evidence_floor` | 同脚本既有 `assert_build_freshness` / `record_evidence_violation` 的 snake_case 动词短语 | ✅ |
| 跨模块变量 | `DISPLAY_EVIDENCE_ACTION` / `_JSON` / `_REASON` / `DISPLAY_RETRY_REQUIRED` | 与 `BUILD_FRESHNESS_MODULE` / `ARTIFACT_INDEX_MODULE` 的大写下划线一致 | ✅ |
| 文件模式 | `664`（不可执行） | source-only 模块，与 `run-layer-v-smoke.sh`（同样 664、经 `bash <path>` 调用）一致 | ✅ |
| 测试文件 | `display-evidence-shell.spec.ts` | 与被测资产同名 + `.spec.ts` | ✅ |

---

## 需重点核查的六项 —— 逐项结论

### 1. 新模块的架构地位与职责边界 —— ✅ 符合，且**抽取是必要条件而非风格偏好**

- 消费侧从内联函数抽为独立可 source 模块，落点 `test-scripts/layer-v-support/`（与其消费对象同目录），符合 `design.md` §1.1 的组件划分与 AD-15 决策 3 已确立的形态先例。
- **职责边界清晰且无重叠**：`.cjs` **判**（退出码 + `pass|retry|skip|fail-closed`），shell **行**（`case` → 变量 / reporters / 退出码契约）。两处没有同一职责的第二种实现：判据不含动作语义，shell 不含 md5 判据。
- **抽取可追溯到需求，不只是重构**：`DEBT-017` 的关闭条件明文要求「消费契约须可被测试驱动」。`case` 四分支只有在**可 source** 的位置才可能被单独驱动（内联在 3000+ 行的主脚本里无法在不起真机链路的前提下到达）——所以「抽出来」是该条件的直接推论。这一点是本次改动最强的设计正当性。
- **接口靠声明 + 失败而非默认**：模块头部 `:15-24` 列出全部输入/输出，且**刻意不给默认值**（`:23-24`），依赖调用方 `set -uo pipefail` 使漏传即失败。符合 §2.3 接口隔离，也符合本 Phase「fail-closed」的一贯取向。
- **无「契约靠注释而非断言」**：`display-evidence-shell.spec.ts` 用真模块 + 真帧驱动这些函数，契约落在测试里。

### 2. 「stdout 为空 + 只能直接调用」契约 —— ✅ 已固化在可断言位置，但**防重入的静态守卫只覆盖两种书写形态** → 🟡-1

- **已在可断言位置固化**（非注释）：① `verdictStdout` 字节数被断言（`display-evidence-shell.spec.ts:240, 262, 300, 323, 336`）；② 直接调用形态被逐字断言（`:428-431`）；③ `retry` 分支额外断言"模块自己的话在 fd 2、不在 stdout"（`:283-286`）。
- **可静态证明**：`display_evidence_verdict`（`:55-88`）内所有输出均已重定向 —— `:71-72`/`:77-78` 为 `>&2`，其余全部是变量赋值；stdout 恒空是**结构性事实**，不依赖运行时观测。
- **下游自洽**：变量契约与主脚本的消费形态一致（`:3023` 直接调用 → `:3024` 读 `DISPLAY_RETRY_REQUIRED`），错误传播经 `fail_harness`/`fail_display` 收口，不新增退出码。
- **缺口**：见 🟡-1（backtick / 跨行 `$(` 可绕过静态守卫）。

### 3. `MIN_DISTINCT_MD5` 由 2 收紧到 3 —— ✅ 措辞完全一致，单一真相源成立

- `display-evidence.cjs:39` 为 `3`；`spec.md` 中**唯一**写死的阈值在〔修订段 R2.2〕（`spec.md:304`）的 `硬下限 **≥ 3 个不同 md5**`，其阈值理由段（`:306`）与之同向；R2.3（`:312`）**不复述数字**，而是引用「满足 AC-26(e) 的证据」—— 这种"单点写值 + 其余引用"的形态是最强的一致性（不存在第二处可比对的数字，因此也不可能漂移）。
- **无残留 `≥2`、无语义漂移**：全文搜 `2` 的命中只剩**历史叙述**（`display-evidence.cjs:10`「raised from 2 to 3」、`display-evidence-shell.sh:41-43`「with the floor at 2, the archived run … had to be accepted; the floor is now 3」、`spec.md`「由 ≥3 收紧」），都是如实记录前一取值，不是现行判据。
- **单一真相源成立**：值只在模块导出（`display-evidence.cjs:39`），shell 经 `require(...).MIN_DISTINCT_MD5` 读取（`display-evidence-shell.sh:152`），并在运行时记录进 `displayEvidence.minDistinctMd5`；shell 侧零硬编码。唯一第二处字面值是 `display-evidence.spec.ts:99` 的**刻意挂闸**（见 🟢-3），不是第二个真相源。
- 未读到该值即 `fail_harness` 的守卫存在且可达：`:154-156`（读取处）+ `:176-182`（消费前二次校验，"地板从未读到"时拒绝判 PASS）。

### 4. `build-freshness` 的 workspace 半区 —— ✅ 比较集可复核，边界如实声明；一处留痕缺失 → 🟡-2

- **比较集定义可复核**：脚本按 glob 展开（`run-layer-v-smoke.sh:1175-1177`），新成员自动进入比较；`build-freshness.spec.ts` **读取 `tsdown.config.ts` 原文**（`:80, 96-100`）并断言「每个成员要么被两个 glob 覆盖、要么在 `OUTSIDE_THE_GLOBS` 内」（`:359-370`），且用 `members.length > 3`（`:363`）防探针自身空转、用 `throw`（`:98`）防数组被改名后静默通过。这是**可复核**的形态，不是文字承诺。
- **判据边界如实声明而非掩盖**：`build-freshness.cjs:29-46` 四条边界（mtime 是必要性判据非充分条件 / 单根对比而非全局最新 / 未构建即拒绝不跳过 / 传递性陈旧不可见），并明说"A guard whose limits are undocumented gets trusted past them"。这正是 `scope-amendment-02.md` §8.2 第 3 项要求的落地。
- **`apps/cli` 的排除在实质上正确**：`packages/sdk/client/src/launch.ts:100-111` 表明，只要 `src/bin.ts` + `src/sdk-source.cordis.patch.yml` + `tsconfig.json` 都在，launch 就**优先 tsx 源入口**——源检出下 `apps/cli/lib` 不是被加载的产物，故不比较它不构成"假 PASS"通道。问题只在**留痕**（见 🟡-2）。

### 5. registry 状态订正 —— ✅ 合规：撤销有痕、原文保留、计数自洽

- **可追溯的撤销痕迹**：「已解决」表内 `DEBT-014` / `DEBT-017` 两行**保留原文**，就地标「⚠️ 本条已于 2026-09-17 迁回「活跃债务」（状态订正）」+「原文描述 … 保留于此**仅供追溯**」+ 解决日期划除（`~~2026-09-17~~ **撤销**`）。
- **「不作现状」已明写**：`:73` 明示「**有效现状以活跃表为准**」；`:77` 追加对下游的硬约束「只以两张表的**当前行**为准 —— 本节的订正说明属**追溯性注释**」。
- **历史计数不被当作现状**：`:74` 逐条点名三处历史计数（`:36` 的「11 → 7」、`:44` 的「现有 5 条」、`:60` 的「本次新增后 10 条」）为各自时点值并**禁止用于当前判断**；取代声明（`:71` 开头）明确「以下三条**取代**上方相关段落的计数与去向声明，原文保留仅供追溯」。
- **活跃表与导语自洽**：当前活跃表 8 行 = `DEBT-004`/`009`/`011`/`012`/`013`/`014`/`017`/`019`，与 `:74` 第 2 条逐一对齐；`DEBT-018` 已迁「已解决」并按用户裁定不另立条目，残余（pre-commit profile 无 `.cjs` 规则、`bash -n` 仅解析级、`shellcheck` 未安装）在「已解决」行与 `scope-amendment-02.md` §8.4 双处留痕。
- 唯一需对齐的是 `DEBT-014` 关闭条件 (iii) 的措辞（🟡-2）。

### 6. `implementation.md` —— ✅ §6.3 与 D8 已成唯一表述；D25–D34 与实际改动一致，无漏登

- **§6.3 与 D8 已消解**：`:273` 显式写明「与 §6.2 `D8` / `D18 (A)` 为同一表述 —— 三处同向，不存在矛盾：文件**变了**、成因**不是**本 agent、处置**不纳入提交**」，D32 亦记录了「核对后'矛盾'不成立」的结论与就地互引。三处同向、无第二种说法。
- **D25–D34 逐条落在实际改动上**，无漏登：我按 mtime 归因核对本轮（09-17 15:46–17:02）工作区改动集 = §1.6 清单 13 项 + `scope-amendment-02.md` §8.4 + `.cursor/skills/project-test/SKILL.md`，全部在册（D31 = registry + §8.4；D34 = 技能回写）。非本轮的改动（`design.md` 09-16、`AGENTS.md` 09-15、`project-build/SKILL.md` 09-16、`.oxlintrc.json` 09-17 10:38 等）未被误记为本轮，§1.6 的「本轮未碰」行亦与实测一致。
- 一处行号 off-by-one：见 🟢-1（`[文档保真]`，不计入判决）。

---

## 需特别判断的偏离：`scope-amendment-02.md` §8.1 第 3 项 probes → `owned`

**独立结论：`owned` 形态等价，且在两个方向上更强、在一个方向上更窄；无需升级用户重裁。**

| 维度 | 字面要求（probe 列表补一行） | 实际形态（`owned` 数组） | 比较 |
|---|---|---|---|
| 构造可行性 | **不可满足**：`tests/tsconfig.json` 用显式列举，合成探针必然 `Got tsconfig … <none>` / `Total programs: 0`（与判据强度无关，是构造矛盾） | 可行 | `owned` 胜（唯一可行） |
| 被断言的对象 | 合成探针文件（**不是**交付物） | 两个**真实交付文件** | `owned` 更强 |
| 失败方向 | 归属错误 ⇒ 红 | 归属错误或文件被移出 `include` ⇒ 红 | 等价 |
| 边界断言 | 无（probes 只断言"目录 → tsconfig"） | **额外断言** `notOwned` ⇒ `<none>`（"该目录不是程序"由假设变为断言，`scripts/oxlint-contract.spec.ts:143-150`） | `owned` 更强 |
| 覆盖面 | 类级（任意文件） | **成员级**：`include` 9 项中只钉 2 项 | `owned` 更窄 → 🟡-3 |

因此：**目的（归属从"无人断言"变为"可失败断言"）已达成**；字面形态的不可满足性是客观事实，不构成需要用户裁决的取舍 —— 字面要求只要不放弃"探针"这一形态就无法实现，而放宽到"把 `include` 的 9 项全部纳入 `owned`"即可覆盖到字面意图之上，且**不需要任何用户决策**。我的建议是就地补足覆盖（🟡-3），而不是升级重裁。

> 补充：`owned` 的失败方向已被实现者演示（移出 `include` ⇒ 该条单独变红），这是本 Phase 反复要求的"可失败性"形态，取它而非 probes 是**正确的工程判断**，不是绕过派单。

---

## 关键发现

### 🔴 Must-Fix

无。

### 🟡 Should-Fix

#### 🟡-1 「调用方不得用命令替换」的静态守卫只覆盖 `$(` 的行内形态，backtick 与跨行均可绕过

证据（`apps/vscode-dsh/tests/display-evidence-shell.spec.ts:430-431`）：

```430:431:apps/vscode-dsh/tests/display-evidence-shell.spec.ts
    const captured = lines.filter(line => /\([^)]*(display_evidence_verdict|assert_display_evidence)/.test(line))
    expect(captured).toEqual([])
```

该正则要求**同一行**内出现 `(` 且其后（至首个 `)` 前）出现函数名。两种会复现 DEBT-017 **同一类**后果的写法漏检：

1. 反引号：``action=`display_evidence_verdict "${DISPLAY_MODE}" "${DISPLAY_EVIDENCE_FORCED_XVFB}"` `` —— 行内无 `(`；
2. 跨行：`action="$(\n  display_evidence_verdict …\n)"` —— 函数名与 `(` 不在同一行。

两者的后果与已修缺陷同类：子 shell 丢弃 `DISPLAY_EVIDENCE_{ACTION,JSON,REASON}`（记账恒 null）、且取值可能被 stdout 污染 ⇒ `case` 落 `*`。本 Phase 的结论恰恰是"只覆盖一种书写形态的防线尚不构成防线"；仓库对同类守卫的既有约定是 [scripts/AGENTS.md](scripts/AGENTS.md) 的「Source-ownership gates … test every admitted/excluded form that changes their detection boundary」。

**建议**（一行级）：把黑名单正则改为**正向白名单**——断言函数名只出现在两个允许的语句行（已逐字断言的那两行），任何第三处出现即红；这样天然覆盖 backtick、跨行与未来新增的替换语法。
**影响**：非阻塞 —— 当前交付物不含该缺陷，已修形态（行内 `$(`）确能被抓住。

#### 🟡-2 `apps/cli` 被排除出 build-freshness 的**理由未落盘**，且 `DEBT-014` 关闭条件 (iii) 的措辞与已实现/已测的契约不一致

证据一（悬空指针，`run-layer-v-smoke.sh:1173-1174`）：

```1173:1174:apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh
  # outside them. The other two members there: the app is compared by the caller below, and
  # `apps/cli` is left out on purpose — see the boundary note in implementation.md.
```

而 `rg -in 'apps/cli' implementation.md` → **0 命中**（该文件仅在 `client.close` 等词上命中 `cli`）。即注释指向一份不存在的留痕。这与本 Phase 其余边界的处理方式不一致（`build-freshness.cjs:29-46`、`display-evidence-shell.sh:15-24`、`:281-282` 都把理由写在原地）。

证据二（真实理由在代码里，可被直接引用）：`packages/sdk/client/src/launch.ts:100-111` —— 源检出下 launch **优先** `src/bin.ts` + tsx，故 `apps/cli/lib` 不是运行时产物 ⇒ 排除**实质正确**；缺的只是把它写下来。

证据三（措辞不一致）：registry 活跃表 `DEBT-014` 的关闭条件 (iii) 写「比较集 = `tsdown.config.ts` 的 workspace 集且**无成员落在比较之外**」，字面**不成立**（`apps/cli` 是成员且在比较之外）；实现与测试的真实契约是「tsdown 的每个成员**要么被两个 glob 比较、要么被显式命名在 `OUTSIDE_THE_GLOBS`**」（`build-freshness.spec.ts:83-84`、`:359-370`）。verifier 若按字面判 (iii)，会得到与实现相反的结论（或让例外静默通过）。

**建议**（一行级，两处）：① 把 `:1174` 的指针替换为理由本身（引 `launch.ts:100-111`）；② 把 (iii) 改写为与测试同口径的表述（"每个成员要么在比较集内、要么被显式命名并断言在 `OUTSIDE_THE_GLOBS` 中"）。
**影响**：非阻塞、零行为影响；但 (iii) 是 verifier 的判定依据，措辞不对齐会直接产生一次假结论。

#### 🟡-3 `owned` 只钉住 9 项 `include` 中的 2 项：其余 7 项被移出程序时不会有红

证据：`apps/vscode-dsh/tests/tsconfig.json:33-43` 列 9 个文件；`scripts/oxlint-contract.spec.ts:120-123` 的 `owned` 只有 `display-evidence.spec.ts` 与 `display-evidence-shell.spec.ts`。其余 7 项（含本轮新增的 `sandbox-clean-state.spec.ts`、`build-freshness.spec.ts`）的归属**无人断言**，而"失去程序"的回归只会抬高**已知全红**的仓库级 lint 基线（`DEBT-019`：2218 条 / 107 文件）⇒ 静默。

**建议**（每项一个字符串）：把 `owned` 扩为 `include` 的全部 9 项 —— 这同时把 §8.1 第 3 项"文件类归属"的诉求覆盖到字面要求之上，且不需要任何用户决策（见上节"偏离判断"）。
**影响**：非阻塞 —— 目的（归属成为可失败断言）已达成，本条只补覆盖面。

### 🟢 Observations

- **🟢-1 `[文档保真]`** `implementation.md` §1.6 / D25 记「`source` 该模块（`:284`）」；实际 `.` 语句在 `run-layer-v-smoke.sh:285`，`:284` 是 `# shellcheck source=…` 注释行，`:283` 是 `[ -f ]` 守卫。底层主张为真（确已 source），零影响；调度者派单文本沿用了同一数字。
- **🟢-2 「stdout 完全为空」的准确范围**：契约覆盖的是**判据函数** `display_evidence_verdict`（`:55-88`，全部输出经 `>&2`）；`assert_display_evidence` 在 `retry` 分支经 `log` 合法写 stdout（`:203`），`display_evidence_reason_text` / `*_record_json` 亦以 stdout 返回值（经 `$( … )` 捕获，用途是取值而非分支）。若合并报告或下游把契约读成"整模块 stdout 恒空"，会误判 `retry` 分支。建议在 HG-3 采用「判据函数 stdout 恒空 + 调用方直接调用」这一精确表述。
- **🟢-3 `MIN_DISTINCT_MD5` 的第二处字面值**只在 `display-evidence.spec.ts:99`（`expect(MIN_DISTINCT_MD5).toBe(3)`），并附"该数字由用户裁定，须在此挂闸使静默改动变红"的注释 —— 属**刻意挂闸**，不是第二个真相源；shell 侧确实无硬编码（`:152` 经 `require` 读取）。
- **🟢-4 `design.md` §1.1 的组件快照未列 `layer-v-support/`**（该目录现有 4 个模块，含本轮的 `.sh`）。这与既有的 3 个 `.cjs` 同属"未列入快照"的既成惯例，故不构成本轮的设计不一致；若日后刷新 `design.md`，为该校验目录补一行可让快照更诚实（可选）。
- **🟢-5 正面**：`build-freshness.cjs:29-46` 把判据边界写成可质疑清单（mtime 必要性非充分 / 单根对比而非全局最新 / 未构建即拒绝 / 传递性不可见），是本 Phase「边界要声明而非假设」的样板；模块头部 `:15-24` 同样写明接口与"未设即失败"。
- **🟢-6 正面**：新模块缺失被**两条独立路径**捕获 —— 主脚本 preflight（`:3097` 列入 `missing`）+ 消费契约测试（路径不存在即红），且 `source` 本身有 `[ -f ]` 守卫（`:283`）、缺失时**不**部分加载，不存在"带残缺函数继续跑"的形态。

---

## 边界声明（本报告未覆盖）

- 未评价行为正确性（reviewer-correctness）、集成连通性（reviewer-connectivity）、界面外观（reviewer-visual）。
- 未重跑真机链路，未运行全仓 `pnpm run lint`；跨树/跨时点的 lint 计数对比无效（沿用 `O-5` 结论），本报告不据此下任何判断。
- 未审 `DEBT-019`（仓库级 lint 基线）的范围问题 —— 本轮按 `scope-amendment-02.md` §8.2 明确排除。
- 本报告的 🟡 条目均为**契约覆盖面 / 留痕**，不改变任何 AC 判定，也不改变 `DEBT-014` / `DEBT-017` 的关闭条件（🟡-2 只是要求把已有条件写准）。
