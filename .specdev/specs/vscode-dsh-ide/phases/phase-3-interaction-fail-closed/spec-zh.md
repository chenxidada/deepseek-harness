# Phase 3: 审批+提问+权限 fail-closed

## 目标

打通 Host bridge 上的人类交互闭环：工具审批与模型提问弹到正确会话/Tab 的 VS Code UI，回传合法 `ApprovalOutcome` / `AskUserQuestionAnswer`；连接缺失、超时、非法结局与进程异常均 fail-closed；权限档位 UI 仅调用 `permission-presets`。

## 前置条件

- Phase `phase-1-profile-dual-channel`、`phase-2-multi-tab-session` HG-3 通过
- Phase Entry Gate：处理 registry 中目标为本 Phase 的 🔴 债务（含 Phase 1 answerer stub）
- 参考：`packages/acp/acp` 终端 answerer 先例；`dsh-user-approval` / `dsh-user-questions` 结局词汇

## 验收标准

**AC-10:** `[Must]` **状态驱动型** — **在** 某会话触发审批或提问 **时**，UI **必须** 能将该交互关联到正确的会话/Tab，**必须不** 在无提示下把应答记到错误会话。

**AC-16:** `[Must]` **事件驱动型** — **当** DSH 发出需人类应答的 `approval/request` **时**，Host bridge **必须** 在 VS Code 展示审批，并将选择映射为合法 `ApprovalOutcome` 回传。

**AC-17:** `[Must]` **事件驱动型** — **当** DSH 发出 `user-questions/request` **时**，Host bridge **必须** 展示提问，并将回答映射为合法 `AskUserQuestionAnswer` 回传。

**AC-19:** `[Must]` **不期望行为型** — **如果** bridge 未连接、超时、抛错或非法结局，**那么** 路径 **必须** fail-closed，**必须不** 静默放行。

**AC-20:** `[Must]` **状态驱动型** — **在** 等待人类应答期间，工具调用 **必须** 保持在既有 DSH waterfall 契约内阻塞，直至合法结局或 fail-closed。

**AC-21:** `[Must]` **事件驱动型** — **当** 开发者选择某一 `permission-presets` 档位 **时**，系统 **必须** 经 Host 应用该档位，使后续沙箱与审批策略与 preset 一致。

**AC-22:** `[Must]` **普遍型** — 扩展 **必须不** 引入与 `dsh-permission-presets` 冲突的第二套权限权威源。

**AC-30:** `[Must]` **不期望行为型** — **如果** SDK 传输关闭或子进程异常退出，**那么** 扩展 **必须** 终止 UI 等待、展示错误态，并对未结算审批/提问 fail-closed。

**AC-31:** `[Must]` **普遍型** — 系统 **必须** 校验 Host bridge 入站载荷等外部输入；非法输入不得导致未定义放行。

**AC-33:** 本 Phase ≥1 集成测试 + ≥1 独立 e2e。

## 约束

- AD-4：ide-bridge 为终端 answerer；失败不 `next()` 到「无人终端」冒充成功
- AD-6：权限只走 permission-presets
- Bridge 非 stdout（已由 Phase 1 AC-18 约束，本 Phase 不得回退）
- 不与 Web ui-approval 双挂

## 产出清单

- `ide-bridge`：完整 approval / user-questions answerer + 超时
- Extension：ApprovalPanel、Questions UI、session/Tab 关联、PermissionPicker
- 入站载荷校验
- 失败路径测试（断连、超时、非法 outcome、子进程退出）
- 填实 Phase 1 answerer stub；更新 registry

## 不在范围内

- 时间线完整 UI / Diff（Phase 4）
- 替换契约文档（Phase 5）
- hooks 策略包 / Spec 面板
