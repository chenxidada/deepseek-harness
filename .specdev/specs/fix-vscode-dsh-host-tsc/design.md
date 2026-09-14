# 修复方案：fix-vscode-dsh-host-tsc

<!--
  slug: fix-vscode-dsh-host-tsc
  audience: implementer / reviewer / verifier / HG-2
  language: zh
  nature: bugfix（类型层一致性修复，不改运行时行为）
-->

## 1. 目标

让 `apps/vscode-dsh` 的 Host 侧 TypeScript 源码在 `tsc -b apps/vscode-dsh` 严格编译下 **0 错误**通过，且**不改变任何运行时行为**。修复仅消除三类类型层不一致，不改运行期逻辑、不改线契约、不改 Webview 已发布产物（`webview/dist/`）。

## 2. 根因（三类）

| 类别 | 根因 | 现场（文件:行） | 数量 |
|------|------|----------------|:--:|
| **1. matchTier/matchTiers 单复数分裂** | `SearchHit` 接口声明 `matchTier`（单数），实现/协议/消费方/Webview/测试全部用 `matchTiers`（复数） | `session-search.ts:31`（唯一单数处） | 1 处接口字段 |
| **2. `Thenable` 未定义** | duck-typed vscode 面不依赖 `@types/vscode`，却引用 vscode 全局类型 `Thenable<T>` | `extension.ts:206/212/213/214/215/221`；`selection-ask.ts:22` | 7 处 |
| **3. exactOptionalPropertyTypes 传参不兼容** | `exactOptionalPropertyTypes: true`（`tsconfig.base.json:21`）下，可选属性被显式传 `| undefined` | `revert.ts:278`；`conversation-controller.ts:1173/1205/1206/1798/1799`；`extension.ts:2091` | 6 个调用点 |

## 3. 修复方案（按类别）

### 类别 1：tier 字段命名统一（Q-1 已拍板 = `matchTiers` 复数）

全项目 8+ 处已使用 `matchTiers`（复数），唯一不一致的是 `SearchHit` 接口声明用了 `matchTier`（单数）。线契约字段名、Webview 读取、4 个测试文件均已是 `matchTiers`。

**改法**：把 `SearchHit` 接口字段 `matchTier` 改名为 `matchTiers`（1 处），即闭环。**不**触碰 Webview 线契约、`protocol.ts`、`chat-panel-host.ts`、前端代码、测试。

- 文件：`apps/vscode-dsh/src/search/session-search.ts:31`
- 改前：`matchTier: SearchMatchTier[]`
- 改后：`matchTiers: SearchMatchTier[]`

改后效果：实现处 `session-search.ts:67/89/98` 的 `matchTiers` 对象字面量与字段访问直接合法；`extension.ts:711/712` 的 `hit.matchTiers` 直接合法；`controller.searchSessions(query)` 返回的 `SearchHit[]` 与 `ChatPanelHostDeps.requestSearchSessions` 声明返回类型（含 `matchTiers`）无需 `as` 断言即可赋值（AC-5）。

### 类别 2：`Thenable` 悬空引用（Q-2 拍板 = 方向 B：`PromiseLike<T>`）

duck-typed vscode 面（`VsCodeLike` 在 `extension.ts`、`TextDocumentLike` 在 `selection-ask.ts`）自声明了最小 vscode 结构类型，不依赖 `@types/vscode`，因此没有 `Thenable` 全局类型可用。

**改法**：把 7 处 `Thenable<T>` 机械替换为标准库全局类型 `PromiseLike<T>`，保留 `| Promise<...>` 与 `| boolean` 成员（冗余但无害，且保留「同步 / Promise / thenable 三种都接受」的可读意图，贴合 AC-7）。

- `PromiseLike<T>` 是 ES2015+ 全局类型，`types: ["node"]`（`apps/vscode-dsh/tsconfig.json:6`）已涵盖，**无需 import、无需新文件、无需新依赖**。
- 替换点（`Thenable` → `PromiseLike`）：
  - `extension.ts:206` `save?(): Thenable<boolean> | Promise<boolean> | boolean`
  - `extension.ts:212` `writeFile(...): Thenable<void> | Promise<void>`
  - `extension.ts:213` `delete(...): Thenable<void> | Promise<void>`
  - `extension.ts:214` `createDirectory?(...): Thenable<void> | Promise<void>`
  - `extension.ts:215` `stat?(...): Thenable<{...}> | Promise<{...}>`
  - `extension.ts:221` `applyEdit?(...): Thenable<boolean> | Promise<boolean>`
  - `selection-ask.ts:22` `save(): Thenable<boolean> | Promise<boolean> | boolean`

替换后 `selection-ask.ts:156` 的 `Promise.resolve(doc.save())` 直接类型兼容（`doc.save()` 返回的 `PromiseLike<boolean> | Promise<boolean> | boolean` 是 `boolean | PromiseLike<boolean>` 的子集）。

### 类别 3：`exactOptionalPropertyTypes` 传参改写

统一采用**条件展开**手法（仓库既有风格，`chat-panel-host.ts` 已大量使用 `...(x === undefined ? {} : { x })`）。该写法保证：值非 `undefined` 时才携带该可选属性；运行时对象字段集合与默认行为不变（消费方均以 `!== true` / `!== undefined` 判断缺省）。

| # | 文件:行 | 调用点 | 改法 |
|---|---------|--------|------|
| 1 | `revert.ts:278` | `executeRevert(deps, changeId, { skipWrite: options.skipWrite })` | 条件展开 `skipWrite` |
| 2 | `conversation-controller.ts:1173` | `executeRevert(deps, changeId, { skipWrite: options.skipWrite })` | 条件展开 `skipWrite` |
| 3 | `conversation-controller.ts:1203-1207` | `executeRevertMany(deps, changeIds, { confirmedGates, confirmGate, skipWrite })` | `confirmGate`、`skipWrite` 各条件展开（`confirmedGates` 必填保留） |
| 4 | `conversation-controller.ts:1798` | `streamingAssistant.set(sessionId, { messageId, turn })` | `turn` 条件展开 |
| 5 | `conversation-controller.ts:1799` | `streaming = { messageId, turn }` | `turn` 条件展开 |
| 6 | `extension.ts:2091-2096` | `asRelativePath: <值或 undefined>` | 条件展开，`undefined` 时省略该属性 |

等价性证明（对应 AC-9/10/11）：
- `skipWrite`：消费方 `if (options.skipWrite !== true)`。省略 ≡ 显式 `undefined`，均走默认写盘。
- `confirmGate`：消费方 `if (options.confirmGate !== undefined)`。省略 ≡ 显式 `undefined`，均走 `cancelled` 取消路径（`executeRevertMany` 内 `cancelled = true` 分支）。
- `turn`：`streamingAssistant` 值类型 `{ messageId: string; turn?: number }`。省略 `turn` ≡ `turn: undefined`，读方 `.turn` 均为 `undefined`。
- `asRelativePath`：`AskAboutSelectionDeps.asRelativePath?`。省略 ≡ `undefined`，`toWorkspaceRelativePath` 走 `node:path` 相对路径兜底。

## 4. 技术选型决策

### 4.1 `Thenable` 修复方式（Q-2）→ **方向 B：`PromiseLike<T>`**

| 维度 | 方向 A（自声明 `Thenable<T>`） | 方向 B（`PromiseLike<T>`） |
|------|------------------------------|---------------------------|
| 改动面 | 需新声明 + 2 文件 import | 机械替换 7 处，零新文件/import |
| 类型兼容 | vscode 原生 `Thenable.then` 返回 `Thenable<TResult>`，与 `PromiseLike.then` 返回 `PromiseLike<TResult1\|TResult2>` 结构不互 assign，`Promise.resolve(doc.save())` 可能仍报错 | `PromiseLike` 正是 `Promise.resolve`/`await` 底层接受的 thenable 结构，兼容零风险 |
| AC-7 | 需额外验证 | 天然满足（`PromiseLike` 比 `Promise` 更宽） |
| 依赖 | 无 | 无（ES2015+ 全局） |

**推荐：方向 B。** 理由：(1) `PromiseLike<T>` 是 `Promise.resolve` / `await` 精确接受的结构类型，`selection-ask.ts:156` 的 `Promise.resolve(doc.save())` 由构造保证类型兼容，而方向 A 若贴 vscode `Thenable` 语义，其 `then` 泛型返回 `Thenable<TResult>` 与 `PromiseLike` 的 `then` 返回 `PromiseLike<TResult1|TResult2>` 不互 assign，存在脆弱的二次报错风险；(2) 零自声明、零新文件、零依赖；(3) 不收紧到 `Promise<T>`，同步 `boolean` 经 union 保留（AC-7）。方向 A 仅在「必须保留 `Thenable` 这个精确名字」时才更优，本项目无此约束。

### 4.2 `exactOptionalPropertyTypes` 统一改写手法

**条件展开**（首选，仓库既有风格）：

```ts
// 改前（报错：可选属性被显式赋 undefined）
executeRevert(deps, changeId, { skipWrite: options.skipWrite })

// 改后（等价：undefined 时省略该属性）
executeRevert(deps, changeId, ...options.skipWrite === undefined ? {} : { skipWrite: options.skipWrite })
```

备选（仅当条件展开使单行过长、可读性差时）：先用局部变量承载已判定的可选值，再条件展开；或在 `if/else` 两条路径分别构造带/不带该属性的对象。**禁止**：`as any`、`!` 非空断言、`delete` 删属性等会引入运行时语义偏差或绕过类型检查的 hack。

### 4.3 验证命令

- **编译门禁（主）**：`tsc -b apps/vscode-dsh`（Node 24 或仓库支持范围 `node ^22.19 || >=24`），期望退出码 0、无 `error TS` 输出。若被引用的项目（`ide-bridge`、`sdk/client`、`subprocess`、`file-reference`）尚未产出声明，先 `pnpm run build`（`tsc -b` 会自动构建引用图）。
- **运行时回归（辅）**：`pnpm vitest run <file>` 跑下述相关用例，证明行为未变（AC-2）。

## 5. 验证策略（对应 AC）

| AC | 验证类型 | 验证方法 | 预期结果 |
|----|---------|---------|---------|
| AC-1 | 编译验证 | `tsc -b apps/vscode-dsh` | 退出码 0，无 `error TS` |
| AC-2 | 运行时验证 | `pnpm vitest run` 跑 §5 用例清单 | 全部通过，无新增失败 |
| AC-3 | 静态检查 | `rg -n 'matchTier\b' apps/vscode-dsh/src apps/vscode-dsh/webview/src apps/vscode-dsh/tests`（非 `matchTiers` 前缀） | 仅 `matchTiers`，无 `matchTier` 单数残留 |
| AC-4 | 运行时验证 | 搜索相关用例（见清单）验证 `search/results` 帧的 `hit.matchTiers` 仍为数组、tier 徽标可渲染 | tier 徽标正常 |
| AC-5 | 编译验证 | `tsc -b apps/vscode-dsh` 后 `extension.ts:1403` 无类型错误 | `requestSearchSessions` 返回值无需 `as` |
| AC-6 | 编译验证 | `tsc -b` 无 `Cannot find name 'Thenable'` | 0 错误 |
| AC-7 | 编译验证 + 运行时 | `selection-ask.ts:156` `Promise.resolve(doc.save())` 类型通过 + 选区用例全绿 | 同步/`Promise`/`thenable` 三种返回均接受 |
| AC-8 | 编译验证 | `tsc -b` 无 exactOptionalPropertyTypes 相关错误 | 0 错误 |
| AC-9 | 运行时验证 | revert 用例（`phase3-review-revert-replay.spec.ts`）验证 `skipWrite === undefined` 时走默认写盘 | 默认写盘行为不变 |
| AC-10 | 运行时验证 | revert 用例验证 `confirmGate` 缺失时未确认 gate 返回 `{ ok:false, reason:'cancelled' }` | 取消语义不变 |
| AC-11 | 运行时验证 | streaming 用例（`chat-ux-streaming-cancel-follow.spec.ts` / `chat-ux-activity-stream.spec.ts`）验证 `turn` 省略时对象字段集合一致 | turn 省略、行为不变 |

### 运行时回归用例清单

| 相关类别 | 测试文件 |
|---------|---------|
| 类别 1（搜索/tier） | `apps/vscode-dsh/tests/chat-ux-session-search.spec.ts`、`apps/vscode-dsh/tests/layer-a-rtl/editor-chat-phase2.spec.tsx`、`apps/vscode-dsh/tests/verifier-phase2/layer-a-rtl.spec.tsx`、`apps/vscode-dsh/tests/verifier-phase2/layer-b-host.spec.ts` |
| 类别 2（选区引用 save） | `apps/vscode-dsh/tests/phase1-code-context.spec.ts` |
| 类别 3（revert skipWrite/confirmGate） | `apps/vscode-dsh/tests/phase3-review-revert-replay.spec.ts` |
| 类别 3（streaming turn） | `apps/vscode-dsh/tests/chat-ux-streaming-cancel-follow.spec.ts`、`apps/vscode-dsh/tests/chat-ux-activity-stream.spec.ts`、`apps/vscode-dsh/tests/layer-a/activity-stream.spec.ts` |

## 6. 风险

- **R1（范围外新错误）**：假设 A1 认为当前 `tsc -b` 报错仅含上述三类。若 implementer 修复过程中发现额外类型错误，须**停止并上报调度者**，不自动扩范围。
- **R2（Thenable 误收紧）**：不得把 `Thenable` 直接替换为 `Promise`（会使真实 vscode 返回 `Thenable` 的调用点类型不匹配）。已由方向 B + AC-7 规避。
- **R3（类别 3 改写引入语义偏差）**：禁止用 `!` / `as` / `delete` 等 hack，必须用条件展开（等价、零语义偏差）。已由 AC-9/10/11 锁定默认行为。
- **R4（Webview dist 误改）**：本修复不触碰 `webview/dist/`；类别 1 只改 `src` 接口字段，线契约字段名不变。

## 7. 精确改动清单（implementer 照做）

### 文件 1：`apps/vscode-dsh/src/search/session-search.ts`（类别 1）
- 第 31 行：`matchTier: SearchMatchTier[]` → `matchTiers: SearchMatchTier[]`

### 文件 2：`apps/vscode-dsh/src/extension.ts`（类别 2 + 类别 3）
- 第 206 行：`save?(): Thenable<boolean> | Promise<boolean> | boolean` → `save?(): PromiseLike<boolean> | Promise<boolean> | boolean`
- 第 212 行：`writeFile(uri: unknown, content: Uint8Array): Thenable<void> | Promise<void>` → `PromiseLike<void> | Promise<void>`
- 第 213 行：`delete(uri: unknown, options?: ...): Thenable<void> | Promise<void>` → `PromiseLike<void> | Promise<void>`
- 第 214 行：`createDirectory?(uri: unknown): Thenable<void> | Promise<void>` → `PromiseLike<void> | Promise<void>`
- 第 215 行：`stat?(uri: unknown): Thenable<{ type?: number; size?: number }> | Promise<{...}>` → `PromiseLike<{...}> | Promise<{...}>`
- 第 221 行：`applyEdit?(edit: unknown): Thenable<boolean> | Promise<boolean>` → `PromiseLike<boolean> | Promise<boolean>`
- 第 2091-2096 行：`asRelativePath: <值或 undefined>` 改为条件展开：

```ts
    ...(vscode.workspace.asRelativePath === undefined
      ? {}
      : { asRelativePath: (fsPath) => {
          const relative = vscode.workspace.asRelativePath
          return relative === undefined ? fsPath : relative(fsPath, false)
        } }),
```

### 文件 3：`apps/vscode-dsh/src/code-context/selection-ask.ts`（类别 2）
- 第 22 行：`save(): Thenable<boolean> | Promise<boolean> | boolean` → `save(): PromiseLike<boolean> | Promise<boolean> | boolean`

### 文件 4：`apps/vscode-dsh/src/change/revert.ts`（类别 3）
- 第 278 行：

```ts
// 改前
results.push(await executeRevert(deps, changeId, { skipWrite: options.skipWrite }))
// 改后
results.push(await executeRevert(
  deps,
  changeId,
  ...options.skipWrite === undefined ? {} : { skipWrite: options.skipWrite },
))
```

### 文件 5：`apps/vscode-dsh/src/conversation-controller.ts`（类别 3）
- 第 1173 行：

```ts
// 改前
const result = await executeRevert(deps, changeId, { skipWrite: options.skipWrite })
// 改后
const result = await executeRevert(
  deps,
  changeId,
  ...options.skipWrite === undefined ? {} : { skipWrite: options.skipWrite },
)
```

- 第 1203-1207 行：

```ts
// 改前
const results = await executeRevertMany(deps, changeIds, {
  confirmedGates: options.confirmedGates ?? new Set(),
  confirmGate: options.confirmGate,
  skipWrite: options.skipWrite,
})
// 改后
const results = await executeRevertMany(deps, changeIds, {
  confirmedGates: options.confirmedGates ?? new Set(),
  ...options.confirmGate === undefined ? {} : { confirmGate: options.confirmGate },
  ...options.skipWrite === undefined ? {} : { skipWrite: options.skipWrite },
})
```

- 第 1798 行：

```ts
// 改前
this.streamingAssistant.set(sessionId, { messageId, turn })
// 改后
this.streamingAssistant.set(sessionId, { messageId, ...turn === undefined ? {} : { turn } })
```

- 第 1799 行：

```ts
// 改前
streaming = { messageId, turn }
// 改后
streaming = { messageId, ...turn === undefined ? {} : { turn } }
```

### 不改动
- 不引入 `@types/vscode` 或任何新依赖。
- 不触碰 `webview/src`、`webview/dist/`、4 个测试文件（它们已用 `matchTiers`）。
- 不改变任何运行时逻辑、线契约字段名、对外类型签名（除 `SearchHit.matchTier` → `matchTiers` 这一最小一致性改名）。
