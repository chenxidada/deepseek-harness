# Correctness Review — phase-2-change-list-display (re-review after MUST-FIX)

## 视角
**Implementation Correctness** — 代码是否正确工作

## 判决
**PASS**

## 逐条 AC 验证

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-5 | meta.diffs 入账并关联 turn 最后 assistant | `change-attributor.ts:settleTurn`; `conversation-controller.ts:settleChangeListProjection` | ✅ | 首 settle 写 `ChangeRecord` + `sourceMessageId`；空 pending 二次 settle **回写**既有 record 的 `sourceMessageId`（N-2 re-anchor）；L2 覆盖 |
| AC-6 | N>0 列表；N=0 一句说明无空骨架；无 diff-summary | `settleChangeListProjection`; provider change-list 分支 | ✅ | N=0 → `emptyNotice` + `CHANGE_LIST_EMPTY_NOTICE`；N>0 有条目；N=0 不注入 `diff-summary` |
| AC-7 | path/kind/status/diff 或等价/来源/时间 | `types.ts` ChangeRecord; `settleTurn` | ✅ | 字段齐全；diff 经可选 `snapshotRef`；列表 payload 不含 old/new 全文 |
| AC-8 | 二进制/超大/生成目录/工作区外不入账 | `change-ignore.ts`; ingest/settle 过滤 | ✅ | 单元 + live 夹具（含 `node_modules`） |
| AC-9 | 用户手动编辑等不入账；仅 meta.diffs | `ingestToolResult` + 无 watcher | ✅ | 无 `FileSystemWatcher`；无 meta.diffs → 0 records；GAP-010/011 有 L2 |
| AC-10 | unreviewed 不暗示未写入/待批准 | provider 文案 `未查看` | ✅ | 字典中性；无「尚未写入/等待批准」 |
| AC-12 | 折叠展开；`get-diff`→`diff-content`；prune 不伪造 | provider expand 控件；Host `requestChangeDiff` | ✅ | 独立 `change-list-expand` post `change/get-diff`；available=false 无伪造正文；列表无全文 |
| AC-12a | **单击**条目打开文件并尽量定位首变更行 | provider `openBtn` click; `extension.ts:openChangedPath` / `firstChangedLine` | ✅ | **已关闭 MUST-FIX**：主键 `change-list-item` 单击直接 post `change/open`（非 shift/dblclick）；展开由独立控件；Host 读 snapshot 定位首变更行，无 snapshot 仍打开文件；L2 HTML + 协议钩子 |
| AC-19 | 变更→来源消息；助手→变更列表 | provider「来源」；`pushRevealSource`；`scroll/reveal-source` | ✅ | **已关闭 MUST-FIX**：UI post `change/reveal-source`；`requestRevealSource` → `pushRevealSource`（**不再** `pushRevealChangeList`）；Webview 滚到 `[data-message-id===sourceMessageId]`；反向经 `reveal-change-list` + `data-source-message-id`；L2 断言不发 `scroll/reveal-change-list` |
| AC-20 | 同 path 多次写入合并最终差异 | `ingestToolResult` firstOld/lastNew; settle blob | ✅ | 同 path 一条 record；有 before-cache 时 blob = full before/after |
| AC-21 | 不同执行列表不交叉；可视觉区分 | ChangeStore `listForTurn`; `data-turn` | ✅ | 两 turn 路径/sourceMessageId 隔离；HTML 含 `data-turn` |
| AC-23 | diff 不执行脚本/不加载外链/默认转义 | provider `pane.textContent`; CSP | ✅ | diff 仅 `textContent`；无 `diffPane.innerHTML` |
| AC-30 共存 | N>0 reveal 对应 change-list；N=0 无摘要 | diff-summary 投影 + click；`requestRevealChangeList` | ✅ | **已关闭 MUST-FIX 焦点**：`diff-summary` 写入 `sourceMessageId`；click post `action/reveal-change-list` **含** identity；Host 按 id 找对应列表（两 turn 夹具防 reverse().find 误选最新）；N=0 无摘要 |

## Stub Detection（桩代码检测）

### 已注册桩（对照 registry）
| Registry ID | 文件:函数 | 状态 | 说明 |
|-------------|-----------|:--:|------|
| GAP-CCD-010 | create/`diffs:[]` | ✅ Resolved | 永久漏记；非伪装完成 |
| GAP-CCD-011 | str_replace_editor 无 presentationMeta | ✅ Resolved | 同上 |
| DEBT-CCD-001 | 整文件 SnapshotStore | ✅ Resolved | 主路径 before-cache；无 full-file before 时**省略** blob（本轮 Should-Fix） |

### 新发现的未注册桩
| 文件:函数:行号 | 当前行为 | 严重性 | 处理建议 |
|---------------|---------|:--:|---------|
| — | 无 | — | — |

## 先前 MUST-FIX / SHOULD-FIX 闭环

| 项 | 状态 | 证据 |
|----|:--:|------|
| AC-12a 单击→open | ✅ Closed | `chat-panel-provider.ts` L653–660 主键 click → `change/open`；expand 分离；测试否定 shift/dblclick-only |
| AC-19 变更→来源气泡 | ✅ Closed | 「来源」按钮；`extension.ts` `pushRevealSource`；Webview `scroll/reveal-source` → assistant `data-message-id` |
| AC-30 reveal 带 sourceMessageId | ✅ Closed | 投影字段 + click 携带 + Host 按 id 匹配；两 turn 防误选 |
| Should: multi-assistant re-anchor | ✅ Closed | `settleTurn` 空 pending 分支 upsert 新 `sourceMessageId`；L2 |
| Should: 无 before-cache 不写 hunk blob | ✅ Closed | `oldText === undefined` → 跳过 `snapshotStore.write`；record 可无 `snapshotRef`；L2 |

## 关键发现

### 🔴 Must-Fix
无。

### 🟡 Should-Fix
无阻塞正确性项。可选观察见下。

### 🟢 Observations
- 无 `snapshotRef` 时 `openChangedPath` 仍打开文件但不定位行 — 符合 AC-12a「无法定位则至少打开文件」。
- AC-12a/19 的 Webview 侧部分断言基于 HTML 字符串（非真实 DOM 点击）；协议往返用 `FakeWebviewPort` 覆盖，对本 Phase L2 足够。
- Intake merge、SnapshotStore prune、CSP/`textContent`、GAP-010/011 策略路径保持真实，无回退为空壳。
- 本地复跑：`phase2-change-list-display.spec.ts` + `phase5-should-polish.spec.ts` → **28 passed**。

## 测试覆盖（正确性相关）

| 场景 | 覆盖 |
|------|------|
| 主键单击 → `change/open`（非 shift/dblclick） | ✅ |
| `change/open` 协议 → open hook | ✅ |
| `change/reveal-source` → `scroll/reveal-source`（非 change-list） | ✅ |
| AC-30 两 turn identity reveal | ✅ |
| Re-anchor 更新 `ChangeRecord.sourceMessageId` | ✅ |
| 无 before-cache 省略 blob | ✅ |
