# Phase 2: specdev-gate gitBranch 类型修复

## 目标

让 `evaluateRoleDispatch` 的 `gitBranch` 实参在 `exactOptionalPropertyTypes` 下类型自洽，消除 2 条 TS2379。不改变 fail-closed 门禁语义，不改 `check.ts` 的类型契约。

## 前置条件（依赖的 spec 文件 + 已完成的 Phase）

- `requirements.md`（§FA-2、§AC-4）
- `design.md`（§决策 D-2、§逐文件改动清单 FA-2）
- 无前置 Phase（DAG 叶子节点，可与 Phase 1/3 并行）。

## 验收标准

- **AC-4**（普遍型）：`packages/specdev/specdev-gate` 的构建必须产出 0 个 `TS2379`（`evaluateRoleDispatch` 的 `gitBranch` 实参在 `exactOptionalPropertyTypes` 下不含 `undefined`）。

## 验证策略（每条 AC 必须有对应的验证方案）

| AC | 验证类型 | 验证方法 | 预期结果 |
|----|---------|---------|---------|
| AC-4 | 编译验证 | 在仓库根执行 `./node_modules/.bin/tsc -b packages/specdev/specdev-gate` | 退出码 0，stdout 中 0 个 `error TS2379` |
| AC-4 | 静态检查 | 读取 `packages/specdev/specdev-gate/src/index.ts` 第 127-129 行与第 166-168 行 | 两处均改为条件展开 `...(role === 'implementer' ? { gitBranch: gitReader(cwd) } : {})`，无 `: undefined` 三元尾 |
| AC-4 | 静态检查 | 读取 `packages/specdev/specdev-gate/src/check.ts` 第 22-25 行 | `EvaluateRoleOptions.gitBranch` 仍为 `readonly gitBranch?: string | null`，未被放宽 |
| AC-4 | 回归验证 | `evaluateImplementer` 的 `actual === undefined`（check.ts:148）与 `actual === null`（check.ts:155）分支仍在 | fail-closed 语义不变：省略=拒绝、null=拒绝、分支不匹配=拒绝 |

> 说明：verifier 应以干净树复核；若 pnpm postinstall 因 git 版本失败，用 `./node_modules/.bin/tsc` 直调。

## 约束（来自 design.md 中与本 Phase 相关的架构决策）

- 采用「条件展开」而非「放宽类型」（决策 D-2），不改 `EvaluateRoleOptions.gitBranch`。
- `GitBranchReader` 返回 `string | null`，`role === 'implementer'` 时 `gitBranch` 为 `string | null`，否则键省略。
- 不引入 `@STUB` / `as any`。

## 产出清单

- 修改 `packages/specdev/specdev-gate/src/index.ts`（两处：`wrapDispatchRole` 内与 `evaluateForRole` 内）
