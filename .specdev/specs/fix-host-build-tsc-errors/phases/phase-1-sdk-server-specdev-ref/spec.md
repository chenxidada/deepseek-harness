# Phase 1: sdk/server ↔ specdev 引用边界修复

## 目标

让 `packages/sdk/server` 对 `@deepseek-ai/dsh-specdev` 的运行时 import 走 **project reference**，并把 specdev 从 `peerDependencies` 移入 `dependencies`，消除 30 条结构性 rootDir 越界错误（15×TS6059 + 15×TS6307）。不改变任何运行时行为。

## 前置条件（依赖的 spec 文件 + 已完成的 Phase）

- `requirements.md`（§FA-1、§AC-3、开放问题 Q-3）
- `design.md`（§决策 D-1、§逐文件改动清单 FA-1）
- 无前置 Phase（本 Phase 为 DAG 叶子节点，可与 Phase 2/3 并行）。

## 验收标准

- **AC-3**（普遍型）：`packages/sdk/server` 的构建必须产出 0 个 `TS6059` 与 0 个 `TS6307`；其对 `@deepseek-ai/dsh-specdev` 的 import 必须经 project reference 解析，不得把 `packages/specdev/specdev/src` 拉入 sdk/server program。

## 验证策略（每条 AC 必须有对应的验证方案）

| AC | 验证类型 | 验证方法 | 预期结果 |
|----|---------|---------|---------|
| AC-3 | 编译验证 | 在仓库根执行 `./node_modules/.bin/tsc -b packages/sdk/server` | 退出码 0，stdout 中 0 个 `error TS6059` 与 0 个 `error TS6307` |
| AC-3 | 静态检查 | 读取 `packages/sdk/server/tsconfig.json`，确认 `references[]` 含 `{ "path": "../../specdev/specdev" }` | 引用路径存在且指向 `packages/specdev/specdev` |
| AC-3 | 静态检查 | 读取 `packages/sdk/server/package.json`，确认 `dependencies` 含 `@deepseek-ai/dsh-specdev`（`workspace:^`），且 `peerDependencies`/`devDependencies` 均不再含该项 | 依赖归属正确（runtime import → dependencies） |
| AC-3 | 运行时验证 | 确认 `server.ts:27` 的 `import { attachOrchestratorMetadata } from '@deepseek-ai/dsh-specdev'` 仍是运行时 import（非 `import type`） | 行内无 `type` 关键字，运行时符号仍可解析 |

> 说明：verifier 应以干净树复核——先 `pnpm run clean`（或 `tsx scripts/clean.ts`），再执行上述 `tsc -b`；不要只依赖已存在的 `lib/types` 产物。若 pnpm postinstall 因 git 版本失败，用 `./node_modules/.bin/tsc` 直调绕过。

## 约束（来自 design.md 中与本 Phase 相关的架构决策）

- 版本号保持 `workspace:^`，不写 `0.1.3-alpha.1` 字面量（对齐仓库所有内部依赖）。
- 相对路径必须为 `../../specdev/specdev`（`packages/sdk/server` → `packages/specdev/specdev`）。
- `server.ts` 源码不改动；reference 只解决类型边界，运行时 import 保留。
- 不引入 `@STUB` / `as any`。

## 产出清单

- 修改 `packages/sdk/server/tsconfig.json`（`references[]` 新增 1 项）
- 修改 `packages/sdk/server/package.json`（`dependencies` +1，`peerDependencies` −1，`devDependencies` −1）
