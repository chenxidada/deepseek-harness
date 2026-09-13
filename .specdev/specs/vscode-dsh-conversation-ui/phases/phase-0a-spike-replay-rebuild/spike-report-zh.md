# Spike 报告 — T-0a 权威日志回放重建

| 字段 | 值 |
|------|-----|
| **Gate** | T-0a |
| **判决** | **PASS** |
| **日期 (UTC)** | 2026-09-08T02:14:15Z |
| **Slug / Phase** | `vscode-dsh-conversation-ui` / `phase-0a-spike-replay-rebuild` |
| **环境** | Linux；Node 24.3.0（`/usr/local/n/versions/node/24.3.0`）；仓库根目录 |
| **宿主层** | L1（vitest + 真实 JSONL persistence）；无 Extension Host |

## 方法

1. 在临时 `root` 上挂载 `@deepseek-ai/dsh-session-persistence-jsonl`（夹具用 `compression: 'none'`；生产默认仍为 `zstd`，API 路径相同）。
2. 三份夹具：`create` → `append` → **`flush`** → `close`（写端退役；磁盘日志保留 —— 对应 agent dispose 的 persistence 半侧）。
3. 冷读：`open(id, 'read')` + `handle.read(0)`，以及 `readColdSessionLog`（open read + 内存 `interruptedTurnClosers`）。
4. 一次性折叠（无分页），辅助函数见 `apps/vscode-dsh/tests/spike-t0a-replay-hydrator.ts`：
   - 消息：`user/message` + `assistant/message`（角色、顺序、seq）
   - Timeline：`turn` / `step` / `tool` 行
   - Diff 探测：仅可恢复的 `tool/result.meta.diffs`（永不读工作区文件）
   - 不完整：磁盘原始开放 turn，**或**冷平衡后的 `turn/end {interrupted}`
5. 在同一 `root` 上再开第二个 Cordis Context，做 `list` / `stat` / 冷读（跨实例可见性）。

## 可重复命令

```bash
PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" \
  ./node_modules/.bin/vitest run apps/vscode-dsh/tests/spike-t0a-replay-rebuild.spec.ts

# 或：
bash .specdev/specs/vscode-dsh-conversation-ui/phases/phase-0a-spike-replay-rebuild/test-scripts/run-spike-t0a.sh
```

**结果：** `Test Files 1 passed | Tests 4 passed`（exit 0）。

## 按 AC 的证据

| AC | 结果 | 证据 |
|----|:----:|------|
| **AC-80** | PASS | 本报告 + 上述脚本；单一判决 **PASS**；含 AD-CU 更新建议 |
| **AC-30 / AC-47** | PASS | 含 diffs 夹具：写端关闭后冷事件 === 夹具；折叠消息角色/文案一致；turn/step/tool 齐全；单次 `read(0)` 全量 |
| **AC-76** | PASS | 夹具 A（可恢复 `meta.diffs`）→ `available=true`；夹具 B（无 diffs）→ `available=false`；仅补丁 meta 被拒绝；未读工作区文件 |
| **AC-77** | PASS | 开放 turn 夹具：原始无 `turn/end`；冷读补 `turn/end {interrupted}`；磁盘未变（closer 仅内存） |

### 夹具

| Id | 内容 |
|----|------|
| `t0a-balanced-with-diffs` / `t0a-with-diffs` | 闭合 turn + 可恢复 `meta.diffs` |
| `t0a-without-diffs` | 闭合 turn + 工具结果**无** diffs |
| `t0a-open-turn` | `turn/start` + user/assistant，**无** `turn/end` |
| `t0a-survive-dispose` | 无 diffs 闭合 turn；第二 Context list/stat/read |

## 选定的读日志缝（供 ReplayHydrator）

| 排序 | 缝 | Spike 结论 |
|------|-----|------------|
| **1 — 优先** | ide-bridge 薄帧 `session/read-log`（+ 可选 `session/stat` / list）→ **`readColdSessionLog(persistence, id)`**（或等价：`open('read')` + `interruptedTurnClosers`） | 符合 AD-CU-2 优先项 #1；不扩 SDK stdout；对齐既有 Host `session/dispose`；冷平衡覆盖 AC-77 且不改盘 |
| **2 — 仅 Spike 证明** | vitest 内直接 persistence / `readColdSessionLog`（本 Gate） | 足以 PASS；非产品缝 |
| **避免** | 新增 SDK stdout 方法 | 与 AD-8 封闭方法集冲突 |

**载荷说明：** 建议向 Extension 返回冷平衡后的 `events`（及 `header`），避免 ReplayHydrator 重复实现 interrupt closers。Diff/不完整探测保持 Host 侧对事件数组的纯折叠。

**本 Spike 未落地：** ide-bridge RPC 帧（仅文档建议；phase-2 实现）。

## 对 AD-CU 的更新建议（Spike → design 回填）

经人工确认后写入 `design.md`「设计修订记录」：

### AD-CU-2（投影 / 读缝）— 建议更新

1. **锁定读 API：** Host → ide-bridge `session/read-log` → `readColdSessionLog`（首选）或 `open('read')` + 内存 `interruptedTurnClosers`。去掉「选型意向」；SDK stdout 冷读标为 **拒绝**。
2. **ReplayHydrator 契约：** 对返回事件数组一次性折叠为 `messages/replace` + Timeline 批量应用；无分页；组件名仍为 **ReplayHydrator**。
3. **可选：** 同 bridge 上 `session/stat` / list，供历史打开预检（存在性 / revision），仍不上 SDK stdout。

### AD-CU-6（Diff / 不完整）— 以证据确认

1. Diff 启用 = 存在**可恢复** `meta.diffs`（`path: string`、`newText: string`、`oldText: string | null`）。仅补丁或字段缺失 → Diff 不可用。禁止用工作区文件冒充 before/after。
2. 不完整 UI 信号 = 原始开放 turn **或** 冷 `turn/end.reason.kind === 'interrupted'`。建议从冷平衡事件水合，使中断 turn 总有 closer。

### T-0a Spike 状态

更新 design 页眉 / Spike Gate 节：**T-0a = PASS**（本报告）。经确认 AD-CU 修订后，phase-2 回放切片可开工。

## 排除项（未改）

- 产品 Conversation Webview / 历史 UI
- ide-bridge 帧实现
- SDK stdout 扩展
- 修改 `packages/core/agent-loop`
- Continue / T-0b

## 降级（若 FAIL）

不适用 — Gate **PASS**。本 Spike 不阻断 phase-2 回放重建。
