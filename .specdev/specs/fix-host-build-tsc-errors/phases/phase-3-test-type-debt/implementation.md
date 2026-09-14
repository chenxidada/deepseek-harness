# Phase 3 实现摘要：测试文件类型债修复

## 变更清单（文件列表）

| 文件 | 改动 |
|------|------|
| `packages/ide/ide-bridge/tests/ide-bridge.spec.ts` | ① 顶部新增 `import type { Agent } from '@deepseek-ai/dsh-agent'`；② 新增 `stubAgent(id, sessionId)` 助手；③ `:380` `boundarySeq` 改为条件展开；④ 5 处 `ctx.waterfall` 的 `agent:` 字面量改为 `agent: stubAgent(…)` |
| `packages/specdev/specdev-advance/tests/specdev-advance.spec.ts` | `:117` `data as { snapshot: unknown }` 改为 `data as unknown as { snapshot: unknown }` |
| `packages/specdev/specdev/tests/specdev.spec.ts` | `:313` `{ options: … } as Agent` 改为 `{ options: … } as unknown as Agent` |

## 对每个验收标准的实现说明

### AC-5（0 个 TS2379 / TS2769 / TS2352）

1. **TS2379（`ide-bridge.spec.ts:380`）**：`forkSession` 回调中 `forked.push({ parent, boundarySeq: options?.boundarySeq })` 的 `options?.boundarySeq` 类型为 `number | undefined`，在 `exactOptionalPropertyTypes` 下不能显式赋给 `boundarySeq?: number`。改为条件展开，`undefined` 时省略键、非 `undefined` 时携带 `boundarySeq`：

```typescript
forked.push({
  parent: parentSessionId,
  ...(options?.boundarySeq === undefined ? {} : { boundarySeq: options.boundarySeq }),
})
```

2. **5×TS2769（`ide-bridge.spec.ts` `:445`/`:482`/`:514`/`:546`/`:570`）**：`ctx.waterfall('approval/request' | 'user-questions/request', …)` 的载荷 `agent` 字段要求全量 `Agent`（`@deepseek-ai/dsh-agent` 的 `{ readonly id: SessionId }` 及 `runtime-types.ts` 增补成员），测试字面量 `{ id: 'a', session: { id: … } }` 的 `id` 是裸字符串（非 `SessionId` branded）且多余 `session`，无重载匹配。修复：
   - 顶部新增 `import type { Agent } from '@deepseek-ai/dsh-agent'`
   - 新增助手（最小接口 `{ id, session: { id } }`，与 `resolveBridgeSessionId` 运行时鸭子类型一致）：

```typescript
function stubAgent(id: string, sessionId: string): Agent {
  return { id, session: { id: sessionId } } as unknown as Agent
}
```

   - 5 处 `agent:` 字面量分别改为 `agent: stubAgent('a', 'sess-1')`（2 处）与 `agent: stubAgent('a', 's')`（3 处）。

3. **TS2352（`specdev-advance.spec.ts:117`）**：`data`（类型 `{ nextAction; kind; version }`）断言为 `{ snapshot }` 时两类型「不充分重叠」。改为 `(data as unknown as { snapshot: unknown }).snapshot`。

4. **TS2352（`specdev.spec.ts:313`）**：`{ options: {} }` 断言为富 `Agent` 时缺大量成员「不充分重叠」。改为 `{ options: {} as Record<string, unknown> } as unknown as Agent`。

所有修复均为测试侧断言补全，未触碰任何 `Events` 声明（`@deepseek-ai/dsh-user-approval/types.ts`、`@deepseek-ai/dsh-user-questions/types.ts` 的事件与载荷类型本就完整）；未引入 `@STUB` / `as any` / `@ts-expect-error` / `@ts-ignore`。

## 测试结果

### 编译验证（AC-5 主验证）

命令（Node 24.3.0）：

```sh
export PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH
./node_modules/.bin/tsc -b tsconfig.host.json
```

- **退出码**：`0`
- **TS2379 数量**：0
- **TS2769 数量**：0
- **TS2352 数量**：0
- **任意 `error TS*` 数量**：0（输出为空，无任何类型错误）

### 回归验证（vitest source-plane）

命令：

```sh
./node_modules/.bin/vitest run \
  packages/ide/ide-bridge/tests/ide-bridge.spec.ts \
  packages/specdev/specdev/tests/specdev.spec.ts \
  packages/specdev/specdev-advance/tests/specdev-advance.spec.ts
```

- `ide-bridge.spec.ts`：**23/23 全部通过**（含 6 处实质改动对应的 fork / approval / user-questions 端到端断言）。
- `specdev.spec.ts`、`specdev-advance.spec.ts`：失败，但失败点为 `scripts/test-invariants.ts:88` 的 `FiberState.PENDING` —— `FiberState` 是 `vendor/cordis/src/fiber.ts:147` 的 `const enum`，在 vitest（isolatedModules/esbuild）下无运行时值，读取时 `undefined`。这是**预先存在的测试基础设施问题**，与本 Phase 无关（见「偏差记录」）。

## 偏差记录

### 偏差 1：specdev/specdev-advance 回归测试受既有 `const enum` 问题影响

- **偏差描述**：直接 `vitest run` 运行 `specdev.spec.ts` / `specdev-advance.spec.ts` 时，`ctx.plugin(...)` 触发 `scripts/test-invariants.ts:88` 的 `FiberState.PENDING`，因 `FiberState`（`vendor/cordis/src/fiber.ts` 的 `const enum`）在 esbuild 转换下无运行时表示而抛 `TypeError: Cannot read properties of undefined`。
- **影响范围**：spec.md §验证策略「AC-5 回归验证」；design.md §验证策略「`pnpm run test:coverage`（vitest source-plane）不回退」。
- **原因**：本 Phase 对这两个文件的改动是 `as unknown as X` 纯类型断言（编译期擦除、零运行时差异），不可能改变运行时行为；失败根因是仓库既有 `const enum FiberState` 与 vitest 隔离模块转译的固有不兼容，与本 Phase 改动无关。
- **影响**：`ide-bridge.spec.ts`（实质运行时相关改动所在文件）23/23 通过，已充分证明测试类型改动未破坏运行时断言。specdev 两个文件的失败为环境问题，与基线一致、不回退。下游 verifier 应以干净树复核 `tsc -b tsconfig.host.json`（exit 0 已达成），并知悉 specdev 测试的 `const enum` 失败为预存环境现象。
