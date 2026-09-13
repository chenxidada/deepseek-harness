# Phase 2: 消息附属变更列表 + 安全 diff + AC-30 共存

## 目标

在 Spike PASS 结论落地后，交付消息附属变更感知与展示：turn 内归属入账与排除、同文件合并最终差异、助手消息下变更列表（含 N=0 一句说明）、安全内嵌 diff（`change/get-diff` 按需）、单击打开定位、双向溯源与执行隔离，以及与 AC-30 摘要入口的跳转共存（N>0 reveal 列表；N=0 隐藏摘要）。

## 前置条件（依赖的 spec 文件 + 已完成的 Phase）

- HG-1 / HG-2 已确认
- 依赖 Phase：`phase-0-spike-attribution-snapshot` **Gate PASS**（Constitution §4.4）
- 必读：`spike-report.md`；`design.md` AD-CCD-1…5,8,9、**N-1/N-2**、协议表 `change/get-diff`；`tech-debt-registry.md`
- Phase Entry Gate：确认无阻塞债指向本 Phase
- **不依赖** phase-1 代码引用完成（可并行调度，但 DAG 上仅依赖 phase-0）

## 验收标准

全部 **[Must]**：

- [ ] **AC-5** — DSH 执行期间通过归属判定的创建/修改/删除 → 生成变更记录并关联触发执行的助手消息（锚点 = 该 turn 最后一条 assistant，见 N-2）
- [ ] **AC-6** — 任务/turn 完成 → 消息下展示变更列表；无变更 → **必须不** 空骨架，**必须** 一句无变更说明；同时 **N=0 必须不** 展示可点 AC-30 `diff-summary`（N-1）
- [ ] **AC-7** — 记录至少含：路径、类型、diff 数据（或等价）、状态、来源消息 ID、时间
- [ ] **AC-8** — 二进制 / 超阈值 / 生成目录 / 工作区外 → **必须不** 入列表
- [ ] **AC-9** — **必须不** 将用户手动编辑、格式化器、其它扩展写入标为 DSH 变更；含误报否定用例
- [ ] **AC-10** — unreviewed 期间 UI **必须不** 暗示「尚未写入 / 等待批准」
- [ ] **AC-12** — 逐文件查看 diff；多文件可折叠展开；展开时 Webview **必须**经 `change/get-diff` 取得正文，Host 以 `change/diff-content` 回应（列表 payload **不含** old/new 全文；prune 时 available=false + 说明，不伪造）
- [ ] **AC-12a** — 单击条目 → 打开文件并尽量定位首变更行；无法定位则至少打开文件
- [ ] **AC-19** — 变更 → 来源消息；助手消息 → 其变更列表
- [ ] **AC-20** — 同执行同文件多次写入 → 合并最终差异；中间历史不默认展示
- [ ] **AC-21** — 不同执行列表 **必须不** 交叉混合，且可视觉区分
- [ ] **AC-23** — diff 渲染不执行脚本、不加载外链、默认转义；含恶意载荷否定

### 本 Phase 对 AC-30 的行为收口（承接 chat-ready，非新 AC 编号）

- N>0：`diff-summary` 点击 **必须** reveal 对应消息下 change-list（AD-CCD-4）
- N=0：不注入摘要入口（与 AC-6/N-1 一致）

### Out of Scope（本 Phase）

- 撤销写盘 / 批量撤销确认门禁 → phase-3（若 UI 暴露按钮须 `@STUB(phase-3-review-revert-replay)` 并登记 registry，或本 Phase 仅展示列表且不提供写盘）
- **AC-11** 完整「标记已审阅」 → phase-3（本 Phase 可只渲染 status=unreviewed 且文案合规）
- Timeline 重构；Git diff；语言过滤；中间版本恢复；改 agent-loop
- 代码引用指针面 → phase-1

## 验证策略

| AC | 验证类型 | 验证方法 | 预期结果 |
|----|---------|---------|---------|
| AC-5/7 | L2 | 注入 turn + 可恢复 meta.diffs + assistant/message → 读 ChangeStore | 记录字段完整；sourceMessageId = 该 turn 最后 assistant |
| AC-6 | L2/L3 | N>0 与 N=0 两组 | N>0 有列表；N=0 有说明无骨架；无 diff-summary |
| AC-8 | L2 | 超大/二进制/ignored/外路径夹具 | 不入账 |
| AC-9 | L2 | 用户保存否定 | 无 ChangeRecord |
| AC-10 | L3 / 静态 | 检查列表文案字典 | 无「未写入/待批准」 |
| AC-12 | L2/L3 | 多文件折叠展开；断言 `change/get-diff` → `change/diff-content`；prune 组 | 可切换；正文来自快照；列表无全文；prune 不伪造 |
| AC-12a | L2 | `change/open` 钩子 | 打开命令调用；有行则 revealLine |
| AC-19 | L2 | reveal-source / 消息→列表 | 双向可达 |
| AC-20 | L2 | 同 path 两次 diffs | 一条；old=首次 new=末次 |
| AC-21 | L2/L3 | 两 turn 列表 | 不混；视觉属性可区分（data-turn 等） |
| AC-23 | L2/L3 | 恶意 script/外链夹具 | 转义；不执行 |
| AC-30 共存 | L2 | N>0 点击 diff-summary | reveal change-list；非仅 Timeline |

## 约束

- 仅使用 Spike 锁定的归属机制（AD-CCD-1）
- 快照仅扩展本地；不进权威日志
- 不改 agent-loop
- L4 不得作唯一证据

## 产出清单

| 产出 | 路径（预期） |
|------|----------------|
| Attributor / Store / Ignore | `apps/vscode-dsh/src/change/*.ts` |
| Snapshot 写入（展示用） | `snapshot-store.ts` |
| MessageStore / 协议 / Webview | `message-store.ts`；`chat-panel/*` |
| Controller 定稿 + AC-30 | `conversation-controller.ts` |
| 测试 | `apps/vscode-dsh/tests/` |
| Phase 文档 | `phases/phase-2-change-list-display/*.md` |
| 中文镜像 | `spec-zh.md` |
