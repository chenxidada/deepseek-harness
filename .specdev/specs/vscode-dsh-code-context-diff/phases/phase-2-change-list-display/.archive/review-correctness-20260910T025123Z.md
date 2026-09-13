# Correctness Review — phase-2-change-list-display

## 视角
**Implementation Correctness** — 代码是否正确工作

## 判决
**MUST-FIX**

## 逐条 AC 验证

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-5 | meta.diffs 入账并关联 turn 最后 assistant | `change-attributor.ts:ingestToolResult/settleTurn`; `conversation-controller.ts:onSdkNotification/settleChangeListProjection` | ⚠️ | 主路径真实：可恢复 hunks → pending merge → ChangeRecord + `sourceMessageId`。L2 覆盖单助手。多助手 re-anchor 时二次 `settleTurn` 在 pending 已清空后**不**回写既有 `ChangeRecord.sourceMessageId`（payload 用新 id，record 可能仍挂首条 assistant） |
| AC-6 | N>0 列表；N=0 一句说明无空骨架；无 diff-summary | `settleChangeListProjection`; `chat-panel-provider.ts` change-list 分支 | ✅ | N=0 → `emptyNotice` + `CHANGE_LIST_EMPTY_NOTICE` + `changes:[]`；N>0 有条目；N=0 不注入 `diff-summary`（L2） |
| AC-7 | path/kind/status/diff 或等价/来源/时间 | `types.ts` ChangeRecord; `settleTurn` | ✅ | 字段齐全；diff 经 `snapshotRef` + SnapshotStore；列表 payload **不含** old/new 全文（L2） |
| AC-8 | 二进制/超大/生成目录/工作区外不入账 | `change-ignore.ts:shouldIgnoreChangePath`; ingest/settle 过滤 | ✅ | 单元断言 + live 夹具 `node_modules` 不入 ChangeStore |
| AC-9 | 用户手动编辑等不入账；仅 meta.diffs | `ingestToolResult` + 无 watcher | ✅ | 无 `FileSystemWatcher` 入账；无 meta.diffs 夹具 → 0 records；GAP-010/011 宁可漏记有 L2 |
| AC-10 | unreviewed 不暗示未写入/待批准 | `CHANGE_STATUS_UNREVIEWED_LABEL`; provider 文案 `未查看` | ✅ | 字典断言；无「尚未写入/等待批准」产品串 |
| AC-12 | 折叠展开；`get-diff`→`diff-content`；prune 不伪造；列表无全文 | provider expand; Host `requestChangeDiff`; SnapshotStore | ✅ | L2：available=true 返回全文；clearSession 后 available=false + reason，无 newText；列表无全文 |
| AC-12a | **单击**条目打开文件并尽量定位首变更行 | provider click handler; `extension.ts:openChangedPath` | ❌ | Host `openChangedPath` + `firstChangedLine` 逻辑真实；但 Webview **单击**只展开 diff（`change/get-diff`），打开仅 **shift-click / dblclick** → 违反 AC-12a「单击」Must |
| AC-19 | 变更→来源消息；助手→变更列表 | protocol `change/reveal-source`; list `data-source-message-id`; AC-30 reveal | ❌ | 助手→列表：有（挂靠 + reveal-change-list）。变更→来源：**Webview 从不 post `change/reveal-source`**；且 Host `requestRevealSource` 调用 `pushRevealChangeList`（滚到列表），**不是**滚到来源 assistant 气泡 |
| AC-20 | 同 path 多次写入合并最终差异 | `ingestToolResult` firstOld/lastNew; settle 整文件 blob | ✅ | L2：两条 hunks → 一条 record；blob = full before/after（非 hunk 碎片） |
| AC-21 | 不同执行列表不交叉；可视觉区分 | ChangeStore `listForTurn`; `data-turn` | ✅ | 两 turn 路径/sourceMessageId 隔离；HTML 含 `data-turn` |
| AC-23 | diff 不执行脚本/不加载外链/默认转义 | provider `pane.textContent`; CSP `default-src 'none'` | ✅ | diff 赋值仅 `textContent`；无 `diffPane.innerHTML`；路径/标题用 textContent/setAttribute |
| AC-30 共存 | N>0 reveal change-list；N=0 无摘要 | provider diff-summary click; `requestRevealChangeList` | ✅ | 点击 post `action/reveal-change-list`（非仅 Timeline）；N=0 无摘要；phase5 L3 同步 |

## Stub Detection（桩代码检测）

### 已注册桩（对照 registry）
| Registry ID | 文件:函数 | 状态 | 说明 |
|-------------|-----------|:--:|------|
| GAP-CCD-010 | create/`diffs:[]` | ✅ Resolved（永久漏记） | 明确不入账；L2 断言；非伪装完成 |
| GAP-CCD-011 | str_replace_editor 无 presentationMeta | ✅ Resolved（永久漏记） | 同上 |
| DEBT-CCD-001 | 整文件 SnapshotStore | ✅ Resolved（主路径） | tool/call before-cache + workspace after-read；L2 证 blob ≠ hunk |

### 新发现的未注册桩
| 文件:函数:行号 | 当前行为 | 严重性 | 处理建议 |
|---------------|---------|:--:|---------|
| — | 无「假装已完成」的空壳 ChangeStore/Attributor | — | — |

说明：`change/reveal-source` 协议+Host 路由存在但 UI/语义未完成 → 记为 **AC 未满足**，不记为 stub（未用假返回值宣称溯源可用）。

## 关键发现

### 🔴 Must-Fix

1. **AC-12a — 单击未打开文件**  
   - `chat-panel-provider.ts` change-list item：`click` → expand + `change/get-diff`；`change/open` 仅在 `shiftKey` / `dblclick`。  
   - Requirements AC-12a / phase spec：当用户**单击**变更条目时必须打开文件并尽量定位首变更行。  
   - Host `openChangedPath` / `firstChangedLine` 已具备真实逻辑；缺的是 Webview 单击绑定。  
   - 建议：单击 → `change/open`；另用折叠控件/次点击满足 AC-12 展开 diff（二者可并存，但主键单击必须满足 12a）。

2. **AC-19 — 变更→来源消息不可达**  
   - Webview 无任何控件 post `change/reveal-source`。  
   - `extension.ts` `requestRevealSource` → `pushRevealChangeList`：滚的是 change-list，不是 `data-message-id === sourceMessageId` 的助手气泡。  
   - 助手→列表半边可用；变更→来源半边未交付。  
   - 建议：列表行提供「定位来源」交互；Host 滚到对应 assistant bubble（可用已有 `data-message-id`）。

### 🟡 Should-Fix

1. **多助手 re-anchor 时 ChangeRecord.sourceMessageId 陈旧**（AC-5/N-2 边缘）  
   - 首条 assistant settle 写入 records 后 pending 清空；后续 assistant 再 settle 只替换消息投影的 `payload.sourceMessageId`，不更新 store 内 record。  
   - 影响后续若用 `record.sourceMessageId` 做溯源。

2. **before-cache 未命中时 settle 可能把 hunk `firstOld` 当整文件写入 SnapshotStore**  
   - `settleTurn`：`cachedBefore` 缺失且非 create 时回退 `merge.firstOld`（DIFF_CONTEXT 碎片）。  
   - 生产依赖 `tool/call` → `noteToolCall`；缺 call/args 时 DEBT-001 回退。  
   - 建议：无 full-file before 时拒绝写 blob / `available=false`，勿把 hunk 当 blob。

### 🟢 Observations

- Intake merge（AD-CCD-5）：同 turn 同 path `firstOld` + `lastNew` 真实合并；无空壳。  
- SnapshotStore：真实 mkdir/write/read/prune；软 cap 拒绝 oversized blob。  
- GAP-010/011：宁可漏记有明确测试与 Attributor 头注释；未用 watcher「补洞」。  
- AC-23：CSP + textContent 路径扎实。  
- phase-3 撤销/mark-reviewed：未暴露按钮，无未注册 `@STUB`。  
- 本地复跑：`phase2-change-list-display.spec.ts` + `phase5-should-polish.spec.ts` → 24 passed（测试未覆盖上述 Must-Fix 交互）。

## 测试覆盖缺口（正确性相关）

| 缺口 | 为何重要 |
|------|---------|
| Webview 单击 → `change/open` | AC-12a 字面 Must；现 L2 只测协议钩子 |
| UI/`requestRevealSource` → 助手气泡 | AC-19 双向 |
| 无 before-cache 时 blob 内容 | 防止 hunk 冒充 full-file |
