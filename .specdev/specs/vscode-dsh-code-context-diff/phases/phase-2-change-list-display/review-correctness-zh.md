# 正确性审查 — phase-2-change-list-display（MUST-FIX 复审）

## 视角
**实现正确性** — 代码是否真正可工作

## 判决
**PASS**

## 逐条 AC 验证

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-5 | meta.diffs 入账并关联 turn 最后 assistant | `change-attributor.ts:settleTurn`；`conversation-controller.ts` | ✅ | 首 settle 写记录；空 pending 二次 settle 回写 `sourceMessageId`（N-2） |
| AC-6 | N>0 列表；N=0 说明无空骨架；无摘要 | settle 投影 + provider | ✅ | emptyNotice；N=0 无 diff-summary |
| AC-7 | 路径/类型/状态/diff/来源/时间 | ChangeRecord + settle | ✅ | 字段齐全；列表无全文 |
| AC-8 | 排除二进制/超大/生成目录/区外 | ignore + 过滤 | ✅ | 有夹具 |
| AC-9 | 不入账手动编辑；仅 meta.diffs | ingest；无 watcher | ✅ | GAP-010/011 有 L2 |
| AC-10 | unreviewed 文案中性 | 「未查看」 | ✅ | 无「未写入/待批准」 |
| AC-12 | 折叠展开；按需 get-diff | 独立 expand 控件 | ✅ | prune 不伪造 |
| AC-12a | 单击打开并尽量定位首行 | 主键 click → `change/open` | ✅ | MUST-FIX 已关；非 shift/dblclick |
| AC-19 | 变更→来源；助手→列表 | 「来源」+ `pushRevealSource` | ✅ | MUST-FIX 已关；滚助手气泡 |
| AC-20 | 同 path 合并最终差异 | firstOld/lastNew | ✅ | 有 before-cache 时整文件 blob |
| AC-21 | 执行隔离 + 可区分 | listForTurn；data-turn | ✅ | 两 turn 隔离 |
| AC-23 | 安全 diff | textContent + CSP | ✅ | 无 innerHTML 赋 diff |
| AC-30 | N>0 按 identity reveal；N=0 无摘要 | sourceMessageId 投影+click | ✅ | MUST-FIX 焦点已关 |

## 桩检测

### 已注册（对照 registry）
GAP-CCD-010 / 011 / DEBT-CCD-001 均为已解决；无 before-cache 时省略 blob（本轮 Should-Fix）。

### 新发现未注册桩
无。

## 先前 MUST-FIX / SHOULD-FIX

| 项 | 状态 |
|----|:--:|
| AC-12a 单击→open | ✅ 已关 |
| AC-19 变更→来源气泡 | ✅ 已关 |
| AC-30 reveal 带 sourceMessageId | ✅ 已关 |
| Should: 多助手 re-anchor | ✅ 已关 |
| Should: 无 before-cache 不写 hunk blob | ✅ 已关 |

## 关键发现

### 🔴 Must-Fix
无。

### 🟡 Should-Fix
无。

### 🟢 观察
- 无 snapshot 时仍打开文件但不定位行（符合 AC-12a）。
- 本地复跑 28 passed。
