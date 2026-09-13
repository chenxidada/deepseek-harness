# 正确性审查 — phase-0a-spike-replay-rebuild

## 视角
**实现正确性** — 代码是否真正能工作

## 判决
**SHOULD-FIX**

## 逐条 AC 验证

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-80 | 正式 PASS/FAIL 报告 + 可复跑脚本 + AD-CU 更新建议 | `spike-report.md`；`test-scripts/run-spike-t0a.sh`；`spike-t0a-replay-rebuild.spec.ts` | ✅ | 报告结论单一 **PASS**；含方法/环境/命令与 AD-CU-2/6 建议；本审查复跑 `vitest` 与 shell runner 均为 `Tests 4 passed` / exit 0 |
| AC-30 / AC-47 | 权威日志一次性全量重建 messages + Timeline turn/tool，并与夹具比对 | `spike-t0a-replay-hydrator.ts` 的 `foldMessages`/`foldTimeline`；经 `readColdSessionLog` + `open('read')` | ✅ | 冷读后 `raw === fixture`；messages 角色/文本/seq 单调；`foldTimeline` 产出有序 turn/step/tool（手工核验完整行序正确）；一次性 `read(0)` 无分页。**但**测试对 step/tool 仅 `.some` 存在性断言，未做完整行序/条数 oracle（见 Should-Fix） |
| AC-76 | 可恢复 Diff 快照存在/不存在可探测；禁止用工作区冒充 | `probeDiffAvailability` / `recoverableDiffsFromMeta` | ✅ | 有 `meta.diffs`（path+oldText+newText）→ `available=true, hunkCount=1`；无 diffs → false；仅 patch → `[]`；纯函数，无文件系统读取 |
| AC-77 | 不完整/中断回合可识别 | `probeIncomplete` + `readColdSessionLog`→`interruptedTurnClosers` | ✅ | open-turn 夹具：磁盘 raw 无 `turn/end`，`openTurnInRaw=true`；cold 追加 `turn/end {interrupted}`；再 `readRaw` 仍等于夹具（closer 仅内存） |
| 交付物 | spike-report + 可重复脚本 + 读缝选型 | 上述路径 | ✅ | 报告推荐 `session/read-log` → `readColdSessionLog`；保留 ReplayHydrator 命名；bridge RPC 明示留给 phase-2 |

## 桩代码检测

### 已注册桩（对照 registry）
| Registry ID | 文件:函数 | 状态 | 说明 |
|-------------|-----------|:--:|------|
| — | — | — | `tech-debt-registry.md` 活跃债务为空 |

### 新发现的未注册桩
| 文件:函数:行号 | 当前行为 | 严重性 | 处理建议 |
|---------------|---------|:--:|---------|
| — | — | — | 无。`fold*` / `probe*` 均为真实折叠/探测逻辑；空 `return []` 仅为合法窄化失败路径（畸形 meta），非空壳 |

## 关键发现

### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
- **Timeline 比对 oracle 偏弱（AC-30/47 验证策略）**：`spike-t0a-replay-rebuild.spec.ts` 对 turn 做了 label 序列断言，但对 `step`/`tool` 仅用 `timeline.some(...)`。函数体实际产出完整有序行（turn→step→tool result→step end→turn end，且 `hasRecoverableDiffs=true`），建议改为与夹具期望的 `FoldedTimelineRow[]`（或至少 kind/label/callId 序列）逐项 `toEqual`，避免回归时「有一行 tool 即可通过」。
- **`foldMessages` 的 `surfaceOp: 'replace'` 路径无测试**：实现会按 id 删除旧 bar 再追加（`spike-t0a-replay-hydrator.ts` 约 72–76 行），夹具只有 `append`。补一条 replace 夹具可锁住「一次性重建」下的 surface 语义。
- **`oldText: null`（可恢复新建文件）未进 AC-76 夹具**：代码接受 `oldText === null` 且拒绝缺省 `oldText`；建议加一条断言，防止与 live `TimelineStore.narrowDiffs`（缺省→`''`）混淆后被改松。

### 🟢 Observations
- 独立复跑：`PATH=.../node/24.3.0/bin:$PATH vitest run apps/vscode-dsh/tests/spike-t0a-replay-rebuild.spec.ts` → 4 passed；`bash .../run-spike-t0a.sh` → exit 0。冷读折叠路径真实可用。
- `readColdSessionLog` / `interruptedTurnClosers` 为既有生产 API，Spike 正确消费而非伪造 closer。
- dispose 用 write-handle `flush`+`close` 模拟写端退役，与 implementation 偏差说明一致；未改 `packages/core/agent-loop`。
- 无产品 Webview / ide-bridge RPC 落地，符合 Spike 范围；不记为桩。

## 复跑命令（本审查执行）

```bash
PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" \
  ./node_modules/.bin/vitest run apps/vscode-dsh/tests/spike-t0a-replay-rebuild.spec.ts
# → Test Files 1 passed | Tests 4 passed | exit 0

bash .specdev/specs/vscode-dsh-conversation-ui/phases/phase-0a-spike-replay-rebuild/test-scripts/run-spike-t0a.sh
# → exit 0
```
