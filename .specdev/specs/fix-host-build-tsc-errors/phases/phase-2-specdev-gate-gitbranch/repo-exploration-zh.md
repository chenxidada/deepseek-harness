# 仓库探索报告 — Phase 2：specdev-gate gitBranch 类型修复

## 1. 任务上下文

本 Phase（id `phase-2-specdev-gate-gitbranch`，对应 FA-2 / AC-4）消除 `packages/specdev/specdev-gate` 中的 2 条 `TS2379` 错误。错误根因是 `evaluateRoleDispatch` 收到的 `gitBranch` 实参其三元表达式会显式产生 `undefined`（`role === 'implementer' ? gitReader(cwd) : undefined`），违反 `exactOptionalPropertyTypes`。修复方式是两处调用点做机械式「条件展开」改写（`...(role === 'implementer' ? { gitBranch: gitReader(cwd) } : {})`），**不**改 `check.ts` 的 `EvaluateRoleOptions.gitBranch` 契约，**不**改 fail-closed 语义。本 Phase 是 DAG 叶子节点，无上游 Phase 依赖。

## 2. 仓库概览

- **语言 / 运行时**：TypeScript（全 ESM，`"type": "module"`），Node `^22.19 || >=24`。
- **包管理**：pnpm workspaces；每个 npm 包都是 `@deepseek-ai/dsh-<name>`。
- **构建模型**：`tsc -b` 产出中间态 `lib/types/`（JS + `.d.ts`），再由 tsdown 打包运行时 `lib/`。每个包的 `tsconfig.json` 都是 `composite` 且 `extends tsconfig.base.json`。
- **目标包**：`packages/specdev/specdev-gate/` —— 一个 Cordis 函数插件（导出 `name` / `inject` / `apply`，无 default export），实现 fail-closed 的 SpecDev 流水线门禁。源文件：`src/index.ts`、`src/check.ts`、`src/authority.ts`、`src/git-branch.ts`。

## 3. 最相关区域

| 文件 | 相关性 | 来源 |
|------|--------|:----:|
| `packages/specdev/specdev-gate/src/index.ts` | **2 个 TS2379 调用点**（第 127-129 行与 166-168 行） | 👁 已读 |
| `packages/specdev/specdev-gate/src/check.ts` | `EvaluateRoleOptions` 类型声明（`:22-25`）与 `evaluateImplementer` fail-closed 分支（`:146-167`） | 👁 已读 |
| `packages/specdev/specdev-gate/src/git-branch.ts` | `GitBranchReader` / `readGitBranch` 返回类型 `string \| null`（`:11`、`:17`） | 👁 已读 |
| `packages/specdev/specdev-gate/src/authority.ts` | `AuthoritativeSpecdevStatus` + `resolveAuthoritativeStatus` —— `auth` 实参，无需改动 | 👁 已读 |
| `packages/specdev/specdev-gate/tsconfig.json` | `extends ../../../tsconfig.base.json`，`rootDir: src`，`outDir: lib/types` | 👁 已读 |
| `tsconfig.base.json` | `strict: true`（`:19`）+ `exactOptionalPropertyTypes: true`（`:21`） | 👁 已读 |
| `packages/specdev/specdev-gate/tests/specdev-gate.spec.ts` | 现有测试已传字面量 `string`（`:206`），从不传 `undefined` —— 不受影响 | 👁 grep |

## 4. 关键入口点 / 调用路径

调用路径 1 — dispatch 包装（TS2379 #1，`index.ts:127`）：

```
apply(ctx, config)
  └─ wrapDispatchRole(ctx, gitReader)                      // index.ts:76
       └─ service.dispatchRole = async (parent, request) => // index.ts:120
            └─ evaluateRoleDispatch(role, auth, {           // index.ts:127
                 gitBranch: role === 'implementer' ? gitReader(cwd) : undefined  // index.ts:128
               })
```

调用路径 2 — agent pre-step 扇出（TS2379 #2，`index.ts:166`）：

```
apply(ctx, config)
  ├─ ctx.root.on('agent/pre-step', ...)                     // index.ts:79
  │    └─ denyForAgent(ctx, agent, gitReader)               // index.ts:80
  │         └─ evaluateForRole(...)                          // index.ts:150
  ├─ ctx.on('tools/pre-execute', ...) → denyToolForRoleAgent // index.ts:92,200
  │    └─ denyForAgent → evaluateForRole
  └─ ctx.tools.guard(...) → denyToolForRoleAgent             // index.ts:102,200
       └─ denyForAgent → evaluateForRole
            └─ evaluateRoleDispatch(role, auth, {           // index.ts:166
                 gitBranch: role === 'implementer' ? gitReader(cwd) : undefined  // index.ts:167
               })
```

两条路径下游：`evaluateRoleDispatch` → `evaluateImplementer(auth, options)`（`check.ts:78`、`:123`）读取 `options.gitBranch`（`check.ts:147`），执行 `undefined` / `null` / mismatch 的 fail-closed 分支。

## 5. 可能的影响面

| 文件 | 改动 | 风险 |
|------|------|:----:|
| `packages/specdev/specdev-gate/src/index.ts` | 2 个三元改写为条件展开（D-2） | 🟢 低 |
| `packages/specdev/specdev-gate/src/check.ts` | **不改**（契约保留） | — |
| 其他文件 | **不改** | — |

两行目标（`:128` 与 `:167`）文本完全相同：`gitBranch: role === 'implementer' ? gitReader(cwd) : undefined,`。改写必须保持 `evaluateRoleDispatch` 的对象字面量实参形态，同时在 `role !== 'implementer'` 时完全省略 `gitBranch` 键。

## 6. 既有约束 / 约定

- `exactOptionalPropertyTypes: true`（来自 `tsconfig.base.json:21`）：可选属性一旦显式写出，值**不能**是 `undefined`。可选键必须省略，而不是赋 `undefined`。
- 仓库约定（D-2 理由）已在 `packages/sdk/server/src/server.ts:168-169` 与 `packages/ide/ide-bridge/src/index.ts` 使用条件展开，这是既有惯用法。
- 类型契约必须保持窄化：`readonly gitBranch?: string | null`（`check.ts:24`）—— **不要**放宽到包含 `undefined`。
- 无 `@STUB`、无 `as any`（宪法 §1）；ESM；`strict: true`。
- 包的 tsconfig 必须保持 `rootDir: src`、`outDir: lib/types`，以及现有 `references[]`（含 `../specdev`）。

## 7. 风险 / 未知点

- ✅ CONFIRMED：两个 TS2379 点分别是 `index.ts:128` 与 `index.ts:167`；三元模式文本一致。
- ✅ CONFIRMED：`EvaluateRoleOptions.gitBranch` 声明为 `readonly gitBranch?: string | null`（`check.ts:22-25`）—— 这是本包**本地**类型，**不是**从 `@deepseek-ai/dsh-specdev` 导出。`index.ts:18` 的 `import type {} from '@deepseek-ai/dsh-specdev'` 是 augmentation/type-only 副作用导入，与本错误无关。
- ✅ CONFIRMED：`GitBranchReader` 返回 `string | null`（`git-branch.ts:11`），故 `role === 'implementer'` 分支产出 `string | null`（对属性合法），而 `else` 分支产出 `undefined`（非法）。
- ✅ CONFIRMED：`specdev-gate/tsconfig.json` 继承 `tsconfig.base.json`，后者设置 `strict: true` + `exactOptionalPropertyTypes: true`；本包未覆盖这两个开关。
- ✅ CONFIRMED：`evaluateImplementer` 保留 `actual === undefined`（`check.ts:148`）与 `actual === null`（`check.ts:155`）分支；条件展开改写保留「省略键 ⇒ undefined ⇒ fail-closed 拒绝」语义。
- ⚠️ HYPOTHESIS：包内无其他源文件以可能为 `undefined` 的值构造 `gitBranch`（grep 确认仅 `index.ts:128`/`:167` 与 `check.ts:24`/`:147`）。测试传字面量字符串。

## 8. 不确定 / 未经核验

- 本环境的确切 `tsc` 调用方式：`pnpm postinstall` 可能因 git 2.25.1 失败，验证时应直接调用 `./node_modules/.bin/tsc -b packages/specdev/specdev-gate`（见 spec 备注）。此处为只读探索，未复跑。
- 是否有下游 `@deepseek-ai/dsh-specdev` 的 `.d.ts` 解析会在完整 `tsc -b tsconfig.host.json` 中额外暴露 TS2379，超出本 Phase 范围（Phase 4 负责端到端绿）。

## 9. 桩检测与注册表交叉校验

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| （无） | — | — | — | — |

`tech-debt-registry.md` 的「活跃债务」与「已解决」两张表均为空（仅占位 `—` 行），无任何已注册桩。

### 桩检测摘要

- ✅ 确认桩：0（registry 为空，无可匹配项）
- ⚠️ Registry 不一致：0
- 🔴 未注册桩：0（`index.ts` / `check.ts` / `authority.ts` / `git-branch.ts` 均含真实逻辑，无空实现 / 假返回值 / `@STUB` / `as any` 信号；`readGitBranch` 的 `catch { return null }` 是 fail-closed 契约行为，非桩）

## 10. 建议优先阅读

1. ⭐ 必读 —— `packages/specdev/specdev-gate/src/index.ts`（第 113-135 行与 153-169 行：两个调用点）
2. ⭐ 必读 —— `packages/specdev/specdev-gate/src/check.ts`（第 21-25 行类型契约；123-168 行 fail-closed 矩阵）
3. 🔷 应读 —— `packages/specdev/specdev-gate/src/git-branch.ts`（返回类型 `string | null`）
4. 🔷 应读 —— `.specdev/specs/fix-host-build-tsc-errors/design.md` §决策 D-2（精确改写形态）
5. 🔹 可选 —— `packages/specdev/specdev-gate/tests/specdev-gate.spec.ts`（确认现有字面量字符串用法，无需改动）
