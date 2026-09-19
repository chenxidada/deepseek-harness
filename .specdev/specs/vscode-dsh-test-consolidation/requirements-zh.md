# 需求文档（中文）— vscode-dsh 测试资产整合（能力域活文件）
> 工作流 slug：`vscode-dsh-test-consolidation`。本文件为 `requirements.md` 的中文镜像，两者语义一致；不一致时以 `requirements.md` 为准。本工作流仅重组测试资产，**不新增产品行为**；整合包含**基于内容的用例筛选（keep/drop）**，每一处删除都必须在台账留痕。

## 产品目标
把 `apps/vscode-dsh` 的测试资产从「按 Phase／feature 切分的一次性快照集合」重组为「按**能力域**组织的、**只增不新建**的活文件集合」，并给出一套可审计、可维护的组织方式，使测试资产可审计（全局唯一断言编号 + keep/drop 决策台账）、可维护（整体进入 lint program）、可扩展（新 Phase 在既有域文件的 `describe` 块内追加）。

## 问题陈述
用户认为 `apps/vscode-dsh/tests` 现状「混乱且没有意义」：每个 Phase／feature 各自新建验证文件，零散、一次性、按 Phase 编号跨工作流撞号；为「追溯」保留历史文件反而让后续开发更困难。方向是**整合**与**在基础上增加**：按能力域归并既有文件，筛选掉一次性探查与实现细节耦合类用例（用例总数下降是预期结果，不是回归），新覆盖落在既有域文件的 `describe` 块内，不再新建文件。

## 目标终态
1. **能力域活文件**：`apps/vscode-dsh/tests/` 下只剩按能力域命名的 `cap-<domain>.spec.ts|tsx`，不再存在以 Phase／缺口／spike 命名的 spec 文件。
2. **只增不新建**：未来新覆盖落在既有域文件的 `describe` 块内，不再新建 spec 文件。
3. **全局唯一断言编号 + keep/drop 台账**：每个保留用例携带唯一 `CAP-<DOMAIN>-<NNN>`；旧 `AC-<n>` 只允许出现在带工作流限定的注释中；唯一追溯载体是 `assertion-map.md` 台账 + git 历史。
4. **verifier 独立性改为流程义务**：verifier 仍独立编写并执行验证，但场景不要求固化进域文件，结论写入 `verification.md`；测试树内不建立 verifier 专属结构。
5. **用例筛选**：保留 K1–K3，删除仅限 D1–D4，每条处置落台账并写理由码。
6. **lint 可维护**：`tests/tsconfig.json` 的 `include` 覆盖整个目录，`oxlint` 对 tests 目录 exit 0。
7. **test-scripts 收敛**：单一职责分层（薄入口编排 + 共享原语模块 + 能力清单数据），镜像原语单一定义。

## 目标用户
vscode-dsh 维护者／贡献者（能回答「这项能力被哪条断言覆盖」，知道「该往哪个文件加」）；后续 Phase 的 implementer（落点明确，不再决定新文件名）；reviewer／verifier（能按能力域独立选取失败面）；调度者（依赖 reviewer / verifier 在 `review.md` / `verification.md` 的留痕复核）。

## 核心场景
- **S-1 定位**：`grep -rl 'cap:change-list' apps/vscode-dsh/tests` → 1 个文件，编号唯一可读。
- **S-2 增量**：新 Phase 在既有域文件内追加 `describe` + 新 `CAP-*`，不新建文件。
- **S-3 独立复验**：verifier 独立推导并执行验证，场景与结论写入 `verification.md`（含解释器版本），不写入测试树。
- **S-4 审计**：由任一历史 spec 路径反查断言处置（keep → 哪个域/哪个 `CAP-`；drop → 哪个理由码/替代者）。
- **S-5 单域回归**：只跑一个域文件即得该能力域的完整回归面。
- **S-6 harness 复跑**：无凭证环境跑 `run-layer-v-smoke.sh`，退出码与整合前一致，脚本已委托共享模块。

## 预期范围
**在范围内**
1. `apps/vscode-dsh/tests/` 下全部 spec 文件（含 `layer-a/`、`layer-a-rtl/`、`verifier-phase*/`、`fixtures/` 归属）的归并、按 F8 规则的用例筛选、去重、改名与重新编号；含未入库 spec 文件（phase-1 基线冻结纳入版本控制）。
2. `apps/vscode-dsh/tests/tsconfig.json` 的 `include` 恢复整体覆盖，及使该目录 `oxlint` 归零所需的测试资产内修复。
3. `apps/vscode-dsh/test-scripts/` 的职责分层与共享原语抽取（消除镜像重复），按与 tests 同一套能力域清单组织。
4. 新增能力域清单（含 `entryAssertions`）、keep/drop 决策台账。
5. 相关 tech-debt-registry 条目更新（`DEBT-1` 关闭；`DEBT-4`/`DEBT-5` 明确不关闭；`DEBT-019` 的 tests 段口径）。

## 不在范围内（明确排除）
1. **不新增测试覆盖**：不要求补写此前缺失的断言。
2. **不修改生产代码**（AC-24）：`apps/vscode-dsh/src/**`、`apps/vscode-dsh/webview/**`、`packages/**`。
3. **不为追溯保留历史副本**：不建 `.archive/`、不复制旧 spec（AC-25）。
4. **不治理 `DEBT-019` 的其余部分**：本工作流只负责 `apps/vscode-dsh/tests` 段。
5. **不关闭 `test-scripts` 的能力覆盖缺口**：`DEBT-4`/`DEBT-5` 明确不关闭；只保证整合不改变脚本可执行结论（AC-23）。
6. **不改 CI 覆盖率门禁语义**（`test:coverage` 对象是 `packages/*/*/src`）。
7. **不修改本工作流的 `constitution.md`**（AC-5）。
8. **不重写任何 UI 资产**（见 UI 相关性）。

## UI 相关性
- **ui_relevant**: `false`。变更面仅为 `tests/**`、`test-scripts/**`，不新增／修改页面、路由、组件、样式、主题；`layer-a-rtl/*.spec.tsx` 是对既有界面的断言，不是界面实现。后续跳过全部视觉环节（HG-1.5 / 原型门禁 / `reviewer-visual` 返回 `N/A` / 强制视觉验证），`ui-spec.md` 保持空骨架。

## 功能区域
| # | 功能区域 | 覆盖 AC |
|:--:|------|------|
| F1 | 能力域目标形态与域清单 | AC-1 – AC-3 |
| F2 | verifier 独立性的流程层承接 | AC-4 – AC-5 |
| F3 | 全局唯一断言编号与 keep/drop 决策台账 | AC-6 – AC-10 |
| F4 | 核心入口覆盖与删除理由码 | AC-11 – AC-14 |
| F5 | tests 目录进入 lint program | AC-15 – AC-18 |
| F6 | test-scripts 整合与去重 | AC-19 – AC-23 |
| F7 | 范围边界 | AC-24 – AC-26 |
| F8 | 用例筛选规则（K1–K3 / D1–D4） | AC-27 – AC-29 |

## 验收标准（EARS 格式）
> 本文件的 `AC-<n>` 是流程契约编号，**不得**成为测试资产主引用（AC-10）。测试资产编号体系是 `CAP-<DOMAIN>-<NNN>`。

### F1 能力域目标形态与域清单
**AC-1:** `[Must]` **普遍型** — 整合后 `apps/vscode-dsh/tests/` 下**每一个** spec 文件**必须**匹配 `cap-<domain>.spec.ts` / `cap-<domain>.spec.tsx` / `cap-<domain>-<part>.spec.ts|tsx`（`<domain>` 小写连字符），且**必须不**存在文件名含 `phase<数字>`、`gap-<数字>`、`spike-` 的 spec，**必须不**存在 `verifier-phase<数字>` 目录。判定：`find apps/vscode-dsh/tests -type f \( -name '*.spec.ts' -o -name '*.spec.tsx' \) | grep -E 'phase[0-9]|gap-[0-9]|spike-|verifier-phase'` 输出**必须**为空。

**AC-2:** `[Must]` **普遍型** — 仓库**必须**存在能力域清单 `apps/vscode-dsh/tests/capability-domains.json`，为每个域记录 `id` / `spec`（文件路径或 `null`）/ `scripts` / `absorbed`（域吸收的整合前 spec 路径列表）/ `entryAssertions`（结构见 AC-11）；**每一个**整合前存在的 spec 文件路径**必须**恰好出现在**一个**域的 `absorbed` 中（既不遗漏也不重复）。可选 `verifierSources`（仅记录）。判定：以 **phase-1 基线冻结的整合前文件集**为基线（用 `find` 类命令采集，**不得**用 `git ls-tree`——会漏掉未入库文件），与全部 `absorbed` 的并集做双向差集，**必须**为空。

**AC-3:** `[Must]` **普遍型** — 每个能力域 spec **必须**含一个顶层 `describe`，标题**必须**以 `cap:<domain> — ` 开头（`<domain>` 与该文件所属域 id 一致）。判定：逐域 `grep -c "^describe('cap:<domain> — " <spec>` 结果 ≥ 1；且全树 `describe('cap:...` 出现的域 id 集合**必须**等于清单中的域 id 集合。

### F2 verifier 独立性的流程层承接
**AC-4:** `[Must]` **普遍型** — verifier **必须**独立设计并执行验证场景（**不得**仅复述/复用 implementer 的用例），结论**必须**写入 `<spec_dir>/phases/<phase>/verification.md`，且列明：① 独立推导的场景清单；② 每条场景的执行命令与结果；③ **执行所用解释器的完整版本与路径**（见 AC-14）。判定：三项齐全；仅罗列 implementer 用例标题而无独立场景者不通过。

**AC-5:** `[Must]` **普遍型** — verifier 独立性的承接载体**必须**是流程层，**必须不**是测试树结构：(a) `tests/` 下**必须不**存在 `.verifier-baseline.json`，域文件**必须不**被要求含 `describe('verifier: ')` 块；(b) `constitution.md §4.3` 为流程义务表述，**本工作流必须不修改 `constitution.md`**。判定：(a) `find apps/vscode-dsh/tests -name '.verifier-baseline.json'` 为空；(b) 该 constitution 文件的 git diff 为空。

### F3 全局唯一断言编号与 keep/drop 决策台账
**AC-6:** `[Must]` **普遍型** — 每个 `it`/`test` 标题**必须**含**恰好一个** `CAP-<DOMAIN>-<NNN>`；`<DOMAIN>` = 所在域 id（大写连字符），`<NNN>` 3 位十进制（`001`–`999`，同域不要求连续）。判定：逐标题 `grep -oE 'CAP-[A-Z0-9-]+-[0-9]{3}'` 计数 = 1（0 或 ≥2 均不通过）。

**AC-7:** `[Must]` **普遍型** — `CAP-` 编号在 `tests/` 全树**必须**互不重复。判定：`grep -rhoE 'CAP-[A-Z0-9-]+-[0-9]{3}' apps/vscode-dsh/tests --include='*.spec.ts' --include='*.spec.tsx' | sort | uniq -d` 为空。

**AC-8:** `[Must]` **普遍型** — `CAP-` 编号**必须**唯一；格式非法（不满足 `CAP-<DOMAIN>-<NNN>`，`<NNN>` 三位十进制）或域段与文件不符的编号**必须**在整合时修正，不得保留冲突。验证：由 reviewer-correctness 在 `review.md` 复核全树编号唯一性、格式与域段一致性并留痕。

**AC-9:** `[Must]` **普遍型** — 仓库**必须**存在 **keep/drop 决策台账**（`apps/vscode-dsh/tests/assertion-map.md`），逐条记录**整合前的每一个用例声明**（最小单元为源码用例声明行，`it.each` 的一行静态声明记一行），既不遗漏也不重复。字段至少：

| 列 | 必填条件 | 内容 |
|---|:--:|------|
| 原文件 | 全部行 | 整合前 spec 路径 |
| 原标题 | 全部行 | 整合前用例标题原文（`it.each` 记格式字符串） |
| 处置 | 全部行 | `keep` \| `drop` |
| 理由码 | 全部行 | keep 行填命中 K1/K2/K3（≥1）；drop 行填**恰好一个** D1–D4 |
| 若 D3 的替代 CAP 编号 | 仅 D3 行 | 替代用例 `CAP-` 编号（须存在于树中） |
| 若 D4 的缺陷关闭依据 | 仅 D4 行 | `verification.md` 路径 / registry 条目 id / commit sha |
| 新 `CAP-` 编号 | 仅 keep 行 | 整合后新编号（须存在于树中） |

判定：以 phase-1 基线冻结的整合前用例声明集（同一静态计数命令采集留档）为基线，与台账行并集做双向差集**必须**为空；每条 keep 行新编号在树中可 `grep` 到；每条 drop 行理由码合法且字段完整。

**AC-10:** `[Must]` **普遍型** — 测试资产编号体系**必须**迁移到 `CAP-<DOMAIN>-<NNN>`；任一 `it`/`test` 标题**必须不**出现未带工作流限定的裸 `AC-<数字>`。既有需求引用只允许出现在注释中，且**必须**带工作流限定（形如 `AC[vscode-dsh-usable-loop]-10`）。验证：由 reviewer-correctness 在 `review.md` 复核并留痕。

### F4 核心入口覆盖与删除理由码
**AC-11:** `[Must]` **普遍型** — 每个能力域的**入口行为**必须被断言覆盖，且覆盖**必须**是可判定结构：`capability-domains.json` 的每个域条目**必须**含非空 `entryAssertions`，每个元素形如 `{ "entrypoint": "<string>", "caps": ["CAP-<DOMAIN>-<NNN>", ...] }`；`entrypoint` 为该域对外部可观察的入口（工具名 / 命令 id / IPC 消息 / 导出符号），`caps` 非空且每个编号满足：① 出现在该域 spec 内；② 域段与该域 id 一致；③ 出现在某 `it`/`test` 标题中。验证：由 reviewer-correctness 逐条核对 entrypoint→caps 映射与 `src/` 真实调用路径，结果写入 `review.md` 并留痕。

**AC-12:** `[Must]` **不期望行为型** — **如果**某条整合前用例被标 `drop`，**那么**该行**必须**恰好命中一个理由码 `D1`–`D4`（见 F8），并按 AC-9 字段表补齐所指对象：D1 给「结论已固化」可定位依据（`路径:行号` 或受影响用例编号）；D2 给被断言的具体私有符号名（非空）；D3 给替代 `CAP-` 编号；D4 给缺陷关闭依据。验证：由 reviewer-correctness 在 `review.md` 逐条复核——缺 `replacementCap` 的 D3 行、`reasonCode` 为空或含两个理由码的行均判不通过；「D3 替代者是否严格覆盖」「D1/D4 依据是否真支撑删除」是语义判断，归 `reviewer-correctness`。

**AC-13:** `[Must]` **事件驱动型** — **当**某能力域在本工作流之后被修改 **时**，受影响的验证**必须**运行该域**完整**文件（不只新增块）。判定：验证记录中存在对完整域文件的运行命令与输出（如 `vitest run apps/vscode-dsh/tests/cap-<domain>.spec.ts`）。

**AC-14:** `[Must]` **普遍型** — 在**唯一权威解释器 Node 24.3.0** 下，同一命令 `vitest run apps/vscode-dsh/tests` 的**失败用例数必须为 0**。判定（命令**必须**显式携带解释器路径）：`env PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" ./node_modules/.bin/vitest run apps/vscode-dsh/tests` → 输出 `failed` = **0**；若 >0，**必须**逐条说明成因并证明与本整合的映射关系。基线（Node 24.3.0，两次复现一致）：**全绿（failed = 0）**。⚠️ Node 20.16.0 下的失败是**环境事故**（`~/.bashrc:151` 默认解释器不满足 `engines`），**不作基线、不作参考**；本 AC **不得**保留「≤30 失败」口径，也**不得**要求「两个环境都测」。

### F5 tests 目录进入 lint program
**AC-15:** `[Must]` **普遍型** — `apps/vscode-dsh/tests/tsconfig.json` 的 `include` **必须**以 glob（或等价可扩展形式）覆盖全目录，**必须不**再用逐文件白名单。判定：`include` 不含具体文件名；被 `include` 匹配到的文件集合与清单声明的 spec 文件集合一致（双向差集为空）。

**AC-16:** `[Must]` **普遍型** — 整合后 `npx tsx scripts/run-oxlint.ts apps/vscode-dsh/tests` **必须**退出码 `0`（0 error）。基线数值未经独立复测，Phase 1 基线冻结时复测留档；本 AC 只断言最终 oxlint 退出码 0，不预设中间误差数。主因是「文件没有 program」，剩下 203 条真实 lint 缺陷在**测试资产内**修掉。

**AC-17:** `[Must]` **普遍型** — `tests/tsconfig.json` 头部注释**必须**更新为整合后事实：**必须不**再陈述「目录过大不可作为 program」与逐文件白名单理由；**必须**说明新 glob 口径。

**AC-18:** `[Must]` **普遍型** — 残留 **tsc** 类型错误口径**必须**被显式记录（写入 `design.md` 现状依据或 registry），**必须不**沉默略过。实测：临时 program 下 `tsc --noEmit` 仍有类型错误，且该 program 无 `references`、不参与 `pnpm run typecheck`。故 tsc 归零**不是**本工作流验收条件，但「未归零」**必须**写下来并给出后续归属。

### F6 test-scripts 整合与去重
**AC-19:** `[Must]` **普遍型** — `test-scripts/` 下**每一个**文件**必须**被归类为四类之一并记录归属域：① 入口编排脚本；② 共享原语模块；③ 能力清单数据（如 `layer-v-capabilities.json`）；④ 支撑资源。**归属域必须取自 `capability-domains.json` 的域 id 集合**（与 tests 同一套）；`layer-v-capabilities.json` 的每个 `group` **必须**映射到某个域 id，映射表**必须**落盘（文件位置由设计阶段定）。判定：① `test-scripts` 目录文件数与清单条目数双向差集为空；② manifest `group` 集合 ⊆ 映射表键集合，且映射表每个值 ∈ 域 id 集合。说明：不要求域 id 与 `group` 同名，要求存在**可判定的映射**（具体映射由设计阶段定稿）。

**AC-20:** `[Must]` **普遍型** — `capability-runner.cjs` 与 `layer-v-driver/extension.cjs` 之间被登记为「语义重复的双份拷贝（部分存在签名漂移）」的原语，在 `test-scripts/**` 内的**定义处数必须各为 1**；两 driver **必须**通过共享模块（`layer-v-support/` 或等价路径）引用。这是**为消除 `DEBT-1` 双拷贝而拆，不是为行数**。镜像原语集合以 `design.md` 定稿的 19 项清单为准（含 `OVERSIZED_CAPTURE_AREA` 常量；`captureScreenshot` 存在签名漂移，统一为 3 参）。判定：逐原语 `grep -rnE "(function|const)\s+<name>\b" apps/vscode-dsh/test-scripts` 计数 = 1。

**AC-21:** `[Must]` **普遍型** — 被本工作流解决的既有债务**必须**在本工作流 registry 中迁入「已解决」并附可复算证据；跨工作流引用**必须**带来源限定（如 `DEBT-1@vscode-dsh-e2e-closure`）；明确不关闭的（`DEBT-4`/`DEBT-5`）**必须**显式登记「不关闭 + 理由 + 承接方」。判定：registry「已解决」表含 `DEBT-1@vscode-dsh-e2e-closure` 且验证命令（AC-20 的原语定义计数）可复算；registry 含 `DEBT-4@…`/`DEBT-5@…` 的显式「不关闭」条目。

**AC-22:** `[Must]` **普遍型** — `pnpm run check:test-scripts-syntax` **必须**退出码 `0`。判定：直接运行该 script。

**AC-23:** `[Must]` **事件驱动型** — **当**在同一环境（Node 24.3.0，无凭证、无显示）运行 `run-layer-v-smoke.sh` 与 `run-layer-v-capabilities.sh` **时**，退出码**必须**与整合前实测值一致（该值**必须**在开工前同命令采集留档，否则判「无法判定」）。判定：整合前后两次运行退出码逐脚本比对。边界：本机无 `DEEPSEEK_API_KEY`，`PASS`(0) 分支不可达，只覆盖 `SKIPPED_*`/`HARNESS_ERROR`；**不得**把「本机必为 skip」当作「真机链路已验证」，`DEBT-4`/`DEBT-5` 不因本 AC 关闭。

### F7 范围边界
**AC-24:** `[Must]` **普遍型** — 本工作流**必须不**修改生产代码。判定：`git diff --name-only <base>..HEAD | grep -E '^(apps/vscode-dsh/(src|webview)|packages)/'` 输出为空。若某条 lint 修复（AC-16）被判定必须改生产代码 → **必须**在 HG-2/HG-3 显式升级，不得静默扩大。补充：把 spec 对已废弃接口（如 `buildThinChatHtml`）的调用改为引用替代实现，属测试资产变更。

**AC-25:** `[Must]` **普遍型** — 本工作流**必须不**在 `tests/`／`test-scripts/` 下产生旧产物的第二份副本（不建 `.archive/`、不复制旧 spec、不留 `*-old.spec.ts`）。判定：整合后新增 spec 中**必须不**存在与任一整合前文件行数比 > 0.9 且内容高度重合者。

**AC-26:** `[Must]` **普遍型** — 以事故／缺口／spike 命名的文件（`gap-003-004-debt-fix.spec.ts`、`gap-005-009-debt-fix.spec.ts`、`spike-attribution-snapshot.spec.ts`、`spike-t0a-replay-rebuild.spec.ts`、`spike-t0b-continue-capability.spec.ts`）**必须**归入对应能力域文件，且**每一条**断言**必须**在台账中有**明确处置**（keep 或 drop）：drop 者按 AC-12 给恰好一个理由码与所指对象；keep 者参与 AC-6/AC-9 的编号与台账。判定：这 5 个文件在 `capability-domains.json` 的 `absorbed` 中各有归属（SUT 实测存在，无退役实例），且其全部整合前用例标题能在台账中查到处置。

### F8 用例筛选规则（K1–K3 / D1–D4）
**保留（满足任一即保留）**

| 码 | 名称 | 定义 | 该码成立时必须给出的可判定依据 |
|:--:|------|------|------|
| K1 | 外部可观察行为 | 断言工具返回值 / DOM / 事件 / 退出码 / 持久化内容 | 被断言对象读取位置 `路径:行号` |
| K2 | 跨模块集成路径 | 断言 capability seam 端到端路径（≥2 模块） | 调用链两端 `路径:行号` |
| K3 | 负向对照 | fail-closed、错误分支、非法输入拒绝 | 触发条件与期望的非成功结果 `路径:行号` |

**删除（仅限这 4 类，每条删除必须落台账并写理由码）**

| 码 | 名称 | 定义 | 该码成立时必须给出的所指对象 |
|:--:|------|------|------|
| D1 | 一次性探查 | spike 验证假设，结论已固化在实现或其它用例 | 固化实现位置 `路径:行号` 或受影响用例编号 |
| D2 | 实现细节耦合 | 断言私有结构（内部变量名、私有函数调用顺序） | 被断言的具体**私有符号名**（须能在整合前该文件内 `grep` 到） |
| D3 | 已被更严用例覆盖 | 存在断言范围严格覆盖它的替代用例 | 替代者 `CAP-` 编号（须存在于树中） |
| D4 | 债修复的临时守卫 | 为已修复缺陷写的一次性守卫，该缺陷已不可能回归 | 缺陷**关闭依据**（`verification.md` / registry id / commit sha） |

**AC-27:** `[Must]` **普遍型** — 台账每行**必须**判定 `keepChecks`（K1/K2/K3 三 bool），且：① 任一为 `true` 的行处置**必须为 `keep`**；② 每个为 `true` 的 `keepCheck` **必须**给出「可判定依据」（`路径:行号`），路径**必须**在仓库存在且行号不越界（复用 `design.md` 现状依据 L4/L5 校验）。验证：由 reviewer-correctness 在 `review.md` 逐条复核——`disposition: drop` 且 `keepChecks.K1: true`、或 K1=true 但依据路径不存在的行判不通过；依据指向真实位置**不保证**依据支持 K 码成立（语义归 `reviewer-correctness`）。

**AC-28:** `[Must]` **不期望行为型** — **如果**某行标 `drop`，**那么**该行**必须**命中**恰好一个** `D1`–`D4`（0 个或 ≥2 个均不通过）。验证：由 reviewer-correctness 在 `review.md` 逐条复核——`reasonCode` 为空或含多个理由码（如 `"D1,D2"`）的行判不通过，并记入台账行号。

**AC-29:** `[Must]` **普遍型** — 筛选硬约束：① **不得以 D1/D2 删除 K1–K3 命中项**（由 AC-27 ① 结构判定）；② `D2` 行**必须**给至少一个私有符号名且该名在整合前对应文件内可 `grep` 到；③ **禁止以「整合」为名做未经台账的断言语义削弱**——整合后某用例断言若弱于来源用例，台账该行**必须**标 `weakened: true` 并给理由，且**不得**据 AC-11 计入 `entryAssertions`，除非 `reviewer-correctness` 判定为等价重写并记入 `review.md`。验证：由 reviewer-correctness 在 `review.md` 逐条复核——`D2` 且 `privateSymbols` 为空、`D2` 指向不存在符号、`weakened: true` 仍列进 `entryAssertions` 的 `caps` 均判不通过；D3 严格覆盖 / D1·D4 依据是否支撑 / `weakened` 是否等价均属语义判断，归 `reviewer-correctness`。

## 约束
1. **集成分支**：仓库**没有 `main`**；集成分支是 **`new/vscode-dsh`**。`.cursor/rules/spec-workflow.mdc` 的 `git checkout main` 与仓库实际不符 → 本工作流 Phase 分支**必须**改用 `new/vscode-dsh`。**偏离只记 `design.md`，不在本工作流内修改规则文件。**
2. **运行环境（唯一权威解释器）**：**Node 24.3.0**，路径 `/usr/local/n/versions/node/24.3.0/bin/node`（满足 `engines: ^22.19 || >=24`）。本机 `~/.bashrc:151` 把默认 node 写死为 **v20.16.0**——**环境陷阱**，**不作基线、不作参考**。所有涉及 Node 的判定命令**必须**写成 `env PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" <cmd>`。
3. **不改产品行为**：整合 = 纯重组 + 基于内容的用例筛选；任何断言语义变更（含「等价重写」）**必须**记入 `implementation.md` 偏差章节并满足 AC-29 ③。
4. **`constitution.md` 一致性**：不违反 §1–§6；`§4.3` 是流程义务表述，**无需修改、也不得修改 constitution**（AC-5）。

## 风险 / 假设
| # | 风险／假设 | 缓解 |
|:--:|------|------|
| R-1 | 合并后 `beforeEach`/fixture 作用域互相污染 → 新失败（违反 AC-14） | 设计阶段由 code-explorer 产出每文件 hook/fixture 依赖清单；按域保留独立 `describe`，不拍平 |
| R-2 | 合并后单文件变大，报错定位变难 | 每条用例标题带 `CAP-` 编号，报错行即编号；台账提供「原文件 → 新编号」反查 |
| R-3 | AC-16 残留 lint 是真实缺陷，修复可能触发断言语义变更 | 逐条分类，语义变更记入偏差章节 + AC-29 ③ 台账 |
| R-4 | 假设 `.tsx`(jsdom) 与 `.ts`(node) 可同文件共存 | 若不可（`// @vitest-environment jsdom` 按文件生效），允许拆为独立 `.tsx`（仍属同一域，不违反 AC-1） |
| R-5 | 含模板拼接的动态标题导致 `CAP-` 编号无法稳定计数 | 动态拼接标题**必须**改为字面量，不得降低 AC-6 强度 |
| R-6 | `.bashrc:151` 默认 node 写死 v20.16.0 → 未显式指定解释器的命令误用 Node 20，产生 `ERR_REQUIRE_ESM` 与失败 | 判定命令**必须**写 `env PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" <cmd>`；phase-1 基线冻结解释器路径与版本；verifier 在 `verification.md` 写明版本与路径（AC-4） |
| R-7 | 域划分由文件内容推断，未必等于产品能力边界 | 设计阶段由 code-explorer（workflow 级）核对 `src/` 模块边界后定稿；AC-2 只要求每个旧文件恰好归属一个域 |
| R-8 | 筛选（D1–D4）可能被滥用为「删除没时间维护的用例」 | AC-27 ① 机械禁止「keepCheck=true 却 drop」；AC-12 要求每条 drop 给可定位所指对象；AC-29 ③ 禁止未留痕语义削弱；语义复核归 `reviewer-correctness` |

## 建议的 Phase 拆分方向
仅作高层指引，具体拆分由 plan-generator 决定：

1. **phase-1-baseline-domain-inventory — 基线冻结与域清单**：固化实测基线（含 AC-23 脚本退出码、Node 24.3.0 解释器路径、把未入库 spec 文件纳入版本控制），产出 `capability-domains.json`（含 `entryAssertions`）与 `assertion-map.md` 台账骨架。没有基线不许搬动文件。
2. **phase-2-tests-consolidation — tests 归并与编号 + 筛选**：按能力域归并文件、建立 `CAP-` 编号、逐行落台账（keep/drop + 理由码）、处理 spike/gap 文件。
3. **phase-3-test-scripts-consolidation — test-scripts 整合与去重**：完成 `test-scripts/` 分层与共享原语抽取（AC-19–22），消除 `DEBT-1`。
4. **phase-4-lint-and-closure — lint program 与收口**：`tsconfig.json` 改 glob、tests oxlint 归零（AC-15–18）、更新 registry（AC-21）、Node 24.3.0 全绿（AC-14）。

> phase-1 是后续全部判定的前提；phase-2 与 phase-3 的写面（`.spec.ts` 与 `.sh/.cjs`）不重叠 → phase-1 完成后可并行；phase-4 依赖两者定稿。
