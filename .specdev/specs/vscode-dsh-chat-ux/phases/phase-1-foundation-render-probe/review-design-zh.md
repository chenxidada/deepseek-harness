# 设计一致性审查 — phase-1-foundation-render-probe

## 视角
**设计一致性** — 实现是否遵循架构设计

## 判决
**SHOULD-FIX**

## 架构决策对照

| design.md 决策 | 实现是否遵循 | 证据 | 判定 |
|:---|:---|------|:--:|
| **AD-CUX-1** 修订 AD-CU-1：呈现态可下放 + 强制探针；决策态留 Host | 是 | `probes.ts` 呈现探针 + `mirrorHostDecisions`；`syncComposerDisabled` 只消费 Host `mode`/`connectionPhase`；`protocol.ts` `panel/state.probes?`；注释已改「允许呈现态」 | ✅ |
| AD-CUX-1：`parentReadonly`/`continueSealed` 为 Host 镜像只读 | 是 | 仅 `mirrorHostDecisions` 写入；层 B smoke 验证协议位 | ✅ |
| AD-CUX-1：无 optimistic 时禁止造假探针 | 是 | 无 `optimistic` 字段；层 A 显式断言 | ✅ |
| **AD-CUX-2** 层 A = 抽离 + jsdom；禁止整页 dangerously 主路径 | 基本是 | `tests/layer-a` import `render/*`；真实 DOM 断言；产品用 `*BrowserSource()` 嵌入 | ⚠️ |
| AD-CUX-2：provider 调用/内联抽离模块 | 部分 | 关键 API 已嵌入并调用；但 HTML **本地重定义 `escapeHtml` 阴影**抽离副本 | 🟡 |
| **AD-CUX-4** 纯决策 + `data-follow-state` | 是 | 算法对齐；完整跟滚属 phase-2 | ✅ |
| 抽离目录与 probes 布局 | 是 | 对标 design；change-list 推迟已登记 DEBT | ✅ |
| 宪法 §7.1 / §7.2 | 是 | 层 A Must + 呈现/决策边界正确 | ✅ |

## 关键发现

### 🔴 Must-Fix
无。

### 🟡 Should-Fix
- 产品 HTML 在嵌入 `messageDomBrowserSource()` 后再次本地定义 `escapeHtml`，阴影抽离实现 — 建议删除本地重定义或改为薄委托。

### 🟢 Observations
- DEBT/GAP 登记正确；`decideFollowState` 未接产品跟滚属 phase-2；`ChatUxProbes.expanded` 顶层座位合理。

完整英文报告见 [review-design.md](./review-design.md)。
