# Connectivity Review — phase-0a-spike-replay-rebuild

## 视角
**Integration Connectivity** — 模块间是否真正连通

## 判决
**PASS**

## 端到端路径追踪

### Path 1: Write → flush → cold read → fold messages/timeline → assert (AC-30/47)

```
Entry: fixtureWithDiffs() SessionEvent[]
  → persistence.create(header)
  → handle.append(events)
  → handle.flush()                          ✅ 落盘屏障
  → handle.close()                          ✅ 写端退役（dispose 持久化半程）
  → readRaw: open('read') + read(0)         ✅ raw === fixture
  → readColdSessionLog(persistence, id)     ✅ cold.events === fixture（已闭合，无 synthetic closers）
    → open('read') + read(0) + close
    → [...events, ...interruptedTurnClosers(events)]
  → foldMessages(cold.events)               ✅ roles ['user','assistant']；text/seq 比对
  → foldTimeline(cold.events)               ✅ turn start/end:completed + step + tool(call-edit)
Exit: 一次性全量条数 === fixture.length；无分页
```

**判定**: ✅ 数据路径完整，起点到终点连通（L1 实测 4/4 通过）

### Path 2: Diff availability — recoverable meta.diffs vs absent / patch-only (AC-76)

```
Entry: Fixture A meta.diffs[{path, oldText, newText}] | Fixture B 无 diffs | inline patch-only
  → materializeAndRetireWriter (create→append→flush→close)
  → readColdSessionLog → events
  → probeDiffAvailability(events)
      → recoverableDiffsFromMeta(tool/result.meta)   ✅ 仅扫日志 meta，不读工作区
  → A: available=true, hunkCount=1                   ✅
  → B: available=false, hunkCount=0                  ✅
  → recoverableDiffsFromMeta({diffs:[{path,patch}]}) → []  ✅ 拒绝仅 patch
Exit: Diff 可用/不可用信号 + hunk 内容断言
```

旁路：`foldTimeline` 在 `tool/result` 分支同样调用 `recoverableDiffsFromMeta` 并写入 `hasRecoverableDiffs`（与 probe 同源）。

**判定**: ✅ Diff 探测路径连通；有/无/拒绝三条出口均被消费

### Path 3: Incomplete / interrupted turn (AC-77)

```
Entry: fixtureOpenTurn() — turn/start + user/assistant mid-step；无 turn/end
  → materializeAndRetireWriter
  → readRaw → 无 turn/end                              ✅
  → readColdSessionLog
      → interruptedTurnClosers(raw)                    ✅ 内存合成 step/end + turn/end {interrupted}
  → probeIncomplete(raw, cold.events)
      → openTurnInRaw=true                             ✅
      → hasInterruptedCloser=true                      ✅
      → incomplete=true                                ✅
  → cold turn/end.reason === {kind:'interrupted'}      ✅
  → re-readRaw === fixture                             ✅ 磁盘不变（closers 仅内存）
Exit: 不完整可观测；权威日志未写回
```

**判定**: ✅ raw 开放 turn 与 cold interrupted closer 双信号均连通

### Path 4: Cross-Context survive writer dispose (AC-80 evidence)

```
Entry: Context₁ JsonlSessionPersistence(root) → materializeAndRetireWriter
  → Context₂ 同 root 再挂载
  → list() 含 sessionId                                ✅
  → stat(id)                                           ✅
  → readColdSessionLog → foldMessages → ['user','assistant']  ✅
Exit: 跨实例冷读可见
```

**判定**: ✅ 写端退役后另一 Context 仍能 list/stat/冷读/折叠

### Path 5: Product Host seam (ide-bridge `session/read-log` → ReplayHydrator) — out of Spike scope

```
Extension → bridge session/read-log → readColdSessionLog → product ReplayHydrator
```

**判定**: ⚪ 本 Phase 刻意未落地（spec / implementation / spike-report 均写明留给 phase-2）。Spike 选定缝已文档化；不构成 Spike 端到端断裂。

## 上下游连接检查

| 新函数/组件 | 上游（谁调用） | 连接状态 | 下游（调用谁） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| `materializeAndRetireWriter` | spike spec 4 个 it | ✅ | `create`/`append`/`flush`/`close` | ✅ |
| `readRaw` | AC-30/47、AC-77 | ✅ | `open('read')`/`read(0)`/`close` | ✅ |
| `readColdSessionLog` | 全部 4 个 it | ✅ | persistence open/read + `interruptedTurnClosers` | ✅ |
| `foldMessages` | AC-30/47、AC-80 | ✅ | `SessionEvent` user/assistant + surfaceOp | ✅ |
| `foldTimeline` | AC-30/47 | ✅ | turn/step/tool + `recoverableDiffsFromMeta` | ✅ |
| `probeDiffAvailability` | AC-76 | ✅ | `recoverableDiffsFromMeta` | ✅ |
| `recoverableDiffsFromMeta` | probe + foldTimeline + AC-76 直调 | ✅ | 纯函数（无 FS） | ✅ |
| `probeIncomplete` | AC-77 | ✅ | `hasOpenTurn(raw)` + cold `turn/end interrupted` | ✅ |
| Gate runner `run-spike-t0a.sh` | spike-report 引用 | ✅ | `vitest run …spike-t0a-replay-rebuild.spec.ts` | ✅ |
| ide-bridge `session/read-log` | — | ⚪ | — | ⚪ phase-2 |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| spike → `@deepseek-ai/dsh-session-persistence-jsonl` | create/append/flush/close/open/read/list/stat | `SessionPersistence` + JSONL backend | ✅ |
| spike → `@deepseek-ai/dsh-session-query` | `readColdSessionLog(persistence, id): ColdSessionLog` | `cold-read.ts` 导出；index re-export | ✅ |
| `readColdSessionLog` → `interruptedTurnClosers` | 开放 turn → 内存 closers；不写盘 | `repair.ts`：open step → step/end + turn/end `{interrupted}` | ✅ |
| hydrator Diff 契约 | path + newText string + oldText string\|null | `recoverableDiffsFromMeta` 同条件；patch-only 丢弃 | ✅ |
| hydrator incomplete | raw open ∪ cold interrupted | `probeIncomplete` OR 组合 | ✅ |
| vitest ↔ 报告命令 | exit 0；4 tests | 本审查复跑：`Test Files 1 passed \| Tests 4 passed` | ✅ |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| （无 DAG 上游 Phase） | — | — | ✅ |
| `SessionPersistence` / JSONL | 既有仓库 | 消费 as-is；未改 agent-loop | ✅ |
| `readColdSessionLog` / `interruptedTurnClosers` | 既有仓库 | 签名未改；Spike 只消费 | ✅ |
| 产品 `session/read-log` / ReplayHydrator | phase-2 | 未实现（计划缝） | ⚪ 预期缺口 |

无冻结接口被本 Spike 修改。

## 关键发现

### 🔴 Must-Fix
- （无）

### 🟡 Should-Fix
- （无）— Diff 的 `foldTimeline.hasRecoverableDiffs` 未在 AC-76 it 中再断言，但同源 `recoverableDiffsFromMeta` 已被 `probeDiffAvailability` 端到端消费；不构成路径断裂。

### 🟢 Observations
- Spike 证明缝是 **persistence + `readColdSessionLog` + 纯 fold 函数**；产品 bridge/`ReplayHydrator` 文件尚未接线，与 spec「完整 bridge 留给 phase-2」一致。
- `apps/vscode-dsh/package.json` 未声明 session-query / persistence 依赖；L1 经仓库 vitest `paths` 解析即可跑通。phase-2 产品模块落地时应补正式依赖。
- 夹具 `compression: 'none'` 与生产默认 `zstd` 共用同一 persistence API；读路径契约一致。
- Gate runner `test-scripts/run-spike-t0a.sh` → repo root → vitest 路径连通。
