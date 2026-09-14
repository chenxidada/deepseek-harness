# 仓库探索报告 — Phase 1：类型层一致性修复

<!--
  slug: fix-vscode-dsh-host-tsc
  phase: phase-1-fix
  nature: bugfix（确认 design.md §7 改动清单准确性 + 补充下游上下文）
  确认度标准: ✅ CONFIRMED = 已读函数体 / ⚠️ HYPOTHESIS = 仅签名 / ❓ UNKNOWN = 未验证
-->

## 1. 任务上下文

本 Phase 修复 `apps/vscode-dsh` Host 侧源码在 `tsc -b apps/vscode-dsh` 严格编译下暴露的约 20 个类型错误（三类根因：`matchTier`/`matchTiers` 单复数分裂、`Thenable` 全局类型悬空引用、`exactOptionalPropertyTypes` 下显式传 `| undefined`）。本次调研唯一目标是**核验 `design.md` §7 精确改动清单的每一处文件/行号/写法是否与实际代码一致**，并补充 implementer/reviewer/verifier 所需的调用链与约定上下文，不重新发散范围。

结论先行：**design.md §7 的 6 个文件、7 处 `Thenable`、6 个 exactOptionalPropertyTypes 调用点、1 处接口字段改名，行号与实际代码全部精确对应，无偏移**。仅 `requirements.md` 问题陈述中的 2 个行号引述（`conversation-controller.ts:1203`、`extension.ts:2088`）相对 `design.md` 略有偏差（见 §7）。

## 2. 仓库概览

- **语言/运行时**：TypeScript，ESM（`"type": "module"`），Node `^22.19 || >=24`。
- **包管理/结构**：pnpm workspaces 单仓。`apps/vscode-dsh` 是 VS Code 扩展，分三平面：
  - `src/` — Host 侧（本次改动面）
  - `webview/src/` — 前端 React（线契约消费方，本次不改）
  - `webview/dist/` — 已构建产物（本次绝不触碰）
  - `tests/` — vitest 用例（本次不改）
- **编译配置**：`apps/vscode-dsh/tsconfig.json` 继承 `tsconfig.base.json`，启用 `strict: true`、`exactOptionalPropertyTypes: true`（`tsconfig.base.json:21`）、`noUncheckedIndexedAccess: true`。`types: ["node"]`（`apps/vscode-dsh/tsconfig.json:6`），因此 **无 `@types/vscode`、无全局 `Thenable`**。
- **关键事实**：此前 feature 验证只跑 vitest（vite/tsx 直载 TS 不做类型检查），导致 Host 侧类型错误长期未暴露；运行时自洽，纯类型层不一致。

## 3. 最相关区域

| 文件 | 关联类别 | 说明 | 来源 |
|------|:--:|------|:--:|
| `apps/vscode-dsh/src/search/session-search.ts` | 1 | `SearchHit` 接口（31 行唯一单数 `matchTier`）+ 实现（67/89/98 复数） | 👁 已读全文 |
| `apps/vscode-dsh/src/extension.ts` | 1/2/3 | duck-typed `VsCodeLike`（206-221 `Thenable`）、711/712 消费、1403 返回、2091-2096 `asRelativePath` | 👁 已读相关段 |
| `apps/vscode-dsh/src/code-context/selection-ask.ts` | 2 | `TextDocumentLike.save()`（22 行 `Thenable`）；156 行 `Promise.resolve(doc.save())` | 👁 已读全文 |
| `apps/vscode-dsh/src/change/revert.ts` | 3 | `executeRevertMany` 内 278 行 `skipWrite` 传参 | 👁 已读全文 |
| `apps/vscode-dsh/src/conversation-controller.ts` | 3 | 1173、1203-1207、1798/1799 四个调用点；`streamingAssistant` 类型（223 行） | 👁 已读相关段 |
| `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` | 1（契约） | `ChatPanelHostDeps.requestSearchSessions` 返回类型（131 行 `matchTiers`） | 👁 已读全文 |
| `apps/vscode-dsh/src/chat-panel/protocol.ts` | 1（契约） | `search/results` 帧（179 行 `matchTiers`） | 👁 已读全文 |
| `apps/vscode-dsh/tsconfig.json` / `tsconfig.base.json` | 编译 | `exactOptionalPropertyTypes`、`types:["node"]` | 👁 已读全文 |

Webview/测试面（本次不改，仅佐证线契约与「复数」一致）：`webview/src/store/chat-ui-store.ts:84/567/568`、`webview/src/components/TabChrome.tsx:382/406`、4 个测试文件（`tests/chat-ux-session-search.spec.ts:145/223`、`tests/layer-a-rtl/editor-chat-phase2.spec.tsx:192/495`、`tests/verifier-phase2/layer-a-rtl.spec.tsx:239/268`、`tests/verifier-phase2/layer-b-host.spec.ts:279`）。

## 4. 关键入口点 / 调用路径

### 4.1 会话搜索（类别 1）

```
extension.ts:696 controller.searchSessions({text,path})   # Host 命令行 / panelHost
        │
        ▼
conversation-controller.ts:1276 searchSessions(query): SearchHit[]
        │  (委托)
        ▼
session-search.ts:46 searchSessions(extensionIndex, pathIndex, query): SearchHit[]
        │  构造命中对象：67 行 matchTiers:[1]、98 行 matchTiers:[2]、89 行 existing.matchTiers.push(2)
        ▼
extension.ts:1403 requestSearchSessions 回调 → 1406 return controller.searchSessions(query)
        │  返回 SearchHit[]（当前因 matchTier 单数无法赋给 ChatPanelHostDeps.requestSearchSessions 的 matchTiers 契约 → AC-5）
        ▼
chat-panel-host.ts:131 契约 matchTiers + protocol.ts:179 search/results 帧 matchTiers
        │
        ▼
extension.ts:711/712 hit.matchTiers.includes(1|2) 快捷选择描述
```

### 4.2 选区引用 save（类别 2）

```
extension.ts:2080 runAskAboutSelection → 2088 askAboutSelection({ ... })
        │  deps 中含 TextDocumentLike（selection-ask.ts:19）
        ▼
selection-ask.ts:156 await Promise.resolve(doc.save())   # doc.save(): Thenable<boolean>|Promise<boolean>|boolean
```

### 4.3 revert / streaming turn（类别 3）

```
conversation-controller.ts:1173 executeRevert(deps, changeId, { skipWrite: options.skipWrite })
conversation-controller.ts:1203 executeRevertMany(deps, changeIds, { confirmedGates, confirmGate@1205, skipWrite@1206 })
        │
        ▼
revert.ts:278 executeRevert(deps, changeId, { skipWrite: options.skipWrite })   # executeRevertMany 内部

conversation-controller.ts:1798 this.streamingAssistant.set(sessionId, { messageId, turn })
conversation-controller.ts:1799 streaming = { messageId, turn }   # Map<string,{messageId:string;turn?:number}>（223 行）
```

## 5. 可能的影响面

| 文件 | 改动 | 风险 |
|------|------|:--:|
| `session-search.ts:31` | `matchTier` → `matchTiers`（1 处） | 🟢 低（纯接口字段改名，闭环） |
| `extension.ts:206/212/213/214/215/221` | `Thenable` → `PromiseLike`（6 处） | 🟢 低（机械替换，`PromiseLike` 更宽） |
| `extension.ts:2091-2096` | `asRelativePath` 条件展开 | 🟢 低（省略 ≡ undefined，走 `node:path` 兜底） |
| `selection-ask.ts:22` | `Thenable` → `PromiseLike`（1 处） | 🟢 低 |
| `revert.ts:278` | `skipWrite` 条件展开 | 🟢 低（`skipWrite !== true` 缺省一致） |
| `conversation-controller.ts:1173/1203-1207/1798/1799` | 条件展开（4 处） | 🟢 低（缺省语义一致，AC-9/10/11 锁定） |

所有改动均为**局部类型层改写，不触碰运行时逻辑、线契约字段名、Webview dist、对外类型签名**（除 `SearchHit.matchTier` 这一最小一致性改名）。

## 6. 既有约束 / 约定

- **条件展开惯用法已存在**（design.md §4.2 所称「仓库既有风格」属实）：`chat-panel-host.ts` 多处（`...connectionMessage === undefined ? {} : { connectionMessage }`、`pushPatch` 五个字段）、`session-search.ts:69/100-102`、`conversation-controller.ts:1795`（紧邻 1798/1799 上方对 `ChatMessage.turn` 已用 `...turn === undefined ? {} : { turn }`）、`extension.ts:2091-2096`。类别 3 的改法与此完全同构。
- **duck-typed vscode 面**：`VsCodeLike`（extension.ts:108）与 `TextDocumentLike`（selection-ask.ts:19）自声明最小结构，不依赖 `@types/vscode`；`types:["node"]` 下没有全局 `Thenable`。
- **`PromiseLike<T>` 是 ES2015+ 全局类型**，已被 `lib` 覆盖，无需 import / 新文件 / 新依赖（design.md §4.1 方向 B 成立）。
- **ESM + `.ts` 相对导入**、`strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` 全开。
- **禁止 hack**：不得用 `as any` / `!` 非空断言 / `delete` 删属性绕过 `exactOptionalPropertyTypes`（会引入运行时语义偏差）。

## 7. 风险 / 未知

### 7.1 行号核验（design.md §7 vs 实际代码）

| design.md §7 声称 | 实际行号 | 判定 |
|---|---|:--:|
| `session-search.ts:31` `matchTier: SearchMatchTier[]` | 31 | ✅ 精确 |
| `session-search.ts:67/89/98` `matchTiers` | 67 / 89 / 98 | ✅ 精确 |
| `extension.ts:206/212/213/214/215/221` `Thenable` | 206/212/213/214/215/221 | ✅ 精确 |
| `extension.ts:711/712` `hit.matchTiers` | 711 / 712 | ✅ 精确 |
| `extension.ts:1403` `requestSearchSessions` 返回 | 1403（回调）/ 1406（return） | ✅ 精确 |
| `extension.ts:2091-2096` `asRelativePath` | 2091-2096 | ✅ 精确 |
| `selection-ask.ts:22` `save(): Thenable...` | 22 | ✅ 精确 |
| `revert.ts:278` `skipWrite` | 278 | ✅ 精确 |
| `conversation-controller.ts:1173` `skipWrite` | 1173 | ✅ 精确 |
| `conversation-controller.ts:1203-1207` `confirmGate`+`skipWrite` | 1203（call）/1205（confirmGate）/1206（skipWrite）/1207（`})`） | ✅ 精确（范围） |
| `conversation-controller.ts:1798/1799` `turn` | 1798 / 1799 | ✅ 精确 |

**无实质行号偏移**。唯一需注意的引述偏差在 `requirements.md`（非 design.md）：
- `requirements.md:33` 类别 3 现场写 `conversation-controller.ts:1203（skipWrite）` → 实际 `skipWrite` 属性在 **1206 行**（`1203` 是 `executeRevertMany(...)` 调用的起始行）。`design.md:20` 已正确写为 `1173/1205/1206`。
- `requirements.md:35` 写 `extension.ts:2088（asRelativePath）` → 实际 `asRelativePath` 属性在 **2091 行**（`2088` 是 `askAboutSelection({` 的起始行）。`design.md:20/149` 已正确写为 `2091-2096`。

### 7.2 类别 1：`matchTier` 单数唯一性 — ✅ CONFIRMED

全 `apps/vscode-dsh` 下 `\bmatchTier\b`（单数，词边界）**仅 1 处** = `session-search.ts:31`。其余全部为 `matchTiers`（复数），分布于：实现 `session-search.ts:67/89/98`、Host 消费 `extension.ts:711/712`、Host 契约 `chat-panel-host.ts:131`、协议 `protocol.ts:179`、Webview `chat-ui-store.ts:84/567/568` + `TabChrome.tsx:382/406`、4 个测试文件（见 §3）。线契约字段名 = `matchTiers`。**design.md Q-1 拍板「复数」成立，一处改名即闭环。**

### 7.3 类别 2：7 处 `Thenable` — ✅ CONFIRMED

全 `apps/vscode-dsh/src` 下 `\bThenable\b` 恰好 7 处：`extension.ts:206/212/213/214/215/221` + `selection-ask.ts:22`。全部为 `Thenable<T> | Promise<T> | ...` union 形式，无遗漏。

### 7.4 类别 3：6 个调用点 — ✅ CONFIRMED

| # | 位置 | 可选属性 | 上下文 |
|---|------|---------|--------|
| 1 | `revert.ts:278` | `skipWrite` | `executeRevert(deps, changeId, { skipWrite: options.skipWrite })` |
| 2 | `conversation-controller.ts:1173` | `skipWrite` | `executeRevert(deps, changeId, { skipWrite: options.skipWrite })` |
| 3 | `conversation-controller.ts:1203-1207` | `confirmGate`（1205）+ `skipWrite`（1206） | `executeRevertMany(deps, changeIds, {...})`，`confirmedGates` 必填保留 |
| 4 | `conversation-controller.ts:1798` | `turn` | `streamingAssistant.set(sessionId, { messageId, turn })` |
| 5 | `conversation-controller.ts:1799` | `turn` | `streaming = { messageId, turn }` |
| 6 | `extension.ts:2091-2096` | `asRelativePath` | `askAboutSelection({ asRelativePath: <值或 undefined> })` |

`streamingAssistant` 类型已确认 = `Map<string, { messageId: string; turn?: number }>`（`conversation-controller.ts:223`）；`projectAssistantChunk` 入参 `turn: number | undefined`（1778 行），故 1798/1799 传 `{ messageId, turn }` 触发 `exactOptionalPropertyTypes` 违例。**注意 1795 行对 `ChatMessage.turn` 已用条件展开**（`...turn === undefined ? {} : { turn }`），进一步印证改法正确。

### 7.5 类别 4（design.md 未覆盖的额外错误）— ❓ UNKNOWN

**本次未运行 `tsc -b`**（code-explorer 只读约束；`tsc -b` 会触发引用项目构建并产出 emit 产物，超出只读边界）。因此「是否还有第 4 类错误」无法静态证伪，只能佐证：
- 静态 grep 未发现除 `Thenable` 以外的其他悬空 vscode 全局类型引用；
- 三类错误按 tsc 报错口径估算约 19-20 个（类别 1 约 7：session-search.ts 3 处对象字面量多余属性 + 1 处属性访问 + extension.ts 711/712 两处属性访问 + 1406 返回类型不匹配；类别 2 7 个；类别 3 6 个），与「约 20 个」吻合。

**给 implementer 的铁律**：以 `tsc -b apps/vscode-dsh` 实际输出为准；若出现 design.md 未覆盖的错误，**停止并上报调度者**（对应 requirements.md 假设 A1 / 风险 R1），不自动扩范围。

## 8. 不确定 / 未验证

- ❓ **`tsc -b apps/vscode-dsh` 的实际报错全集**未运行核验（见 §7.5）。其余声称均已读函数体（✅ CONFIRMED），无 HYPOTHESIS 项。

## 9. 桩检测与 Registry 交叉校验

`tech-debt-registry.md` 活跃债务与已解决表均为空（占位 `—`）。本次修复是「未注册的类型不一致」，修复即完成，不产生 `@STUB` / 债务条目（requirements.md C-4）。

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| — | — | — | — | — |

### 桩检测汇总

- ✅ Confirmed stubs（匹配 registry）: 0 个
- ⚠️ Registry mismatch（代码已变但 registry 未更新）: 0 个
- 🔴 Unregistered stubs（代码中存在但未注册）: 0 个

本次改动范围内未发现任何 `@STUB` / 空实现 / 硬编码假返回 / `TODO: wire up` 信号；`TIER3_FULL_TEXT_SEARCH_API = null`（session-search.ts:136）是**产品意图**（明确不暴露 tier-3），非桩，保持不变。

## 10. 推荐后续阅读

1. ⭐ **必读** — `design.md` §7（精确改动清单，已核验无偏移）+ `requirements.md` §AC-1…AC-11（验收标准）
2. ⭐ **必读** — `apps/vscode-dsh/src/search/session-search.ts`（类别 1 唯一改动点）
3. 🔷 **应读** — `apps/vscode-dsh/src/extension.ts`（类别 2/3 主战场，206-221 / 711-712 / 1403 / 2091-2096）
4. 🔷 **应读** — `apps/vscode-dsh/src/conversation-controller.ts`（1173 / 1203-1207 / 1795-1799，含既有的条件展开范例）
5. 🔷 **应读** — `apps/vscode-dsh/src/change/revert.ts`（278 行及 `executeRevert`/`executeRevertMany` 缺省语义）
6. 🔹 **选读** — `apps/vscode-dsh/src/chat-panel/protocol.ts` + `chat-panel-host.ts`（线契约 `matchTiers`，验证不改线字段名）
7. 🔹 **选读** — `apps/vscode-dsh/tsconfig.json` / `tsconfig.base.json`（确认 `exactOptionalPropertyTypes` / `types:["node"]` 生效范围）
