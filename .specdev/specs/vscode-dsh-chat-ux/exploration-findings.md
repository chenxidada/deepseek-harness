# Exploration Findings: vscode-dsh-chat-ux

> 只读探查结论（2026-09-10）。禁止当作实现授权。  
> 用户拍板输入见会话；本文件固化 X1–X7 事实与对 T1 的硬输入。

## 用户已拍板（探查前 / 条件拍板）

| ID | 决议 |
|----|------|
| T1（条件） | X3 可行 → 重试/编辑 **P-接续**（E2：父只读浏览+可 revert，禁发送/禁 Continue live）+ 分叉 **P-标明**；不可行 → 全部 P-标明 |
| T3 | **I-真**（接后端 cancel） |
| T4 | 协作 abort + 活动项→aborted + **不**自动 revert |
| T5 | **A** 保留半截文本并标已停止 |
| T7 | **A** 纯决策函数 + `data-follow-state` |
| T8 | 内联 diff + 显式跳原生 |
| T9 / T10 | 采纳（Host 行为强制层 B；活动项状态转移升 AC） |
| R1–R8 | 一揽子同意 |

### T1 终态（依 X3）

**X3 = FEASIBLE → T1 锁定为：重试/编辑 = P-接续（+E2）；分叉 = P-标明。**

---

## P0

### X1 — session.cancel 接线面

**结论：I-真只需扩展 + ide-bridge + sdkSessionCancel 薄封装；不必改 agent-loop（O-3 安全）。**

| 事实 | 详情 |
|------|------|
| bridge | 有 `session/dispose|read-log|resume|continue-capability`；**无** `session/cancel` |
| stdout SDK | 仅 initialize / prompt / shutdown；**无** wire cancel |
| `dsh.stopSession` | **整进程 shutdown**，≠ turn cancel |
| 核心 | `Agent.cancel({ kind:'user' }, { keepInbox: true })` 已存在（对齐 Web） |

**最小接线：**

```
Webview Stop → IdeSessionHost.cancelSession → bridge session/cancel
  → sdkSessionCancel → Agent.cancel(..., { keepInbox: true })
```

镜像现有 dispose/resume 三件套即可。

---

### X2 — fork 后 ChangeStore 基线

**结论：C（无产品 fork 路径）+ 分桶模型已近似 A。**

- ChangeStore / Attributor / Snapshot：**按 sessionId 隔离**；新建 Tab **不**拷贝父变更。
- `tool/call` before = **当时磁盘读** → 对齐「基线 = fork 时磁盘」。
- **风险（接线时避免）**：拷贝父 index 到 child；把 seed 历史 `meta.diffs` 当 live 入账；derive-only 只换文案不换 sessionId。

需求 G6/AC-64 可直接写；实现重点是 fork 编排勿踩上述风险，而非先改分桶。

---

### X3 — 多 Tab / P-接续前提

**结论：FEASIBLE → 解锁 T1 条件分支「重试/编辑 P-接续」。**

| 能力 | 现状 |
|------|------|
| 父+子两 session 两 Tab | ✅（禁同 session 双 Tab，与本场景无关） |
| per-tab `live\|replay` | ✅；父可 replay、子可 live |
| 发送双闸 | ✅ mode≠live 禁用 |
| 单例 Webview 只投影活动 Tab | ✅ |
| 父 revert | ✅ 不按 mode 门禁；Change 按 sessionId |

**缺口（编排/策略，非模型障碍）：**

1. 无「冻父 + 开子 + 切 active」产品路径（勿复用 `continueConversation` 原位 resume）
2. `replay` 默认仍可 Continue → E2 需额外封印（capability unknown / sealed）
3. `parentSessionId` 少写、无 fork 展示位（类型已有）

---

### X5 — cancel 事件序列与 IDE 投影

**结论：权威日志 live cancel 已成对闭合；vscode-dsh 活动项/aborted 标示需新投影。**

典型（工具执行中 cancel）：

```
turn/start → step/start → user/message → assistant/message
→ tool/call → [Agent.cancel] → tool/result (ABORTED|ABORTED_BEFORE_DISPATCH)
→ step/end → turn/end { kind: 'aborted', reason: { kind: 'user' } }
```

- Live cancel 的 turn reason = **`aborted`**（不是 `interrupted`；后者是崩溃修复）。
- 半截流式文本：`assistant/message.interrupted: true` 后 turn aborted。
- IDE：无对话内活动项；`detectIncomplete` **不认** `aborted` → T5「标已停止」要改 hydrate/live 投影。
- 活动项 running→aborted：映射 `tool/result.error.code ∈ {ABORTED, ABORTED_BEFORE_DISPATCH}`；可参考 web `ui-chat` tool nodes，非 Timeline 现成开关。

---

### X6 — jsdom 挂 thin HTML

**结论：NEEDS_EXTRACT（非 BLOCKED）。**

- 根已有 `jsdom@29`；vscode-dsh 测试现只用字符串/`vm` 跑 markdown。
- 整页 `runScripts: 'dangerously'` + stub `acquireVsCodeApi` 可冒烟，但不适合作主基建。
- **推荐**：抽 `renderBubble` / `syncChrome` / message 分发为可测 TS（对齐 `composer-keydown`），jsdom 挂壳调抽离函数 → 满足 AC-6 / T7。

---

## P1

### X4 — thinking / reasoning

**结论：PROTOCOL_ONLY_IGNORED**

协议与权威日志有 `reasoning-delta` / reasoning blocks；vscode-dsh 只抽 `text`，不消费 chunk。  
→ T6 若选「展示」，属扩展投影工作，非协议阻塞；若选「不展示」，与现状一致。

### X7 — 搜索档 1/2

| 档 | 结论 |
|----|------|
| 1 | **READY**：`title` + `firstUserPreview` 已在 ExtensionIndex |
| 2 | **NEED_INDEX**：Change 按 session 分文件；无 path→session 反查，需新建或扫全 index |

---

## 对 requirements 修订的直接含义

1. AC-31/32/33：机制 = fork；呈现 = P-接续（重试/编辑）/ P-标明（分叉）；边界 = 上一 closed turn；aborted 非 boundary。
2. AC-13：必须接 cancel（X1 接线面）；T5 保留半截 + incomplete 须认 `aborted`（X5）。
3. AC-3/14/15/16/71：跟滚 = 决策函数 + `data-follow-state`（T7）；AC-15 不内嵌像素阈值。
4. AC-43：锁死内联 + 跳原生（T8）。
5. AC-64 + 变更基线硬话（X2 支持「空桶+读盘」）。
6. 层 A 基建：NEEDS_EXTRACT（X6）；Host 行为强制层 B（T9）；活动项状态转移 AC（T10 + X5）。
7. 档 2：需求保留，设计须含 path→session 索引（X7）。
8. T6 thinking：仍待用户一拍（X4 证明「展示=扩展工作」）。
