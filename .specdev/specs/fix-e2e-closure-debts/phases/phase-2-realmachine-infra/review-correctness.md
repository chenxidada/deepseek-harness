# Correctness Review — Phase 2（DEBT-14 增量修复）

## 视角
**Implementation Correctness** — 代码是否正确工作

## 判决
**SHOULD-FIX**

> 代码修复本身真实、逻辑正确、纯验证基建、无回归、无未注册桩 —— 不构成 MUST-FIX。
> 但 implementer 声称的「真机已复验闭环」证据是**隔离单跑**（`openTabSet:0`），
> 无法复现根因的失败路径（restore 关闭 live Tab），因此修复的核心分支
> （`newConversation` 重建 live Tab）**端到端未被验证**。详见「关键发现」。

## 逐条 AC 验证

DEBT-14 不在 spec.md 的 AC 清单内（spec AC 覆盖 DEBT-2/3/7/10/12），它是 Phase 2 二轮真机
verifier 暴露、本轮增量修复的债务。按本轮审查焦点，映射到最相关 AC：

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-1（范围授权） | 新增 `dsh.test.*` 必须 `VSCODE_DSH_TEST=1` 门控、注册在 `shouldRegisterTestHooks` 分支内；不引入新产品业务逻辑 | `extension.ts:1028-1040` | ✅ | 修复在 `shouldRegisterTestHooks`（`:1012`）分支内；生产命令 `dsh.askAboutSelection`（`:842-844`）仍直调 `runAskAboutSelection`，未改 |
| DEBT-14（真修） | `dsh.test.askAboutSelection` 在 `runAskAboutSelection` 返回后结算 in-flight restore 并重建 live Tab | `extension.ts:1029-1037` | ✅（代码）/ ⚠️（证据） | 函数体为真实逻辑（`await autoReady?.triggerAutoReady()` + 条件 `newConversation`），非空壳；但真机证据未触发该分支（见下） |
| AC-12（回归护栏） | 既有 vitest + 冒烟通过，不引入回归 | 生产路径未触碰 | ✅ | 仅改 test hook + registry；生产 `runAskAboutSelection`/auto-ready/conversation-controller 语义未动 |
| AC-13（诚实登记） | 无取巧、无放宽断言 | — | ✅ | 未放宽 `$assistantContains`/超时、未删步骤、未改探针；DEBT-14 移到 registry「已解决」 |
| DEBT-14 一致性 | DEBT-14 从活跃移到已解决，registry 无未注册桩 | `tech-debt-registry.md` | ✅ | 已解决表含 DEBT-14 行；活跃表剩 DEBT-2/3/13/15；grep 无 `@STUB`/`TODO: wire` |

## Stub Detection（桩代码检测）

### 已注册桩（对照 registry）
| Registry ID | 文件:函数 | 状态 | 说明 |
|-------------|-----------|:--:|------|
| DEBT-2 | `server.ts:createForkedSession`（AC-13 登记） | ⚠️ Known | 已登记为「本工作流外」，非本轮范围 |
| DEBT-3 / DEBT-13 / DEBT-15 | manifest 流式增量 / delete-modal / messages-protocol | ⚠️ Known | 均在活跃债务表，非本轮改动 |

### 新发现的未注册桩
无。

- 修复代码（`extension.ts:1028-1040`）全部为真实调用：`await triggerAutoReady()`（`auto-ready-coordinator.ts:84-86` 委托 `maybeApplyReady`，`:96-118` 有真实 `applyInFlight` 单飞 + await 逻辑）、`newConversation(EMPTY_LIVE_TITLE)`（`conversation-controller.ts:347-353` 真实 `registry.create` + `persistOpenTabs`）、`pushFullState()`。
- `triggerAutoReady` / `newConversation` / `getActive` 均为既有公开方法，非本轮新增空壳。

## 关键发现

### 🔴 Must-Fix
无。

### 🟡 Should-Fix

**S-1：真机「闭环」证据是隔离单跑，未复现根因失败路径，修复的核心分支端到端未验证。**

- 根因（implementer 自述 + 代码核实）：`openEditorWithSelection` 打开文本编辑器 → webview 失焦 → `auto-ready` 的 `readyAppliedForVisibilityEpoch` 重置（`auto-ready-coordinator.ts:61-68`）→ `runAskAboutSelection` 内 `revealConversationPanel` 重新触发 `restoreOpenTabSet`（`conversation-controller.ts:580-583` 关闭所有 live Tab + 恢复 replay Tab）。
- **该失败路径的必要前置条件是 `openTabSet` 非空**（有前序持久会话可 restore）。当 `openTabSet` 为空时，`restoreOpenTabSet` 在 `conversation-controller.ts:496-500` 直接返回 `{ outcome: 'empty' }`，不关闭任何 live Tab。
- 但 implementer 提供的真机证据是 `LAYER_V_CAPABILITY_ONLY="cap-selection-ask"` **隔离单跑**（`runs/20260920T064428Z-2001844/layer-v-capabilities-status.json`），其 `host-started` 步（step 4）值为 `openTabSet: 0`、`tabs: 1` —— **无前序会话**。
- 因此该 run 中：
  - restore 走 `outcome:'empty'`，不关闭 live Tab；
  - `active` 始终是 step 5 `new-conversation` 建的 live Tab（`a62ec373…`），`mode:'live'`；
  - 修复里的 `if (active === undefined || active.mode !== 'live')` **恒为 false，`newConversation` 重建分支从未被执行**。
- 结论：`exit 0` / `closedLoop.closed:true` 是真的，但它描述的是「隔离 happy path 通过」，**不能区分「已修复」与「失败路径未被复现」**。原始失败发生在全链 model 批（前序 `cap-message-store-stream-patch` 会话残留在 `openTabSet`），该场景**尚未用修复后的代码重跑**。

**S-1 建议**：在含前序持久会话的场景重跑 `cap-selection-ask`（至少 `LAYER_V_CAPABILITY_ONLY` 单跑前先跑一次会持久化会话的能力，或直接跑全链 model 批），确认 `assistant-replied` 的 `panelSnapshot` 读到 `mode:'live'` 且 sessionId 与 `send-prompt` 一致，再宣称 DEBT-14 闭环。

> 说明：代码逻辑本身经我逐分支追查是**正确**的 —— `triggerAutoReady()` 经 `maybeApplyReady` 的 `applyInFlight` 字段（`auto-ready-coordinator.ts:50/100-117`）能正确 `await` in-flight 的 restore；restore 结算后 `readyAppliedForVisibilityEpoch` 已为 true，不会二次 restore（`:107-110`），随后 `active.mode !== 'live'` 触发 `newConversation` 重建 live Tab。所以这不是代码缺陷，而是**验证覆盖缺口**。

### 🟢 Observations

- **[文档保真]** implementation.md DEBT-14 章节测试结果表 #5 与 #342 行声称「真机复验 `cap-selection-ask` 闭环」「10 个步骤全部 ok:true」，字面为真（status.json 10 步全 ok）。但该陈述未点明这是 `openTabSet:0` 的隔离跑，读起来易被误认为已覆盖全链失败场景 —— 属陈述不完整，不计入判决，建议在 implementation.md 补充「隔离单跑未复现全链失败路径」的限定。
- `dsh.test.askAboutSelection` 的返回仍是 `runAskAboutSelection` 的 `result`（`:1039`），manifest 的 `ask-about-selection` 步断言（`ok:true`/`path`/`startLine`/`endLine`）不受修复影响，无回归。

## 结论

修复是真实的验证基建改动（纯 test hook、`VSCODE_DSH_TEST=1` 门控、生产路径未动、无桩、registry 一致），代码逻辑正确。唯一问题是「真机闭环」证据是隔离单跑，未复现根因（非空 `openTabSet` 下 restore 关闭 live Tab），修复的 `newConversation` 重建分支端到端未被验证 —— 属 SHOULD-FIX（验证覆盖缺口），建议在含前序会话场景重跑确认后再定 DEBT-14 闭环。
