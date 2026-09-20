# Phase 2 验证报告（phase-2-realmachine-infra）— 第四轮（DEBT-14 构建后交付态终验）

## 判决：PARTIAL

> 判决理由：本轮按任务要求做「DEBT-14 在构建后的交付态真闭环」终验。第三轮判 FAIL 的 CRITICAL 根因（implementer 改了 `src/extension.ts` 但漏 `build:host` 致 `lib/` 旧、真机 host 加载旧 lib）已由 implementer 补 build 解决——我在本机**独立确认**：`lib/`/`webview/dist/` 均已晚于对应源码、`lib/extension-C6sxRWop.js` 已含 DEBT-14 修复分支，并在「非空 `openTabSet:1`」场景真机复跑，`cap-selection-ask` 真闭环（`mode:live`、sessionId 与 `send-prompt` 一致、`assistant-replied` 命中 `LAYER-V-CAP-26-OK`、`closedLoop.closed=true`、exit 0）。
>
> 因此 **DEBT-14 修复本身判 PASS**（交付态真闭环）。但**整体判决为 PARTIAL**：本 Phase 范围内真修完成的债务（DEBT-7/10/12/14 全闭环）之外，仍剩 **DEBT-2 / DEBT-3 / DEBT-15 / DEBT-13** 四条**已登记残留**（Known Gap）——它们不是本 Phase 声称要修而未修，而是用户已决策本 Phase 只修 DEBT-14（DEBT-2/13「做不动」、DEBT-3/15「流式波动系统性，后续处理」）。AC-9 全链 exit 0 因此仍未达成（被 DEBT-2/3/15 拖累）。按 verifier 契约「有 Known Gap → PARTIAL」，判决为 PARTIAL，但**本报告明确区分**「本 Phase 已真修闭环」与「已登记残留」两部分。

## 本轮核心任务：DEBT-14 修复「构建后交付态」真闭环

### 第一步：确认 lib 是最新构建（不信 implementer，自己查）

| 证据项 | 事实 | 证据 |
|---|---|---|
| lib 晚于 src | `lib/extension-C6sxRWop.js` mtime `1789889399`（15:29:59）> `src/extension.ts` `1789886537`（14:42:17） | `stat -c %Y` |
| webview dist 晚于 src | `webview/dist/assets/index.js/.css` mtime `1789889414`（15:30:14）> `webview/src/probes.ts` `1789875958`（11:45:58） | `stat -c %Y` |
| lib 含修复分支 | `lib/extension-C6sxRWop.js` 内 `dsh.test.askAboutSelection` 命令体 = `await autoReady?.triggerAutoReady(); ... if (active === void 0 || active.mode !== "live") { controller.newConversation(EMPTY_LIVE_TITLE); panelHost?.pushFullState(); }` | python 提取 lib 字节 419609 附近 + 426490 起命令体 |
| git 状态 | `webview/dist/assets/index.css`/`index.js` 均显示 ` M`（已重新打包）；`lib/` gitignored 不入库 | `git status -s` |

结论：构建产物就绪，修复已编译进 lib。**不存在第三轮「旧 lib 假阳性」问题。**

### 第二步：真机复验（非空 `openTabSet` 场景，根因失败路径）

```
命令：LAYER_V_CAPABILITY_ONLY="cap-message-store-stream-patch,cap-selection-ask"（带 key，Node 24.3.0）
run=20260920T073507Z-2111494  exit 0 (PASS)
  cap-message-store-stream-patch  PASS  closed=true   （前序持久化会话 b52e9f92）
  cap-selection-ask               PASS  closed=true
    host-started:      tabs=1  openTabSet=1            ← 根因前置条件（非空）满足 ✅
    new-conversation:  sessionId=c46f260d (mode=live)
    send-prompt:       sessionId=6d9ab5cb              ← 与 new-conversation 不同 → 修复的重建分支被执行 ✅
    assistant-replied: mode=live  sessionId=6d9ab5cb   ← 与 send-prompt 一致 ✅
    openTabSet=[b52e9f92/replay, 6d9ab5cb/live]
    assistant 回复 = LAYER-V-CAP-26-OK
    closedLoop: closed=true  actualTrigger=true  concreteAssertion=true  realScreenshot=true
```

**关键证据**：`send-prompt` 的 sessionId（`6d9ab5cb`）与 `new-conversation`（`c46f260d`）**不同**——证明修复的 `if (active.mode !== 'live') newConversation(EMPTY_LIVE_TITLE)` 分支**真实执行**（restore 关闭 `c46f260d` 后重建了 `6d9ab5cb`），`assistant-replied` 读到 `mode:live` + 与 `send-prompt` 一致的 sessionId。这是 reviewer-correctness 上一轮要求、且第三轮因旧 lib 未真正拿到的端到端证据。`LAYER-V-CAP-26-OK` marker 为模型真实回显（每 run 随机生成、harness 校验），证明真实 LLM 往返。

## 回归确认（DEBT-10 / DEBT-12 未被 DEBT-14 修复或 build 破坏）

```
命令：LAYER_V_CAPABILITY_ONLY="cap-open-subagent-context,cap-delegate-subagent-model"（带 key，Node 24.3.0）
run=20260920T075425Z-2146412  exit 0 (PASS)
  cap-open-subagent-context      PASS  closed=true   （inject-child-started → enter-child-context 钉住子 tab）
  cap-delegate-subagent-model    PASS  closed=true
    child-replied: childSessionId=8c1cccde  title="Subagent 8c1cccde"  status=ended  parentSessionId=40c9d532
    child assistant 回复 = LAYER-V-CAP-24-OK
    closedLoop.closed=true
  readonly-live 失败计数 = 0    ← DEBT-12 复位生效 ✅
```

- **DEBT-10 真实委托无回归**：`cap-delegate-subagent-model` 走真实委托链路（父 `sendPrompt` → 模型 `subagent` 工具 → 子 Agent → 子会话 assistant 回复 `LAYER-V-CAP-24-OK`），非 `injectSubagent` 注入。
- **DEBT-12 复位无回归**：`cap-open-subagent-context`（钉住子 tab，DEBT-12 污染②源）跑在**前面**，其后的 `cap-delegate-subagent-model` `send-prompt` 仍 `ok:true`，readonly-live 失败 = 0——复位清除了 pinned 子 tab / contextSessionId。

## 残留确认（DEBT-2 / DEBT-3 / DEBT-15 / DEBT-13 状态不变）

读 `tech-debt-registry.md` 活跃债务表，四条残留均**保持不变**（本 Phase 不声称修复）：

| 债务 | 状态 | 处置依据 |
|------|------|---------|
| DEBT-2 | 🟡 活跃（未动） | fork 子会话 preset 由 SDK `createForkedSession` 硬编码继承父 preset（`server.ts:473/482/493-495`），无 `agentPreset` 覆盖 seam，属「不改产品/SDK 分叉语义」硬约束外，AC-13 登记「本工作流外」 |
| DEBT-3 | 🟡 活跃（未动） | `cap-message-store-stream-patch` #18 流式增量跨 run 波动，`intervalMs:150→50` 未彻底消除，用户已决策本 Phase 只修 DEBT-14 |
| DEBT-15 | 🟡 活跃（未动） | `cap-messages-protocol` 流式增量波动，与 DEBT-3 同根因，后续处理 |
| DEBT-13 | 🟡 活跃（未动） | `cap-delete-confirm-modal` 条件渲染无 host 侧触发（`App.tsx:131`），AC-13 诚实登记 |

DEBT-14 已在 registry「已解决」表，其「真机复验闭环」记录第三轮曾被判假阳性（旧 lib），本轮以交付态真闭环证据坐实该「已解决」判定。

## 测试执行矩阵

| 场景 | 来源 | 命令 | 结果 | 证据 |
|------|:--:|------|:--:|------|
| DEBT-14 构建产物新鲜度 | verifier 独立 | `stat -c %Y` src/lib/webview + grep lib 修复分支 | ✅ | lib 15:29:59 > src 14:42:17；lib 含 `triggerAutoReady`+`newConversation(EMPTY_LIVE_TITLE)` |
| DEBT-14 交付态真机（非空 openTabSet） | verifier 独立 | `LAYER_V_CAPABILITY_ONLY="cap-message-store-stream-patch,cap-selection-ask"` + key | ✅ | run 073507Z：openTabSet=1、send-prompt≠new-conversation、assistant-replied mode=live sessionId 一致、`LAYER-V-CAP-26-OK`、closed=true、exit 0 |
| DEBT-10 真实委托回归 | 任务要求 | `LAYER_V_CAPABILITY_ONLY="cap-open-subagent-context,cap-delegate-subagent-model"` + key | ✅ | run 075425Z：child 8c1cccde status=ended、`LAYER-V-CAP-24-OK`、closed=true |
| DEBT-12 复位回归 | 任务要求 | 同上（subagent 能力后跟 sendPrompt 能力） | ✅ | readonly-live 失败 = 0 |
| AC-1 静态（dsh.test.* 门控 / 无 agent-loop） | verifier 独立 | `verify-phase2-realmachine.sh` | ✅ | 3 命令均注册于 `shouldRegisterTestHooks`（`:1012`）；agent-loop diff 空 |
| AC-6/7 静态（concreteAssertion / requiresModel / delegate 步骤） | verifier 独立 | 同上 | ✅ | 8/9 项 `queryWebviewRenderState`；2 项 `requiresModel:false`；delegate `requiresModel:true` 含 `sendPrompt→listChildren→$assistantContains` |
| AC-9 负向（无 key model 批 SKIPPED） | verifier 独立 | 同上（采信既有 run） | ✅ | run 045004Z：24 项 `SKIPPED_NO_CREDENTIALS` |
| AC-12 vitest 回归 | verifier 独立 | `PATH=<node24> pnpm exec vitest run apps/vscode-dsh/tests` | ✅ | 12 files / 560 passed / exit 0 |
| AC-13 登记诚实（DEBT-2/13） | verifier 独立 | 同上 + registry 核对 | ✅ | `server.ts` fork preset 继承 + `App.tsx:131` 条件渲染均坐实 |

> 注：vitest 需 Node 22+（`node:sqlite`）。默认 `node` v20.16.0 会报 `ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite`（环境版本问题，非代码回归）；用 `PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH"` 后全绿。

## 独立验证场景（verifier 自己设计，不信 implementer / 上一轮 verifier）

| 场景 | 命令/方法 | 结果 | 证据 |
|------|------|:--:|------|
| 「构建后交付态」vs「第三轮旧 lib」判别 | 比对 `lib/extension-C6sxRWop.js` mtime 与 `src/extension.ts`，再 python 提取 `dsh.test.askAboutSelection` 命令体 | ✅ 已构建 | lib 15:29:59 > src 14:42:17；命令体含完整修复分支 |
| 修复分支是否真被触发（非空 openTabSet） | 真机复跑，比对 `send-prompt` 与 `new-conversation` 的 sessionId | ✅ 真触发 | `6d9ab5cb` ≠ `c46f260d` |
| DEBT-10 是否仍真实委托（非注入） | 检查 child-replied 子会话 `status=ended` + assistant 含随机 marker | ✅ 真委托 | child 8c1cccde、`LAYER-V-CAP-24-OK` |
| DEBT-12 复位是否仍生效（subagent 污染②） | subagent 能力后紧跟 sendPrompt 能力，数 readonly-live 失败 | ✅ 生效 | readonly-live = 0 |

## 端到端验证

| 数据路径 | 结果 | 证据 |
|------|:--:|------|
| DEBT-14 修复链（交付态）：`askAboutSelection` → `triggerAutoReady` 结算 restore → active 非 live → `newConversation` 重建 live Tab → `sendPrompt`/`assistant-replied` 读到同一 live 会话 | ✅（真机） | run 073507Z：openTabSet=1、send-prompt/assistant-replied sessionId 均 6d9ab5cb、`LAYER-V-CAP-26-OK`、closed=true |
| DEBT-10 真实委托链：父 `sendPrompt` → 模型 `subagent` 工具 → 子 Agent → `listChildren` 断言 | ✅（真机） | run 075425Z：子会话 8c1cccde、`LAYER-V-CAP-24-OK`、parentSessionId 匹配 |
| DEBT-12 复位链：subagent 能力后 `resetToIdle` → 后续能力干净初始态 | ✅（真机） | run 075425Z：readonly-live = 0 |

## 视觉验证（ui: false）

DAG JSON 中本 Phase `ui: false`，不涉及界面，跳过视觉验证（不因此降级判决）。

## 残余风险

| 风险 | 严重性 | 阻塞 HG-3 | 说明 |
|------|:--:|:--:|------|
| DEBT-2（fork 子会话自主编排自启动） | 🟡 MEDIUM（已登记） | 否 | AC-13 登记「本工作流外」；需改 SDK fork preset 继承语义 |
| DEBT-3（#18 流式增量跨 run 波动） | 🟡 MEDIUM（已登记） | 否 | `intervalMs:50` 未彻底消除，用户已决策后续处理 |
| DEBT-15（cap-messages-protocol 流式波动） | 🟡 MEDIUM（已登记） | 否 | 同 DEBT-3 根因 |
| DEBT-13（cap-delete-confirm-modal 无 host 触发） | 🟢 LOW（已登记） | 否 | AC-13 诚实登记 |
| AC-9 全链 exit 0 未达成 | 🟡 MEDIUM（已知） | 否 | 被 DEBT-2/3/15 拖累，非串行状态污染、非本 Phase 声称修复项 |

## Pipeline 合规检查

- ✅ 当前分支 `impl-phase-2-realmachine-infra`；全部非 spec 改动在 `apps/vscode-dsh/`（`src/*`、`test-scripts/*`、`tests/cap-test-harness.spec.ts`、`webview/*`）。
- ✅ `git diff --name-only HEAD -- packages/core/agent-loop` 为空 —— 无 agent-loop / 产品 / SDK 代码变更（AC-1 范围授权成立）。
- ✅ `lib/` 为 gitignored 构建产物；`webview/dist/` 已重新打包（`git status` 显示 `M`），与交付态一致。
- ✅ 无未注册 `@STUB`。
- ✅ registry 中 DEBT-14 已移「已解决」且本轮以交付态真闭环坐实；DEBT-2/3/13/15 仍在「活跃债务」表，状态一致。

## 主动问题上报（AC-19）—— 为何不是 PASS

判决为 **PARTIAL**，分条如下：

1. **【DEBT-14 已真闭环，正面】交付态真闭环成立**：构建产物新鲜（lib 15:29:59 > src 14:42:17、含修复分支）+ 真机非空 `openTabSet:1` 场景 `cap-selection-ask` 真闭环（run 073507Z：`mode:live`、sessionId 一致、`LAYER-V-CAP-26-OK`、`closedLoop.closed=true`、exit 0）。第三轮 FAIL 的 CRITICAL 根因（漏 build 致旧 lib）已彻底消除，且**本轮的证据不是假阳性**——`send-prompt`≠`new-conversation` 的 sessionId 证明修复分支被真实触发。
2. **【DEBT-10/DEBT-12 无回归，正面】**：真机回归确认真实委托（子会话 `LAYER-V-CAP-24-OK`）与复位（readonly-live=0）均未被 DEBT-14 修复或 build 破坏。
3. **【DEBT-2，已登记残留】为何不是 PASS**：`cap-fork-from-closed-turn` 的 `child-replied` 真机仍 LINK_FAILURE（fork 子会话 preset 由 SDK 硬编码继承父 preset，无 seam），AC-13 已登记「本工作流外」。→ 属已登记 Known Gap，非本 Phase 声称修复项。
4. **【DEBT-3/DEBT-15，已登记残留】为何不是 PASS**：`cap-message-store-stream-patch` #18 与 `cap-messages-protocol` 的流式增量跨 run 波动（`requireIncrement` 偶发 `no streaming increment observed`），用户已决策本 Phase 只修 DEBT-14、这两条后续处理。
5. **【DEBT-13，已登记残留】为何不是 PASS**：`cap-delete-confirm-modal` 条件渲染无 host 触发，AC-13 登记。
6. **【AC-9 未达成，Why PARTIAL 的根源】**：全链 41 项 exit 0 因 DEBT-2/3/15 未达成。但这是**已登记残留**导致的，不是本 Phase 声称要修而未修，也不是串行状态污染（DEBT-12 已消除 readonly-live 污染）。

**一句话区分**：本 Phase 范围内真修完成的债务 **DEBT-7 / DEBT-10 / DEBT-12 / DEBT-14 全闭环**；仅剩 **DEBT-2 / DEBT-3 / DEBT-15 / DEBT-13** 四条**已登记残留**（用户已决策的 Known Gap），故整体 PARTIAL 而非 PASS。

## 验证脚本

- `.specdev/specs/fix-e2e-closure-debts/phases/phase-2-realmachine-infra/test-scripts/verify-phase2-debt14-round4.sh`（本轮新增：构建新鲜度 + 修复分支 + DEBT-14 非空 openTabSet 证据 + DEBT-10/12 回归证据，一次提取）
- 复用 `.specdev/specs/fix-e2e-closure-debts/phases/phase-2-realmachine-infra/test-scripts/verify-phase2-debt14-repro.sh`（第三轮非空 openTabSet 证据提取，本轮仍有效）
- 真机复跑命令（供复现，勿回显 key 明文）：
  ```bash
  export DEEPSEEK_API_KEY="$(grep '^DEEPSEEK_API_KEY=' .env | cut -d= -f2-)"
  # DEBT-14 交付态终验（非空 openTabSet）：
  LAYER_V_CAPABILITY_ONLY="cap-message-store-stream-patch,cap-selection-ask" bash apps/vscode-dsh/test-scripts/run-layer-v-capabilities.sh
  # DEBT-10 真实委托 + DEBT-12 复位回归：
  LAYER_V_CAPABILITY_ONLY="cap-open-subagent-context,cap-delegate-subagent-model" bash apps/vscode-dsh/test-scripts/run-layer-v-capabilities.sh
  # AC-12 回归（需 Node 22+）：
  PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" pnpm exec vitest run apps/vscode-dsh/tests
  ```
- 运行证据 run 目录：`20260920T073507Z-2111494`（DEBT-14 交付态闭环）、`20260920T075425Z-2146412`（DEBT-10/12 回归）。
