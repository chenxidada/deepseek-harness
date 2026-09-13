# 正确性审查 — phase-2-change-list-display

## 视角
**实现正确性** — 代码是否真正按验收标准工作

## 判决
**MUST-FIX**

## 逐条 AC 验证

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-5 | meta.diffs 入账并关联 turn 最后一条助手 | `change-attributor.ts`；`conversation-controller.ts` | ⚠️ | 主路径真实；多助手 re-anchor 时 record 上的 `sourceMessageId` 可能仍挂首条助手 |
| AC-6 | N>0 列表；N=0 一句说明无空骨架；无摘要 | `settleChangeListProjection`；provider | ✅ | L2 覆盖 N=0/N>0 与空说明 |
| AC-7 | 字段完整；diff 或等价 | ChangeRecord + SnapshotStore | ✅ | 列表无全文；blob 经 snapshotRef |
| AC-8 | 排除二进制/超大/生成目录/工作区外 | `shouldIgnoreChangePath` | ✅ | 单元 + live 夹具 |
| AC-9 | 非 DSH 写入不入账 | 仅 meta.diffs；无 watcher | ✅ | 含 GAP-010/011 宁可漏记 |
| AC-10 | unreviewed 文案合规 | 「未查看」 | ✅ | 无「未写入/待批准」 |
| AC-12 | 展开 + get-diff；prune 不伪造 | Host + SnapshotStore + provider | ✅ | L2 覆盖 available true/false |
| AC-12a | **单击**打开并定位 | provider / `openChangedPath` | ❌ | Host 逻辑在；单击只展开 diff，打开靠 shift/双击 |
| AC-19 | 双向溯源 | reveal-source / 列表挂靠 | ❌ | 助手→列表有；变更→来源无 UI，且 Host 滚错目标 |
| AC-20 | 同 path 合并最终差异 | ingest merge + 整文件 blob | ✅ | L2 证一条 + full-file |
| AC-21 | 执行隔离 + 可区分 | `listForTurn` / `data-turn` | ✅ | 两 turn 不混 |
| AC-23 | 安全 diff 渲染 | textContent + CSP | ✅ | 无 innerHTML 灌 diff |
| AC-30 共存 | N>0 reveal 列表；N=0 无摘要 | diff-summary 点击 | ✅ | 非仅 Timeline |

## 桩代码检测

### 已注册（对照 registry）
| ID | 状态 | 说明 |
|----|:--:|------|
| GAP-CCD-010 / 011 | 已解决（永久漏记） | 有 L2；非伪装完成 |
| DEBT-CCD-001 | 已解决（主路径） | 整文件 before/after |

### 新发现未注册桩
无。`change/reveal-source` 未完成记为 AC 缺口，非假返回桩。

## 关键发现

### 🔴 Must-Fix
1. **AC-12a**：单击条目必须打开文件；当前单击只展开 diff。
2. **AC-19**：变更→来源消息不可从 UI 到达；`requestRevealSource` 误滚到 change-list。

### 🟡 Should-Fix
1. 多助手 re-anchor 不更新 `ChangeRecord.sourceMessageId`。
2. before-cache 未命中时可能把 hunk 当整文件写入 SnapshotStore。

### 🟢 Observations
- 入账合并、SnapshotStore、XSS、宁可漏记策略均真实可用；phase-3 未暴露伪完成按钮。

## 测试缺口
- 单击 → `change/open`；变更→助手气泡；无 before-cache 时的 blob 内容。
