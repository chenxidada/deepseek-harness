# Phase 1 实现摘要 — sdk/server ↔ specdev 引用边界修复

## 变更清单（文件列表）

| 文件 | 改动 |
|------|------|
| `packages/sdk/server/tsconfig.json` | `references[]` 末尾（`../../subagent/subagent` 之后）新增 `{ "path": "../../specdev/specdev" }`，并为原末尾 subagent 项补尾逗号 |
| `packages/sdk/server/package.json` | ① `dependencies` 新增 `"@deepseek-ai/dsh-specdev": "workspace:^"`（插在 `@deepseek-ai/dsh-brand` 之后、`@deepseek-ai/schemastery` 之前，保持字母序）；② `peerDependencies` 删除该项；③ `devDependencies` 删除该项 |

未改动文件（符合 spec 约束）：
- `packages/sdk/server/src/server.ts` — `server.ts:27` 的 `import { attachOrchestratorMetadata } from '@deepseek-ai/dsh-specdev'` 保持运行时 import（无 `type` 关键字），源码零改动。

## 对每个验收标准的实现说明（AC-3）

| AC-3 子项 | 验证类型 | 实现/结果 |
|-----------|---------|-----------|
| 0 个 TS6059 + 0 个 TS6307 | 编译验证 | ✅ `tsc -b packages/sdk/server --force` 退出码 0，0 个 `error TS` |
| import 经 project reference 解析 | 编译验证 | ✅ 新增 reference 后 TS 改用 specdev 的 `.d.ts` 解析，不再走 `paths` 把 `src` 拽入 program |
| `references[]` 含 `../../specdev/specdev` | 静态检查 | ✅ `tsconfig.json` 第 38-40 行为 `{ "path": "../../specdev/specdev" }` |
| `dependencies` 含 specdev，peer/dev 不含 | 静态检查 | ✅ `dependencies` 第 31 行含该项；`peerDependencies` 与 `devDependencies` 均已无该项 |
| `server.ts:27` 仍是运行时 import | 运行时验证 | ✅ 行内无 `type` 关键字，运行时符号解析路径不变 |

## 测试结果（命令 + 输出）

环境：`export PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH`（Node v24.3.0），`./node_modules/.bin/tsc` / `vitest` 直调绕过 pnpm postinstall。

### 1. tsc 全量重编译（核心验收）

```bash
./node_modules/.bin/tsc -b packages/sdk/server --force
```

- 退出码：**0**，`error TS` 计数 **0**。

### 2. 残留 TS6059/TS6307 计数

```bash
./node_modules/.bin/tsc -b packages/sdk/server 2>&1 | grep -cE 'TS6059|TS6307'
```

- 结果：**0**。

### 3. vitest 回归检查（`packages/sdk/server/tests/`）

```bash
./node_modules/.bin/vitest run packages/sdk/server
```

结果：**1/3 测试文件通过**，2 个套件在导入阶段失败，根因为 vendored cordis 的 `const enum FiberState` 在 source-plane 无运行时对象，与本 Phase 改动无关：

```
FAIL  plugin-apply.spec.ts  TypeError: Cannot read properties of undefined (reading 'UNLOADING')
FAIL  server.spec.ts        TypeError: Cannot read properties of undefined (reading 'UNLOADING')
      at packages/core/agent-loop/src/index.ts:40:14
PASS  plugin-shape.spec.ts  1 passed
```

**判定：非本 Phase 回归。** 两个失败套件都 import `@deepseek-ai/dsh-agent-loop`，其顶层 `new Set([FiberState.UNLOADING, ...])` 运行时访问 `const enum FiberState`（`vendor/cordis/src/fiber.ts:147`），esbuild 不做跨文件 const enum 内联导致 `FiberState` 为 `undefined`。本 Phase 仅改 sdk/server 的 tsconfig/package.json，不触碰 cordis/agent-loop，无法影响该解析；不 import agent-loop 的 `plugin-shape.spec.ts` 单独跑 1/1 passed 进一步印证。

## 偏差记录

无偏差。实现严格对齐 design.md 决策 D-1 与 spec.md 约束：
- references 相对路径 `../../specdev/specdev`，与既有 `../../llm/llm`、`../../core/agent` 同构 ✅
- 版本号保持 `workspace:^` ✅
- `server.ts` 源码零改动 ✅
- 未引入 `@STUB` / `as any` ✅

## 技术债注册

无新增债务（未创建任何桩/占位）。

## 给调度者/verifier 的提示

- `tsc -b` 会产生构建副作用（向部分引用项目 emit `.js`/`.d.ts`/`.map`）。本 Phase 实际改动仅 2 个文件，HG-3 提交时应只 `git add` 这 2 个文件。
- verifier 若需干净树复核，应先 `pnpm run clean` 再执行 `tsc -b packages/sdk/server`。
