# Phase 1: 类型层一致性修复

## 目标

让 `apps/vscode-dsh` 的 Host 侧 TypeScript 源码在 `tsc -b apps/vscode-dsh` 严格编译下 0 错误通过，且运行时行为零变化（三类类型层不一致的最小一致性修复）。

## 前置条件

- 依赖的 spec 文件：`.specdev/specs/fix-vscode-dsh-host-tsc/requirements.md`（HG-1 已确认）、`design.md`（HG-2 已确认）。
- 已完成的 Phase：无（本 bugfix 单 Phase，`id = phase-1-fix`，`dependencies = []`）。
- 已拍板决策：Q-1 = `matchTiers`（复数）；Q-2 = `Thenable` 替换为 `PromiseLike<T>`（方向 B）。

## 验收标准

从 `requirements.md` 提取，全部属于本 Phase（单 Phase，11 条 AC 全覆盖）：

- **AC-1**：`tsc -b apps/vscode-dsh`（Node 24 或仓库支持范围 `node ^22.19 || >=24`）以 0 个类型错误退出（无 `error TS` 输出）。
- **AC-2**：受影响模块（搜索、选区引用、revert、流式 turn 记录）的既有 vitest 用例全部通过，且无新增失败。
- **AC-3**：全项目（`src` + `webview/src` + `tests`）对「命中 tier 数组」字段使用唯一标识符，不再同时存在 `matchTier`（单数）与 `matchTiers`（复数）。
- **AC-4**：`searchSessions()` 返回的命中经 `search/results` 帧推送至 Webview 时，Webview 读取的 tier 字段名与 Host 侧 `SearchHit` 类型字段名一致，tier 徽标正常渲染（无 `undefined`/字段缺失）。
- **AC-5**：`extension.ts` 中 `requestSearchSessions` 回调返回值与 `ChatPanelHostDeps.requestSearchSessions` 返回契约兼容，`controller.searchSessions(query)` 无需 `as` 断言即可直接赋值。
- **AC-6**：`extension.ts` 与 `selection-ask.ts` 中所有 `Thenable<T>` 引用解析为已声明类型，编译期无 `Cannot find name 'Thenable'`。
- **AC-7**：duck-typed 方法（如 `save()`）返回类型契约仍接受同步 `boolean`、`Promise<boolean>`、`Thenable<boolean>` 三种，不因类型收紧使既有测试/真实调用点赋值失败。
- **AC-8**：`revert.ts`、`conversation-controller.ts`、`extension.ts` 中所有「向可选属性显式传 `| undefined`」调用点改写为「仅在值非 `undefined` 时携带」，`tsc` 0 错误。
- **AC-9**：`skipWrite` 为 `undefined` 时仍走默认写盘路径（等价 `skipWrite !== true`），不改默认写盘行为。
- **AC-10**：`confirmGate` 未提供时 `executeRevertMany` 仍对未确认 gate 返回 `{ ok: false, reason: 'cancelled' }`，不改取消语义。
- **AC-11**：`streamingAssistant` 写入 `turn` 时，`turn` 为 `undefined` 则该字段被省略（而非显式 `turn: undefined`），对象与 `{ messageId: string; turn?: number }` 兼容，运行时字段集合与修复前一致。

## 改动范围

5 个文件，三类修复，精确位置与改法如下（与 `design.md` §7 完全一致）：

### 类别 1：tier 字段命名统一（1 处）

**文件** `apps/vscode-dsh/src/search/session-search.ts`

- 第 31 行：`matchTier: SearchMatchTier[]` → `matchTiers: SearchMatchTier[]`

（仅此一处，不改 Webview 线契约 / `protocol.ts` / `chat-panel-host.ts` / 前端 / 测试，它们已用 `matchTiers`。）

### 类别 2：`Thenable` → `PromiseLike<T>`（7 处）

**文件** `apps/vscode-dsh/src/extension.ts`

- 第 206 行：`save?(): Thenable<boolean> | Promise<boolean> | boolean` → `save?(): PromiseLike<boolean> | Promise<boolean> | boolean`
- 第 212 行：`writeFile(uri: unknown, content: Uint8Array): Thenable<void> | Promise<void>` → `PromiseLike<void> | Promise<void>`
- 第 213 行：`delete(uri: unknown, options?: { recursive?: boolean; useTrash?: boolean }): Thenable<void> | Promise<void>` → `PromiseLike<void> | Promise<void>`
- 第 214 行：`createDirectory?(uri: unknown): Thenable<void> | Promise<void>` → `PromiseLike<void> | Promise<void>`
- 第 215 行：`stat?(uri: unknown): Thenable<{ type?: number; size?: number }> | Promise<{ type?: number; size?: number }>` → `PromiseLike<{ type?: number; size?: number }> | Promise<{ type?: number; size?: number }>`
- 第 221 行：`applyEdit?(edit: unknown): Thenable<boolean> | Promise<boolean>` → `PromiseLike<boolean> | Promise<boolean>`

**文件** `apps/vscode-dsh/src/code-context/selection-ask.ts`

- 第 22 行：`save(): Thenable<boolean> | Promise<boolean> | boolean` → `save(): PromiseLike<boolean> | Promise<boolean> | boolean`

### 类别 3：`exactOptionalPropertyTypes` 条件展开（6 个调用点）

统一手法：`...(x === undefined ? {} : { x })`。

**文件** `apps/vscode-dsh/src/change/revert.ts`

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

**文件** `apps/vscode-dsh/src/conversation-controller.ts`

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

**文件** `apps/vscode-dsh/src/extension.ts`

- 第 2091-2096 行：

```ts
// 改前
    asRelativePath: vscode.workspace.asRelativePath === undefined
      ? undefined
      : (fsPath) => {
        const relative = vscode.workspace.asRelativePath
        return relative === undefined ? fsPath : relative(fsPath, false)
      },
// 改后
    ...(vscode.workspace.asRelativePath === undefined
      ? {}
      : { asRelativePath: (fsPath) => {
          const relative = vscode.workspace.asRelativePath
          return relative === undefined ? fsPath : relative(fsPath, false)
        } }),
```

## 边界约束

- ❌ 不改变任何运行时行为或可见功能。
- ❌ 不引入 `@types/vscode` 或任何新的运行时/类型依赖。
- ❌ 不新增任何文件（本 bugfix 仅改动既有 5 个源文件）。
- ❌ 不修改 Webview 已构建产物 `webview/dist/`；不改 `webview/src`；不改 4 个测试文件（它们已用 `matchTiers`）。
- ❌ 不重构、不重命名大范围代码；不改变对外类型签名（除 `SearchHit.matchTier` → `matchTiers` 这一最小一致性改名）。
- ❌ 不扩范围：若修复中发现三类之外的额外类型错误，停止并上报调度者，不自动纳入。
- ❌ 不产生 `@STUB`；`tech-debt-registry.md` 保持为空（修复即完成，不留债）。

## 验证策略

| AC | 验证类型 | 验证方法 | 预期结果 |
|----|---------|---------|---------|
| AC-1 | 编译验证 | `tsc -b apps/vscode-dsh`（Node 24） | 退出码 0，无 `error TS` |
| AC-3 | 静态检查 | `rg -n 'matchTier\b' apps/vscode-dsh/src apps/vscode-dsh/webview/src apps/vscode-dsh/tests`（排除 `matchTiers` 前缀命中） | 无 `matchTier` 单数残留，仅 `matchTiers` |
| AC-6 | 编译验证 | 同上 `tsc -b` | 无 `Cannot find name 'Thenable'` |
| AC-5 | 编译验证 | 同上 `tsc -b`，观察 `extension.ts:1403` | 返回契约兼容，无 `as` 断言 |
| AC-7 | 编译验证 + 运行时 | `tsc -b` 通过 + 选区用例全绿 | 同步/`Promise`/`thenable` 三种返回均接受 |
| AC-8 | 编译验证 | 同上 `tsc -b` | 无 exactOptionalPropertyTypes 相关错误 |
| AC-2 | 运行时验证（回归） | `pnpm vitest run` 跑下述用例清单 | 全部通过，无新增失败 |
| AC-4 | 运行时验证 | 搜索用例验证 `search/results` 帧 `hit.matchTiers` 仍为数组、tier 徽标可渲染 | tier 徽标正常 |
| AC-9 | 运行时验证 | revert 用例验证 `skipWrite === undefined` 走默认写盘 | 默认写盘行为不变 |
| AC-10 | 运行时验证 | revert 用例验证 `confirmGate` 缺失时未确认 gate 返回 `{ ok:false, reason:'cancelled' }` | 取消语义不变 |
| AC-11 | 运行时验证 | streaming 用例验证 `turn` 省略时对象字段集合一致 | turn 省略、行为不变 |

### 运行时回归用例清单

| 相关类别 | 测试文件 |
|---------|---------|
| 类别 1（搜索/tier） | `apps/vscode-dsh/tests/chat-ux-session-search.spec.ts`、`apps/vscode-dsh/tests/layer-a-rtl/editor-chat-phase2.spec.tsx`、`apps/vscode-dsh/tests/verifier-phase2/layer-a-rtl.spec.tsx`、`apps/vscode-dsh/tests/verifier-phase2/layer-b-host.spec.ts` |
| 类别 2（选区引用 save） | `apps/vscode-dsh/tests/phase1-code-context.spec.ts` |
| 类别 3（revert skipWrite/confirmGate） | `apps/vscode-dsh/tests/phase3-review-revert-replay.spec.ts` |
| 类别 3（streaming turn） | `apps/vscode-dsh/tests/chat-ux-streaming-cancel-follow.spec.ts`、`apps/vscode-dsh/tests/chat-ux-activity-stream.spec.ts`、`apps/vscode-dsh/tests/layer-a/activity-stream.spec.ts` |

执行方式（可批量）：

```sh
pnpm vitest run \
  apps/vscode-dsh/tests/chat-ux-session-search.spec.ts \
  apps/vscode-dsh/tests/layer-a-rtl/editor-chat-phase2.spec.tsx \
  apps/vscode-dsh/tests/verifier-phase2/layer-a-rtl.spec.tsx \
  apps/vscode-dsh/tests/verifier-phase2/layer-b-host.spec.ts \
  apps/vscode-dsh/tests/phase1-code-context.spec.ts \
  apps/vscode-dsh/tests/phase3-review-revert-replay.spec.ts \
  apps/vscode-dsh/tests/chat-ux-streaming-cancel-follow.spec.ts \
  apps/vscode-dsh/tests/chat-ux-activity-stream.spec.ts \
  apps/vscode-dsh/tests/layer-a/activity-stream.spec.ts
```

## 约束（来自 design.md 与本 Phase 相关的架构决策）

- **最小一致性修复**：只改类型层，不改运行期逻辑、线契约字段名、对外类型签名（除 `SearchHit.matchTier` → `matchTiers`）。
- **`Thenable` 方向 B**：机械替换为 `PromiseLike<T>`，保留 `| Promise<...>` 与 `| boolean` 成员；不得替换为 `Promise<T>`（否则收紧契约，违反 AC-7）。
- **`exactOptionalPropertyTypes` 手法**：统一条件展开；禁止 `as any`、`!` 非空断言、`delete` 删属性等引入语义偏差的 hack。
- **`tsc -b` 会自动构建引用图**：若 `ide-bridge`/`sdk/client`/`subprocess`/`file-reference` 尚未产出声明，`tsc -b` 自动构建（必要时可先 `pnpm run build`）。

## 产出清单

- `apps/vscode-dsh/src/search/session-search.ts`（1 处改名）
- `apps/vscode-dsh/src/extension.ts`（6 处 `Thenable`→`PromiseLike` + 1 处条件展开）
- `apps/vscode-dsh/src/code-context/selection-ask.ts`（1 处替换）
- `apps/vscode-dsh/src/change/revert.ts`（1 处条件展开）
- `apps/vscode-dsh/src/conversation-controller.ts`（4 处条件展开）
