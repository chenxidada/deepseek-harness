# Phase 3: 审阅 + 撤销 + 回放统计 + 前序回归

## 目标

在变更列表数据面之上，交付「标记已审阅」（不写盘）、单文件/批量撤销（含新建确认、删除恢复、冲突、后续变更提示、AC-17 content hash）、已撤销后再改记新变更、历史回放路径与统计（AC-22）、快照不进日志明文（AC-24），以及 chat-ready Must 回归抽测（AC-25）。批量同 path **按 turn 倒序**（AD-CCD-10）。

## 前置条件（依赖的 spec 文件 + 已完成的 Phase）

- HG-1 / HG-2 已确认
- 依赖 Phase：`phase-2-change-list-display` HG-3 通过
- 必读：`design.md` AD-CCD-10、**N-3/N-4**、AD-CCD-3/6；phase-2 `implementation.md`；`tech-debt-registry.md`
- Phase Entry Gate：处理指向本 Phase 的阻塞债

## 验收标准

全部 **[Must]**：

- [ ] **AC-11** — 「标记已审阅」→ status=reviewed，且 **必须不**对任何工作区文件产生写入
- [ ] **AC-13** — 「撤销此文件」无冲突门禁拦截 → 恢复变更前状态并置 reverted；失败 → 错误且状态不变
- [ ] **AC-14** — 撤销 DSH **新建** → 二次确认后删除
- [ ] **AC-15** — 撤销 DSH **删除** → 按旧内容重建；已存在同名 → 先冲突提示
- [ ] **AC-16** — 撤销 **必须不**阻止后续 DSH 再改同文件；再改 → **新**变更记录，不与旧 reverted 混同
- [ ] **AC-17** — 相对 after-image 已脏（N-3：content hash ± isDirty）→ 撤销前提示将丢失后续改动；取消 **必须不**写盘
- [ ] **AC-18** — 多文件撤销（勾选或全部）**必须**逐文件返回结果；部分失败如实呈现
- [ ] **AC-22** — 历史回放：消息关联变更列表至少路径与统计可见；blob prune 后不伪造完整 diff（N-4）
- [ ] **AC-24** — 快照/旧内容 **必须不**以明文写入扩展日志；日志仅元数据与统计
- [ ] **AC-25** — **必须不**破坏 chat-ready Must（自动建连、对话底盘、新建 chrome、AC-30 入口可点等）；合入后回归抽测通过

### AD-CCD-10 批量倒序（本 Phase 验收绑定）

- [ ] 同 path 多 turn `change/revert-many` → **turn 倒序**执行
- [ ] 只选较早 turn 且存在较晚 unreverted → 先「后续变更」类确认；取消该 path 不写盘

### Out of Scope（本 Phase）

- 写盘前审批；Git 驱动；diff 上再编辑应用；中间版本恢复；语言过滤
- 改 agent-loop；快照进权威日志
- 代码引用新需求（属 phase-1）

## 验证策略

| AC | 验证类型 | 验证方法 | 预期结果 |
|----|---------|---------|---------|
| AC-11 | L2 | mark-reviewed 前后盘面 hash / fs 探针 | 状态变；无写盘 |
| AC-13 | L2 | revert 成功/失败夹具 | 成功 reverted；失败状态不变 |
| AC-14 | L2/L3 | 新建撤销：取消/确认 | 取消保留；确认删除 |
| AC-15 | L2 | 删除撤销；同名冲突 | 冲突提示；确认后按策略执行 |
| AC-16 | L2 | revert 后再注入同 path diffs | 新 changeId；旧保持 reverted |
| AC-17 | L2 | 改盘面或 stub hash → 确认框；取消 | 取消无写盘 |
| AC-18 | L2 | 批量部分失败 | 逐项 success/fail |
| AD-CCD-10 | L2 | 同 path 两 turn 批量；只选旧 turn | 倒序；后续变更提示 |
| AC-22 | L2 | 冷启动/回放 Tab 读索引；prune 组 | 路径+统计；无伪造正文 |
| AC-24 | 静态+L2 | 扫扩展日志输出 | 无 oldText/newText 明文 |
| AC-25 | L2 | chat-ready 抽测清单 | 全部通过 |

## 约束

- 撤销一律经 VS Code FS / TextDocument（AD-CCD-10）
- AC-17 用 N-3（禁止仅 mtime）
- 快照生命周期 N-4 / AD-CCD-6
- 不改 agent-loop
- L4 不得作唯一证据

## 产出清单

| 产出 | 路径（预期） |
|------|----------------|
| revert 模块 | `apps/vscode-dsh/src/change/revert.ts` |
| 审阅协议 | `change/mark-reviewed` + UI |
| 批量/确认门禁 | chat-panel Host |
| 回放 hydrate | ChangeStore 冷启动 |
| 测试 | `apps/vscode-dsh/tests/` |
| Phase 文档 | `phases/phase-3-review-revert-replay/*.md` |
| 中文镜像 | `spec-zh.md` |
