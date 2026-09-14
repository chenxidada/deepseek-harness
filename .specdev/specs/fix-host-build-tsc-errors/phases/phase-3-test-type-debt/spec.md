# Phase 3: 测试文件类型债修复

## 目标

修正 3 个测试文件在 host aggregate 下的类型错误（1×TS2379 + 5×TS2769 + 2×TS2352），使 `ide-bridge/tests`、`specdev/tests`、`specdev-advance/tests` 通过类型检查。这是「修正测试类型」，不是「补 Events 类型声明」，也不从 host aggregate 排除 tests 目录。

## 前置条件（依赖的 spec 文件 + 已完成的 Phase）

- `requirements.md`（§FA-3、§AC-5、§Q-1=all_fix、风险「Events 类型声明缺口」）
- `design.md`（§逐文件改动清单 FA-3）
- 无前置 Phase（DAG 叶子节点，可与 Phase 1/2 并行）。

## 验收标准

- **AC-5**（普遍型）：`packages/ide/ide-bridge/tests/ide-bridge.spec.ts`、`packages/specdev/specdev/tests/specdev.spec.ts`、`packages/specdev/specdev-advance/tests/specdev-advance.spec.ts` 在 host aggregate 下必须产出 0 个 `TS2379` / `TS2769` / `TS2352`。

## 验证策略（每条 AC 必须有对应的验证方案）

| AC | 验证类型 | 验证方法 | 预期结果 |
|----|---------|---------|---------|
| AC-5 | 编译验证 | 在仓库根执行 `./node_modules/.bin/tsc -b tsconfig.host.json`（该 aggregate 直接 include `packages/*/*/tests/**/*.ts`） | 输出中 0 个 `error TS2379`、`error TS2769`、`error TS2352`（尤其定位到上述三个文件） |
| AC-5 | 静态检查 | 读取 `ide-bridge.spec.ts` 第 380 行 | `boundarySeq` 改为条件展开，无 `boundarySeq: options?.boundarySeq` 直赋 |
| AC-5 | 静态检查 | 读取 `ide-bridge.spec.ts` 顶部与 5 处 `ctx.waterfall` 调用点（:444/:480/:513/:545/:569） | 新增 `import type { Agent }` 与 `stubAgent` 助手；5 处 `agent:` 均改为 `agent: stubAgent(…)` |
| AC-5 | 静态检查 | 读取 `specdev-advance.spec.ts` 第 117 行 | `(data as unknown as { snapshot: unknown }).snapshot` |
| AC-5 | 静态检查 | 读取 `specdev.spec.ts` 第 313 行 | `{ options: {} as Record<string, unknown> } as unknown as Agent` |
| AC-5 | 回归验证 | 执行 `pnpm run test:coverage`（vitest source-plane） | 与修复前基线一致，不回退 |

> 说明：verifier 应以干净树复核 `tsc -b tsconfig.host.json`；`test:coverage` 走 source-plane、不经 tsc build，仅用于确认测试类型改动未破坏运行时断言。

## 约束（来自 design.md 中与本 Phase 相关的架构决策）

- 仅改 `tests/` 目录文件，不触碰任何 `Events` 声明（`@deepseek-ai/dsh-user-approval/types.ts`、`@deepseek-ai/dsh-user-questions/types.ts` 的事件已声明，不缺）。
- 断言统一用 `as unknown as X`（严格模式下部分对象与全量类型「不充分重叠」，单层 `as X` 会再触发 TS2352）。
- 不引入 `@STUB` / `as any`。

## 产出清单

- 修改 `packages/ide/ide-bridge/tests/ide-bridge.spec.ts`
- 修改 `packages/specdev/specdev-advance/tests/specdev-advance.spec.ts`
- 修改 `packages/specdev/specdev/tests/specdev.spec.ts`
