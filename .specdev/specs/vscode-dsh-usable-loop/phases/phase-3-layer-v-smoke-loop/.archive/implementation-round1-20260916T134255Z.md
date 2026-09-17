# Phase 3 实现摘要 — `phase-3-layer-v-smoke-loop`

> 分支：`impl-phase-3-layer-v-smoke-loop`（开工复核 `git branch --show-current` ✅，全程未换分支、未 commit）
> 授权依据：`spec.md`（含文末修订段 R1）+ `scope-amendment-01.md`（修订 01 `DEBT-010` + 追加裁定 R1）
> 结论：**五步真机链路在真实 EDH 上跑通（`PASS` / 退出码 0）**；`DEBT-010` 在本 Phase 内修复完毕并迁入「已解决」（三条独立证据）；AC-11(b)/AC-10 的**字段级**证据按 R1 由「五步完成后的受控运行期断线」构造成功。

---

## 1. 变更清单

### 1.1 新增 — 产品源码 / 测试

| 文件 | 内容 |
|---|---|
| `apps/vscode-dsh/src/interaction-coordinator.ts`（修改） | `resolveApproval(id, outcome)`（AD-12）+ 拒绝词表类型 `ApprovalRefusalReason` / 结果类型 `ApprovalResolution`；复用既有 `finishApproval` + `entry.abort.abort()`（先 settle 再 dismiss，避免 `unavailable` 竞态二次回答） |
| `apps/vscode-dsh/src/extension.ts`（修改） | ① `dsh.test.answerApproval` 注册（在 `shouldRegisterTestHooks` 门禁内，`extension.ts:1009`）；② `dsh.test.injectDisconnect` 改为 `host?.injectRuntimeDeath()`（见 §6 偏差 D5） |
| `apps/vscode-dsh/src/host-diagnostics.ts`（修改） | `HostDiagnosticPhase` 增第三成员 `'post-handshake'`；`HOST_DIAGNOSTIC_SCHEMA_VERSION` `1 → 2`（唯一常量真相源，未散落字面量）；`HostDiagnosticInput.phase?` 可选入参；`HostFailureRecorder.lastSeq?()` 契约成员（契约化，见 §6 偏差 D6） |
| `apps/vscode-dsh/src/session-host.ts`（修改） | 新增 `recordTransportDeath()`；`onTransportDeath` 仅在 `status === 'connected'`（即握手后）时落一条 `phase: 'post-handshake'` 记录，携带 `resolvedExecutable` + `source`（取自启动时已解析的 `ResolvedNodeExecutable`）；`injectRuntimeDeath()` 通过 `client.close()` 制造真实死亡边（不再自造 FSM 状态） |
| `apps/vscode-dsh/tests/interaction-approval-resolution.spec.ts`（新增，146 行） | AD-12 六条用例：按 id 回答且不影响其它等待、未知 id 拒绝且不 settle 任何等待、词表外 outcome 拒绝且等待仍可回答、弹窗被 dismiss 且不二次回答 runtime、fail-closed 后不可回答、`questions` 等待不会被当作可批准的 id |
| `apps/vscode-dsh/tests/layer-v-inject-disconnect.spec.ts`（新增） | R1.3 落点实测用例：`lands on the post-handshake death edge and yields exactly one record carrying both fields`、`leaves the FSM through the product status watch, and the death is not recorded twice by the retry` |
| `apps/vscode-dsh/tests/host-diagnostics.spec.ts` / `session-host.spec.ts` / `node-env-guard.spec.ts`（修改） | 契约完整性随 v2 同步（字段集仍**恰 18 个**、版本取自常量）；新增 `post-handshake` 契约与去重用例；三个测试文件加 `beforeEach/afterEach` 清除 `DSH_NODE_BIN`（见 §6 偏差 D7） |

### 1.2 新增 — 层 V 冒烟资产

| 文件 | 内容 |
|---|---|
| `apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh`（新增，唯一入口、无参数、不读 stdin） | 构建前检、`PATH` 前置到合格 Node（AC-12）、`VSCODE_DSH_TEST=1` + workspace settings、`HOME` 沙箱（route A）、显示环境 `reuse → xvfb → SKIPPED_NO_DISPLAY`、`code --extensionDevelopmentPath` 拉起 EDH、日志抽取器（zstd **多帧**扫描）、截图、`report_meta.json`、五步协证 `corroborate`、进程/socket/沙箱回收、`artifact-index.md` 追加 |
| `apps/vscode-dsh/test-scripts/layer-v-driver/`（新增） | SDK 驱动扩展：**CJS**（`extension.cjs` 入口）、`package.json` **不含 `bin`**、**零 npm 依赖**；五步场景驱动 + 审批回答 + 原生 Diff 校验 + R1 断线取证 |
| `apps/vscode-dsh/test-scripts/layer-v-shadow-preset.sh`（新增） | 影子 preset 生成器 + `--check-shadow-preset` 自检（不动 shipped 源） |

### 1.3 新增 / 修改 — 仓库与文档

| 文件 | 内容 |
|---|---|
| `.gitignore`（修改） | 显式规则 `apps/vscode-dsh/test-artifacts/`（AC-26；按 spec 顺序约束**先落规则后建目录**） |
| `.specdev/specs/vscode-dsh-usable-loop/artifact-index.md`（新增，**git 追踪**） | 每次运行的结论 / 退出码 / 五步截图文件名清单（AC-33） |
| `apps/vscode-dsh/README.md`（修改）+ `README.zh.md`（新增）+ `README.i18n.yaml`（新增） | 四节（产物目录路径 / 截图命名规则 / 跳过条件 / 退出码含义）+ 显式清除继承 `DSH_NODE_BIN` + 影子 preset 生成器与 `--check-shadow-preset` 用法；双语配对（见 §6 偏差 D3） |
| `.cursor/skills/project-build/SKILL.md`、`.cursor/skills/project-test/SKILL.md`（修改） | 回写本 Phase 新知识（含「冒烟脚本不会替你构建」的坑）与验证状态+时间 |
| `.specdev/specs/vscode-dsh-usable-loop/tech-debt-registry.md`（修改） | `DEBT-010` 迁入「已解决」并补足验证方式与剩余边界表述 |

---

## 2. 对每条验收标准的实现说明

| AC | 实现方式 | 可检视证据 |
|---|---|---|
| **AC-11(a)** 终端侧 | 本 Phase 未改仓库；脚本与文档显式要求 shell 的 `PATH` 前置到 `/usr/local/n/versions/node/24.3.0/bin`（`README` 的「显式清除继承 `DSH_NODE_BIN`」节）；(a) 与 (b) 由**不同**机制满足、可独立判定 | 本机 `node -v` 默认 v20.16.0（不合格），`/usr/local/n/versions/node/24.3.0/bin/node` 合格 |
| **AC-11(b)** 扩展子进程侧（R1 补充证据） | VS Code 设置项 `dsh.nodeBin` = 24.3.0 绝对路径（脚本写 workspace settings，并**清除** `DSH_NODE_BIN` 以免污染该侧判定）；五步链路完成后的受控断线产出**字段级**记录：`source: 'vscode-setting'` + `resolvedExecutable` = 脚本预置绝对路径 | 见 §4；`layer-v-status.json` 的 `r1.postHandshakeRecords[]` |
| **AC-12** 脚本前置 `PATH` | 脚本在拉起源进程前解析合格解释器并把其 `bin` 目录前置到 `PATH`；解析失败 → `HARNESS_ERROR`（不静默使用默认 `node`） | `report_meta.json` 的 `node` 段（`resolved` / `source` / `version`） |
| **AC-23** 单命令、无人工 | `bash apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh`，无参数、不读 stdin；全部交互由驱动扩展经 `dsh.test.*` 完成（含审批） | PASS 运行日志 `[step-1..5]` 顺序 |
| **AC-24** `code --extensionDevelopmentPath` | 脚本以 `code --extensionDevelopmentPath=<repo>/apps/vscode-dsh` 拉起 EDH | `report_meta.json` 的 `launch` 段 |
| **AC-25** 五步 + 断言证据 | ① 启动 → `dsh.test.getStartState === 'started'`；② 新会话 → 会话数量/激活 tab 断言；③ 真实模型往返 → 会话日志含 assistant 消息且工具调用 ≥1（标注「真实模型」）；④ 审批 → 会话日志 `approval/asked` + 默认权限探针被沙箱拒绝 + 升级后重试 `allowed-once`；⑤ Diff → **模型原生 `meta.diffs`**（非注入）+ 磁盘内容一致 + `dsh.reviewWorkspaceDiffs` 命令可达 | 每步 `layer-v-status.json` 的 `steps[]`（含 `evidence`/`failureEvidence`）+ 会话日志抽取器产物 `layer-v-log-evidence.json` + 每步截图 |
| **AC-26** 固定产物目录 + 稳定文件名 + 显式 ignore | 截图落 `apps/vscode-dsh/test-artifacts/layer-v/`，文件名 `step-<n>-<slug>.png` 与步骤一一对应；根 `.gitignore` 显式规则（`git check-ignore` 命中，不依赖全局 ignore） | `git check-ignore -v apps/vscode-dsh/test-artifacts/layer-v/step-1-host-started.png` → 命中 `.gitignore` |
| **AC-27** 任一步失败 → 非零退出 + 步骤名 + 不报通过 | 任一断言失败：输出 `FAILED STEP: <step-id>` / `reason` / `failureEvidence`，按门禁层归类 `LINK_FAILURE`(1) | AC-27(b) 故障注入运行：`plan.faults.step5DiffCommand` 把 `dsh.reviewWorkspaceDiffs` 换成不存在的命令 → `conclusion=LINK_FAILURE`，`reason=step-5-review-command-failed`，退出码 1 |
| **AC-28** 显示环境顺序 | `reuse`（探测既有可达 `DISPLAY`）→ `xvfb`（`xvfb-run` 优先，否则自行拉起 `Xvfb`）→ `SKIPPED_NO_DISPLAY`(2)；**无** `apt`/`sudo` 动作 | 本机 `DISPLAY=:1` 可达 → `display.mode='reuse'`（`report_meta.json`） |
| **AC-29** 进程回收 | 结束后按运行自有归属（沙箱 `HOME` / 进程组）回收 EDH 及其子进程，并核对残留 | `report_meta.json` 的 `processResidue`（残留 PIDs 区分「本运行自有」与「开发者既有 IDE」） |
| **AC-30** 临时 bridge socket 释放 | 运行前分配临时 socket 路径、结束后删除并断言不存在 | `report_meta.json` 的 `bridgeSocket`（`released: true`） |
| **AC-31** 真实模型往返 | 凭据可用时步骤 3 为真模型往返（禁 fixture/替身），并在输出中标注该步使用真实模型 | PASS 运行 `step-3` 的 `usedRealModel: true` + 会话日志中的 assistant/工具帧 |
| **AC-32** 缺凭据 ≠ 链路失败 | 可信 cwd（不含 `.env`）下运行 → `conclusion=SKIPPED_NO_CREDENTIALS`、退出码 **3**、`reason=missing-credentials`；不计 `LINK_FAILURE` | 负向运行（`cd /tmp` 空 cwd）：退出码 3；`artifact-index.md` 中该行结论为 `SKIPPED_NO_CREDENTIALS` |
| **AC-33** 文档 + git 追踪的产物索引 | README 四节（产物目录 / 命名规则 / 跳过条件 / 退出码）+ 每次运行追加 `artifact-index.md`（含运行时间、结论、五步文件名；缺截图写 `—` 而非省略） | `artifact-index.md` 末行 = 本次 PASS 运行；`git ls-files` 含该路径 |

**AC-10 补充证据**：AC-10 要求「扩展子进程侧」的 Node 修复可被独立判定 —— 取证方式与 AC-11(b) 共用同一条 `post-handshake` 记录（`source` + `resolvedExecutable`），即**由运行期断线反证启动时实际解析并使用的解释器**，而非只看设置项本身。
**AC-13 / AC-14 补充证据**：`post-handshake` 记录经既有 `HostDiagnosticRecord` 18 字段面呈现，v2 版本号由唯一常量产出；读取侧（`[]` 口径）见 §5 R1.2。

---

## 3. `DEBT-010` 修复结果（本 Phase 内完成）

**修法**（未新增记录面、未加字段、未改 `kind` 词表）：

1. `HostDiagnosticPhase` = `'start' | 'retry' | 'post-handshake'`（第三成员表达「握手后 / 运行期」边界）。
2. 同一次改动内 `HOST_DIAGNOSTIC_SCHEMA_VERSION` `1 → 2`。
3. 补齐缺失的记录边：
   - `session-host.ts` `onTransportDeath`：**仅当** `status === 'connected'`（握手已成功）时落一条 `phase:'post-handshake'` 记录，并携带 `resolvedExecutable`（= 启动时 `resolveNodeExecutable` 的产物）与 `source`；
   - `auto-start-orchestrator.ts` 那处自合成 `failed` 快照**不写记录**（保持无生产者即为无记录，避免第二条通道）。
4. 去重：握手**前**的死亡仍由 `start()` catch 记录（`phase: 'start'`），`onTransportDeath` 在 `status !== 'connected'` 时**不**记录 → 同一次失败只留一条。

**三条独立证据**（已全部落为可重跑用例）：

| # | 证据 | 位置 | 断言 |
|---|---|---|---|
| ① | 单元契约 | `tests/host-diagnostics.spec.ts:404`「DEBT-010: a post-handshake death is its own phase and opens the chain a retry joins」；同文件 `:122` 字段集**恰 18**、`:177` 版本取自唯一常量 | `phase:'post-handshake'`、`retryOfSeq:null`、字段集恰 18、版本 = 常量 |
| ② | 真机路径集成 | `tests/session-host.spec.ts:455`「a runtime death after the handshake records phase `post-handshake` with the resolved executable」；`:502`「a death while the start is still in flight is recorded once, by the start sequence」 | 两字段取值来源正确；**同一次死亡只记录一条** |
| ③ | 落点实测 | `tests/layer-v-inject-disconnect.spec.ts:123` / `:156` | 落在 post-handshake 死亡边、**恰一条**记录且两字段齐备；FSM 经产品状态观察退出，重试不重复记录 |

**已核实的边界（照实登记）**：`onStartSucceeded()`（`host-diagnostics.ts:341-343`）只重置失败链、**不写记录**；`records()`（`:385-387`）只返回 `record()` 推入项 —— 故「成功启动 + `getDiagnosticsText`」必然为 `[]`，该现象**合法**（见 §5 R1.2 口径）。

---

## 4. R1 前置实测结论（`injectDisconnect` 落点 / 条数 / 字段来源）

**实测（非推断）**：

| 观察项 | 实测结果 | 证据 |
|---|---|---|
| 落点 | `dsh.test.injectDisconnect` → `IdeSessionHost.injectRuntimeDeath()` → `client.close()` → transport death → **`onTransportDeath`（status === 'connected'）** → `recordTransportDeath()` 落 `phase:'post-handshake'` | `layer-v-inject-disconnect.spec.ts:123`；真机运行 `layer-v-status.json` 的 `r1` |
| 记录条数 | **恰 1 条**（`deduped: true`）；随后编排器的重试不追加 post-handshake 记录 | 同上测试 `:156` + `session-host.spec.ts:502` |
| FSM 出口 | 死亡后由**产品自身的**状态观察驱动：`extension.ts:2337-2345` 的 `onStatusChange('error')` → `orchestrator.onUnexpectedDisconnect()`（`state === 'started'` 时）→ 既有重试路径 | 同上；FSM 入口**未变** |
| 字段来源 | `source === 'vscode-setting'`（脚本清除 `DSH_NODE_BIN`、写入 `dsh.nodeBin` 设置 → 解析链命中设置项）；`resolvedExecutable` = 启动时解析出的 24.3.0 **绝对路径**（`session-host.ts` 的 `ResolvedNodeExecutable`，与 spawn 使用者同一值） | 真机 `r1.postHandshakeRecords[0]` 与 `report_meta.json` 的 `node.resolved` 逐字相同 |

**去重结论**：握手后死亡只经 `onTransportDeath`；握手中死亡只经 `start()` catch；两处互斥（`status === 'connected'` 判别），已由 `session-host.spec.ts:502` 与 `layer-v-inject-disconnect.spec.ts:156` 双向锁住。
**未降级**：该构造**产出**了带两字段的记录（非 `[]`），故未触发「结构上不可行」的升级路径，也**未**改写任何 AC 口径。

---

## 5. R1.2 `[]` 最终口径（实现所遵循的判定）

| 情形 | 判定 | 实现位置 |
|---|---|---|
| **构造后的那次读取**为 `[]` | `HARNESS_ERROR`（字段级证据不可得，不得静默降级） | 驱动扩展 R1 段：读 `dsh.test.getDiagnosticsText`，过滤 `phase === 'post-handshake'` 且两字段齐备；找不到 → `HARNESS_ERROR` |
| **未构造时**的任何读取为 `[]` | **合法**，且不对版本断言（与 AD-14 决策 5 一致） | 驱动在构造前不读诊断；读取侧不因空集断言版本 |

---

## 6. 偏差台账

### 6.1 spec 文字漂移（实测事实，已在实现中按事实落地；**未**改 spec 文件）

| # | spec 写法 | 实测事实 | 处理 |
|---|---|---|---|
| **D1** | `dsh.reviewWorkspaceDiffs` 在 `apps/vscode-dsh/src/extension.ts:812` | 实际在 **`extension.ts:872`** | 按实际行号定位；影响 spec 的「第 5 步命令可达性」取证位置（AC-25 step5） |
| **D2** | `agent-presets` overlay 指向 IDE patch | 实际在 **`packages/bundle/sdk-app/cordis.patch.yml:46-55`**（spec 所指 IDE patch 只有 15 行、无该行） | 影子 preset 生成器按**实际** overlay 位置定位被删的 2 行；影响 AD-15 route A 的「严格 2 行删除」构造 |
| **D3** | 只改 `README.md`（`README.zh.md` 视为已存在、`README.i18n.yaml` 视为需重录） | `README.zh.md` **不在 HEAD 中**（`git cat-file -e` → 不存在），`README.i18n.yaml` 亦不存在 | 按「**补齐配对**」处理：新增 `README.zh.md` + `README.i18n.yaml`；影响 AC-33 的文档面与文档门禁（`test:docs`） |
| **D4** | `.gitignore` 规则「需确认」 | 规则与目录**都不存在**（`git check-ignore` 退出码 1） | 遵守 spec 顺序约束：**先**落 `.gitignore` 规则、**后**创建探针/截图文件；影响 AC-26 与 AC-33（否则产物索引可能落入被 ignore 目录） |

### 6.2 我的实现偏差（需 reviewer 关注）

| # | 偏差 | 影响范围 | 原因 | 影响 |
|---|---|---|---|---|
| **D5** | `dsh.test.injectDisconnect` 由「直接戳编排器 FSM（`orchestrator.onUnexpectedDisconnect()`）」改为「真实杀死运行时连接（`host.injectRuntimeDeath()`），FSM 由**产品自身**的状态观察退出」 | AC-6a（`vscode-dsh-chat-ready`）的「同 FSM 入口」性质；`spec.md` §R1.3；`design.md` AD-14 | R1 要求记录**必须**携带 `resolvedExecutable` + `source`。编排器侧**拿不到**启动时解析的 `ResolvedNodeExecutable`，自造 `failed` 快照也**无生产者**；唯一能同时满足两字段与「只一条」的落点是 Host 死亡边。原实现是「无生产者的合成态」，与 DEBT-010 描述同源 | FSM 入口**未变**（仍经 `onUnexpectedDisconnect`，实测 `layer-v-inject-disconnect.spec.ts:156`），但**触发方式**变了：现在走真实死亡边。属测试钩子语义收紧（更贴近真机崩溃），非产品行为变更 |
| **D6** | 给 `HostFailureRecorder` **接口**补 `lastSeq?()`（类上本就存在，`host-diagnostics.ts:393`） | AD-14 记录面契约 | 接口是记录器的对外契约，AC-22/去重读取依赖该高水位；把只在类上存在的成员契约化，**零运行时行为变更** | 无行为影响；若 reviewer 认为超范围，可回退为「只在类上」 |
| **D7** | 三个既有测试文件加 `beforeEach/afterEach` 清除/恢复 `process.env.DSH_NODE_BIN` | 测试环境隔离（AC-10/AC-11(b) 判定） | 开发机若导出 `DSH_NODE_BIN`，解析链会优先命中它，导致「设置项来源」用例恒红（`source: 'dsh-node-bin'` 而非 `vscode-setting`）——**假红**，非产品缺陷 | 仅测试卫生；不影响产品行为。spec 的「显式清除继承 `DSH_NODE_BIN`」要求在**脚本**侧已落实，此处是测试侧同类问题 |
| **D8** | `pnpm-lock.yaml` 在工作区出现 `7+/4-` 改动（新增 `tsdown` 条目 + `importers` 段重排） | 依赖面 | 由 `pnpm install` 的一致性回填产生：**没有任何 `package.json` 被改动**（`git diff --stat` 为空），故**非新增依赖** | 建议调度者在 HG-3 按清单决定是否纳入提交；若不纳入，`git checkout -- pnpm-lock.yaml` 即可（**本 agent 未执行任何 git 操作**） |

### 6.3 未做 / 不做的事（边界声明）

- **未**修改 `packages/core/agent-loop`；**未**新增任何 npm 依赖（`apps/vscode-dsh/test-scripts/layer-v-driver/package.json` 无依赖、无 `bin`）。
- **未**触碰真实 `~/.dsh`（route A 的 `HOME` 沙箱是唯一写入面，且由脚本断言真实 `~/.dsh` 摘要不变）。
- **未**使用注入/回放构造 Diff（`dsh.test.openHistory` 未用于构造）；**未**使用 UI 自动化（`xdotool` 等）。
- **未**放宽影子 preset 的「严格 2 行删除且零新增」断言；生成逻辑不经过 formatter / YAML 重排。

---

## 7. 命令与真实结果

### 7.1 影子 preset 生成器自检（**先于**真机链路，spec 明文要求）

```bash
bash apps/vscode-dsh/test-scripts/layer-v-shadow-preset.sh --check-shadow-preset
```

实测输出（退出码 **0**）：

```
[1/5] shipped preset layout assertion (lines 28-29)
      shipped sha256: e1a9a55d7aefa990d172d7d37b93047439e4bfcf517227e9645f2c11c79f360e
[3/5] determinism: run1 sha256: f0e15ed61a6e516a2f103b8557a07ad386e25bc43578ffa5539da1a7bdb15915
                   run2 sha256: f0e15ed61a6e516a2f103b8557a07ad386e25bc43578ffa5539da1a7bdb15915
[4/5] diff against shipped (must be 2 deletions, 0 insertions)
      28,29d27
      < - id: orchestrator-tool-policy
      <   name: '@deepseek-ai/dsh-specdev-presets/orchestrator-tool-policy'
[5/5] shipped preset untouched: sha256 unchanged e1a9a55d…f360e
PASS: shadow preset is the shipped preset minus rows 28-29 (+0 lines)
```

### 7.2 构建（顺序按 spec；**冒烟脚本不会替你构建**）

```bash
pnpm run build:lib:host
pnpm --filter @deepseek-ai/dsh-vscode-dsh run build:host
pnpm run webview:build
```

三条命令均成功；`build:host` 产物内含本 Phase 的 `dsh.test.answerApproval` 与 `post-handshake`（已在 `project-build` skill 记录校验方式）。

### 7.3 真机冒烟

```bash
bash apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh      # 正向
# 负向（AC-27(b)）：临时以环境变量注入故障（把 dsh.reviewWorkspaceDiffs 替换为不存在的命令）
# 负向（AC-32）：cd 到无 .env 的 cwd 后运行
```

| 运行 | 结论 | 退出码 | 证据 |
|---|---|---|---|
| 正向（最终） | **`PASS`** | **0** | 五步截图齐备；`step-5-native-diff.png` 来自**模型原生** `meta.diffs`；R1 段产出 `phase:'post-handshake'` 记录，`source=vscode-setting`、`resolvedExecutable=` 24.3.0 绝对路径 |
| AC-27(b) 故障注入 | `LINK_FAILURE` | **1** | `reason=step-5-review-command-failed`，输出失败步骤名，未输出通过结论 |
| AC-32 负向 | `SKIPPED_NO_CREDENTIALS` | **3** | `reason=missing-credentials`，**未**计入链路失败 |
| AC-28 显示 | `display.mode='reuse'`（`DISPLAY=:1` 可达） | — | `report_meta.json.display` |

三条记录均已写入 `artifact-index.md`（时间 / 结论 / 退出码 / 五步文件名），该文件被 git 追踪。

### 7.4 单元 / 集成测试

```bash
pnpm run test apps/vscode-dsh
```

结果：`Tests 418 passed | 6 failed | 1 skipped (425)`；`Test Files 49 passed | 4 failed (53)`。

**失败 6 条为本机既有基线**（`spike-t0a-replay-rebuild` × 2、`AC-76`、`AC-77`、`VP-1-close`、`V-A4`；`spike-t0a` 还带 `requireActive` 未处理拒绝），**与本 Phase 改动无交集**；本 Phase 新增/修改的测试文件（`interaction-approval-resolution` / `layer-v-inject-disconnect` / `host-diagnostics` / `session-host` / `node-env-guard`）**全绿**。基线在 `project-test` skill 中已标注（含最后验证时间）。

### 7.5 文档门禁

```bash
pnpm run test:docs
```

结果：与改动前**同一组 6 条失败**（既有基线，均与本 Phase 无关）；双语配对面：`README.zh.md` ↔ `README.i18n.yaml` 配对一致。

---

## 8. 桩与债务

- **`@STUB` 自检：本 Phase 产出中零 `@STUB(...)` 标记**（`grep` 于新增脚本/驱动/源码/测试与三份 phase 产物 → 无命中）。
- `DEBT-010` 已从「活跃债务」迁入「**已解决**」，验证方式列含三条独立证据（见 §3），并把原先「剩余边界：走编排器 FSM 而非 Host 死亡边」的表述更正为实测落点（§4）。
- 其余活跃债务（`DEBT-004` / `DEBT-009` / `DEBT-011`–`DEBT-013`）均为用户已裁定「承接为债、本 Phase 不改」的条目，本 Phase **未**新增、**未**关闭。

---

## 9. 自检表（完成前自检）

| 检查 | 结果 |
|---|---|
| 空壳函数扫描（`(void)` / `return []` 型桩） | ✅ 无：驱动与脚本每条分支都有真实副作用与断言（`resolveApproval` 真 settle + abort；`recordTransportDeath` 真写记录） |
| 连通性：数据存 → 谁读 | ✅ `recordTransportDeath` 写入 → `records()` 读取 → `dsh.test.getDiagnosticsText` → 驱动 R1 断言（真机实测贯通） |
| 连通性：我调用 → 是否桩 | ✅ `finishApproval` / `entry.abort` / `client.close` / `onStatusChange` 均为既有产品实现 |
| 连通性：被谁调用 → 端到端一次 | ✅ 真机 EDH 五步链路（含审批与原生 Diff）已完成一次完整往返 |
| 警告信号扫描（`TODO` / `will be wired` / `placeholder`） | ✅ 本 Phase 新增产物中无 |
| 测试质量：功能被禁用会红？ | ✅ `layer-v-inject-disconnect.spec.ts` 在移除 `recordTransportDeath` 时变红（记录的缺失/字段缺失两条断言均会失败） |
| 测试质量：主路径断裂会红？ | ✅ `session-host.spec.ts:455/502` 覆盖「字段来源」与「只一条」两条主路径性质 |
| UI 完成定义（8 项） | N/A —— 本 Phase `ui: false` |
| Git 分支 | ✅ 全程 `impl-phase-3-layer-v-smoke-loop`；未 commit / 未 checkout / 未 push |

---

## 10. 遗留问题与需 reviewer / 调度者关注的点

1. **D5（`injectDisconnect` 语义收紧）** 是本 Phase 唯一触碰产品侧运行时行为的改动，建议 reviewer-connectivity 重点核对「FSM 入口未变、且不再有第二条记录通道」。
2. **D8（`pnpm-lock.yaml`）** 需调度者在 HG-3 提交时决定是否纳入（本 agent 未执行 git 操作）。
3. **基线红灯 6 条**（`apps/vscode-dsh`）与**文档门禁基线 6 条**为本机既有问题，本 Phase 未修（不属本 Phase 范围）；如需修，应另立 Phase / 债条目。
4. 本机 `node` 默认 v20.16.0 不满足 `engines.node` —— 跑真机链路**必须**先按 §7.2 / README 前置 `PATH`（脚本已内置该前置，但手工跑 `pnpm` 时仍需自行处理）。
