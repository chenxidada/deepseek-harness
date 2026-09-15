# Tech Debt Registry

> 这是本工作流中所有已知技术债的 **唯一定义来源**。
> 所有 Phase 的 agent 共写共读。写入新债，读取已有债，解决后更新状态。

---

## 活跃债务

<!--
  ID 格式：STUB-xxx（桩代码）/ GAP-xxx（功能缺失）/ DEBT-xxx（其他技术债）
  状态：🔴 阻塞 / 🟡 非阻塞
  类型：空实现 / 假返回值 / 流程骨架 / 条件桩 / 类型占位
  来源：implementation.md / review.md / verification.md / scope-gap-report.md

  结构化索引字段（标签列）：
  - module:<name> — 所属模块。例：module:gateway
  - type:<stub|gap|debt> — 债务类型
  - concern:<topic> — 关注领域。例：concern:auth, concern:export
  - bind:<binding> — 绑定关系。例：bind:someip, bind:grpc
  标签 + depends_on → agent 精确查询。例：查「标签含 gateway 的 🔴阻塞项」→ 2 条，不扫全表
-->

| ID | 源Phase | 模块 | 文件:函数:行号 | 当前行为 | 预期行为 | 类型 | 标签 | 依赖它的模块 | 目标Phase | 阻塞 | 来源 | 注册日期 |
|----|:------:|------|---------------|---------|---------|------|------|-------------|:--------:|:---:|------|---------|
| DEBT-004 | plan-generator（设计阶段登记，非本工作流实现缺陷） | specdev-presets / ide profile | `packages/specdev/specdev-presets/src/tool-policy.ts:21-27`、`:30`（`ORCHESTRATOR_ALLOW` / `ORCHESTRATOR_WRITE_BLOCK`，模块级 const，plugin 无 `Config`）；`packages/specdev/specdev-presets/presets/specdev-orchestrator/agent.cordis.yml:28-29`（挂载该 policy row） | 出厂 `ide` profile 的**主会话不可写文件**：默认 preset `specdev-orchestrator` 挂载的 `orchestrator-tool-policy` 把模型可见工具收窄为 5 个（`bash`/`glob`/`grep`/`read`/`read_image`），`write`/`edit`/`str_replace_editor` 被 guard 阻断；用户在 VS Code 里让助手改代码时无法写入 | 让 `ide` 主会话可写。**已定位的窄口径修法**：`packages/bundle/ide/cordis.patch.yml` 是 `dsh-base + dsh-sdk-app` 之上的薄 patch 层，可单独覆盖 `agent-presets.config.default`（**须重述全部 config 键**：`default`/`includeShippedRoot`/`includeUserRoot`/`roots`，patch 替换整段 `config`）；blast radius 限于 `ide` profile。**不得** 改 `tool-policy.ts`（会牵连 `sdk`/`headless` 共用的 SpecDev 编排契约） | 功能缺失 | module:specdev-presets, type:debt, concern:tool-policy | `packages/bundle/ide/cordis.patch.yml`、`ide` profile 默认人设 | 下一个处理 preset 策略 / IDE 默认人设的工作流 | 🟡非阻塞 | spikes/native-diff-feasibility.md（§P1.4/G1.4 真机实测工具集 5→25（计数以 `request/header.header.tools` 实测为准；spike 正文的"26"与其自身打印的 25 个工具名自相矛盾）+ 源码事实）+ design.md §6 | 2026-09-15 |
| DEBT-008 | phase-1-node-env-preflight（第 3 轮审查发现，**用户裁定承接为债、本 Phase 不改**） | vscode-dsh Host 诊断（注释/引用层，**零行为影响**） | `apps/vscode-dsh/src/extension.ts:224`、`:2173`；`apps/vscode-dsh/src/session-host.ts:43`；`apps/vscode-dsh/src/auto-start-orchestrator.ts:36` | 两处引用/来源句失真：**(E-1)** 设置读取处引 `(AD-10)`，但 `design.md:225` 的 **AD-9** 才是「提供 `dsh.nodeBin` 设置项」，`:243` 的 AD-10 是**文档落点**决策——按编号追会落到错误决策；**(E-2)** `session-host.ts:43`「Class of a failed `IdeSessionHost.start`」与 `auto-start-orchestrator.ts:36`「the vocabulary `IdeSessionHost.start` throws with」的来源句**不覆盖**新增成员 `invalid-setting`（该成员实由 `extension.ts` 的 `readNodeBinSetting` 在 `StartHostPort` 层抛出，非 `IdeSessionHost.start` 自身）；成员列表**已**含 `invalid-setting`，仅来源句未同步 | 引用改为 `(AD-9)`；来源句扩为覆盖 `StartHostPort` 层（如「Class of a failed Host start, thrown by `IdeSessionHost.start` or its `StartHostPort`」） | 注释/引用保真 | module:vscode-dsh, type:debt, concern:jsdoc-reference | 无（仅可读性） | 下一轮触及 `apps/vscode-dsh` Host 诊断的工作流（Phase 2 若改动同一 JSDoc 可顺带偿还） | 🟡非阻塞 | review-design.md（E-1/E-2）+ 调度者实测核实（`design.md:225`/`:243` AD 编号对照） | 2026-09-15 |
| DEBT-009 | phase-1-node-env-preflight（第 3 轮审查 E-3 发现，**用户裁定承接为债、本 Phase 不改**） | spec 产物（`implementation.md`） | `phases/phase-1-node-env-preflight/implementation.md` §2.3 | 把 `.cursor/skills/project-build/SKILL.md` 归为「not this phase / Pre-existing」——**失实**。调度者实测裁决：该文件 mtime 由 `2026-09-14 17:10` 变为 **`2026-09-15 20:11`**（落在 Phase 1 窗口 16:47–20:12 内）、`git diff` 为 **+25 −2**、含本轮关键词（`invalid-setting`/`24.3.0`/`nodeBin`/`20.16`）命中 **8 处** → **确由本 Phase 的 implementer/verifier 依其 agent 契约写入**（其 `project-build`/`project-test` SKILL 更新义务） | 该条目应归为「本 Phase 改动」。**附带限制**：其 diff **混有 09-14 的旧改动与本轮新改动、无法按内容拆分**；用户已裁定 `.cursor/` 工具树**不随本 Phase 入库**（保持仓库「Phase 提交几乎不含 `.cursor/`」惯例）→ 本轮写入的 Node 版本知识（24.3.0 合格 / v20.16.0 废弃）留在工作区未入库 | 文档归类失实 | module:specdev-artifact, type:debt, concern:classification | 无 | Phase 4 交付收口（或下一轮 spec 校正） | 🟡非阻塞 | review-design.md（E-3）+ 调度者实测（`stat` mtime、`git diff --stat`、关键词计数）；与 review-connectivity.md §8 的「非本 Phase」主张**实测冲突已被裁决推翻** | 2026-09-15 |

> **`DEBT-005` / `DEBT-006` / `DEBT-007` 已解决（2026-09-15，`phase-1-node-env-preflight` 修复轮）**：三条均由 Phase 1 第 2 轮审查与独立验证产生，**均非功能缺陷**（verifier 判决 `PARTIAL` 时明确记录「无 CRITICAL / MEDIUM 功能缺陷」）。`DEBT-005` 为注释卫生、`DEBT-006` 为机器可读错误归类、`DEBT-007` 为 AC-1 的自动化验证手段缺口。用户裁定 `PARTIAL` 不算通过，implementer 在本 Phase 内直接修复三条，**不是**推迟到 Phase 2 / Phase 4。结论见「已解决」表；本轮证据链见 `phases/phase-1-node-env-preflight/implementation.md`。

> **`DEBT-004` 说明**：本工作流**已用 route A 在测试内绕过**该缺口（`HOME` 沙箱 + 影子 preset，见 `design.md` AD-15），用户**明确裁定不在本工作流内修**（只登记）。因此本条目为 🟡非阻塞，但**必须**在 Phase 4 的 `verification.md` 与 HG-3 汇报中可见。
>
> **活跃表现有 3 条，全部 🟡非阻塞**：`DEBT-004`（ide profile 主会话不可写，用户裁定本工作流不修）、`DEBT-008`（E-1/E-2 注释引用失真，零行为影响）、`DEBT-009`（`implementation.md` §2.3 归类失实 + `.cursor/` 工具树不入库的连带后果）。`DEBT-001`（已解决归档）、`DEBT-002`（v4 撤销）、`DEBT-003`（v6 撤销）、`DEBT-005`/`DEBT-006`/`DEBT-007`（2026-09-15 在本 Phase 内修复并归档到「已解决」）均不出现在活跃表中；下游 agent **不得**再按条件性登记流程处理 `DEBT-003`（Xvfb 已由用户安装，脚本内不存在安装动作），**不得**把 `DEBT-005`–`DEBT-007` 当作尚未偿还的债。
>
> **v7 修订（用户评审 #3 / #4 / #9）不新增任何债务条目**：`schemaVersion` 契约版本策略与契约完整性用例（#3）、影子 preset 生成器 `apps/vscode-dsh/test-scripts/layer-v-shadow-preset.sh` + `--check-shadow-preset`（#4）、文档门禁口径更正与早期评估（#9）均为**本工作流内必做的硬要求**（分别落在 Phase 2 / Phase 3 / Phase 1 + Phase 3 + Phase 4 的 spec 中），不是待偿还的债。Phase 1–3 的 implementer / reviewer / verifier **不得**把其中任何一项登记为"已知缺口"或降格为债务；若某 Phase 未完成，应按该 Phase 的 spec 判 `MUST-FIX` / 非 PASS，并在 `implementation.md` 记录，而不是新增 registry 条目绕过。

## 已解决

| ID | 源Phase | 描述 | 解决Phase | 解决日期 | 验证方式 |
|----|:------:|------|:--------:|---------|---------|
| DEBT-001 | phase-1-node-env-preflight（原登记，未落入活跃表） | 「扩展缺 VS Code Node 可执行文件路径设置面」——v1 曾以「AC-10 条件前件为假」的方案承接该缺口。HG-2 D-4 否决该方案并把 AC-10 升为 `[Must]`，该能力由本工作流 Phase 1 直接交付 | `phase-1-node-env-preflight`（AD-9 反转） | 2026-09-15 | `apps/vscode-dsh/package.json` 的 `contributes.configuration.dsh.nodeBin` + 三级解析链（`DSH_NODE_BIN` > 设置 > Extension Host Node）+ 无效设置 fail loud；Phase 1 spec 的 AC-10 验证策略 |
| DEBT-002 | phase-3-layer-v-smoke-loop（原为"预计新增"，从未落入活跃表） | **撤销**：「AC-25 第 5 步的 Diff 元数据来自注入而非模型原生」这一预计债务**不再成立**。用户 HG-2（v4）裁定第 5 步走 **route A**（`HOME` 沙箱 + 影子 `specdev-orchestrator` preset，零仓库改动），Diff 元数据为**模型原生 `meta.diffs`**；`spikes/native-diff-feasibility.md` Follow-up §G1.4 已真机实测（模型调用 `edit`、`meta.diffs` 非空且含 `oldText`/`newText`、persona 仍为 SpecDev Orchestrator）。撤销依据：**用户选择 route A，原生 Diff 可达**。同时 v1–v3 的注入构造与 `dsh.test.openHistory` 依赖已从设计中删除 | 设计阶段（v4，未实施） | 2026-09-15 | `spikes/native-diff-feasibility.md` Follow-up §G1.1–§G1.4 实测；`design.md` AD-15（route A 构造 + 证据字段 `diffSource:"native-meta-diffs"`） |
| DEBT-003 | phase-3-layer-v-smoke-loop（原为"条件性登记"，从未落入活跃表） | **撤销**：v5 曾把「AC-28(c) 的 Xvfb 分支未在真机实测（因离线/权限导致 `sudo -n apt-get install -y xvfb` 非 0）」设为**条件性债务**（触发条件不成立时不登记）。**Xvfb 已由用户安装**（2026-09-15 用户指令；实测证据：`/usr/bin/Xvfb` 与 `/usr/bin/xvfb-run` 均存在；`dpkg-query` → `xvfb 2:1.20.13-1ubuntu1~20.04.20 install ok installed`；`DISPLAY=:1` 上 X.Org 存活），且 `requirements.md` 的 AC-28 已明确脚本 **必须不** 尝试通过 `apt`/`sudo` 安装 Xvfb —— **触发条件（脚本内安装失败）已不存在**，该条件性债务**不再可能成立且无需登记**。显示环境顺序收敛为 `reuse → xvfb（已安装） → SKIPPED_NO_DISPLAY`；Xvfb 日后不可用/启动失败 → `SKIPPED_NO_DISPLAY` / 退出码 2 + 输出跳过原因，**不得**报 PASS，**不得**判为 `LINK_FAILURE` 或 `HARNESS_ERROR` | 设计阶段（v6，未实施） | 2026-09-15 | 用户指令 + 2026-09-15 实测证据（`design.md` AD-8 环境事实段 / §6 / §7 F5）；`design.md` §10 原冲突点 5 已删除（需求侧已收敛为同一份规范文本） |
| DEBT-005 | phase-1-node-env-preflight | **注释卫生**：测试名/注释中的审查条目码（`S9` / `S5` / `M2`）——`apps/vscode-dsh` 下 4 处（`tests/node-env-guard.spec.ts` 的 `:240`、`:629`、`:664` 与 `tests/auto-start-orchestrator.spec.ts:144`）已全部清除；`AD-9` / `AD-4` / `AD-2` 等 `design.md` 决策编号按本仓惯例**保留** | `phase-1-node-env-preflight`（第 3 轮，本 Phase 内修复） | 2026-09-15 | 证伪探针：`grep -rnE '\((S[0-9]+\|M[0-9]+)[,)]\|// *(S\|M)[0-9]+:' apps/vscode-dsh/` → **零命中**（`AD-*` 不在该模式内）；同时 `grep -nE 'AD-[0-9]+'` 证明 `AD-9`/`AD-4`/`AD-2`/`AD-1` 引用仍在 |
| DEBT-006 | phase-1-node-env-preflight | **机器可读错误归类**：非字符串 `dsh.nodeBin` 曾抛裸 `Error`（无 `kind`），经 `startErrorKindOf` 归一化为 `process-failed`。现 `readNodeBinSetting` 抛 `HostStartError('invalid-setting', …)`；`START_ERROR_KINDS` 新增独立成员 `invalid-setting`（**未**复用 `node-environment`，以保住 `session-host.ts` 的「`diagnostic` 恰好当 `kind === 'node-environment'` 时存在」不变式）；三处文档（`StartErrorKind` JSDoc、`HostStartErrorKind` JSDoc、`design.md`/`design-zh.md` AD-4 错误词表）已同步 | `phase-1-node-env-preflight`（第 3 轮，本 Phase 内修复） | 2026-09-15 | 运行时断言：`dsh.test.requestStart` 快照的 `errorKind === 'invalid-setting'`（`node-env-guard.spec.ts`「classifies a non-string setting as invalid-setting, not a process failure」）。证伪探针：从 `START_ERROR_KINDS` 移除该成员 → 同一用例变红（`expected 'process-failed' to be 'invalid-setting'`）→ 恢复后变绿 |
| DEBT-007 | phase-1-node-env-preflight | **AC-1(b) 自动化证据面**：原用例名含 `AC-1 a, b` 但 (b) 段断言的是 `process.execPath`。现按 spec 验证策略拆为两条：AC-1(a)（恰 1 行、合法 semver、`rangeAdmits`）与 AC-1(b)（在 `/usr/local/n/versions/node/<v>`、`~/.nvm/versions/node/v<v>`、`command -v node` 三处定位被 pin 的 24.3.0，对定位到的解释器调用 `validateNodeEnvironment`，断言 `ok:true` 且 `report.version === pinned`）；三处均无该版本时以 `ctx.skip` 报 **skipped** 并在消息中写出 pin 版本与三处已查路径（不 PASS）。**未**改动 `spec.md` 与 `.nvmrc` | `phase-1-node-env-preflight`（第 3 轮，本 Phase 内修复） | 2026-09-15 | 运行 `node-env-guard` verbose：AC-1(b) 执行并通过（本机命中 `/usr/local/n/versions/node/24.3.0/bin/node` 与 PATH 上的同一解释器）。证伪探针一：把版本名根指向 `~/.nvm/versions/node/v22.14.0/bin/node` → 变红（`was rejected by the pre-flight: expected false to be true`）。证伪探针二：pin 设为本机未安装的 `24.4.0` → 旧形态（`process.execPath` + 仅 `ok:true`）仍 PASS，新形态报 `↓ skipped [no install of 24.4.0 to locate; checked …=absent; …=absent; command -v node=… (24.3.0)]` |

---

## 维护规则

### 谁写入
- **implementer**：创建 `@STUB(phase-N)` 后立即注册到「活跃债务」。编码完成后检查是否有未注册的桩。
- **reviewer**：发现 implementer 未标注的桩/缺陷 → 新增条目到「活跃债务」
- **verifier**：独立验证发现疑似桩或已知缺陷 → 新增条目到「活跃债务」
- **Cursor Agent**（Phase Closure）：从 scope-gap-report.md 中同步推迟项到注册表

### 谁读取
- **code-explorer**（Phase 准备阶段）：读注册表，交叉验证代码中的桩 → 输出到 `repo-exploration.md` §9
- **plan-generator**：设计时检查 registry，确认依赖接口是否已有 stubs
- **implementer**：编码前读 registry，不把桩当真实现
- **reviewer**：审查时对照 registry，已知桩不误报为「发现」
- **verifier**：验证时对照 registry，已知桩跳过行为验证

### 谁更新状态
- **implementer**：实现之前注册的桩 → 从「活跃债务」移到「已解决」
- **reviewer**：确认桩已填实 → 可标记为已解决
- **verifier**：验证通过 → 确认可关闭
- **Cursor Agent**（Phase Closure）：标记不再适用的过时项 → ⚠️ 标记

### 字段规范

| 字段 | 说明 | 必须在 |
|------|------|:--:|
| **ID** | `STUB-N`(桩) / `GAP-N`(功能缺失) / `DEBT-N`(其他) | ✅ |
| **源Phase** | 产生该债的 Phase | ✅ |
| **模块** | 所属模块名 | ✅ |
| **文件:函数:行号** | 精确代码定位 | ✅ |
| **当前行为** | 代码实际做什么，不是意图 | ✅ |
| **预期行为** | 完整实现应该怎么做 | ✅ |
| **类型** | `空实现` / `假返回值` / `流程骨架` / `条件桩` / `类型占位` / `功能缺失` / `已知缺陷` / `性能问题` | ✅ |
| **标签** | `module:<name>`, `type:<stub\|gap\|debt>`, `concern:<topic>`, `bind:<binding>` | ✅ |
| **依赖它的模块** | 哪些模块依赖这个接口；**无依赖时写"无"** | ✅ |
| **目标Phase** | 计划在哪个 Phase 解决 | ✅ |
| **阻塞** | 🔴阻塞 / 🟡非阻塞 | ✅ |
| **来源** | 谁发现的（implementation.md / review.md / verification.md / scope-gap-report.md） | ✅ |
| **注册日期** | ISO 日期 | ✅ |

### 标签规范
- 每个条目必须有 `module:` 和 `type:` 标签
- `concern:` 和 `bind:` 为**可选标签**：**适用时必须填写**（提高查询精度），**不适用时省略该标签**（**不得**填占位值、**不得**填与其他条目相同的泛化值）
- 标签使用英文小写，多词用连字符连接
- 例：`module:auth-service, type:stub, concern:password-reset, bind:email`

### 查询指引（各 agent 如何精确查询）

| Agent | 查询方式 | 示例 |
|-------|---------|------|
| **plan-generator** | 查目标Phase=N AND 阻塞=🔴 → 按标签分组 | "下一 Phase 继承了哪些阻塞债务" |
| **implementer** | 查文件:函数精确匹配 → 已知桩不当真实现 | "我依赖的这个接口是桩吗" |
| **reviewer** | 查文件含当前目录前缀 → 已知桩不重复发现 | "我审查的代码里哪些函数是已知桩" |
| **verifier** | 查阻塞=🔴 且不在已解决表中 → 跳过验证 | "哪些已知问题不需要现在验证" |
| **code-explorer** | 逐行按文件:函数:行号验证代码是否匹配 | "registry 里的桩还在代码里吗" |

### 去重与清理
- 写入前搜索标签和文件:函数避免重复
- Phase Closure 时检查文件路径/函数名是否变化 → 标记 ⚠️ 或更新
- Phase 间传递的债务不重复注册

### Phase Entry Gate 联动
- 进入新 Phase 前，Cursor Agent 读取本文件
- 筛选「目标Phase = 当前Phase」且「阻塞 = 🔴」的条目
- 向用户呈现继承的债务清单，用户确认后正式开始 Phase
- 用户可选：(a) 本 Phase 优先解决 (b) 推迟 (c) 取消
- 根据决策更新 registry 中的目标Phase
