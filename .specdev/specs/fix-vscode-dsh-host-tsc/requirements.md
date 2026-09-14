# Requirements: fix-vscode-dsh-host-tsc

<!--
  slug: fix-vscode-dsh-host-tsc
  audience: plan-generator / implementer / reviewer / verifier / HG-1
  language: zh (canonical). Mirror: requirements-zh.md
  constitution: .specdev/specs/fix-vscode-dsh-host-tsc/constitution.md
  nature: bugfix（类型层一致性修复，不改运行时行为）
  root cause: Host 侧 TS 源码从未被 tsc -b 严格编译（feature 验证只跑 vitest，vite/tsx 直接加载 TS 不做类型检查）
-->

## 术语（全文统一）

| 术语 | 含义 | 首次括注 |
|------|------|----------|
| **Host 侧源码** | `apps/vscode-dsh/src/` 下的扩展 Host 端 TypeScript 源码 | Host-side source |
| **duck-typed vscode 面** | 项目为可测性自行声明的最小 vscode API 结构类型（`VsCodeLike` 等），**不**依赖 `@types/vscode` | duck-typed vscode surface |
| **SearchHit** | `src/search/session-search.ts` 中导出的搜索命中类型（含 tier 数组字段） | search hit |
| **线契约 / 线字段名** | Host↔Webview 通过 `postMessage` 传输的字段实际名称（`protocol.ts` 定义），运行时生效，非类型别名 | wire contract |
| **exactOptionalPropertyTypes** | `tsconfig` 严格选项：可选属性不能显式传入 `| undefined` 值 | exact optional property types |
| **运行时自洽** | 代码在 vite/tsx 直接加载下可正常运行、测试全绿；仅类型层不一致 | runtime self-consistent |

## 产品目标

让 `apps/vscode-dsh` 的 Host 侧 TypeScript 源码在 `tsc -b apps/vscode-dsh` 严格编译下 **0 错误通过**，且**不改变任何运行时行为**——修复仅消除类型层不一致（字段单复数分裂、`Thenable` 全局类型悬空引用、`exactOptionalPropertyTypes` 下显式传 `| undefined`），不改动运行期逻辑、不改动线契约、不改动 Webview 已发布产物。

## 问题陈述

此前所有 feature 的验证只跑 vitest（vite/tsx 直接加载 TS，**不做** tsc 类型检查），导致 `apps/vscode-dsh` Host 侧约 20 个类型错误长期未被暴露。这些错误**不影响运行时行为**（运行时自洽），纯粹是类型层面不一致。三类根因如下：

| 类别 | 根因 | 现场（文件:行） | 影响 |
|------|------|----------------|------|
| **1. matchTier/matchTiers 单复数分裂** | `SearchHit` 接口声明字段 `matchTier`（单数）与消费方/协议/运行时实际字段 `matchTiers`（复数）分裂 | `session-search.ts:31`（声明，单数）；`session-search.ts:67/89/98`（实现，复数）；`extension.ts:711/712`（消费，复数）；`extension.ts:1403`（返回类型不匹配）；`chat-panel-host.ts:131`、`protocol.ts:179`（类型，复数） | `tsc` 报错：实现与消费方使用 `matchTiers`，但 `SearchHit` 上只有 `matchTier` |
| **2. `Thenable` 未定义** | duck-typed vscode 面不依赖 `@types/vscode`，却直接引用了 vscode 全局类型 `Thenable<T>` | `extension.ts:206/212/213/214/215/221`；`selection-ask.ts:22` | `tsc` 报错：`Cannot find name 'Thenable'` |
| **3. exactOptionalPropertyTypes 传参不兼容** | `exactOptionalPropertyTypes: true` 下，可选属性不能显式传 `| undefined` | `revert.ts:278`；`conversation-controller.ts:1173/1203`（skipWrite）、`1798/1799`（turn）；`extension.ts:2088`（asRelativePath） | `tsc` 报错：可选属性被显式赋予 `undefined` |

## 目标终态

- `tsc -b apps/vscode-dsh`（Node 24 或仓库支持的 `>=24` 环境）以 **0 错误** 退出。
- 全项目（`src` + `webview` + `tests`）对「命中 tier 数组」字段使用**唯一一致的标识符**，无单复数并存。
- `Thenable<T>` 引用全部解析为**已声明**类型；duck-typed 面的返回类型契约仍兼容「同步返回」与「异步 thenable 返回」。
- 所有 `exactOptionalPropertyTypes` 下的显式 `| undefined` 传参点被改写为等价且不改变运行时语义的写法。
- vitest 相关用例**全部通过**，证明运行时行为未变。

## 目标用户

- **维护者 / 开发者**：在 CI 或本地跑 `tsc` 类型门禁时不再被这约 20 个误报阻断。
- **下游 implementer / reviewer / verifier**：拥有一个类型干净的 Host 侧代码基线，后续改动可被 `tsc` 可靠把关。
- **终端用户**：**无感知**（本修复不改运行时行为，不改变任何可见功能）。

## 核心场景

- **S-1 类型门禁**：开发者执行 `tsc -b apps/vscode-dsh`，期望 0 错误退出（当前约 20 个错误）。
- **S-2 搜索功能回归**：修复 tier 字段命名后，会话搜索（tier-1 标题/预览、tier-2 路径反查）结果在 Webview 正常展示 tier 徽标，`hit.matchTiers` 消费方（`extension.ts` 快捷选择、Webview `TabChrome`/`chat-ui-store`）仍能读到数组。
- **S-3 运行时零回归**：修复 `Thenable` / `exactOptionalPropertyTypes` 相关类型后，选区引用（selection-ask）、revert 写盘、流式 turn 记录等既有 vitest 用例全绿。

## 预期范围

**范围内**：
1. 统一 tier 字段命名（类别 1）——含 `SearchHit` 接口、`session-search.ts` 实现、`extension.ts` 消费与返回类型、`protocol.ts` / `chat-panel-host.ts` 类型。
2. 修复 `Thenable<T>` 悬空引用（类别 2）——自声明或等价类型，不引入 `@types/vscode` 依赖。
3. 修复 `exactOptionalPropertyTypes` 下显式 `| undefined` 传参（类别 3）——`revert.ts`、`conversation-controller.ts`、`extension.ts`。
4. 更新因此受影响的测试/类型断言（若有）以与统一命名保持一致。

**范围边界**：仅限「让 `tsc -b apps/vscode-dsh` 通过 + 不改运行时行为」。

## 功能区域

### 区域 A：tier 字段命名统一（类别 1）

`SearchHit` 上的「命中 tier 数组」字段必须在声明、实现、协议、Host 消费、Webview 消费、测试之间保持**唯一命名**。运行时实际字段与线契约（`protocol.ts`、`chat-panel-host.ts`、Webview `chat-ui-store.ts`/`TabChrome.tsx`、4 个测试文件）一致使用 `matchTiers`（复数），唯一不一致的是 `session-search.ts:31` 的 `SearchHit` 接口声明用 `matchTier`（单数）。

### 区域 B：`Thenable` 悬空引用（类别 2）

`extension.ts` 与 `selection-ask.ts` 中 duck-typed 面用到的 `Thenable<T>` 必须解析为已声明类型；相关方法（`save`、`writeFile`、`delete`、`createDirectory`、`stat`、`applyEdit`）的返回类型契约不得收紧到只接受 `Promise`（需兼容 vscode 原生 `Thenable` 与同步 `boolean` 返回值）。

### 区域 C：`exactOptionalPropertyTypes` 传参（类别 3）

`revert.ts:278`、`conversation-controller.ts:1173/1203/1798/1799`、`extension.ts:2088` 处向可选属性显式传 `| undefined` 的写法必须改为「不为 `undefined` 时才携带该属性」的等价写法，运行时字段集合与语义不变。

## 验收标准（EARS 格式）

### 全局（编译门槛 + 行为不变）

- **AC-1**（普遍型）：当开发者在 Node 24（或仓库支持的 `>=24`）环境下执行 `tsc -b apps/vscode-dsh` 时，编译器**必须**以 0 个类型错误退出（无 `error TS` 输出）。

- **AC-2**（普遍型）：修复后的源码**必须**保持运行时行为与修复前一致——受影响模块（搜索、选区引用、revert、流式 turn 记录）的既有 vitest 用例**必须**全部通过，且**不得**新增失败用例。

### 类别 1：tier 字段命名统一

- **AC-3**（普遍型）：全项目（`apps/vscode-dsh/src`、`apps/vscode-dsh/webview/src`、`apps/vscode-dsh/tests`）对「命中 tier 数组」字段**必须**使用**唯一**且一致的标识符命名；修复后**不得**再同时存在 `matchTier`（单数）与 `matchTiers`（复数）两个字段名指向同一语义。

- **AC-4**（事件驱动型）：**当** `searchSessions()` 返回的命中对象被 Host 经 `search/results` 帧推送至 Webview **时**，Webview 侧（`chat-ui-store.ts` / `TabChrome.tsx`）读取的 tier 字段名**必须**与 Host 侧 `SearchHit` 类型的字段名一致，使 tier 徽标在 UI 正常渲染（无 `undefined` 或运行时字段缺失）。

- **AC-5**（普遍型）：`extension.ts` 中 `requestSearchSessions` 回调的返回值**必须**与 `ChatPanelHostDeps.requestSearchSessions` 声明的返回契约类型兼容，使 `controller.searchSessions(query)` 的返回值**必须**无需 `as` 断言即可直接赋值。

### 类别 2：`Thenable` 悬空引用

- **AC-6**（普遍型）：`extension.ts` 与 `selection-ask.ts` 中所有 `Thenable<T>` 引用**必须**解析为已声明的类型；编译期**不得**出现 `Cannot find name 'Thenable'`。

- **AC-7**（不期望行为型）：**如果**某个 duck-typed 方法（如 `save()`）的运行期实现可能返回同步 `boolean`、`Promise<boolean>` 或 vscode 原生 `Thenable<boolean>` 之一，**那么**修复后的返回类型契约**必须**仍能接受这三种返回，**不得**因类型收紧而使既有测试或真实调用点的赋值失败。

### 类别 3：`exactOptionalPropertyTypes` 传参

- **AC-8**（普遍型）：在 `exactOptionalPropertyTypes: true` 下，`revert.ts`、`conversation-controller.ts`、`extension.ts` 中所有「向可选属性显式传入 `| undefined` 值」的调用点**必须**被改写为「仅在值非 `undefined` 时携带该属性」的等价写法，使 `tsc` 0 错误通过。

- **AC-9**（不期望行为型）：**如果**调用方传入的 `skipWrite` 为 `undefined`，**那么**修复后系统**必须**仍走默认写盘路径（等价于 `skipWrite !== true`），**不得**因改写而改变默认写盘行为。

- **AC-10**（不期望行为型）：**如果** `confirmGate` 回调未提供（`undefined`），**那么**修复后 `executeRevertMany` **必须**仍对未确认的 gate 返回 `{ ok: false, reason: 'cancelled' }`，**不得**改变既有取消语义。

- **AC-11**（普遍型）：`streamingAssistant` 写入 `turn` 时，**如果** `turn` 为 `undefined`，**那么**该字段**必须**被省略（而非显式写 `turn: undefined`），使对象类型与 `{ messageId: string; turn?: number }` 兼容，且运行时对象字段集合与修复前一致。

## 不在范围内（明确排除）

- ❌ 不改变任何**运行时行为**或**可见功能**。
- ❌ 不引入 `@types/vscode`（或任何新的运行时/类型依赖）来「顺带」解决 `Thenable`——duck-typed 面必须保持零 vscode 类型依赖。
- ❌ 不修改 Webview 已构建产物 `apps/vscode-dsh/webview/dist/`（仅当修复导致前端类型/字段名变化时才同步 `webview/src`，**不**手工改 dist）。
- ❌ 不重构、不重命名大范围代码；不改变 `SearchHit`、`ChatPanelHostDeps`、`RevertDeps` 等对外类型签名（除「统一 tier 字段命名」这一最小一致性改动外）。
- ❌ 不新增 tier-3 / JSONL 全文检索等任何功能面（`TIER3_FULL_TEXT_SEARCH_API` 保持 `null` 不变）。
- ❌ 不解决与本次 tsc 报错无关的其他历史类型债（如后续 Phase 可能暴露的其他文件错误）。

## 约束

- **C-1**：Node 版本范围 = 仓库支持范围（`node ^22.19 || >=24`），验收以 Node 24 为准。
- **C-2**：改动必须是最小一致性修复，不得趁机重构或调整模块职责。
- **C-3**：EARS 格式强制；每条 AC 可独立判定 ✅/❌。
- **C-4**：`tech-debt-registry.md` 当前为空；本 bugfix 修复的是「未注册的类型不一致」，不产生 `@STUB`（修复即完成，不留债）。若修复中发现需要推迟的关联类型债，须在 registry 注册 `DEBT-N` 条目。

## 开放问题 / 决策点

- **Q-1（需拍板）**：tier 字段以 `matchTier`（单数）还是 `matchTiers`（复数）为准？
  - **推荐：以 `matchTiers`（复数）为准**，把 `SearchHit` 接口字段 `matchTier` 改名为 `matchTiers`。
  - **证据**：全项目 `matchTiers`（复数）出现于 **8+ 处**——Webview 线契约 `chat-ui-store.ts:84/567/568`、`TabChrome.tsx:382/406`；Host 协议 `protocol.ts:179`、`chat-panel-host.ts:131`；消费方 `extension.ts:711/712`；实现 `session-search.ts:67/89/98`；以及 4 个测试文件（`chat-ux-session-search.spec.ts`、`layer-a-rtl/editor-chat-phase2.spec.tsx`、`verifier-phase2/layer-a-rtl.spec.tsx`、`verifier-phase2/layer-b-host.spec.ts`）。而 `matchTier`（单数）**仅 1 处**——`session-search.ts:31` 的 `SearchHit` 接口声明。
  - **改动量**：改名接口字段（1 处）即闭环，**不**触碰 Webview 线契约与前端代码；若反过来改单数，需同步修改 5+ 个文件且改变线字段名，风险更大。
  - **决策规则**：若用户拍板 `matchTier`（单数），则 AC-3/AC-4 的「唯一命名」以 `matchTier` 为准，并需同步改动 `protocol.ts`、`chat-panel-host.ts`、Webview、`extension.ts`、实现与测试，但**不得**改变运行时语义（本需求文档当前 AC 默认按 `matchTiers` 复数推荐编写）。

- **Q-2（技术选型，低风险，可由 plan-generator 拍板）**：`Thenable<T>` 的修复方式。
  - 方向 A：自声明一个局部 `Thenable<T>` 类型（贴近 vscode 语义，改动集中在类型声明）。
  - 方向 B：统一替换为 `PromiseLike<T>`（标准库全局类型，零自声明）。
  - 约束不变：无论选哪个，都**不得**引入 `@types/vscode`，且不得把返回类型收紧到只接受 `Promise<T>`（见 AC-7）。

## 风险/假设

- **假设 A1**：`tsc -b apps/vscode-dsh` 的当前报错**仅**包含上述三类（约 20 个）；若修复过程中发现额外类型错误，须先向调度者/用户报告，再决定是否纳入本 bugfix 范围（不自动扩范围）。
- **风险 R1**：类别 1 的命名统一若被用户反转为「单数为准」，会牵动 Webview 线契约与前端代码，扩大改动面——因此默认推荐复数，并已作为 Q-1 明确请用户拍板。
- **风险 R2**：类别 2 若误把 `Thenable` 直接替换为 `Promise`，可能使真实 vscode 调用点（返回 `Thenable` 而非 `Promise`）类型不匹配——AC-7 已显式约束该风险。
- **风险 R3**：类别 3 的 `exactOptionalPropertyTypes` 改写若用「显式删属性」或「加 `!`」等 hack，可能引入运行时语义偏差——AC-9/AC-10/AC-11 已锁定默认行为不变。

## 建议的 Phase 拆分方向

本 bugfix 为单一、内聚的类型修复，建议 **单 Phase**（`/bugfix` 流程不拆 Phase），实现顺序建议（供 plan-generator 参考，非强制）：

1. **类别 2（Thenable）** 与 **类别 3（exactOptionalPropertyTypes）** 先行——它们是纯局部类型修正，与命名决策无关，可立即消除约 15 个错误。
2. **类别 1（tier 命名统一）** 后行——依赖 Q-1 用户拍板，且涉及协议/Host/Webview/测试的多文件一致性。
3. 全部修复后跑 `tsc -b apps/vscode-dsh` 验证 0 错误，再跑相关 vitest 用例证明运行时无回归。
