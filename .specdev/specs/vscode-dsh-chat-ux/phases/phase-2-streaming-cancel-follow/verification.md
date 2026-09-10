# Phase 2 验证报告 — phase-2-streaming-cancel-follow

## 判决：PASS

## 测试执行矩阵

| 场景 | 来源 | 命令 | 结果 | 证据 |
|------|:--:|------|:--:|------|
| AC-10/12/18 chunk→store→patch 身份 | spec / impl 层 B | `vitest run apps/vscode-dsh/tests/chat-ux-streaming-cancel-follow.spec.ts` | ✅ | 7/7 passed；后续 chunk 仅 `messages/patch`，同 messageId 收敛 |
| AC-11/T6 无 reasoning 展示 | spec / impl 层 B | 同上 | ✅ | `reasoning-delta` → store 空；仅 text-delta 投影 |
| AC-13 Stop→cancelSession | spec / impl 层 B | 同上 | ✅ | `action/stop` → `host.cancelCalls === [sessionId]` |
| AC-13b aborted incomplete + 半截 | spec / impl 层 B | 同上 | ✅ | text 保留 + `incomplete` + notice「已停止/未完成」 |
| AC-13d cancel 失败 fail-closed | spec / impl 层 B | 同上 | ✅ | banner「中断失败」；不标 incomplete |
| AC-19 断连 fail-closed | spec / impl 层 B | 同上 | ✅ | status error → streaming cleared + banner |
| AC-13b hydrate aborted | spec / impl 层 B | 同上 | ✅ | `detectIncomplete` aborted/interrupted true |
| AC-14/15/16/18/71 层 A | spec / impl 层 A | `vitest run apps/vscode-dsh/tests/layer-a/` | ✅ | 14/14（含 streaming-cancel-follow + foundation） |
| AC-13 bridge→sdkSessionCancel | review | `vitest run packages/ide/ide-bridge/tests/ide-bridge.spec.ts` | ✅ | 16/16；cancel round-trip ok |
| AC-17 / O-3 / keepInbox / AC-72 | verifier static | `bash …/test-scripts/static-checks.sh` | ✅ | agent-loop 未改；keepInbox:true；无层 C Must |
| detectIncomplete 回归 | review 建议 | `vitest run …/phase3-restart-continue.spec.ts -t detectIncomplete\|incomplete\|aborted` | ✅ | 2 passed / 11 skipped |

## 独立验证场景（verifier 自设计）

| 场景 | 命令 | 结果 |
|------|------|:--:|
| E2E Host outbound append/patch → 真实 DOM 同 `data-message-id` 节点 | `vitest run --config …/test-scripts/vitest.config.ts` | ✅ |
| AC-13b 出站 `messages/patch { incomplete:true }`（connectivity 缝） | 同上 | ✅ |
| live `interrupted`（impl 仅测 aborted live） | 同上 | ✅ |
| cancel ok 不伪造 incomplete → 随后 aborted 才 settle | 同上 | ✅ |
| P2-2 cancel/断连后 follow 保持 off（不强制重置） | 同上 | ✅ |
| MessageStore + pushPatch text⊕appendText XOR 拒绝 | 同上 | ✅ |
| 交错 reasoning-delta 不污染 text | 同上 | ✅ |
| 产品 HTML 含 Stop / patch / follow-resume；无 thinking | 同上 | ✅ |
| `server.cancelSession` 源码钉死 `keepInbox:true` | 同上 | ✅ |
| bridge 双 sessionId 参数变化 → sdkSessionCancel | `bash …/bridge-cancel-param-variation.sh` | ✅ |

**独立套件汇总**：`verifier-independent-phase2.spec.ts` **10/10 passed**；bridge param **PASS**。

## Reviewer 建议的验证场景

| 场景 | 命令 | 结果 |
|------|------|:--:|
| 层 A patch 身份 + follow | `vitest run apps/vscode-dsh/tests/layer-a/` | ✅ 14 passed |
| 层 B chunk/cancel/aborted/fail-closed | `vitest run apps/vscode-dsh/tests/chat-ux-streaming-cancel-follow.spec.ts` | ✅ 7 passed |
| ide-bridge cancel | `vitest run packages/ide/ide-bridge/tests/ide-bridge.spec.ts` | ✅ 16 passed |
| AC-13b outbound incomplete patch（review 标注缝隙） | verifier independent | ✅ 已补测通过 |

## 端到端验证

| 数据路径 | 结果 | 证据 |
|----------|:--:|------|
| `assistant/chunk` text-delta → MessageStore → `messages/append`/`patch` → `patchMessageDom` 同节点 | ✅ | independent E2E：`Aa`+`Bb`+`Cc` → DOM text `AaBbCc`，单一 `data-message-id`；后续帧无 replace/append |
| `action/stop` → `cancelActiveTurn` → `cancelSession`（Host spy） | ✅ | 层 B + independent cancel→aborted 序列 |
| bridge `session/cancel` → `sdkSessionCancel`（双 sessionId） | ✅ | ide-bridge 16 + bridge-cancel-param-variation |
| SDK `cancelSession` → `Agent.cancel({kind:'user'},{keepInbox:true})` | ✅ | static-checks + independent 源码断言；**未改 agent-loop** |
| `turn/end` aborted/interrupted → incomplete + notice；半截保留 | ✅ | 层 B + independent outbound patch + interrupted |
| cancel 超时/失败 → banner fail-closed；不宣称成功 | ✅ | 层 B AC-13d |
| Host disconnect → streaming false + banner；follow 不强制 on | ✅ | 层 B AC-19 + independent P2-2 |
| reasoning-delta 丢弃（T6） | ✅ | 层 B + independent 交错噪声 |

## 残余风险

| 风险 | 严重性 | 说明 |
|------|:------:|------|
| Follow 产品滚动像素行为未在 jsdom 断言 | 🟢 LOW | AC/设计明确不断言像素；决策函数 + `data-follow-state` + HTML 接线已验 |
| Cancel 全链无单测贯穿 IdeSessionHost.broadcast→真实 Agent 实例 | 🟢 LOW | 分段：Host spy + bridge 真 socket + server 源码 keepInbox；符合 I-真分段验证习惯 |
| DEBT-CUX-001 / GAP-CUX-001/002 | 🟢 LOW | registry 已知非阻塞；目标 phase-3/4/5；本 Phase 未误判 |

无 CRITICAL / MEDIUM 残余风险。

## Pipeline 合规检查

- Pipeline compliance: ✅ 所有产品变更在 `impl-phase-2-streaming-cancel-follow` 分支工作区（未提交，符合「implementer 不自行 commit」）
- ✅ `packages/core/agent-loop` 无工作区改动、无分支 commit（O-3）
- ✅ 无未登记疑似桩（对照 `tech-debt-registry.md`；参数变化测试输出随输入变化）

## 验证脚本

落盘于：

```
.specdev/specs/vscode-dsh-chat-ux/phases/phase-2-streaming-cancel-follow/test-scripts/
├── run-verifier-phase2.sh
├── static-checks.sh
├── vitest.config.ts
├── verifier-independent-phase2.spec.ts
├── bridge-cancel-param-variation.sh
└── bridge-cancel-param-variation.mts
```

一键：`bash .specdev/specs/vscode-dsh-chat-ux/phases/phase-2-streaming-cancel-follow/test-scripts/run-verifier-phase2.sh`

## 环境

- Node **v22.14.0**
- 分支：`impl-phase-2-streaming-cancel-follow`
- 日期：2026-09-10
