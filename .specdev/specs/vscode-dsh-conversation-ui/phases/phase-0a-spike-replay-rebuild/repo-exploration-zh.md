# 代码库调研报告 — phase-0a-spike-replay-rebuild

## 1. Task Context（任务上下文）

Phase 0a 是 Spike Gate **T-0a**（状态：**NOT RUN**）：在无产品 UI 的前提下，证明 DSH **权威会话日志**在 agent dispose 之后仍可打开，并一次性折叠为 (a) user/assistant 消息流条数/顺序/角色，(b) Timeline turn/step/tool 行，(c) 经 `tool/result.meta.diffs` 判定 Diff 可用性，(d) 不完整/中断回合可观测性 — 再为后续 `ReplayHydrator` 推荐 Host **读日志缝**（AD-CU-2）。交付物为 `spike-report.md` + 可重复 L1 脚本/测试（优先 `apps/vscode-dsh/tests` 或 `packages/ide/ide-bridge/tests`）。本报告梳理既有持久化 / 查询 / bridge / SDK / vscode-dsh 表面，供 implementer 实证 PASS/FAIL，无需发明存储或改动 `agent-loop`。

## 2. Repository Overview（仓库概览）

- **语言 / 运行时：** TypeScript ESM，Node `^22.19 || >=24`，Cordis 插件组合。
- **包管理：** pnpm workspaces（`packages/<group>/<pkg>/`，应用在 `apps/`）。
- **权威日志：** `@deepseek-ai/dsh-session` 的 `SessionEvent` 流；经 `@deepseek-ai/dsh-session-persistence` + 官方 JSONL 后端 `@deepseek-ai/dsh-session-persistence-jsonl` 落盘（默认 `dshHomePath('sessions')` 下 `session.jsonl.zstd`）。
- **查询层：** `@deepseek-ai/dsh-session-query`（+ sqlite 后端挂在 `dsh-base`，`openAt: never` — 精确读取仍可用，全文搜索关闭）。
- **IDE Host 路径：** `apps/vscode-dsh` → SDK JSON-RPC stdout + `packages/ide/ide-bridge` NDJSON Host 桥；profile `dsh --profile ide` = `dsh-base` + `dsh-sdk-app` + `dsh-ide`。
- **code2prompt：** 本环境不可用；本次用定向 glob/grep + 读文件（👁）。

## 3. Most Relevant Areas（最相关区域）

| 区域 | 路径 | 原因 | 来源 |
|------|------|------|------|
| 持久化 Service Definition | `packages/session/session-persistence/src/index.ts`, `handle.ts` | `create` / `open(id,'read'\|'write')` / `stat` / `list` / `SessionHandle.read` | 👁 |
| JSONL 后端 | `packages/session/session-persistence-jsonl/` | 磁盘布局、物化、无删除 API | 👁 |
| 冷读 + 中断 closer | `packages/session-query/session-query/src/cold-read.ts` | `readColdSessionLog` = 只读打开 + 内存中 `interruptedTurnClosers` | 👁 |
| Session query API | `packages/session-query/session-query/src/index.ts` | `listSessions`、`readSession`、`readSurface`、`listEvents` | 👁 |
| 中断修复 | `packages/core/session/src/repair.ts` | 合成 `tool/result` / `step/end` / `turn/end {interrupted}` | 👁 |
| Surface 折叠 | `packages/core/session/src/surface.ts`（`foldSurface`） | 从事件日志得到模型可见消息面 | 👁 |
| Base 组合 | `packages/bundle/base/cordis.patch.yml` | 挂载 persistence-jsonl + session-query-sqlite | 👁 |
| ide-bridge 线协议 | `packages/ide/ide-bridge/src/types.ts`, `index.ts` | 当前 `BridgeFrame` 集合；尚无读日志；`ctx.get` 模式 | 👁 |
| SDK 协议 | `packages/sdk/protocol/`，`packages/sdk/server/README.md` | stdout 仅 `initialize` / `session/prompt` / `shutdown` | 👁 |
| Timeline 投影 | `apps/vscode-dsh/src/timeline-store.ts` | live `session.event` → turn/tool/diffs；可复用折叠逻辑 | 👁 |
| 会话绑定 | `apps/vscode-dsh/src/conversation-controller.ts`, `session-host.ts` | Tab `sessionId` → prompt/dispose；关闭时清 timeline | 👁 |
| Diff meta 生产者 | `packages/fs/tool-fs/`，`packages/core/tools/src/presentation.ts`（`FileDiff`） | `meta.diffs` 含 `oldText: string \| null`、`newText` | 👁 |
| 既有 L1 模式 | `apps/vscode-dsh/tests/timeline-projector.spec.ts`，`packages/session/session-persistence/tests/contract.ts` | 夹具式事件投影；只读打开契约 | 👁 |
| Phase / 设计 | `.specdev/specs/vscode-dsh-conversation-ui/phases/phase-0a-spike-replay-rebuild/spec.md`，`design.md` AD-CU-2 / T-0a | Gate AC-80/30/47/76/77 | 👁 |

## 4. Key Entry Points / Call Paths（关键入口 / 调用路径）

### 路径 A — 权威写入（生产 ide 栈）

```
dsh --profile ide
  → agent-loop create/resume
      → sessionPersistence.create / open(id,'write')
      → live session/event → JSONL append（+ flush 屏障）
  → Host session/dispose（bridge）
      → sdkSessionDispose.disposeSession
      → AgentHandle.dispose → session/disposed
      → persistence 写句柄排空 + close
      → **已物化的 .jsonl(.zstd) 仍留在磁盘**（无删除 API）
```

✅ 已确认：dispose 退役进程内写者；**不会**抹掉已物化日志（`session-persistence-jsonl` README：「Nothing deletes session files」）。

### 路径 B — 冷读（今天进程内即可用）

```
sessionPersistence.open(id, 'read')
  → handle.read(0) → 校验后的 SessionEvent[]
  → handle.close()

或（AC-77 配平更优）：

readColdSessionLog(persistence, id)
  → open('read') + read + close
  → events.concat(interruptedTurnClosers(events))   // 仅内存

或（更高层，live 优先）：

ctx.sessionQuery.readSession(id)
  → corpus.load → Session.create 校验 → 克隆 { header, events }
```

### 路径 C — 今日 live UI 投影（非回放）

```
IdeSessionHost.onNotification
  → ConversationController → TimelineStore.apply(HarnessNotification)
      session.event: turn/step/tool/assistant + tool/result.meta.diffs
      session.status / subagent.*
```

尚无 `MessageStore` / `ReplayHydrator` 源文件（仅设计命名）。

### 路径 D — 意向产品 Host 缝（未实现；AD-CU-2 优先）

```
Extension IdeSessionHost
  → bridge frame session/read-log | session/stat   # 新建薄帧
  → ide-bridge 插件
      → ctx.get('sessionPersistence') | sessionQuery
      → open('read') / readSession / stat
  → Extension ReplayHydrator → messages/replace + TimelineStore 批量 apply
```

## 5. Likely Impact Surface（可能影响面）

| 表面 | 0a 是否改动 | 风险 | 说明 |
|------|-------------|------|------|
| `spike-report.md` + L1 测试/脚本 | **是（必须）** | 低 | 仅实证；无产品 UI |
| `packages/ide/ide-bridge` | 可选薄原型 **或** 仅文档推荐 | 实现则中等 | 完整 RPC 可留给 phase-2 |
| `apps/vscode-dsh` UI / Webview | **否** | — | Spec 禁止产品回放 UI |
| `TimelineStore` | 只读复用 / 在测试中抽取折叠辅助 | 低 | 日后 bulk hydrate 可镜像 `applySessionEvent` |
| `packages/core/agent-loop` | **禁止** | — | Spec + AD-CU-12 |
| SDK stdout 协议 | **避免** | 若改动则高 | 破坏 AD-8 双通道纯度 |
| Persistence / session-query 包 | 优先原样消费 | 低 | 已暴露 read/list/stat |

## 6. Existing Constraints / Conventions（既有约束 / 惯例）

- **注册即 effect**；bridge 可选服务经 `ctx.get(...)`（ide-bridge 对 dispose/presets/sessions 已如此）。
- **SDK stdout 专属 JSON-RPC**（`initialize` / `session/prompt` / `shutdown`）；逐会话 dispose 已在 **bridge** 而非 stdout — 读日志可用同一模式。
- **模型可见 ⟺ 已记录**；UI 须从 `SessionEvent` 重建，不得用扩展索引当正文库（AD-CU-4）。
- **持久化：** 仅追加、seq 连续；撕裂尾永不返回；`open('read')` 可与写者并存；对读句柄 mutate → `SessionReadOnlyError`。
- **Diff 策略（AD-CU-6）：** 仅日志 `meta.diffs`；仅有补丁且无法恢复 before → Diff 不可用；**禁止**用当前工作区文件冒充 before/after。
- **客户端文案 locale 所有**适用于后续产品字符串；Spike 报告可用 `.specdev` 下中英 markdown。
- 测试：包/应用 `tests/` 下 vitest 行为测试；Gate 只需 L1（不要求 L2 Extension Host）。

## 7. Risks / Unknowns（风险 / 未知）

| 项 | 确信度 | 说明 |
|----|:------:|------|
| 已物化日志在 dispose 后仍可通过 `open('read')` 读取 | ✅ 已确认 | 契约 + JSONL README；未 append 的 pending 会话在 creator close 时会擦除 — Spike 夹具**必须 append+flush** |
| 事件词汇含 user/assistant/turn/step/tool + `meta.diffs` | ✅ 已确认 | TimelineStore + tool-fs 附带完整 `oldText`/`newText`（null = 新文件） |
| 不完整回合可通过未闭合 turn **或** `interruptedTurnClosers` 后的合成 `turn/end {interrupted}` 探测 | ✅ 已确认（库） | Spike 仍须对夹具**实证**（AC-77） |
| ide profile 挂载 persistence + sessionQuery | ✅ 已确认 | 继承自 `dsh-base` cordis.patch.yml |
| ide-bridge 今日无 read-log / list / hydrate | ✅ 已确认 | `BridgeFrame` 联合止于 permission + dispose + hello |
| SDK 无会话读/列表 API | ✅ 已确认 | 协议方法闭集 |
| 最佳 Host 缝 = bridge 包 persistence 还是 sessionQuery | ⚠️ 假说 | 设计偏好 bridge → `open('read')`；`sessionQuery.readSession` 已配平中断 — Spike 应比较载荷/错误分类 |
| zstd 日志需经后端解码（不能直接 `fs.readFile`） | ✅ 已确认 | 默认 `compression: 'zstd'`；Spike 必须走 persistence API |
| 真实 ide 路径是否可能 dispose 前未 flush 丢末回合 | ❓ 未知 | 存在 flush 策略；夹具应在 dispose 前 flush |
| Conversation Webview 消息条折叠规则（相对 `foldSurface`） | ⚠️ 假说 | 产品 MessageStore 未实现；Spike 可折叠 `user/message` + `assistant/message`（及 surfaceOp replace）并记录与 `foldSurface` 的偏差 |

## 8. Uncertain / Unverified（未核验）

- **`AgentHandle.dispose` → persistence close 在 ide profile 下的排序** — agent-loop README 有文档；本次探索未端到端重跑。Spike 脚本应按其声称路径 dispose，或至少在 flush 后关闭写句柄。
- **`sessionQuery.readSession` vs 原始 `handle.read` 对 Diff 扫描** — 两者都返回事件；closer 不同（query 会配平）。Gate 须写明用了哪条 API。
- **`TimelineStore.narrowDiffs` 把非 string `oldText` 收成 `''`** — 丢失 `null`「新文件」语义；产品 Diff UI 日后可能要更严的 narrowing（Spike 可直接探测 `meta.diffs` 是否存在，不必经 TimelineStore）。
- **多进程同 `root` 写租约** — 所有权仅进程内；Spike 单进程即可。
- **扩展 `workspaceState` 索引** — 0a 范围外；勿与权威日志混淆。

## 9. Stub Detection & Registry Cross-Validation（桩检测与注册表交叉校验）

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| — | — | 空表（无活跃债务） | N/A | ✅ 匹配（无可校验条目） |

### Stub Detection Summary

- ✅ 已确认桩：**0**（registry 无活跃项；相关路径未见 `@STUB` / 空壳读日志 API）
- ⚠️ Registry 不一致：**0**
- 🔴 未注册桩：**0**
- 🟡 能力缺口（非桩 — FAIL 时写入 Spike/债表，否则留给 phase-2）：
  - **GAP（产品）：** ide-bridge 尚无 `session/read-log` / `session/stat`
  - **GAP（产品）：** `apps/vscode-dsh` 尚无 `ReplayHydrator` / `MessageStore` / `messages/replace`
  - **GAP（协议）：** SDK stdout 按设计不能 list/read 冷会话
  - 这些是**缺失产品缝**，不是假实现；除非 implementer 故意留占位，否则不要注册为 STUB。

## 10. Recommended Next Reads（建议优先阅读）

1. ⭐ 必读 — `packages/session/session-persistence/README.md` + `src/handle.ts`（`open`/`read`/`stat`/`list`）
2. ⭐ 必读 — `packages/session-query/session-query/src/cold-read.ts` + `packages/core/session/src/repair.ts`（`interruptedTurnClosers`）
3. ⭐ 必读 — `.specdev/specs/vscode-dsh-conversation-ui/design.md` § AD-CU-2 / T-0a；本 phase `spec.md` Gate 表
4. 🔷 应读 — `packages/ide/ide-bridge/src/types.ts` + `README.md` AD-8 双通道（薄读帧应加在何处）
5. 🔷 应读 — `apps/vscode-dsh/src/timeline-store.ts` + `tests/timeline-projector.spec.ts`（无 UI 折叠 turn/tool/diffs）
6. 🔷 应读 — `packages/bundle/base/cordis.patch.yml`（persistence root + session-query 挂载）
7. 🔹 可选 — `packages/sdk/server/README.md`（为何**不要**扩展 stdout）
8. 🔹 可选 — `packages/fs/tool-fs/tests/tools.spec.ts` Diff meta 示例；`packages/core/tools/src/presentation.ts` `FileDiff`

### Spike 脚本落点（建议）

| 优先级 | 位置 | 理由 |
|--------|------|------|
| **1** | `apps/vscode-dsh/tests/spike-t0a-replay-rebuild.spec.ts`（名称可调） | 与未来 ReplayHydrator 同应用；可复用 TimelineStore 折叠；符合 phase spec 偏好 |
| **2** | `packages/ide/ide-bridge/tests/` | 仅当 Spike 原型 bridge 帧时；否则 Gate 应独立于线协议 |
| **3** | `packages/session/session-persistence-jsonl/tests/` 纯持久化夹具 | 「关闭后磁盘可读」最快，但与 vscode 折叠关联弱 |

**建议 L1 方法（无需 Extension Host）：**

1. 临时 `root` + 挂载/创建 JSONL persistence（或 Loader 小组合）。
2. 夹具 A：完整回合，含 `user/message`、`assistant/message`、`tool/call`+带 `meta.diffs` 的 `tool/result`、`turn/end completed` → flush → 关闭写句柄。
3. 夹具 B：同上但无 `meta.diffs`。
4. 夹具 C：未闭合 turn（无 `turn/end`）→ flush → close。
5. 写者消失后：`open('read')` / `readColdSessionLog` → 断言条数/顺序/角色；Diff 探测真/假；不完整经未闭合 turn **或** closer `reason.kind === 'interrupted'`。
6. 结果写入 `phases/phase-0a-spike-replay-rebuild/spike-report.md`，并含 AD-CU-2 更新建议。

### 推荐读日志缝（供 spike-report 写 AD-CU 更新）

| 排序 | 缝 | 结论 |
|------|-----|------|
| **优先** | ide-bridge 薄 `session/read-log`（+ 可选 `session/stat` / list）→ `sessionPersistence.open(id,'read')` **或** `sessionQuery.readSession` | 符合 AD-CU-2；保持 SDK stdout 纯净；镜像既有 `session/dispose` Host 模式 |
| **仅 Spike 实证** | vitest 内直接用 `sessionPersistence` / `readColdSessionLog` | 足以支撑 Gate PASS 证据；无 UI |
| **避免** | 新增 SDK stdout 方法 | 把 Extension 绑到协议扩张；与已文档化的 AD-8 闭集冲突 |

---

*调研模式：本 Phase 首次探索（无既有 repo-exploration.md）。Registry 为空。Spike Gate NOT RUN。*
