# Phase 3 范围修订 01 — `DEBT-010` 在本 Phase 内修复（用户裁定）

> 本文件共承载**两项**用户裁定：**修订 01**（`DEBT-010` 在本 Phase 内修复，见 §1–§3）与**追加裁定 R1**（AC-11(b) / AC-10 的字段级证据面，见 §3.5）。

| 项 | 值 |
|---|---|
| 修订编号 | `scope-amendment-01` |
| 产生时点 | Phase 3 的 **Phase Entry Gate**（实施之前，HG-3 之前） |
| 决策人 | **用户**（调度者以三选项呈现 `DEBT-010` 的处置方式，用户选择「在本 Phase 内修复」，未选「只评估留痕」与「关闭」） |
| 日期 | 2026-09-16 |
| 效力 | 对 Phase 3 的**全部**下游 agent（code-explorer / implementer / reviewer×4 / verifier）**有约束力** |
| 明确未改动 | Phase ID、DAG `id`、`dependencies`、AC 归属与 AC 语义、`ui: false` 标记、退出码/结论分类契约 |

> 目的：把「用户授权的范围扩张」写成可复核的书面决策。没有这份记录时，`reviewer-design` 会**正确地**把「代码与 `design.md` AD-14 原文不一致」判为 MUST-FIX —— 而该偏离实际上已获用户授权。本文件是该偏离的唯一授权依据。

## 1. 决策内容

`DEBT-010`（**握手之后**的运行期子进程死亡不产生任何 `HostDiagnosticRecord`，导致空诊断通道无法区分「本次运行没有启动失败」与「Host 启动成功后在运行期断线」）**在本 Phase 内修复**，而不是仅「评估 + 留痕」。

修法（用户所选方案明文）：

1. 给 `HostDiagnosticRecord.phase`（现为 `'start' | 'retry'`）增加**第三成员**，覆盖「握手之后 / 运行期」的失败边界。
   **不得**改用「新增独立记录面」—— 那会改变 18 字段集，连带放大 Phase 2 契约用例与 Phase 3 断言的改动面。
2. 按 AD-14 决策 11（**任何**字段面改动**必须**在同一次改动中 +1 版本）把 `HOST_DIAGNOSTIC_SCHEMA_VERSION` 由 `1` 升为 `2`。版本号**只有**这一个常量真相源（`apps/vscode-dsh/src/host-diagnostics.ts:20`），**不得**散落字面量。
3. 补上缺失的记录边（`DEBT-010` 已定位的两处）：
   - `apps/vscode-dsh/src/session-host.ts:727-757` 的 `onTransportDeath`（全 `src/` 唯一的 `record()` 调用点在 `:451` 的 `start()` catch 内，握手后死亡不经此处）；
   - `apps/vscode-dsh/src/auto-start-orchestrator.ts:225-229`（唯一一处由编排器自行合成、无任何生产者的 `failed` 快照，经同一次握手后死亡可达）。
4. 同步 Phase 2 已交付的契约完整性用例（`apps/vscode-dsh/tests/host-diagnostics.spec.ts`）。

## 2. 与既有冻结文档的关系（**必须理解，否则会误判为违规**）

| 文档 / 条款 | 原文口径 | 本修订后的口径 |
|---|---|---|
| `design.md` AD-14 字段契约 | `phase: 'start' \| 'retry'`；`schemaVersion` 恒为 `1` | `phase` 增加第三成员；`schemaVersion` 恒为 `2`。**字段集仍为 18 个**（不增字段、不改名、不改可空性） |
| `design.md` AD-14 决策 10（断言三口径） | `=== 1` → 18 字段精确断言；`> 1` → 只断 v1 子集并记录观测版本；缺失/`null`/非整数/`< 1` → `HARNESS_ERROR`；`[]` 合法且不对版本断言 | **完全不变**。因版本现为 2，Phase 3 的驱动与 reviewer / verifier 一律走 `> 1` 分支（只断 v1 子集 + 把观测版本记入证据），**不得**按 `=== 1` 断言 |
| Phase 2 的契约完整性用例 | 断言字段集恰 18、版本取自常量 | 字段集断言**不变**（仍 18）；版本断言若取自常量则随常量升位**自然通过**；**若发现硬编码字面量 `1`，必须改为引用常量**（这是本修订允许的最小改动） |
| Phase 3 `spec.md` | 未提及本修法 | **被本修订覆盖**。`spec.md` 一字未改；本文件是其显式、带日期的叠加层 |
| `tech-debt-registry.md` `DEBT-010` 行 | 目标Phase「Phase 3（评估）或下一个处理诊断面的工作流」 | 目标Phase 改为本 Phase；实现完成后由 implementer 迁入「已解决」 |

## 3. 对下游 agent 的硬约束

- **implementer**
  - 按 §1 的四项落地；**不得**顺手改动 `kind` 词表、**不得**新增字段、**不得**改 AC-18 的「启动窗口」读法口径。
  - 修复完成后把 `DEBT-010` 从「活跃债务」迁到「已解决」（含验证方式），并在 `implementation.md` 的偏差台账登记本次范围修订的实施结果与任何偏差。
  - 涉及 `phase` 第三成员与 `onTransportDeath` 记录边的改动，**必须**有对应单元/集成用例，且**必须**证明「同一失败不会被重复记录」（同一失败既走 `start()` catch 又走 `onTransportDeath` 时只应留一条）。
- **reviewer-design**
  - **不得**把「代码与 `design.md` AD-14 原文（两成员 / 版本 1）不一致」判为 MUST-FIX —— 该偏离已授权并在此留痕。
  - 但**必须**审查：第三成员的语义是否**真的**覆盖「握手之后」；`onTransportDeath` 的记录时机是否恰当；版本是否**只有一处**真相源；是否仍有**遗漏的记录边**。**修订未被完整实施 → 照常 MUST-FIX。**
- **reviewer-correctness**
  - **必须**独立检查「字段面改动与版本 +1 是否在同一次改动中完成」（AD-14 决策 11），以及新记录边**是否重复记录**、是否与既有 `start()` catch 路径冲突。
- **reviewer-connectivity**
  - **必须**检查新增记录边的**可达性**：握手后断线现在能产出一条可被 `dsh.test.getDiagnosticsText` 读到的记录，且不破坏 AC-18 的启动窗口读法。
- **verifier**
  - **必须**独立（不读 implementer 的自述）构造或复现「握手后断线」并断言产生记录；同时复核 18 字段集断言仍为 18、观测到的 `schemaVersion === 2`。
- **全部 agent**
  - **不得**把本修订登记为新的技术债（它是本 Phase 的**必做项**，不是待偿还的债）。
  - **不得**借本修订扩大边界（不改 `kind`、不加字段、不改 AC 语义、不改退出码契约）。

## 3.5 追加裁定 R1（同日，用户选定 B′）：AC-11(b) / AC-10 的字段级证据面

> 产生原因：`code-explorer` 的 phase 级调研返回 **🔴 BLOCKING 升级** —— 成功启动**不产生任何** `HostDiagnosticRecord`（`host-diagnostics.ts:341-343` 的 `onStartSucceeded()` 只重置失败链；`records()` 只含 `record()` 推入项；全应用 3 处 `record()` 全在失败路径），故绿灯运行下 `dsh.test.getDiagnosticsText` **必然返回 `[]`**，与 `spec.md:176`（AC-11(b)）「`[]` 判 `HARNESS_ERROR`」及 `:195`（AC-10 补充证据）「记录中**必须存在** `source === 'vscode-setting'`」按字面**无法同时满足**。调度者逐处复核确认该冲突成立，并**推翻**了调研报告的首选方案（「靠缺凭据触发 pre-handshake 记录」—— 该路径只写 `kind`/`detail`，**不含** `resolvedExecutable` 与 `source`，见 `host-diagnostics.ts:293`、`extension.ts:2368`）。

**用户裁定（B′）**：AC-11(b) 与 AC-10 补充证据的字段级证据，取自**五步链路完成后的一次受控运行期断线**记录 —— 即**直接复用修订 01 新增的记录边**。

由此产生的**新增硬要求**（对本 Phase 全部下游 agent 有约束力）：

1. **`debt-010` 新增的记录边必须携带 `resolvedExecutable` 与 `source`**。实现方必须在新的记录边上保留 Host 启动时已解析的 `ResolvedNodeExecutable`（`session-host.ts:408` 的产物）。仅"记录存在"**不满足**本要求。
2. 驱动在**五步链路全部结束之后**调用白名单内既有的 `dsh.test.injectDisconnect`（`extension.ts:1214-1217`）诱发断线；该构造**不得**扰动五步各自的干净沙箱断言（故置于其后）。
3. **前置实测（不得假设）**：`injectDisconnect` 走 `orchestrator.onUnexpectedDisconnect()`，其实际落点（`session-host.ts:727-757` 的 `onTransportDeath` ↔ `auto-start-orchestrator.ts:225-229` 的合成 `failed` 快照）**未经实测**。implementer **必须**实测落点、记录条数与两个字段的取值来源，并保证**同一次断线只产生一条记录**。
4. **不得静默降级**：若该构造在结构上无法产出带两个字段的记录，**必须**以 `LINK_FAILURE` / `HARNESS_ERROR` 带证据升级 —— **不得**改写为「`[]` 合法」或「无需字段证据」（那属于改 AC 验收口径，须用户批准）。
5. `[]` 的最终口径已由 `spec.md` 修订段 R1.2 钉死：**按 R1 完成构造后的那次读取**为 `[]` → `HARNESS_ERROR`；**未构造时**的任何读取为 `[]` → 合法且不对版本断言（与 AD-14 决策 5 一致）。

**该构造的语义**（供 reviewer / verifier 判定）：Host 已到达 `connected`，**证明 AC-4 预检已通过且所用解释器来自设置项**；随后被受控断线。记录中的 `resolvedExecutable` / `source` 因此是对**该次成功解析**的字段级陈述。

## 4. 本修订**未**改变的事项

- Phase 3 的 13 条 AC 及其验收口径（AC-11、AC-12、AC-23 – AC-33）与「补充证据」项（AC-10 / AC-13 / AC-14）。
- 真机执行方式（构建顺序、单命令入口、`VSCODE_DSH_TEST=1`）、**显式清除继承的 `DSH_NODE_BIN`**、route A（`HOME` 沙箱 + 影子 preset + 2 行删除断言）、五步链路与稳定命名截图要求。
- 退出码 / 结论分类契约：`PASS` 0 / `LINK_FAILURE` 1 / `SKIPPED_NO_DISPLAY` 2 / `SKIPPED_NO_CREDENTIALS` 3 / `HARNESS_ERROR` 4。
- `DEBT-004`（出厂 `ide` profile 主会话不可写）仍**不在**本工作流内修；本 Phase 用 route A 绕过，且其结论**必须**在 `verification.md` 中显式呈现。
