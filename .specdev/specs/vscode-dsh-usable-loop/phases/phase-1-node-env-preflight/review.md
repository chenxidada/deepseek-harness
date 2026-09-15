# Phase 1 审查报告（合并）

> Phase：`phase-1-node-env-preflight`　轮次：第 3 轮（第 2 轮判决 SHOULD-FIX → verifier 判 PARTIAL → 回炉 2 修 D-1/D-2/N1 → 本轮复评）
> 本文件为调度者合并产物；三份视角报告各自独立成文，见文末链接。

## 判决：SHOULD-FIX

## 合并依据

| 视角 | 判决 | 依据 |
|---|:--:|---|
| 实现正确性（reviewer-correctness） | SHOULD-FIX | D-1/D-2/N1 全部 CONFIRMED-FIXED；新增 N3.1 |
| 设计一致性（reviewer-design） | SHOULD-FIX | 三条真修复；AD-4 越界裁定「不构成」；新增 E-1/E-2/E-3 |
| 集成连通性（reviewer-connectivity） | PASS | D-2 新归类确认接到消费者；新增 F-1/F-2/F-3 |

合并规则：三视角均无 MUST-FIX → 无任一视角触发 MUST-FIX 分支；存在 SHOULD-FIX → **最终判决 = SHOULD-FIX**。
SHOULD-FIX **不触发回炉**（回炉仅由 MUST-FIX 触发），阻塞解除 → 进入 verifier 独立端到端验证。

## 一、本轮三条修复的确认（三视角独立核验，一致判定为真）

| 条目 | 核验结论 | 关键证据 |
|---|---|:--:|
| **D-1** 清除审查条目码 | ✅ 修复 | 条目码 grep 零命中（退出码 1）；`AD-9`/`AD-4`/`AD-2`/`AD-1` 引用**完整保留**；无新空白/EOF 破坏 |
| **D-2** 非字符串 `dsh.nodeBin` 独立归类 | ✅ 修复 | 逐跳追完链路（`extension.ts:2185` → `:2278` → `runStart` catch `:226` → `startErrorKindOf:53-61` → 快照 `:744`）；**未复用** `node-environment`（diagnostic 不变式保住）；三处词表**结构性相等**；**与 Phase 2 无冲突**（`process-failed` 保留兜底） |
| **N1** 实现 spec 的 AC-1(b) 三处定位 | ✅ 修复 | 用例已拆为 AC-1(a)/(b)；(b) 真跑（`✓ (AC-1 b) 52–53ms`，**非 skip**：三处已查、两处命中 24.3.0），断言 `ok:true` **且** `report.version === pinned`；`spec.md` 与 `.nvmrc` 的 `git diff --stat` **为空**（未削弱 spec） |

### AD-4 词表扩展的越界裁定（调度者转交，design 视角答复）

**不构成跨 Phase 越界。** 理由链：(a) `HostStartError` 与共享词表**本身即 Phase 1 的交付物**；(b) `dsh.nodeBin` 由本 Phase 首次引入，其配置错误的归类属 Phase 1 职责；(c) 改动**纯加性**，未添加任何 Phase 2 才需要的成员；(d) 复用 `node-environment` 会破坏 `session-host.ts` 的「`diagnostic` 恰好当 kind=node-environment 时存在」不变式。
**Phase 2 需同步的三处**（已在报告中写明）：其 spec 的边界清单、产出清单；AD-14 词表仅在 Phase 2 确需出记录时才动。

## 二、连通性视角的关键确认（本轮最有价值的独立证据）

连通性视角用**独立探针驱动真实 `extension.ts` 的 `activate()` + 真实 `dsh.test.requestStart` + 真实 `ConnectionUiController`**，实测非字符串 `dsh.nodeBin` 的完整链路为：

```
failed / errorKind=invalid-setting / 根因文案 / settingsDeepLinkAvailable=false / statusBarVisible=true
```

由此确认三件事：

1. **新归类真的接到了消费者**——全仓 **13 类 `errorKind` 消费点无一产生未定义行为**。
2. **我转交的 hazard 不成立**——「未知成员被当 `node-environment` 去读 `diagnostic`」不会发生，因为**产品侧读 `.diagnostic` 的地方为 0 处**（仅 `session-host-preflight.spec.ts:180-182` 读）。另一视角独立确认**全仓不存在 `switch over StartErrorKind`**。
3. **`invalid-setting` 可证伪**——连通性视角用**自建变异体**复核：同一错误对象在移除成员后落回 `process-failed`，故 `node-env-guard.spec.ts:744` 真会变红。**这填补了 correctness 视角因沙箱阻断而留下的 UNVERIFIED 缺口**（correctness 的「删除词表成员」探针两次被拒于仓外）。

## 三、本轮新增发现（全部 SHOULD-FIX，零行为影响；调度者已逐条独立核实）

| ID | 提出视角 | 内容 | 调度者核实结论 |
|---|---|---|---|
| N3.1 | correctness | AC-1(b) 以 `source:'process-exec-path'` 标注非 `process.execPath` 的解释器 | ✅ 成立但**无行为偏差**。`source` 只喂诊断文案（`node-env-guard.ts:120` → `:170`/`:192`），探测模式由**独立字段** `executable.electronRunAsNode` 驱动（`:258`）。连通性视角独立测得三种 source 判定完全一致。**仅失败路径的 remedy 文案会失真** |
| E-1 | design | `extension.ts:224`、`:2173` 引 `(AD-10)` 应为 `(AD-9)` | ✅ 成立（`design.md:225` AD-9 = 提供 `dsh.nodeBin` 设置项；`:243` AD-10 = **文档落点**）。讲设置读取处引 AD-10 会让读者按编号落到文档决策 |
| E-2 | design | 两句 JSDoc 的**来源句**已不覆盖新增成员 | ✅ 成立。成员列表**已**含 `invalid-setting`，但 `session-host.ts:43`「Class of a failed `IdeSessionHost.start`」与 `auto-start-orchestrator.ts:36`「the vocabulary `IdeSessionHost.start` throws with」仍称由 `IdeSessionHost.start` 抛出——而 `invalid-setting` 由 `extension.ts` 的 `readNodeBinSetting`（`StartHostPort` 内）抛出 |
| E-3 | design | `implementation.md` §2.3 把 `.cursor/skills/project-build/SKILL.md` 归为「not this phase / Pre-existing」失实 | ✅ 成立且**影响 HG-3 提交范围**。调度者实测裁决见 §四 |
| **F-1** | connectivity | `test-scripts/v3-e2e-preflight.mts:236` 仍断言 `errorKind === 'process-failed'`（标注 "today"），实测已为 `invalid-setting` → **verifier 原样复用会产生假红** | ✅ **成立，且是本轮最危险的一条**（见 §五）。**这是 verifier 自己的产物**，非产品代码 |
| F-2 | connectivity | `test-scripts/mutation/auto-start-orchestrator-flattened.ts` 已比出货模块落后两个成员 + 一段 JSDoc，「otherwise byte-identical」不再字面成立 | ✅ 成立（verifier 自己的产物） |
| F-3 | connectivity | Phase 2 侧落点：需为 `invalid-setting` 明确映射分支、读 `.diagnostic` 前按 `kind` 收窄；`launch.ts:132-139` 原样返回设置值 → `resolvedExecutable` 的绝对性只对 `process-exec-path` 有保证 | ✅ 记录为 Phase 2 输入，**Phase 1 无需改动** |

## 四、事实冲突的调度者裁决（两条视角互相矛盾）

该冲突属「两个 agent 对**事实**的分歧」，按 `AGENTS.md` 冲突解决规则须由仓库实测裁决；调度者已实测：

| 主张 | 来源 | 调度者实测裁决 |
|---|---|---|
| `.cursor/skills/project-build/SKILL.md` 属「非本 Phase / Pre-existing」 | connectivity（§8 脏文件清单） | ❌ **不成立** |
| 该文件**确由本轮 implementer 写入**，`implementation.md` §2.3 归类失实 | design（E-3） | ✅ **成立** |

**实测证据**：mtime `2026-09-14 17:10` → **`2026-09-15 20:11`**（本轮窗口内）；`git diff` 为 **+25 −2**，其中含本轮关键词命中 **8 处**（`invalid-setting` / `24.3.0` / `nodeBin` / `20.16`）。故该文件属**本 Phase 改动**，`implementation.md` §2.3 的「Pre-existing」表述须更正。

> 该文件的可交付性问题：其 diff 现**混有 09-14 的旧改动与本轮新改动**，无法按内容拆分。HG-3 提交范围须由用户裁定（见 §六）。

## 五、F-1：会污染下一轮验证的**假红陷阱**（必须先行处置）

**现象**：`test-scripts/v3-e2e-preflight.mts:236`

```ts
check('D-2 non-string class is process-failed today', snapshot.errorKind === 'process-failed', ...)
```

该断言写于第 2 轮（当时 D-2 尚未修复），标签 "today" 已过期。本轮 D-2 修复后实际值为 `invalid-setting`，故**该脚本当前必然报红**。

**危害等级**：若 verifier 原样复用其上一轮的脚本集而不更新，会产生**自己制造的假红**，进而可能误判 Phase 1 失败——这与第 1 轮 `replay` 假通过陷阱属**同一类**「证据通道本身失真」的问题，方向相反。

**处置**：该脚本是 **verifier 自己的产物**（非产品代码、非 implementer 交付物），故修复**不需要** implementer 派发、**不受** `loop_count` 阻断。已在派发 verifier 时列为**首要任务**。

## 六、HG-3 提交范围（调度者实测更新）

| 路径 | 状态 | 处置 |
|---|---|---|
| **新增本 Phase 23 个文件** | — | 纳入（清单见 `current-status.json` 的 `phase1_commit_set`） |
| `pnpm-lock.yaml`(09-14) | 已改 | **排除** |
| `apps/vscode-dsh/webview/dist/assets/index.{css,js}`(09-14 09:21) | 已改 | **排除** |
| `.specdev/specs/workflows.json`(09-15 09:56，早于 Phase 1) | 已改 | **排除** |
| **`.cursor/skills/project-build/SKILL.md`** | **本轮已改（mtime 20:11，+25 −2）** | ⚠️ **须用户裁定**：其 diff 混有 09-14 旧改动与本轮新改动、**无法拆分**；且仓库惯例几乎不含 `.cursor/` |
| `.cursor/skills/project-test/SKILL.md` | 本轮已改（mtime 20:11） | ⚠️ **须用户裁定**：整个 `project-test/` 目录未跟踪 |
| `.specdev/specs/vscode-dsh-usable-loop/` | 未跟踪（886 个 `.specdev/` 文件已追踪） | 按历次 Phase 提交惯例纳入 |

## 七、转交 verifier 的事项

1. **首要：先修 F-1**，否则其脚本集自造假红。同时处置 F-2（变异体已落后两个成员）。
2. **独立确认 D-2 可证伪性**——correctness 视角的变异探针两次被沙箱拒于仓外，其「删成员即红」的主张**未获第三方独立复现**；连通性视角已用自建变异体复现（移除成员 → 落回 `process-failed`）。verifier 需以**自己的手段**独立确认。
3. **N1 的 pass/skip 事实**——两个视角均实测为 **pass（52–53ms 真跑）非 skipped**；verifier 须独立确认，因「恒 skip 等于没有覆盖」。
4. **N3.1 定级复核**——`source` 错标是否真的零行为影响（连通性视角测得三种 source 判定一致）。
5. **AC-10(f) 跨 Phase 依赖**——Phase 1 的 `verification.md` **必须显式登记**，不得以 Phase 3 未完成判 Phase 1 失败；同时须**明确说明**该登记是否使判决降为 PARTIAL（`PARTIAL` 规则：有 gap 即非 PASS——这是设计与分期的判断，须显式给出理由，**不得**含糊）。
6. **E-1/E-2/E-3 与 F-3** 的记录与复核。
7. **`loop_count` 已达上限 2**：若验证发现需改**产品代码**的问题，`pipeline-gate.sh:347` 会阻断 implementer 派发——verifier **不得**假定可自动回炉，须按升级协议上报用户。

## 八、差量验收（三视角各自实测，结论一致）

| 命令 | 基线 | 本轮实测 |
|---|---|---|
| `pnpm run typecheck` | 绿 | ✅ 绿（exit 0） |
| `pnpm test packages/sdk/client` | 绿 | ✅ 绿（3 文件 / 84 用例） |
| `pnpm run test apps/vscode-dsh` | 红（4 文件 / 6 用例） | ✅ 红，**失败集合与基线一致** |
| `pnpm run test:docs` | 红（10 passed / 5 failed） | ✅ 同计数、同 5 个门禁；`doc budgets` **PASS**（未触发预算上调）；本 Phase 文档对零出现 |
| `pnpm run lint` | 红 | ✅ 红（10382 条，权威 `.oxlintrc.json`）；按 `git diff -U0` 逐条核对**新增行零诊断** |

## 九、详细报告

- [review-correctness.md](./review-correctness.md) — 实现正确性（判决 SHOULD-FIX）
- [review-design.md](./review-design.md) — 设计一致性（判决 SHOULD-FIX）
- [review-connectivity.md](./review-connectivity.md) — 集成连通性（判决 PASS）

前两轮全部产物与三视角旧版均已归档至 `.archive/`。
