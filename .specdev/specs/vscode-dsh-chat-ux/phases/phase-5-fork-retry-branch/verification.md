# Phase 5 验证报告 — phase-5-fork-retry-branch

## 判决：PASS

## 测试执行矩阵

| 场景 | 来源 | 命令 | 结果 | 证据 |
|------|:--:|------|:--:|------|
| AC-30 复制 + lastCopiedText | spec | vitest `chat-ux-fork-retry-branch` AC-30 + independent copy param variation + static `dsh.test.lastCopiedText` | ✅ | `alpha-copy`/`beta-copy` 不坍塌；extension 暴露 `lastCopiedText` |
| AC-31/31b/66 P-接续 E2 | spec | layer-B + independent AC-31 vs AC-60 contrast | ✅ | 新 child id；父 `mode=replay`；`probes.parentReadonly/continueSealed`；`resumeCalls=[]`；active=child |
| Must-Fix turn=0 emptySeed | archive MF#1 | layer-B Must-Fix + independent edit-resend turn-0 + bridge emptySeed param | ✅ | `opts={emptySeed:true}`；无 `boundarySeq`；child 无父 assistant |
| Must-Fix MessageStore 裁剪 | archive MF#2 | layer-B prior-cut + independent retry turn=1 + `projectMessagesForForkSeed` 参数变化 | ✅ | `seedMaxTurn=0` 丢弃 turn-1 assistant；`undefined→[]` / `0≠1` |
| AC-32 编辑重发 | spec | layer-B AC-32 + independent turn-0 edit | ✅ | `editedText` 入 child user；E2；`emptySeed` |
| AC-33 三入口共用 fork | spec | layer-B AC-33 + static no truncate | ✅ | ≥3 forkCalls；无 `truncateSession`/`session/truncate` |
| AC-34/61 拒 aborted/open | spec | layer-B aborted + independent open-turn + invalid seq | ✅ | `aborted-turn` / `open-turn` / `invalid-boundary`；`forkCalls=0` |
| AC-60 P-标明父 mode 不变 | spec | layer-B AC-60 + independent contrast | ✅ | 父仍 `live`；无 `parentReadonly`；`seedMaxTurn=目标 turn` |
| AC-62/63 与 Continue 可区分 / 父子文案 | spec | layer-B AC-60/62/63 | ✅ | `branch-mark` vs `continue-switch`；`forkLabel` 含「派生自」 |
| AC-64 子 ChangeStore 空桶 | spec | layer-B + independent AC-64+65 | ✅ | child `list=[]`；父变更仍在；无 checkout 路径 |
| AC-65 Continue same-id | spec | layer-B + independent | ✅ | `resumeCalls=[sameId]`；sessionId 不变 |
| P2-1 父 running 拒 fork | spec | layer-B | ✅ | `reason=parent-running` |
| GAP-CUX-002 | registry | static + E2 probes | ✅ | 已解决表；产品路径下发 probes |
| 约束：未改 agent-loop | spec | static + `git status` agent-loop | ✅ | 无 diff / 无 untracked |
| Bridge emptySeed 透传 | verifier | `bridge-emptySeed-param-variation.sh` | ✅ | emptySeed ≠ boundarySeq 参数变化均达 SDK |
| Bridge session/fork | reviewer | `ide-bridge.spec.ts -t session/fork` | ✅ | 1 passed（boundarySeq 路径） |
| phase-2 回归 | regression | `chat-ux-streaming-cancel-follow` | ✅ | 7 passed |

## 独立验证场景（你自己设计的）

| 场景 | 命令 | 结果 |
|------|------|:--:|
| `projectMessagesForForkSeed` 参数变化（undefined/0/1） | vitest independent | ✅ |
| Bridge validate：emptySeed 单独 OK；+boundarySeq 拒；tip omit OK | vitest independent | ✅ |
| Bridge E2E emptySeed → sdkSessionFork | `bridge-emptySeed-param-variation.sh` | ✅ |
| Open turn 拒绝（implementer 未覆盖） | vitest independent | ✅ |
| Branch turn=1 `seedMaxTurn=1`（含目标回合，非 prior-cut） | vitest independent | ✅ |
| AC-31 vs AC-60 同 fixture 对照 | vitest independent | ✅ |
| Copy 文本参数变化不坍塌 | vitest independent | ✅ |
| Invalid seq → invalid-boundary | vitest independent | ✅ |

## Reviewer 建议的验证场景

| 场景 | 命令 | 结果 |
|------|------|:--:|
| 上轮 Must-Fix emptySeed + MessageStore 裁剪复验 | layer-B Must-Fix ×2 + independent | ✅ 关闭 |
| E2 / AC-64 / Continue 未破坏 | layer-B + independent | ✅ |
| emptySeed ↔ boundarySeq 互斥 | validate + SDK static + bridge param | ✅ |

## 端到端验证

| 数据路径 | 结果 | 证据 |
|----------|:--:|------|
| Webview `action/copy-message` → Host `requestCopyMessage` | ✅ | 两段不同文本依次写入 |
| `forkFromClosedTurn(retry)` → Host `forkSession({emptySeed})` → `applyContinueSwitch` → `panel/state.probes` | ✅ | FakeWebviewPort 收到 `parentReadonly`+`continueSealed`；父 mode=replay |
| `forkFromClosedTurn(branch)` → 空 ChangeStore child + 父 live | ✅ | child changes `[]`；父 mode 不变 |
| Bridge `session/fork` emptySeed → `sdkSessionFork` | ✅ | forked options `{emptySeed:true}` |
| Continue → `session/resume` same-id | ✅ | `resumeCalls=[before]` |

## 残余风险

| 风险 | 严重性 | 说明 |
|------|:--:|------|
| 真 VS Code clipboard / 真模型 fork 未在本机 IDE 手工点按 | 🟢 LOW | 层 B 走 Fake clipboard + Host fork 注入；产品路径符号与 bridge/SDK 契约已用执行证据覆盖；非行为缺口 |
| SDK `forkSeedFromParent` 私有函数未直接单测 | 🟢 LOW | 静态断言 `emptySeed→seed:[]` + bridge 透传 emptySeed 已验证；与 tip omit 行为在源码/互斥校验双线确认 |

## Pipeline 合规检查

- Pipeline compliance: ✅ 所有产品改动在工作区位于 `impl-phase-5-fork-retry-branch`（未 commit，符合「implementer 不自行 commit / HG-3 统一提交」）
- `packages/core/agent-loop`：无改动
- specs 仅验证产物写入本 Phase 目录；未将 specs 作为产品提交（本 verifier 亦不 commit）

## 验证脚本

落盘目录：`.specdev/specs/vscode-dsh-chat-ux/phases/phase-5-fork-retry-branch/test-scripts/`

| 文件 | 用途 |
|------|------|
| `static-checks.sh` | agent-loop / emptySeed 契约 / GAP-CUX-002 / copy 出口 |
| `verifier-independent-phase5.spec.ts` | 14 个独立场景 |
| `vitest.config.ts` | 隔离 vitest 配置 |
| `bridge-emptySeed-param-variation.mts` + `.sh` | Bridge emptySeed 参数变化 E2E |
| `run-verifier-phase5.sh` | 一键：static + layer-B + 回归 + bridge + independent |

### 执行摘要（本机）

```
static-checks PASSED
chat-ux-fork-retry-branch: 12 passed
chat-ux-streaming-cancel-follow: 7 passed
ide-bridge session/fork: 1 passed
bridge emptySeed param variation: PASS
verifier independent: 14 passed
```

一键：`bash .specdev/specs/vscode-dsh-chat-ux/phases/phase-5-fork-retry-branch/test-scripts/run-verifier-phase5.sh`
