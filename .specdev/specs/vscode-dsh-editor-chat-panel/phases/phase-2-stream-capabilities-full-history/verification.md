# Phase 2 验证报告（Q-6 Tab 右键删除复验）

> phase-id: `phase-2-stream-capabilities-full-history`
> slug: `vscode-dsh-editor-chat-panel`
> branch: `impl-phase-2-stream-capabilities-full-history`
> verified-at: 2026-09-13T15:28:55Z
> prior report archived: `.archive/verification-20260913T151657Z.md`

## 判决：PARTIAL

## 为什么不是 PASS（主动问题清单）

1. **AC-40 / AC-42 — 层 V 真机未执行**：`LAYER_V_STATUS=BLOCKED_NO_HOST`（无 `code`/`cursor` CLI，无 `DISPLAY`/`WAYLAND_DISPLAY`）。静态/构建代理全部通过，但人眼 §9 Phase 2 清单全部 `BLOCKED_NO_HOST`。按 AC-42 **禁止 Phase PASS**。
2. **残余风险 MEDIUM**：无端到端真机视觉路径 → 不得降为 LOW。
3. （已关闭于本轮）Reviewer Should-Fix「非活动 Tab 右键删除 sessionId」→ 独立用例 **V-A12** + Host **V-B7** 已绿，不再构成判决缺口。

## 测试执行矩阵

| 场景 | 来源 | 命令 | 结果 | 证据 |
|------|:--:|------|:--:|------|
| V-A1 XSS sanitize (img-onerror / javascript:) | verifier | `vitest …/layer-a-rtl.spec.tsx` | ✅ | 12/12 Layer A |
| V-A2 branch turn gate + param | verifier | 同上 | ✅ | turns `[3,7]` |
| V-A3 edit-resend cancel + dual messageId | verifier | 同上 | ✅ | no emit on cancel |
| V-A4 history delete cancel | verifier | 同上 | ✅ | no `ui/delete-request` |
| V-A5 search origin isolation | verifier | 同上 | ✅ | chrome≠hist hits |
| V-A6 streaming→settle MD | verifier | 同上 | ✅ | no msg-md while streaming |
| V-A7 stopping ≠ fifth composer state | verifier | 同上 | ✅ | waiting/error + 正在停止… |
| V-A8 history Continue | verifier | 同上 | ✅ | `ui/history-select` |
| V-A9 activity/ref/change intents | verifier | 同上 | ✅ | toggle + open-ref |
| **V-A10 Q-6 tab contextmenu cancel→confirm** | verifier | 同上 | ✅ | cancel 无 emit；confirm → `ui/delete-request` `vfy-active` + 文案「不可恢复」 |
| **V-A11 Q-6 overflow delete regression** | verifier | 同上 | ✅ | overflow → 同 modal → `vfy-overflow` |
| **V-A12 Q-6 inactive-tab sessionId (Should-Fix)** | verifier | 同上 | ✅ | 右键非活动 Tab → `sess-inactive`（≠ `sess-active`）；cancel 先过 |
| V-B1 AC-60 deleteConfirmed only | verifier | `vitest …/layer-b-host.spec.ts` | ✅ | 7/7 Layer B；3 sessionId params |
| V-B2 edit/branch/stop Host | verifier | 同上 | ✅ | payload variation |
| V-B3 SPA ≠ thin | verifier | 同上 | ✅ | panel source 无 thin import |
| V-B4 decideFollowState matrix | verifier | 同上 | ✅ | on/off 参数变化 |
| V-B5 SPA HTML shell | verifier | 同上 | ✅ | CSP / no CDN |
| V-B6 search-sessions E2E Host | verifier | 同上 | ✅ | alpha≠beta hits |
| **V-B7 Q-6 pushTabsFrame sessionId** | verifier | 同上 | ✅ | active+inactive 各有不同 `sessionId` |
| Implementer phase2 RTL+host (secondary) | impl | `editor-chat-phase2` + `phase2-history-delete-host` | ✅ | **14/14**（含 impl Q-6 单 Tab） |
| Layer V capability probe | verifier | `node …/layer-v-capability-probe.mjs` | ⚠️ BLOCKED | env FAIL；static/build PASS；exit 0 + `LAYER_V_STATUS=BLOCKED_NO_HOST` |
| webview:build smoke | verifier | `pnpm --filter … webview:build` | ✅ | built in 267ms |

## 独立验证场景（你自己设计的）

| 场景 | 命令 | 结果 |
|------|------|:--:|
| V-A10 Tab 右键：cancel 再 confirm（独立于 implementer 单用例） | `run-verifier.sh` Layer A | ✅ |
| V-A11 溢出删除回归（Q-6 双入口并存） | 同上 | ✅ |
| V-A12 **非活动 Tab** contextmenu → modal → `sessionId=sess-inactive` | 同上 | ✅ |
| V-B7 Host `pushTabsFrame` 双 Tab `sessionId` 投影（RTL 前提） | Layer B | ✅ |

## Reviewer 建议的验证场景

| 场景 | 命令 | 结果 |
|------|------|:--:|
| Should-Fix：RTL 补非活动 Tab 双入口 | V-A12（本轮新增） | ✅ 已验证关闭 |
| Q-6 共用 DeleteConfirmModal / `ui/delete-request` | V-A10 + V-A11 + V-B1 | ✅ |
| 合并审查 SHOULD-FIX（非 MUST-FIX）→ 允许进 verifier | review.md | ✅ 已执行 |

## 端到端验证

| 数据路径 | 结果 | 证据 |
|----------|:--:|------|
| Tab contextmenu → `tab-context-menu` → `DeleteConfirmModal` → `ui/delete-request` | ✅ | V-A10 |
| Overflow → 同 modal → `ui/delete-request` | ✅ | V-A11 |
| **Inactive tab** contextmenu → modal → `ui/delete-request{sessionId=inactive}` | ✅ | V-A12 |
| `ui/delete-request` → Host `requestDeleteConfirmed` only（非 `requestDelete`） | ✅ | V-B1 |
| Registry → `pushTabsFrame` → per-tab `sessionId` | ✅ | V-B7 |
| Producer search → Host → `search/results` consumer | ✅ | V-B6 |
| 真机层 V（Panel/四态/双主题/focus） | ❌ BLOCKED | probe + `layer-v-capability-report.json` |

## Q-6 证据摘要

```
V-A10: contextMenu(tab) → menu-tab-delete-session → modal「不可恢复」
       → cancel: posts 无 ui/delete-request
       → confirm: ui/delete-request sessionId=vfy-active

V-A11: btn-overflow → menu-delete-session → 同 modal → ui/delete-request sessionId=vfy-overflow

V-A12: two tabs (active=sess-active, idle=sess-inactive)
       → contextMenu(inactive) → confirm
       → exactly 1 delete-request with sessionId=sess-inactive (≠ active)

V-B7:  pushTabsFrame tabs[] each carries distinct sessionId for active+inactive
```

层 A/B 路径与 AC-13c / AC-14a / AC-60 / Q-6=A 对齐；真机层 V 仍缺。

## 残余风险

| 风险 | 严重性 | 说明 |
|------|:--:|------|
| 无 VS Code Extension Host 人眼层 V（AC-40/41/42） | 🟡 MEDIUM | 环境阻断；静态代理不能替代人眼。**禁止 PASS** |
| 双主题 / focus / reduced-motion 仅静态 tokens 代理 | 🟡 MEDIUM | 同上 |
| Should-Fix 非活动 Tab RTL | — | **本轮 V-A12 已关闭**；无新增活跃债 |

## Pipeline 合规检查

- 当前分支：`impl-phase-2-stream-capabilities-full-history`
- 工作区代码改动均在该 `impl-*` 分支上（未提交；符合 implementer 不自行 commit、HG-3 统一提交约定）
- Pipeline compliance: ✅ 所有非 specs 变更在 `impl-*` 分支工作区

## 验证脚本

| 脚本 | 路径 |
|------|------|
| Orchestrator | `test-scripts/run-verifier.sh` |
| Layer V probe | `test-scripts/layer-v-capability-probe.mjs` |
| Independent RTL | `apps/vscode-dsh/tests/verifier-phase2/layer-a-rtl.spec.tsx` |
| Independent Host | `apps/vscode-dsh/tests/verifier-phase2/layer-b-host.spec.ts` |
| Layer V report | `screenshots/layer-v-capability-report.json` |

## 执行摘录

```
Layer A: 12 passed (12)  — includes V-A10/11/12
Layer B: 7 passed (7)    — includes V-B7
Implementer secondary: 14 passed (14)
LAYER_V_STATUS=BLOCKED_NO_HOST
webview:build ✓ built in 267ms
```

## 债务对照

- 活跃债务：无
- GAP-ECP-008（Q-6）保持「已解决」；本轮行为复验通过（含非活动 Tab）
- 未发现新疑似桩（参数变化路径输出随输入变化）
