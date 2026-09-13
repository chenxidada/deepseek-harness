# Phase 4: Subagent 进入 / 钉 Tab / 父子已删导航

## 目标

父会话消息流中的 subagent 卡片可**进入**子会话视图（默认不占 Tab）；运行中为只读实时投影，结束后自动转为回放；面包屑返回父。Should：钉成 Tab（AC-78/79）。交付父子已删导航（AC-74/75）。

## 前置条件

- 依赖：`phase-2-multitab-history-replay`、`phase-3-restart-continue`
- 面板消息流、回放模式、Continue 降级策略已就绪

## 验收标准

### 进入与导航

- [ ] **AC-35** 父流 subagent 入口可进入子会话可读消息流
- [ ] **AC-36** 面包屑（或等价）返回父
- [ ] **AC-37** 进入默认不占用 Conversations Tab
- [ ] **AC-39** 子进行中且父为当前上下文 →「子代理运行中」；子结束且父仍为当前上下文 → 清除；卡片可改为「已结束，可进入回放」
- [ ] **AC-40** 子结束后仍可进入只读回放；回放/继续策略与父一致
- [ ] **AC-71** 运行中进入 = 只读实时投影；结束自动转回放

### 钉 Tab（Should）

- [ ] **AC-38** 可钉成 Conversations Tab
- [ ] **AC-78** 已钉后从父进入 → 激活已有子 Tab；不在父内再切子上下文
- [ ] **AC-79** 钉定时若正处于子上下文 → 提升为独立 Tab 并恢复父视图

### 父子已删

- [ ] **AC-74** 子已删 → 父卡片「子会话已删除」不可进入
- [ ] **AC-75** 父已删 → 子面包屑「父会话已删除」禁用返回

### 验证门禁

- [ ] **AC-54 / AC-84** L2 + L3（**模拟 Webview**）；必须覆盖「进入子会话」（VP-4-sub）；feature 级补齐重启恢复（phase-3）+ 进入子会话

## 验证策略

> **L3 定义：** Extension Host 内 fake Webview 对接真实 Host；断言协议与边界；**不**验证 HTML/CSP/渲染。真实渲染属 L4，非达标门槛。

| AC | 验证类型 | 验证方法 | 预期结果 |
|----|---------|---------|---------|
| AC-35/37 | L2 + L3（模拟 Webview；VP-4-sub） | `nav/open-subagent` → `panel/state` / contextSessionId 指向子；Conversations Tab 数不因默认进入而增加 | 进入成功；默认不占 Tab |
| AC-36 | L2 + L3（模拟 Webview） | `nav/back` → 父 session 上下文恢复 | 面包屑返回 |
| AC-39 | L2 + L3（模拟 Webview） | 子 running 时父 banner 协议「子代理运行中」；子结束事件后清除 | 标记生命周期正确 |
| AC-40/71 | L2 + L3（模拟 Webview） | 运行中进入：composer 禁用 + 实时投影；结束 → mode 转 replay（或等价） | 只读实时→自动回放 |
| AC-38/78/79 | L2 | 钉 Tab → 子有独立 Tab；再从父进入激活已有；钉定时在子上下文 → 父视图恢复 | 符合 AC-78/79 |
| AC-74/75 | L2 | 删子 → 父卡片不可进入文案；删父 → 子面包屑禁用返回 | 导航文案正确 |
| AC-54/84 | 运行时验证 | `test-scripts` 覆盖 VP-4-sub（运行中或回放至少一种） | exit 0；禁止仅 L1/仅人工/仅渲染达标 |

## 约束

- design AD-CU-11；同会话单 live（AC-59）在钉 Tab 时仍成立
- 父删不级联删子权威（AC-61）；本 Phase 补齐导航 UX
- 若子权威绑死父：写偏差 + tech-debt

## 产出清单

- 面板 Subagent 卡片 / 上下文栈 / 面包屑
- 钉 Tab 命令与 registry 字段
- 删除后卡片/面包屑状态
- L2/L3（模拟 Webview）：进入子会话

## 排除项

- Spec/hooks、审批表单重做、S-20、跨工作区历史、Cursor 级 Chat UX（Could）

## 依赖

`phase-2-multitab-history-replay`, `phase-3-restart-continue`
