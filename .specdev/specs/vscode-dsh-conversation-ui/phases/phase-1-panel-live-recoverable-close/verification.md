# Phase 1 验证报告

## 判决：PASS

## 测试执行矩阵

| 场景 | 来源 | 命令 | 结果 | 证据 |
|------|:--:|------|:--:|------|
| AC-54/84 L2+L3 runner（VP-1-*） | spec | `bash …/test-scripts/run-phase1-l2-l3.sh` | ✅ | `ALL PHASE-1 L2/L3 STEPS OK`；message-store 3、protocol 6、close/delete 4、回归 14 |
| AC-1 / L2 钩子注册 | spec | vitest `panel-l2-l3-protocol` + V-IND-4 | ✅ | `dsh.chat` provider；`dsh.test.sendPrompt/close/delete/panelSnapshot/getIndex/openPanel` |
| AC-2 / AC-24 空态清空 | spec + MUST-FIX | L3 `closes last content Tab…` + V-IND-1 | ✅ | `panel/state:empty` + `hasReplaceEmpty true` + `sessionId:''` |
| AC-3/4/9/10 薄面板发送 | spec | L3 composer/send + V-IND-1 thin panel | ✅ | `from-thin-panel` 入 MessageStore；非空 `prompt` |
| AC-11 `ui/reject-send` | spec | L3 + V-IND-2 | ✅ | `empty` / `no-active` / `no-host`；无假成功 |
| AC-14/15 Timeline 弱化 | spec | L3 Timeline + V-IND-3 | ✅ | description=`assistant turn`；tool Diff 保留 |
| AC-17 README | static | README grep | ✅ | `## Panel vs Timeline`；Close ≠ dispose |
| AC-18 切 Tab 不串台 | spec | L3 switch replace | ✅ | replace 仅 `from-a` |
| AC-21 双 running 仅活动 | verifier | V-IND-5 | ✅ | 仅推活动 session `generating`；切后翻转 |
| AC-23 关≠dispose | spec | `panel-close-delete.e2e` + V-IND-1 | ✅ | close 后 `disposed=[]`；权威仍可读 |
| 空 Tab / 立即持久化 | spec | VP-1-empty + e2e writes | ✅ | openTabSet 无空项；close 后 writes↑ |
| AC-25/26/60/72/73 删状态机 | spec | close/delete e2e | ✅ | 确认前不 dispose；host-not-ready 禁删 |
| AC-41 waiting-interaction | spec | L3 status/set | ✅ | `waiting-interaction` |
| AC-12/48…53 无另立 loop | static | `git diff packages/core/agent-loop` = 0 | ✅ | 变更面限 `apps/vscode-dsh` |
| AC-54/84 独立 L3 FakeWebview | verifier | `verifier-independent-phase1.mts` | ✅ | V-IND-1..5 failed=0 |
| 全量 vitest / tsc | review | `vitest run apps/vscode-dsh/tests`；`tsc -p apps/vscode-dsh --noEmit` | ✅ | 17 files / 59 tests；tsc exit 0 |

## 独立验证场景（你自己设计的）

| 场景 | 命令 | 结果 |
|------|------|:--:|
| **V-IND-1** 关最后有内容 Tab：FakeWebview `replace([])` + MessageStore 权威保留 + 不 dispose；再 delete 对照 dispose+清权威 | `tsx …/verifier-independent-phase1.mts` | ✅ |
| **V-IND-2** sendPrompt 拒绝原因参数变化（no-active/empty/no-host）— 非桩 | 同上 | ✅ |
| **V-IND-3** Timeline 长助手正文弱化 + tool Diff 入口 | 同上 | ✅ |
| **V-IND-4** activate 路径 L2 钩子 + openPanel + snapshot 空消息 | 同上 | ✅ |
| **V-IND-5** 两 Tab 同时 running，status 只跟活动（AC-21；implementer 缺专用夹具） | 同上 | ✅ |

## Reviewer 建议的验证场景

| 场景 | 命令 | 结果 |
|------|------|:--:|
| 复跑 `run-phase1-l2-l3.sh` | bash runner | ✅ |
| 关最后 Tab `hasReplaceEmpty` 探针 | protocol L3 + V-IND-1 | ✅ true |
| 全量 `apps/vscode-dsh/tests` | vitest 59 | ✅ |

## 端到端验证

| 数据路径 | 结果 | 证据 |
|----------|:--:|------|
| FakeWebview `composer/send` → Host gate → `promptActive` → MessageStore → `messages/append` | ✅ | V-IND-1 + L3 send |
| `closeConversation`(最后 Tab) → `pushFullState` → `panel/state:empty` + `messages/replace([])`；**不** `disposeSession`；权威保留 | ✅ | V-IND-1 |
| `deleteConversation(confirmed)` → `disposeSession` + MessageStore 清空；已关未删 session 仍保留 | ✅ | V-IND-1 对照 |
| activate → `dsh.test.*` 钩子可脱离 Webview 驱动 | ✅ | V-IND-4 |
| Timeline `assistant/message` 短 label；`tool/result` Diff 保留 | ✅ | V-IND-3 |
| 真实 fake-sdk 子进程：close≠dispose / delete=dispose | ✅ | `panel-close-delete.e2e` |

## 残余风险

| 风险 | 严重性 | 说明 |
|------|:--:|------|
| 未跑真实 VS Code Extension Host / HTML 渲染（L4） | 🟢 LOW | Spec 明确 L3=FakeWebview 协议；L4 非达标门槛；duck-typed vitest 为仓库等价 L2 |
| DEBT-001 / GAP-001 | 🟢 LOW | registry 🟡，目标 phase-2/3；非本 Phase 阻塞 |
| `sessionId: ''` 清空哨兵未协议文档化 | 🟢 LOW | review Observation；行为已测通 |

## 问题清单（为何不是 FAIL / 为何可 PASS）

无 CRITICAL/MEDIUM 未决项。MUST-FIX loop1 空态清空已由 L3 + V-IND-1 独立证明关闭。AC-21 缺 implementer 夹具已由 V-IND-5 补齐。

## Pipeline 合规检查

Pipeline compliance: ✅ 所有产品变更在 `impl-phase-1-panel-live-recoverable-close` 分支（`git branch --show-current`）；`packages/core/agent-loop` diff 为空；工作区改动限于 `apps/vscode-dsh/**` + `.specdev/**`。

## 验证脚本

- `test-scripts/run-phase1-l2-l3.sh` — implementer L2/L3（复跑）
- `test-scripts/verifier-independent-phase1.mts` — verifier 独立场景 V-IND-1..5
- `test-scripts/run-verifier-phase1.sh` — 聚合：L2/L3 + 独立 + 全量 vitest + tsc

### 复跑命令

```bash
PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" \
  bash .specdev/specs/vscode-dsh-conversation-ui/phases/phase-1-panel-live-recoverable-close/test-scripts/run-verifier-phase1.sh
```
