# Correctness Review — Phase 3 `phase-3-layer-v-smoke-loop`

## 视角

**Implementation Correctness** — 代码是否正确工作。不评价设计一致性 / 集成连通性 / 视觉（分别属 `reviewer-design` / `reviewer-connectivity` / `reviewer-visual`）。

审查基线：`300f492f84`；当前分支 `impl-phase-3-layer-v-smoke-loop`；本 Phase `ui: false`。

## 判决

**MUST-FIX**

> 判据：AC-11 在 `spec.md` 的验证方法列明文要求脚本在 `layer-v-status.json.node` 中写出**两个覆盖面各自**的结论，且 (a) `terminalSide` 必须含「是否过门槛」的判定 + 「终端侧需执行的动作」+ `docs/development.md` 责任清单锚点。实测 `node` 段**没有** `terminalSide` 这个字段、没有该侧的 ✅/❌、没有动作文本、没有文档锚点 —— 该 AC 的 (a) 半边未被实现，属「任一 AC 未满足 → MUST-FIX」。
>
> `DEBT-010` 修复本身（R1 要求的字段级证据）**经独立核验为正确**：18 字段集不变、版本唯一真相源升为 2、两条记录边互斥、`resolvedExecutable` / `source` 取值来源正确且真机记录恰 1 条。**没有**把「与 `design.md` AD-14 原文（两成员 / 版本 1）不一致」计入缺陷（该偏离已由 `scope-amendment-01` 授权）。

## 逐条 AC 验证

| AC | 实现位置 | 判定 | 证据 |
|----|---------|:--:|------|
| AC-11(a) 终端侧 | — | ❌ | `layer-v-status.json` 的 `node` 键 = `path/version/source/directory/defaults/dshNodeBin/extensionSubprocessSide`，**无 `terminalSide`**；`run-layer-v-smoke.sh:366 measure_path_defaults` 只写事实（`defaults.withoutCandidateDir.qualified:false`），无判定字段、无动作文本；`rg 'terminalSide|development\.md'` 于脚本/驱动/README → 0 命中（本机 `docs/development.md` 存在且含 `#node-environment` 段，锚点可写而未写） |
| AC-11(b) 子进程侧 | `host-diagnostics.ts:70,131,405,413`；`session-host.ts:822-838`；驱动 `extension.cjs:1930-1988` | ✅ | 真机记录：`phase='post-handshake'`、`source='vscode-setting'`、`resolvedExecutable=/usr/local/n/versions/node/24.3.0/bin/node`（= 脚本预置绝对路径）；驱动对「恰 1 条 / 两字段 / source=setting / fieldSet」全部 `throw harnessError` 硬断言（`:1931-1971`） |
| AC-12(a) 前置 PATH | `run-layer-v-smoke.sh:2395` + `report_meta` | ✅ | `node.path=/usr/local/n/versions/node/24.3.0/bin/node` = `directory` 候选目录内；`defaults.distinctFromUnprependedDefault:true`（≠ 未前置默认项） |
| AC-12(b) 反向构造（fake-node-dir） | — | 🟡 | 无运行证据：`implementation.md` §7.3 只有 3 次运行（正向 / AC-27(b) / AC-32），无 `PATH=<fake-node-dir>:$PATH` 构造（见 🟡 F3） |
| AC-12(c) 源内前置语句 | `run-layer-v-smoke.sh`（`PATH` 前置段） | ✅ | 源码断言存在；`defaults.*` 三字段即其运行时旁证 |
| AC-23 单命令无人工 | 脚本唯一入口 | ✅（证据侧） | PASS 运行的 `steps[1..5]` 顺序 `ok`；无 stdin 读取（代码审读）。**未**由我重跑，见「未能验证」 |
| AC-24 `--extensionDevelopmentPath` 双 flag | 驱动自证 + `report_meta` | ✅（证据侧） | `layer-v-status.json` 的启动段 + 驱动扩展 id 自证 |
| AC-25 step1 | 驱动 step1 | ✅ | `steps[0].status='ok'`，含 `triggerAutoReady` gated 正常态处理 |
| AC-25 step2 | 驱动 step2（不 await） | ✅ | `steps[1].status='ok'`；`assertions.newTab:true` 在真实轮询之后（`extension.cjs:1154`） |
| AC-25 step3（含 `replay` 反向断言） | 驱动 step3 | ✅ | `steps[2].status='ok'`，信封 inner/outer 双 `ok`（`extension.cjs:1220` 只在双 `ok` 后写入） |
| AC-25 step4（审批 + `/var/tmp` 拒绝 + 25 工具面） | 驱动 step4 + 脚本 2050-2054 | ⚠️→🟡 | 本运行 `toolCount=25` ✅、审批 `allowed-once` ✅、探针清理 ✅；但 `toolCount!==25` 只进 `warnings`（见 🟡 F2） |
| AC-25 step5（模型原生 `meta.diffs`） | 驱动 step5 | ✅ | `assertions.nativeDiffs/logMetaDiffs/diffTab/diskMatches`（`extension.cjs:1893`）均在硬断言之后；`diffSource:'native-meta-diffs'`，无注入 |
| AC-25（命令面）静态 | 驱动源码 | ✅ | 白名单 + 无 `dsh.test.openHistory` + 无 `xdotool`（`rg` 0 命中） |
| AC-26 产物 + 稳定命名 + ignore | `.gitignore:52` | ✅ | 5 张 PNG 齐备、magic bytes `89504e470d0a1a0a`、520KB–657KB、命名 `step-<n>-<slug>.png`；`git check-ignore -v` 命中仓库根规则 `.gitignore:52`（`apps/vscode-dsh/test-artifacts/`）；`git status --porcelain` 无输出 |
| AC-27(a) step3 失败路径 | 驱动 fail 分类 | 🟡 | 无运行证据（未做 `DEEPSEEK_BASE_URL` 不可达构造）；AC-27(b) 有证据 |
| AC-27(b) 故障注入 | 脚本 + 驱动 | ✅ | `conclusion=LINK_FAILURE`、`exit=1`、`reason=step-5-review-command-failed`；参考其 `artifact-index.md` 行 |
| AC-28 显示顺序 | `run-layer-v-smoke.sh:427-470` | 🟡 | (a) `mode='reuse'` ✅ 有证据；(xvfb 分支) 与 (b) `SKIPPED_NO_DISPLAY` 无运行证据；且「优先 `xvfb-run`」未实现（F3/F4） |
| AC-29 进程回收（含 Crashpad） | `run-layer-v-smoke.sh:1352-1423` | ✅（证据侧） | `report_meta.processResidue` + 源内 `setsid`/`processGroupKill` 断言；`crashpad` 显式匹配 `<UD>/Crashpad` |
| AC-30 socket 释放 | 脚本 | ✅（证据侧） | `report_meta.bridgeSocket.released=true` |
| AC-31 真实模型往返 | 驱动 step3 + 脚本 | ✅ | `steps[2]` 标注真实模型；`rg 'fake-sdk-runtime|llm-mock-server|fixture'` 于脚本/驱动 → 0 命中 |
| AC-32 缺凭据 ≠ 链路失败 | 脚本 | ✅ | 负向运行 `SKIPPED_NO_CREDENTIALS` / `exit=3`；`artifact-index.md:45` 有该行 |
| AC-33 文档 + 被追踪索引 | `README.md` / `README.zh.md` / `artifact-index.md` | 🟡 | 四节齐备、文件被 git 追踪 ✅；但追加逻辑破坏了索引表格结构（见 🟡 F5） |
| AC-10 补充证据 | 同 AC-11(b) | ✅ | `node.dshNodeBin` 含 `inherited/unsetPerformed/printenvAfterUnset/assertion`（脚本显式清除 + 空值断言）+ 字段级记录 |
| AC-13 / AC-14 补充证据 | 驱动 `:1941-1957` | ✅ | `schemaVersion=2` → 走 `>1` 分支（只断 v1 子集）✓；`Number.isInteger` 校验 ✓；`===1` 时才做 18 字段精确断言 ✓ |
| 回归（`pnpm run test apps/vscode-dsh` 全绿） | — | 🟡 | 字面未达：`Tests 6 failed | 418 passed`。**已独立证实 6 条均为本机既有基线**（见下 §2），非本改引入；但该口径须在 HG-3 显式接纳 |

## 七项独立核验（实际动作 + 结果）

### 1. `DEBT-010` 修复的正确性

**动作**
- `git --no-pager diff 300f492f84 -- apps/vscode-dsh/src/{host-diagnostics,session-host}.ts`
- `rg -n "HOST_DIAGNOSTIC_SCHEMA_VERSION"`、`rg -n "schemaVersion: *[12]\b" apps/vscode-dsh/src`
- 读 `session-host.ts:408-469`（`start()` 主体）、`:731-838`（`watchTransport` / `onTransportDeath` / `recordTransportDeath` / `injectRuntimeDeath`）
- 读 `packages/sdk/client/src/client.ts` 的 `TransportClosedError` 定义
- `node -e` 读真机产物 `layer-v-status.json` 的 `postLink` / `node` 段与 `layer-v-corroboration.json`

**结果**
| 待核项 | 结果 |
|---|---|
| 字段集仍**恰 18** | ✅ 真机记录 `Object.keys(record).length = 18`；驱动 `postLink.fieldSet = {expectedV1Fields:18, actualKeys:18, missingFields:[]}`；测试 `expect(Object.keys(death)).toHaveLength(18)` |
| 不增字段 / 不改名 / 不改可空性 | ✅ `git diff` 中 `HostDiagnosticRecord` 接口**零改动**（改动只在 `HostDiagnosticPhase` 联合类型、`HostDiagnosticInput` 增可选 `phase?`、`HostFailureRecorder` 增可选 `lastSeq?()`） |
| 版本升为 `2` | ✅ `host-diagnostics.ts:26` = `2` |
| 唯一常量真相源、无散落字面量 | ✅ 全仓 `rg HOST_DIAGNOSTIC_SCHEMA_VERSION` 仅 `host-diagnostics.ts:26/76/79/80/407` + 测试引用；`rg "schemaVersion: *[12]"` 于 `src/` → 仅 `:407` 一处且取自常量；驱动侧旧字面量 `1` 已改为 `V1_RECORD_FIELDS.length` 派生 |
| 字段面改动与版本 +1 **同一次改动**（AD-14 决策 11） | ✅ 同一 `git diff` hunk 组内：`:70`（第三成员）+ `:26`（版本）= 同一工作区改动；测试 `host-diagnostics.spec.ts:141/183` 对字面量 `2` 断言（bump 常量即红） |
| 互斥判别不被竞态绕过 | ✅ 读 body：`onTransportDeath` 在**任何 await 之前**同步读 `this.status`（`:777-778`），`'starting'` → 不记录、`'connected'` → 记录。三条竞态均闭合：① 握手前死亡 → `start()` catch（`:449-459`）记录、死后状态非 connected → 边界不记录，恰 1 条；② 握手响应已达但 `status` 尚为 `'starting'` 时死亡 → 边界不记录、`start()` 成功返回 → 编排器合成 `process-failed` 由 listener 记 1 条 `other`（**无重复**，正是新补的那条边）；③ 死亡后 `start()` 不再可能进入 catch（已成功返回）→ 边界记录独有 |
| 记录**先于**状态迁移（防 listener 二次记账） | ✅ `:781 recordTransportDeath` → `:782 this.status='error'` → `:808 notifyError`（注释 `:771-773` 与代码一致） |
| 新记录携带 `resolvedExecutable` + `source` 且来源正确 | ✅ `:826 const resolved = this.nodeExecutable`（`:236` 声明、`:418` 赋值 = `start()` 内 `resolveNodeExecutableSpec()` / `options.nodeExecutable` 的**同一对象**，即 `:432` 传给 `new HarnessClient` 的那个）；真机值 = `/usr/local/n/versions/node/24.3.0/bin/node`，与 `report_meta` 的 `node.path` 逐字相同；**非重新解析** |
| 同一失败不重复记录（R1.3「恰 1 条」） | ✅ 真机 `postLink.postHandshakeRecordCount = 1`；驱动 `post.length !== 1 → linkFailure`（`extension.cjs:1931-1937`）；集成用例 `session-host.spec.ts`（post-handshake 与 in-flight 两向）各断言 `toHaveLength(1)`；`layer-v-inject-disconnect.spec.ts:136/153/193` 断言恰 1 条 + 二次调用不可再制造 |
| `retryOfSeq` 语义 | ✅ `:413 retryOfSeq: afterHandshake ? null : this.chainStartSeq`，`:430` 让 post-handshake 记录**成为**后续重试链的开端 → 真机 `retryOfSeq: null`，重试记录 `phase:'retry' / retryOfSeq:1`（`layer-v-inject-disconnect.spec.ts:198-200`） |

### 2. 「6 条失败为本机既有基线、与本改无交集」

**动作**
- `PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH pnpm run test apps/vscode-dsh` → 日志 `/tmp/dsh-cur.log`
- `git worktree add /tmp/dsh-base-check 300f492f84`（**只读对照树**，未对工作区做任何 git 写操作）+ 从主树 symlink `node_modules` → 同命令 → `/tmp/dsh-base-full.log`
- 把工作区既存未跟踪构建产物 `vendor/cordis/src/*.js` 复制进对照树后再跑 → `/tmp/dsh-base-focus2.log`；再单独跑 `spike-t0a` → `/tmp/dsh-base-spike-alone.log`
- `rg "host-diagnostics|session-host|interaction-coordinator|extension\.ts|injectDisconnect|answerApproval|layer-v"` 于 4 个失败文件

**结果**
| 失败项 | 是否触及本 Phase 改动 | 基线对照 |
|---|---|---|
| `spike-t0a-replay-rebuild.spec.ts`：AC-30/47、AC-76、AC-77、AC-80（4 条） | ❌ 不 import 任何改动文件（该文件只 import `@deepseek-ai/dsh-llm` / `dsh-session` / `dsh-session-query` / `cordis`） | 对照树**不**带工作区未跟踪 JS 时全绿；带上后同样 4 条红；单独跑 `spike-t0a` 全绿（隔离失败，非逻辑失败） |
| `spike-t0b-continue-capability.spec.ts`（加载错误、0 测试） | ❌ 同上 | 同源同因 |
| `panel-close-delete.e2e.spec.ts:11`（import `session-host.ts`！） | ⚠️ 触达改动文件 | **在 `300f492f84` 上同样失败**（`/tmp/dsh-base-full.log:15`）→ 非本改引入 |
| `verifier-phase1/layer-a-rtl.spec.tsx`（V-A4） | ❌ | **在 `300f492f84` 上同样失败**（`/tmp/dsh-base-full.log:34`） |

**结论**：implementer 的核心主张**成立** —— 6 条失败无一由本 Phase 改动引入；新增的 2 个测试文件不在失败集中（对照树 51 个测试文件 vs 当前 53 个，恰为本 Phase 新增的 2 个）。两点修正：① 4 条 spike 失败是「带既存未跟踪 `vendor/cordis/src/*.js`（mtime 2026-09-11）时的环境/隔离性失败」，而非无条件恒定失败（干净的 base 树里它们全绿）；② `Test Files 4 failed` 的第 4 个文件（`spike-t0b`，加载错误）未在 `implementation.md` §7.4 列出。

### 3. D6（`HostFailureRecorder.lastSeq?()` 契约化）= 零行为变更？

**动作**：`git --no-pager diff 300f492f84 -- apps/vscode-dsh/src/host-diagnostics.ts` 逐 hunk 读；`rg -n "lastSeq" -B6 -A12`。

**结果**：
- 接口成员新增（`:185-195`）本身**零行为** ✅（类上 `lastSeq()` 建于 Phase 2，`:451-453` 实现未改）。
- ⚠️ **但同一文件的同一次改动还包含一处真实行为变更**：`createStartFailureListener` 现在为「编排器自行合成、无 Host 边界记录的 `process-failed`」补写一条 `kind:'other'` 记录（`:323-345`，判定 = 高水位 `mark()` 未移动）。这不是 D6 声称的「零运行时行为变更」的**唯一**内容，且它**未登记在 §6.2 偏差台账**，而 §3 第 3 点的措辞（「不写记录…避免第二条通道」）与之相左 → 见 🟡 F6。该变更本身经核**正确**（互斥成立、真机恰 1 条、两条新用例覆盖两种相对顺序，文件名即 `DEBT-010`）。

### 4. D8（`pnpm-lock.yaml` `7+/4-`，无 `package.json` 改动）

**动作**：`git --no-pager diff --stat 300f492f84` 全量 + 对 `pnpm-lock.yaml` 逐 hunk 读 + 检查 `vite` 引用一致性。

**结果**
| 项 | 观察 |
|---|---|
| `package.json` 改动 | **零**（`git diff --stat 300f492f84 -- '**/package.json'` 为空）✅ 与自述一致 |
| 内容 1 | `importers['apps/vscode-dsh']` 补 `tsdown` 条目 —— 该依赖在 `apps/vscode-dsh/package.json` 中**已存在**（Phase 1/2 加入），是把 lockfile 补齐到 `package.json` 的回填 |
| 内容 2 | `importers['packages/sdk/server']` 段重排（`@deepseek-ai/dsh-specdev` 位置变化）—— 纯顺序 |
| 内容 3 | `vitest` 快照的 `vite` peer 由 `6.4.3` → `8.0.16`：`vite@8.0.16` 快照**已存在**于同一 lockfile（另一条目），无悬空引用；`vite@6.4.3` 条目仍有 10 处消费者 → 属部分回填，非破坏性 |
| 是否影响可重现安装 | `pnpm install --frozen-lockfile` 的语义面（lockfile 与 `package.json` 一致）**未被破坏**；但该改动**不是**本 Phase 任何 AC 的产物 |

**判断**：真实的一致性回填（非新增依赖），但与本 Phase 交付物无关 → **建议不纳入本次提交**（`git checkout -- pnpm-lock.yaml` 即可，由调度者在 HG-3 决定；我未执行任何 git 写操作）。

### 5. 13 条 AC 与断言强度

**动作**：逐条对照 `spec.md` 验证方法列，读驱动与脚本的断言位置（`extension.cjs:1076/1154/1220/1274/1679-1758/1813/1893/1930-1988/2098-2138`、`run-layer-v-smoke.sh:1733-1750/1819/2050-2054/2095-2108/2395`），并行读真机产物。

**结果**
- **未被放宽**（逐条确认）：`meta.diffs` 非空 + `oldText`/`newText`（硬断言）、五步齐备（runner 循环 + `steps[]` 全 `ok`）、`replay` 反向断言（双 `ok` 才放行）、审批 `/var/tmp` 首步被拒立即判 `LINK_FAILURE`、`schemaVersion` 版本分流（`===1` 精确 18；`>1` 只断 v1 子集）、R1 的「恰 1 条 + 两字段 + `source` 值」全为 `throw`。
- **被放宽 1 处**：`toolCount !== 25` 只进 `warnings`（`:2053-2054`），而 `warnings` 在 `:2107-2108` 只 `note`，**不影响结论/退出码** → 见 🟡 F2。本运行 `toolCount=25`、`corroboration.warnings=[]`，**未**造成假 PASS。
- **无运行证据 3 处**：AC-12(b) 反向构造、AC-27(a) step3 失败路径、AC-28 的 xvfb 与 `SKIPPED_NO_DISPLAY` 两分支 → 见 🟡 F3。

### 6. 桩与空壳

**动作**
- `rg -n "TODO|FIXME|placeholder|not implemented|(void)|return \[\]|@STUB"` 于 4 个改动源码 + 脚本/驱动 + 2 个新测试文件
- `rg -n "assertions:" -A 4` 于驱动，逐处回看其前置守卫
- `rg -n "@STUB"` 于 `.specdev/specs/vscode-dsh-usable-loop/phases/phase-3-layer-v-smoke-loop/`（含三份产物）

**结果**：**零桩、零空壳**。
- 唯一 `placeholder` 命中是 `run-layer-v-smoke.sh:2254` 的 artifact-index 占位行字符串（文档模板，非代码桩）。
- `(void)` 命中全为 `void this.pump()` / `void Promise.resolve(...)` 的既有 fire-and-forget 惯用法（改前即存在），非吞异常空壳。
- 驱动的 `assertions: {…true}` 六处**全部**在 `throw` 守卫之后写入，非恒真断言（逐处核对：`:1076` 后 `:1154` 后 `:1220` 后 `:1274` 后 `:1893` 后 `:1988`）。
- 本 Phase 产物内**零 `@STUB(...)`** → 与 `tech-debt-registry.md` 交叉核无缺口；`DEBT-010` 已迁入「已解决」，其余活跃债务（`DEBT-004`/`009`/`011`–`013`）均非本 Phase 新增且未被本 Phase 误报。

### 7. `layer-v-shadow-preset.sh` 的「严格 2 行删除且零新增」

**动作**
- `bash apps/vscode-dsh/test-scripts/layer-v-shadow-preset.sh --check-shadow-preset`（本机实跑）
- `rg -n "NR >=|awk|sed"` 于主脚本，核对是否存在第二处生成实现
- 读 `run-layer-v-smoke.sh:2340-2410`（自检调用与失败归类）

**结果**
- 自检退出码 **0**；实际 `diff` = `28,29d27`，删除两行即 `- id: orchestrator-tool-policy` 与其 `name:` 行，**零新增**；两次生成 `sha256` 相同（确定性）；shipped preset 前后哈希相同（未被改）。
- 生成逻辑为**行号 + 原文**双重前置断言（不符即 fail loud），未见模糊匹配删除；主脚本内**无**第二处生成实现（主脚本只 `source` 该脚本，且非零退出 → `HARNESS_ERROR`，并对投放副本与两次生成做交叉哈希）。
- 与 `design.md` AD-15 route A 的硬约束一致。

## Stub Detection

| 类别 | 结果 |
|---|---|
| 已注册桩（对照 registry） | 无（本 Phase 产物无 `@STUB`；`DEBT-010` 已解决） |
| 新发现未注册桩 | **0 条**（源码/脚本/驱动/测试全部有真实副作用与断言） |

## 关键发现

### 🔴 Must-Fix

- **F1 — AC-11(a) `terminalSide` 证据面缺失**（`layer-v-status.json` 的 `node` 段；`run-layer-v-smoke.sh:366-399`；驱动 `extension.cjs:2100`）
  `spec.md` 验证方法列要求 `node` 写出**两个覆盖面各自**的结论，且 (a) 侧含「是否过 AC-4 门槛」的判定 + 「终端侧需执行的动作」+ `docs/development.md` 责任清单锚点，并断言两侧各自给 ✅/❌。实测：`node` 键只有 `path/version/source/directory/defaults/dshNodeBin/extensionSubprocessSide`，**无 `terminalSide`**；`defaults.withoutCandidateDir.qualified:false` 是裸事实，无 `ok`/`judge`、无动作文本、无锚点（`rg 'development\.md'` 于脚本/驱动/README 为 0 命中，而 `docs/development.md#node-environment` 在仓库中存在）。
  影响：AC-11 的对称性要求（「不得由一侧的 ✅ 推导另一侧」）在产物层面无法被机器复核 —— 现在的产物只给出子进程侧判定。
  最小修法：脚本在 `node` 内补 `terminalSide: { ok:false, judge:'fail', path, version, qualified:false, action:'…（前置 PATH 到 /usr/local/n/…/bin 或改 dsh.nodeBin）', docsAnchor:'docs/development.md#node-environment' }`，并断言两侧字段同时存在且无合并字段。

### 🟡 Should-Fix

- **F2 — `toolCount === 25` 被降级为 warning 且未披露**（`run-layer-v-smoke.sh:2053-2054`、`:2107-2108`；驱动 `extension.cjs:1885-1886`、`:2146-2147`）
  AC-25 step4 的预期结果明文要求「证据来自本次运行的 25 工具面且 `toolCount === 25`」。实现是：缺失 → `problems`，**不等** → `warnings`，而 `warnings` 只 `note`、不改变 `conclusion`/退出码；`implementation.md` 全文未提 `toolCount`。本运行值恰为 25（`corroboration.toolCount=25`，`warnings:[]`）→ **无假 PASS**，但门禁强度低于 AC 口径。建议把不等提升为 `problems`（或至少在自述中披露该降级决定）。

- **F3 — 三处反向/分支构造缺运行证据**（`implementation.md` §7.3 只有正向 / AC-27(b) / AC-32 三次运行）
  (i) **AC-12(b)**：`PATH=<fake-node-dir>:$PATH` 的反向构造未跑；(ii) **AC-27(a)**：`DEEPSEEK_BASE_URL` 不可达使 step3 失败的路径未跑（仅 AC-27(b) 有证据）；(iii) **AC-28** 的 `xvfb` 分支与 `SKIPPED_NO_DISPLAY`（退出码 2）分支未跑（只有 `reuse`）。
  代码路径**真实存在**且看起来正确（`run-layer-v-smoke.sh:175-177 fail_display → SKIPPED_NO_DISPLAY/2`、`:427-470` 显示探测、`:2471-2472` 结论归类；驱动 `StageError`/`linkFailure`/`harnessError` 定级于 `extension.cjs:94-107`，跑步收口于 `:2098-2138`），未发现桩。建议由 `verifier` 独立补跑这三次构造后关闭。

- **F4 — AC-28 的「优先 `xvfb-run`」未实现**（`run-layer-v-smoke.sh:448-467`）
  spec 要求 `xvfb` 分支「优先 `xvfb-run`，否则自行拉起 `Xvfb`」。实测脚本**从不**调用 `xvfb-run`（`rg 'xvfb-run'` 于 `test-scripts/` → 仅 README 提到，脚本 0 命中），`start_xvfb` 直接 `command -v Xvfb` 并自拉，`Xvfb` 缺失即 `SKIPPED_NO_DISPLAY`。当 `Xvfb` 不在但 `xvfb-run` 在时会产生**过度跳过**。对本次运行（`mode='reuse'`）无影响。请实现偏好序或在自述中显式登记该偏离。

- **F5 — `artifact-index.md` 的表格结构被追加逻辑打散**（`.specdev/specs/vscode-dsh-usable-loop/artifact-index.md:14-46`；`run-layer-v-smoke.sh:2245-2268`）
  表头在第 14-16 行，第 18-24 行是散文段「Reading an entry」，追加的行从第 25 行继续 —— 22 条运行记录落在**表外**，Markdown 渲染时不再属于该表。插入代码的注释（`:2245-2250`）自称「Rows belong *inside* the run table, not at the end of the document」，实现是「插到最后一条以 `|` 开头的行之后」（`:2260-2268`）——`placeholder` 分支（`:2254-2257`）不适用（占位行早已被替换），于是插入点落在**散文之后的既有数据行块末尾**，缺陷自我延续（成因应是较早的运行曾用「文档末尾追加」）。AC-33(b) 的内容要求（时间/目录/结论/步骤映射）满足，但可复核性下降。修法：把散文段移到表格之前，或改为「插入到第一段连续表格块的末尾」。

- **F6 — `scope-amendment-01` §1.3 第二条记录边的实现落点未登记，且 §3 措辞相反**
  修订 §1.3 要求补两处记录边，其一写作 `auto-start-orchestrator.ts:225-229` 的自合成 `failed` 快照；实际由 `host-diagnostics.ts:323-345` 的既有 `createStartFailureListener` 补写 `kind:'other'` 记录（合法且更合理 —— listener 正是该快照的消费者，且 `auto-start-orchestrator.ts` 保持无 `record()` 生产者）。该行为变更**未**出现在 §6.2 偏差台账（D5–D8 均未涵盖），§3 第 3 点「不写记录…避免第二条通道」读起来与已交付行为相反。代码本身经核**正确**（互斥、去重、两条新用例、真机恰 1 条），仅需在台账补登一行并修正 §3 措辞。

- **F7 — AC「回归」的字面（全绿）在本机未达成，需显式以基线结论接纳**
  `pnpm run test apps/vscode-dsh` = `Tests 6 failed | 418 passed`。6 条已独立证实为本机既有基线（§2），非本改引入；但 AC 表写的是「全绿」。请在 HG-3 由调度者以「基线对照结论」显式接纳，不要默认视为通过。

### 🟢 Observations

- **O1 `[文档保真]`** `implementation.md` §7.4 的 6 条失败测试枚举与实测**逐条一致**（spike-t0a 共 4 条：AC-30/47、AC-76、AC-77、AC-80 + `panel-close-delete` + `layer-a-rtl`）；仅 `Test Files 4 failed` 的第 4 个文件（`spike-t0b-continue-capability.spec.ts`，加载错误、0 测试、不计入 `Tests failed`）未列出。底层主张为真，零影响。
- **O2 `[文档保真]`** `implementation.md` §4 与 `tech-debt-registry.md` 的 `DEBT-010` 行把 AC-11(b) 证据位置写作 `layer-v-status.json` 的 `r1.postHandshakeRecords[]`；该产物**没有 `r1` 键**，真机证据在 `postLink`（`postHandshakeRecordCount` / `record` / `fieldSet`）与 `node.extensionSubprocessSide`。底层主张为真，零影响。
- **O3** `recordTransportDeath` 对两个 R1 关键字段用条件展开（`session-host.ts:831`），`nodeExecutable` 缺失时记录会**少字段而不报错**。当前不可达（`:418` 在任何可能到达 `connected` 的 await 之前赋值），但建议在记录边断言两字段存在（fail loud），以免 R1 的证据面在将来静默退化。

## 未能验证 / 边界（明确声明）

1. **未由我重跑真机冒烟**（`run-layer-v-smoke.sh`）：AC-23/24/25/29/30/31 的「运行时」性质是通过**既有 PASS 运行的产物**（`layer-v-status.json` / `layer-v-corroboration.json` / 5 张 PNG / `artifact-index.md`）与脚本+驱动源码审读判定的。端到端复跑属 `verifier` 的独立职责，本报告不代替它。
2. **未运行「删代码看变红」的证伪探针**：那需要改产品代码，超出只读审查者的边界。`implementation.md` §9 自陈的探针结论我**未**独立复现，仅做了逻辑核验（移除 `recordTransportDeath` 必然使 `toHaveLength(1)` 变红）。
3. **spike 失败的根因未完全定位**：我只能证明「带上工作区既存未跟踪 `vendor/cordis/src/*.js`（mtime 2026-09-11）时，对照树 `300f492f84` 复现同一组 4 条 `spike-t0a` 失败 + `spike-t0b` 加载错误；不带时全绿；`spike-t0a` 单独跑全绿」——即「既有环境/隔离性问题」，但未追到协作者内部根因（不属本 Phase 范围）。
4. **未做任何 git 写操作**（除创建**只读对照树** `git worktree add /tmp/dsh-base-check 300f492f84`——该操作不修改当前工作区、不切换分支、不 commit；对照树仍在原处（detached `300f492f84`），可由 `verifier` 复用或由调度者 `git worktree remove` 清理，我未执行任何清理以免越界）；未修改任何产品代码 / 脚本 / 测试 / spec 文件。本次审查唯一写入是本报告文件。
