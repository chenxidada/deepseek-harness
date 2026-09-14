# Phase 2 实现摘要：specdev-gate gitBranch 类型修复

## 变更清单

| 文件 | 改动 | 性质 |
|------|------|------|
| `packages/specdev/specdev-gate/src/index.ts` | 两处 `evaluateRoleDispatch(role, auth, { gitBranch: role === 'implementer' ? gitReader(cwd) : undefined })` 改为条件展开 `...(role === 'implementer' ? { gitBranch: gitReader(cwd) } : {})`（`:128` 与 `:167`） | 类型层一致性修复，运行时行为不变 |

`check.ts`、`git-branch.ts`、`authority.ts` 均未改动。

## 对每个验收标准的实现说明

### AC-4（`packages/specdev/specdev-gate` 0 个 TS2379）

- **根因**：`EvaluateRoleOptions.gitBranch`（`check.ts:22-25`）声明为 `readonly gitBranch?: string | null`。在 `exactOptionalPropertyTypes: true`（继承自 `tsconfig.base.json`）下，可选属性一旦显式写出，值**不能**是 `undefined`。原三元 `role === 'implementer' ? gitReader(cwd) : undefined` 的类型为 `string | null | undefined`，`undefined` 分支不合法，触发 TS2379。
- **修复**：改用条件展开 `...(role === 'implementer' ? { gitBranch: gitReader(cwd) } : {})`。当 `role === 'implementer'` 时 `gitBranch` 以 `string | null`（`GitBranchReader` 返回类型）作为属性存在；否则**整个键省略**，不产生显式 `undefined`。
- **fail-closed 语义保持**：省略属性后，`evaluateImplementer`（`check.ts:147-153`）读 `options.gitBranch` 得 `undefined`，命中 `actual === undefined` 分支返回 `SPECDEV_BRANCH_UNKNOWN`（省略=拒绝）；`readGitBranch` 返回 `null` 时命中 `actual === null` 分支（读到 null=拒绝）。条件展开「省略键」与「显式 undefined」在运行时均表现为属性缺失，`actual === undefined` 分支仍命中，语义不变。
- **未放宽类型契约**：`check.ts:22-25` 的 `EvaluateRoleOptions.gitBranch` 仍为 `readonly gitBranch?: string | null`，未被修改。

## 测试结果

### AC-4 编译验证（权威证据）

```
$ export PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH
$ ./node_modules/.bin/tsc -b packages/specdev/specdev-gate --force
# 退出码 0，无任何 stdout/stderr 错误输出
$ ./node_modules/.bin/tsc -b packages/specdev/specdev-gate --force 2>&1 | grep -c "error TS2379"
# 0
```

- **退出码**：0
- **TS2379 数量**：0

### AC-4 静态检查（已验证）

- `index.ts:128` 与 `:167`：均改为 `...role === 'implementer' ? { gitBranch: gitReader(cwd) } : {}`，无 `: undefined` 三元尾（`git diff` 确认仅此两行改动）。
- `check.ts:22-25`：`EvaluateRoleOptions.gitBranch` 仍为 `readonly gitBranch?: string | null`（未改动）。
- `check.ts:148`（`actual === undefined`）与 `:155`（`actual === null`）分支仍在，fail-closed 矩阵未被破坏。

### 包内既有测试（回归说明）

运行 `./node_modules/.bin/vitest run packages/specdev/specdev-gate/tests/specdev-gate.spec.ts`，9 个用例全部失败，但**失败根因与本 Phase 无关**：

- 失败栈：`scripts/test-invariants.ts:88` `fiber.ctx.fiber.state === FiberState.PENDING` 抛 `TypeError: Cannot read properties of undefined (reading 'PENDING')`；未处理拒绝处为 `requireActive` 读 `FiberState.ACTIVE` 同型错误。
- 根因：`vendor/cordis/src/fiber.ts:147` 的 `const enum FiberState` 在 vitest source-plane（esbuild）下不被跨文件内联，运行时 `FiberState` 为 `undefined`。这是**已知、已文档化**的环境限制（见 `.cursor/skills/project-test/SKILL.md`「⚠️ sdk/server tests 存在 `const enum FiberState` source-plane 失败」）。specdev-gate 测试通过 `gateHarness` → `ctx.plugin(...)` 加载同一 vendored cordis fiber，触发同源问题。
- 该失败发生在插件注册阶段，**先于**本 Phase 修改的 `index.ts` dispatch 路径执行，与本 Phase 的纯类型层改动无关。本 Phase 为类型一致性修复，无运行时行为变化可测，验收证据以 AC-4 的 tsc 编译验证为准（见 spec 说明）。

## 偏差记录

无偏差。实现严格遵循 design.md 决策 D-2 与 spec.md AC-4：

- 条件展开形态与 design.md D-2 示例一致（`...(role === 'implementer' ? { gitBranch: gitReader(cwd) } : {})`）。
- 未改动 `check.ts` 类型契约、未引入 `@STUB` / `as any`、未超出 Phase 范围（仅 `index.ts` 两处）。

## 债务注册

本 Phase 无新桩、无占位、无 `@STUB`，无需更新 `tech-debt-registry.md`（该文件「活跃债务」与「已解决」仍为空）。
