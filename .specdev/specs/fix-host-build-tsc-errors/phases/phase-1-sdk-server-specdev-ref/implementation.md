# Phase 1 实现摘要 — sdk/server ↔ specdev 引用边界修复

## 变更清单（文件列表）

| 文件 | 改动 |
|------|------|
| `packages/sdk/server/tsconfig.json` | `references[]` 末尾（`../../subagent/subagent` 之后）新增 `{ "path": "../../specdev/specdev" }`，并为原末尾 subagent 项补尾逗号 |
| `packages/sdk/server/package.json` | ① `dependencies` 新增 `"@deepseek-ai/dsh-specdev": "workspace:^"`（插在 `@deepseek-ai/dsh-brand` 之后、`@deepseek-ai/schemastery` 之前，保持字母序）；② `peerDependencies` 删除 `"@deepseek-ai/dsh-specdev": "workspace:^"`；③ `devDependencies` 删除 `"@deepseek-ai/dsh-specdev": "workspace:^"` |

未改动的文件（符合 spec 约束）：
- `packages/sdk/server/src/server.ts` — `server.ts:27` 的 `import { attachOrchestratorMetadata } from '@deepseek-ai/dsh-specdev'` 保持运行时 import（无 `type` 关键字），源码零改动。

## 对每个验收标准的实现说明（AC-3）

| AC-3 子项 | 验证类型 | 实现/结果 |
|-----------|---------|-----------|
| 0 个 TS6059 + 0 个 TS6307 | 编译验证 | ✅ `./node_modules/.bin/tsc -b packages/sdk/server --force` 退出码 0，0 个 `error TS` |
| import 经 project reference 解析 | 编译验证 | ✅ 新增 `{ "path": "../../specdev/specdev" }` 后，TS 改用 specdev 自身 composite 项目的 `.d.ts` 解析，不再走 `paths` 把 `packages/specdev/specdev/src` 拽入 program |
| `references[]` 含 `../../specdev/specdev` | 静态检查 | ✅ `tsconfig.json` 第 38-40 行为 `{ "path": "../../specdev/specdev" }` |
| `dependencies` 含 specdev，`peerDependencies`/`devDependencies` 不含 | 静态检查 | ✅ `dependencies` 第 31 行 `"@deepseek-ai/dsh-specdev": "workspace:^"`；`peerDependencies`（第 34-44 行）与 `devDependencies`（第 45-60 行）均已无该项 |
| `server.ts:27` 仍是运行时 import | 运行时验证 | ✅ 行内无 `type` 关键字（`import { attachOrchestratorMetadata } from '@deepseek-ai/dsh-specdev'`），运行时符号解析路径不变 |

## 测试结果（命令 + 输出）

环境统一：`export PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH`（Node v24.3.0），用 `./node_modules/.bin/tsc` / `./node_modules/.bin/vitest` 直调绕过 pnpm postinstall（宿主 git 2.25.1 < 2.26）。

### 1. tsc 全量重编译（核心验收）

```bash
./node_modules/.bin/tsc -b packages/sdk/server --force
```

- 退出码：**0**
- `error TS` 计数：**0**（无任何输出）

### 2. 残留 TS6059/TS6307 计数

```bash
CNT=$(./node_modules/.bin/tsc -b packages/sdk/server 2>&1 | grep -cE 'TS6059|TS6307')
```

- 结果：**TS6059/TS6307 计数 = 0**（增量构建亦无任何输出）

### 3. vitest 回归检查（`packages/sdk/server/tests/`）

```bash
./node_modules/.bin/vitest run packages/sdk/server
```

结果：**1/3 测试文件通过**，2 个测试套件在**导入阶段**失败，失败根因为 vendored cordis 的 `const enum FiberState` 在 source-plane 无运行时对象——与本 Phase 改动无关：

```
FAIL  plugin-apply.spec.ts  TypeError: Cannot read properties of undefined (reading 'UNLOADING')
FAIL  server.spec.ts        TypeError: Cannot read properties of undefined (reading 'UNLOADING')
      at packages/core/agent-loop/src/index.ts:40:14  (FiberState.UNLOADING)
PASS  plugin-shape.spec.ts  1 passed
```

**判定：非本 Phase 回归。** 理由：
1. 两个失败套件都 `import AgentLoop from '@deepseek-ai/dsh-agent-loop'`，而 `agent-loop/src/index.ts:40` 顶层 `new Set([FiberState.UNLOADING, ...])` 在运行时访问 `FiberState`。`FiberState` 是 `vendor/cordis/src/fiber.ts:147` 的 `export const enum`，`const enum` 在编译期内联、**不产出运行时对象**；esbuild（vitest source-plane）不做跨文件 const enum 内联，故 `FiberState` 为 `undefined`。
2. 本 Phase 仅改 `packages/sdk/server` 的 `tsconfig.json`（加一条 reference）与 `package.json`（specdev 依赖迁移），不触碰 cordis、agent-loop 及任何运行时代码，无法影响 `FiberState` 的解析。
3. 不 import agent-loop 的 `plugin-shape.spec.ts` 单独跑 **1/1 passed**，进一步印证失败仅与 agent-loop/cordis const-enum 路径相关。

## 偏差记录

无偏差。实现严格对齐 design.md 决策 D-1 与 spec.md 约束：
- references 相对路径 `../../specdev/specdev`（`packages/sdk/server` → `packages/specdev/specdev`），与既有 `../../llm/llm`、`../../core/agent` 同构 ✅
- 版本号保持 `workspace:^`，未写字面量 ✅
- `server.ts` 源码零改动，reference 只解决类型边界 ✅
- 未引入 `@STUB` / `as any` ✅

## 技术债注册

无新增债务（未创建任何桩/占位）。`tech-debt-registry.md` 活跃债务与已解决表维持为空。

## 给调度者/verifier 的提示

- `tsc -b` 会产生构建副作用：向部分引用项目（如 `vendor/cordis/src/`）emit `.js`/`.d.ts`/`.map`（本项目既有现象，见 project-build skill）。本 Phase 实际改动仅上述 2 个文件，HG-3 提交时应只 `git add` 这 2 个文件，勿纳入 `src/` 下的 build 产物。
- verifier 若需干净树复核，应先 `pnpm run clean` 再执行 `./node_modules/.bin/tsc -b packages/sdk/server`，以排除 `lib/types` 既有产物干扰（spec.md 已注明）。
