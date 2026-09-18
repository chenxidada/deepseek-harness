# Phase 4 验证报告

## 判决：PASS

独立端到端验证通过：13 条 AC 全部有真实执行证据覆盖（我的独立 V-IND-A~E 36 项断言 + 既有 V-IND-1~6 42 项断言 + phase4 vitest 11/11 + 全量回归 0 失败 + Host tsc 通过 + webview vite build 通过）。两条 SHOULD-FIX 经静态 + 运行时双重核实均**属实**，但属 Should 级非阻塞（详见 §SHOULD-FIX 核实结论），不构成 visual-blocking、不阻断 HG-3。无未登记 `@STUB`。

---

## 测试执行矩阵

| 场景 | 来源 | 命令 | 结果 | 证据 |
|------|:--:|------|:--:|------|
| AC-35/37/39/40/71/74/75/78/79/38/36/84 L2/L3 | spec | `vitest run apps/vscode-dsh/tests/phase4-subagent-enter-pin.spec.ts` | ✅ | `Test Files 1 passed (1)` / `Tests 11 passed (11)`，exit 0 |
| 全量回归（无回归） | verifier | `vitest run apps/vscode-dsh/tests` | ✅ | `Test Files 59 passed (59)` / `Tests 522 passed | 1 skipped (523)`，exit 0（**0 失败**） |
| Host 类型检查 | spec/impl | `tsc -p apps/vscode-dsh/tsconfig.json --noEmit` | ✅ | exit 0，无输出 |
| Webview 生产构建 | verifier 追加 | `vite build`（`apps/vscode-dsh/webview/`） | ✅ | `✓ built in 89ms`，exit 0（26 modules） |
| 独立 e2e（本次新写） | verifier | `tsx .../test-scripts/verifier-e2e-phase4.mts` | ✅ | `done failed=0`（36 项断言，V-IND-A~E + V-SF-1） |
| 既有独立验证 | verifier | `tsx .../test-scripts/verifier-independent-phase4.mts` | ✅ | `done failed=0`（42 项断言，V-IND-1~6） |

> 注：全量套件实测 **0 失败**，优于 `project-test` 技能记录的「2 failed 基线」——两条历史失败（`panel-close-delete.e2e`、`verifier-phase1/layer-a-rtl`）本轮已不再出现。属正向观测，不影响判决。

---

## 独立验证场景（本次新写，不照抄既有判定）

| 场景 | 命令 | 结果 | 关键断言 |
|------|------|:--:|------|
| V-IND-A 进入子会话（running→readonly-live；finished→replay；不占 Tab） | `tsx verifier-e2e-phase4.mts` | ✅ | `panel/state` 携带 `contextSessionId=child` + `mode∈{readonly-live,replay}`；Tab 数不变；`messages/replace` 水合子消息 |
| V-IND-B 面包屑返回父 | 同上 | ✅ | `nav/back` 清 context；投影恢复父 `sessionId` + `mode='live'` + 无 breadcrumb |
| V-IND-C 只读实时→回放 | 同上 | ✅ | `sendPrompt` 拒绝 `{"ok":false,"reason":"readonly-live"}`；`finished` 后投影翻转 `replay` 且 context 保留 |
| V-IND-D 钉 Tab + 去重 + 恢复父视图 | 同上 | ✅ | 钉 +1 Tab + `pinnedSubagent=true` + 父恢复 active；再进入返回 `activated-tab` |
| V-IND-E 父子已删导航 | 同上 | ✅ | 删子→父卡 `deleted` + 再进入 `outcome:'deleted'`；删父→`breadcrumb.parentDeleted=true` + `navBack()==={outcome:'disabled'}` |
| V-SF-1（SHOULD-FIX-1 运行时核实） | 同上 | ✅ | 钉 running 子会话产出子 Tab `mode==='live'`（可写），与上下文进入路径 `readonly-live` 口径分裂 |

全部 36 项断言通过，`failed=0`。

---

## SHOULD-FIX 核实结论

### SHOULD-FIX-1：钉「运行中」子会话产出可写 `live` Tab —— **属实**

- **位置**：`conversation-controller.ts:1856-1857`
  ```ts
  const run = this.childRunState.get(childId)
  const mode: OpenTabMode = run === 'running' ? 'live' : 'replay'
  ```
- **对比**：上下文进入路径 `openSubagentContext`（`:1788`）与 `resolvePanelProjection`（`:1892`）对 running 子均投影 `readonly-live`（只读）。钉 Tab 路径却用 `mode='live'`（可写）。
- **运行时证实（V-SF-1）**：钉 running 子后，子 Tab `mode==='live'`，`resolvePanelProjection()` 根分支（`:1911-1912`）对其返回 `mode='live'` → `sendPrompt`（`chat-panel-host.ts:697-703`）放行发送。与 AC-71「运行中=只读」口径分裂。
- **兜底（属实）**：`onSubagentFinished`（`:2042-2044`）在结束事件时把 `mode==='live'` 的钉定子 Tab 强制 `setMode('replay')`，即「运行中=live、结束=replay」内部模型，非静默断裂。
- **评估**：属 Should 级窄路径（AC-38「钉 Tab」本就是 Should；「钉**运行中**子」更窄）。根因是设计数据模型 `OpenTabMode` 只有 `'live'|'replay'`、无 Tab 级只读态，design.md 未定义「运行中钉 Tab」的 Tab 级表示。**不阻断验收**（spec：SHOULD-FIX 不阻断）；**不构成 visual-blocking**（本 Phase `ui:false`）。建议后续在 design.md 显式记录口径或投影 `readonly-live`，二选一。

### SHOULD-FIX-2：`TimelineStore.childrenOf()` 无消费者 —— **属实**

- **位置**：`timeline-store.ts:232`（`childrenOf(sessionId): string[]`，返回 `this.children` 的直接子列表）。
- **全树 grep 证据**：`childrenOf(` 在 `apps/vscode-dsh` 下**零调用**；唯一的另一处 `childrenOf` 在 `packages/client/connection/src/client/fixture.ts:1953`，是无关的局部闭包（fixture 路径遍历），非 `TimelineStore` 方法。对照 `getParent` 有 3 处真实消费方（`conversation-controller.ts:1594/1814/1905`）。
- **评估**：死公共 API 面，无 `@STUB` 标记、无 registry 登记、不影响任何端到端路径。**不阻断验收**。建议删除或未来 Phase 接线消费方。

---

## 端到端验证（数据路径表）

| 数据路径 | 结果 | 证据 |
|----------|:--:|------|
| Webview `nav/open-subagent` → `parseWebviewToHostMessage`（fail-closed）→ `ChatPanelHost.onWebviewMessage` → `openSubagentContext` → `resolvePanelProjection` → `panel/state`(contextSessionId/mode) + `messages/replace` | ✅ | V-IND-A（FakeWebview 帧断言） |
| running 子 `sendPrompt` → `resolvePanelProjection().mode==='readonly-live'` → `reject('readonly-live')` → `ui/reject-send` | ✅ | V-IND-C + `chat-panel-host.ts:701` 读体 |
| `subagent.finished` → `onSubagentFinished` → 卡片 running→ended + 投影翻转 `replay` | ✅ | V-IND-C + phase4 vitest |
| Webview `action/pin-subagent` → `pinSubagent` → `registry.create` + `setPinnedSubagent` + `persistOpenTabs` → 父恢复 active | ✅ | V-IND-D |
| 已钉再进入 `nav/open-subagent` → `getBySessionId` 命中 → `switchTo` → `outcome:'activated-tab'` | ✅ | V-IND-D（去重） |
| 删子 `deleteSession` → `markSubagentCardDeleted`（父卡 `subagentStatus:'deleted'`）→ 再进入 `outcome:'deleted'` | ✅ | V-IND-E |
| 删父 `deleteSession` → `buildBreadcrumb` `parentDeleted:true` → `navBack` `outcome:'disabled'` | ✅ | V-IND-E |
| running 子 `session.event` → `isProjectedSession` → `messages/append`（子上下文仍推 webview） | ✅ | V-IND-5（既有脚本） |

---

## 技术债校验

- **未登记 `@STUB`**：`grep -rn "@STUB\|@stub" apps/vscode-dsh/src` → **0 命中**。无桩逃逸。
- **活跃债务表**：`tech-debt-registry.md` §活跃债务为空（仅「（无）」占位行）。
- **DEBT-007~011**（phase-4 自身债务）：重新真实成立，由 phase4 vitest（11/11）+ V-IND-3/6（DEBT-007/008/009）+ V-IND-A~E 覆盖。
- **DEBT-012/013**（phase-2/3 债务，registry 归因 phase-4）：字面 `DEBT-012`/`DEBT-013` 测试标记在当前测试树**已不存在**（`grep` 0 命中），`vitest -t DEBT-012/-013` 全部 skip（8 skip / 13 skip）。但**底层行为仍在**：phase-2 冷读 → `phase2-...spec.ts:422`（`listHistory ... when conversations unbound`）；phase-3 批处理 → `phase3-...spec.ts:312`（`restoreMoreTabs: read failure requeues deferred...`）。全量套件 522 passed 覆盖这两条行为。**结论**：registry「验证方式」列的测试名已陈旧（非功能缺口），建议 Phase Closure 时订正验证方式描述。非阻塞。

---

## 残余风险

| 风险 | 严重性 | 阻塞 HG-3 | 说明 |
|------|:-----:|:--:|------|
| SHOULD-FIX-1：钉运行中子会话产出可写 `live` Tab（口径分裂） | 🟢 LOW | 否 | 窄 Should 路径；有 `finished→replay` 兜底；design.md 未定义 Tab 级表示。建议后续记 design 或投影 `readonly-live` |
| SHOULD-FIX-2：`childrenOf()` 死 API | 🟢 LOW | 否 | 零调用，不影响任何路径。建议删除或接线 |
| registry DEBT-012/013「验证方式」列测试名陈旧 | 🟢 LOW | 否 | 底层行为已由 phase-2/3 套件覆盖；仅文档描述失实 |
| Webview `tsc --noEmit` 有既有错误（TS5097 扩展名导入 + TS2322 mode 收窄） | 🟢 LOW | 否 | 非 phase-4 引入（git diff 证实 `panel/tabs` 映射未改动）；webview 走 vite/esbuild 构建，`vite build` exit 0 |

**无 CRITICAL / MEDIUM 残余风险。** 无 `visual-blocking`（本 Phase `ui:false`，L2/L3 协议层达标，L4 渲染非门槛）。

---

## Pipeline 合规检查

- 当前分支：`impl-phase-4-subagent-enter-pin`（匹配 `impl-<phase-id>`）。
- 产品改动全部落在 `apps/vscode-dsh/`（src 10 文件 + webview 8 文件 + tests 1 新增文件），无 `packages/core/agent-loop` 等外部改动。
- `git status -s` 中非 `.specdev/.cursor` 的改动均为本 Phase 文件；`knowledge-base-mcp.sh`/`opencode.jsonc`/`packages/typert/generator/tests/.generated-tools-*/` 为工作区既有未跟踪杂物，与本 Phase 无关。
- Pipeline compliance: ✅ 所有变更在 `impl-*` 分支工作区；未执行 git commit（implementer/verifier 均不提交，待调度者 HG-3 统一提交）。

---

## 验证脚本

- `test-scripts/verifier-e2e-phase4.mts`（**本次新写**：V-IND-A~E + V-SF-1，36 项断言，走真实 `ChatPanelHost.handleWebviewMessage` 协议层）
- `test-scripts/verifier-independent-phase4.mts`（既有：V-IND-1~6，42 项断言）
- `test-scripts/run-phase4-l2-l3.sh` / `run-verifier-phase4.sh`

### 复跑命令

```bash
export PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH"
./node_modules/.bin/vitest run apps/vscode-dsh/tests/phase4-subagent-enter-pin.spec.ts
./node_modules/.bin/vitest run apps/vscode-dsh/tests
./node_modules/.bin/tsc -p apps/vscode-dsh/tsconfig.json --noEmit
./node_modules/.bin/tsx .specdev/specs/vscode-dsh-conversation-ui/phases/phase-4-subagent-enter-pin/test-scripts/verifier-e2e-phase4.mts
./node_modules/.bin/tsx .specdev/specs/vscode-dsh-conversation-ui/phases/phase-4-subagent-enter-pin/test-scripts/verifier-independent-phase4.mts
```
