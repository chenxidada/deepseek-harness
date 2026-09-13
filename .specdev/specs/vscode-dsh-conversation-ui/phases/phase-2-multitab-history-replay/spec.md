# Phase 2: 多 Tab 未读/审批串行 + 历史列表与回放重建

## 目标

交付非活动 Tab 未读点与审批角标、交互串行队列；基于扩展索引的工作区历史列表；从历史打开/激活**回放 Tab**，经 **ReplayHydrator** 从权威日志一次性全量重建面板与 Timeline。**必须**在 `phase-0a` Gate **PASS** 后实施回放切片。

## 前置条件

- 依赖：`phase-0a-spike-replay-rebuild`（PASS）、`phase-1-panel-live-recoverable-close`
- 读取 `phases/phase-0a-spike-replay-rebuild/spike-report.md` 中的 API 选型
- 继承 phase-1 面板 / 可恢复关删 / Timeline 弱化
- **第一步（强制）：** 现状阅读既有 `InteractionCoordinator`——确认阻塞式单弹层 vs 已有队列，再决定按 AD-CU-7 重构或增量扩展；队列逻辑**并入** `interaction-coordinator.ts`，**禁止**新建 `interaction-queue.ts`

## 验收标准

### 多 Tab 未读与审批

- [ ] **AC-19** 非活动新消息 → 未读点；不抢焦点
- [ ] **AC-57** 激活且面板已展示该会话后才清除未读
- [ ] **AC-20** 非活动审批 → 角标；会话↔交互关联
- [ ] **AC-58** 串行单弹层；**软优先**（活动 pending 插队队首、不打断已弹）；同 Tab FIFO；队头 fail 立即出队；切 Tab：未作答→关弹层回 pending（角标保留），目标有 pending 再弹；已作答不撤回
- [ ] **AC-22** `[Should]` Tab 标题用 session/title 或首条用户消息

### 历史列表

- [ ] **AC-28** 当前工作区历史：标题、mtime；`continueCapability` 映射（AD-CU-8 完整表）；打开一律先回放
- [ ] **AC-29** 非本工作区会话不出现
- [ ] **AC-63** 列表可独立于 Host 展示索引

### 回放重建

- [ ] **AC-30** 历史打开 → ReplayHydrator 全量重建；mode=replay；composer 禁用；禁双开；再开 → **新 tabId**；同 session 单开按 **sessionId**
- [ ] **AC-64 / AC-65** 已有打开 Tab → 激活已有（含 live / 回放），不叠副本（沿用既有 tabId）
- [ ] **AC-31** 回放禁止 prompt；`ui/reject-send`（`replay`）
- [ ] **AC-47** 重建后条数/顺序/角色与 Timeline turn/tool 可与权威日志比对
- [ ] **AC-80** 回放切片仅在 T-0a PASS 后交付
- [ ] **审批状态机（AD-CU-7）** `pending → presented → resolved|abort`；切 Tab 未作答：`presented → pending`

### Should / 验证门禁

- [ ] **AC-16** `[Should]` 面板「本回合改了 N 个文件」链到 Timeline/Diff
- [ ] **AC-56** `[Should]` Timeline 短 label 定位：user → assistant → 无可定位
- [ ] **AC-54 / AC-84** L2 + L3（**模拟 Webview**）；覆盖关 Tab→历史回放、审批唤醒、回放误发
- [ ] **AC-62** 历史列表行删除入口可发现

## 验证策略

> **L3 定义：** Extension Host 内 fake Webview（`postMessage` / `onDidReceiveMessage`）对接真实 Host；断言协议与边界；**不**验证 HTML/CSP/渲染。真实渲染属 L4，非达标门槛。
>
> **L2 可调用面：** 每个 VP 须有 Host 命令/测试钩子（可脱离 Webview）；钩子仅测试暴露。

| AC | 验证类型 | 验证方法 | 预期结果 |
|----|---------|---------|---------|
| AC-19/57 | L2 | 非活动 Tab 注入新消息 → unread=true；激活且面板展示后 unread=false（Host 钩子） | 未读点行为符合 |
| AC-20/58 | L2（VP-2-wake） | 非活动 pending → 角标；活动 pending **软优先**插队且不打断已弹；队头 Abort → 下一项；切 Tab 未作答→presented 回 pending；切到含 pending Tab → 唤起 | 串行、不卡死、不错配 |
| AC-22 | L2 / 静态检查 | 有 title 或首条用户消息时 Tab 标签匹配 | 标题可读 |
| AC-28/29/63 | L2 | Host 断开仍可列索引；仅当前 workspace；capability 映射对照 AD-CU-8（列表 vs Continue 解耦） | 无跨区泄漏；未知不显示「可继续」 |
| AC-30/47 | L2 + L3（模拟 Webview；VP-2-history） | 关 Tab → 历史打开 → `messages/replace` 全量；与权威日志夹具比对；新打开 **新 tabId**；同 session 单开 | 一致；mode=replay；composer 禁用 |
| AC-64/65 | L2 | 已有 live/replay 再开历史 → 激活已有，OpenTabRecord 不增副本 | 单 Tab；沿用既有 tabId |
| AC-31 | L3（模拟 Webview；VP-2-replay-reject） | 回放态 fake Webview `composer/send` → `ui/reject-send`（`replay`）；无 prompt | 拒绝成功 |
| AC-80 | 静态检查 | 存在 phase-0a spike-report 且结论 PASS | 可追溯 |
| AC-16 | L2 / L3（模拟 Webview） | 回合含写工具 → 面板摘要可测（或 hook） | Should：摘要存在或显式跳过并记债 |
| AC-56 | L2 + L3（模拟 Webview） | 触发 `scroll/reveal` → 定位优先序 | 定位或「无可定位」反馈 |
| AC-62 | L2 | 历史行删除命令/钩子可执行 | 入口可发现 |
| AC-54/84 | 运行时验证 | `test-scripts` 跑 L2（含 Host 钩子）+L3（模拟 Webview）；覆盖 VP-2-* | exit 0；禁止仅 L1/仅人工/仅渲染达标 |

## 约束

- design AD-CU-2/4/5/6/7；读日志缝遵循 T-0a 报告；tabId 生命周期见 AD-CU-5
- 组件名：**ReplayHydrator**
- 审批队列**并入** `interaction-coordinator.ts`（禁止 `interaction-queue.ts`）
- Host 未连打开历史须有说明（完整等待自动重建可与 phase-3 AC-69 对齐）
- L2 每 VP 须有可脱离 Webview 的 Host 钩子
- 不交付重启全集、Continue、AC-76/77 最终产品门禁

## 产出清单

- `extension-index.ts`、`history-view.ts`、`replay-hydrator.ts`
- `interaction-coordinator.ts` 扩展（串行 + 软优先 + 切 Tab 回 pending）
- bridge 只读方法（若 T-0a 选定）
- 回放比对夹具 + L2/L3（模拟 Webview）用例

## 排除项

| 项 | 归属 |
|----|------|
| 重启未关 Tab 集 | phase-3 |
| 继续此会话 | phase-3 |
| 回放 Diff / 不完整回合产品门禁 | phase-3 |
| Subagent | phase-4 |

## 依赖

`phase-0a-spike-replay-rebuild`, `phase-1-panel-live-recoverable-close`
