# Phase 1 审查报告 — sdk/server ↔ specdev 引用边界修复

## 判决：PASS

实现严格对齐 design.md 决策 D-1 与 spec.md 的 AC-3。运行时零变更，改动仅限 2 个配置文件，独立复跑 `tsc -b packages/sdk/server --force` 退出码 0、0 个错误。

## 逐条验收标准审查（AC-3）

| 子项 | 结果 | 证据 |
|------|:--:|------|
| 0 个 TS6059 + 0 个 TS6307 | ✅ | `export PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH && ./node_modules/.bin/tsc -b packages/sdk/server --force` → 退出码 0，stdout/stderr 无任何 `error TS` 输出（Node v24.3.0） |
| import 经 project reference 解析 | ✅ | `tsconfig.json` `references[]` 新增 `{ "path": "../../specdev/specdev" }`；TS 改用 specdev 自身 composite 项目的 `.d.ts`，不再走 `paths` 把 `packages/specdev/specdev/src` 拽入 program |
| `references[]` 含 `../../specdev/specdev` | ✅ | 相对路径正确（`packages/sdk/server` → `../..`=`packages/` → `specdev/specdev`），与既有 `../../core/agent`、`../../llm/llm` 同构 |
| `dependencies` 含 specdev，peer/dev 均不含 | ✅ | `package.json` `dependencies` 第 31 行新增项；`peerDependencies`（34-43 行）与 `devDependencies`（45-59 行）均已无该项 |
| `server.ts:27` 仍是运行时 import | ✅ | 行内容 `import { attachOrchestratorMetadata } from '@deepseek-ai/dsh-specdev'`，无 `type` 关键字，运行时符号解析路径不变 |

## 逐项核对（对照 review 重点 1-5）

### 1. references 修正 ✅

`git diff packages/sdk/server/tsconfig.json` 显示：`../../subagent/subagent` 项补尾逗号，随后新增 `{ "path": "../../specdev/specdev" }`。原有 9 项全部保留、顺序未动：

```
../../../vendor/cordis, ../../../vendor/schemastery, ../../llm/llm,
../../llm/llm-deepseek, ../../core/agent, ../../attachment/attachment,
../../core/session, ../protocol, ../../subagent/subagent, ../../specdev/specdev
```

只加了 specdev 一项 + 尾逗号，符合 design D-1「放在 `../../subagent/subagent` 之后」。

### 2. 依赖归属修正 ✅

`git diff packages/sdk/server/package.json` 显示三处改动，均正确：

- `dependencies` 新增 `"@deepseek-ai/dsh-specdev": "workspace:^"`，插在 `dsh-brand` 之后、`schemastery` 之前（字母序正确）；
- `peerDependencies` 删除 `"@deepseek-ai/dsh-specdev": "workspace:^",`；
- `devDependencies` 删除 `"@deepseek-ai/dsh-specdev": "workspace:^",`。

版本号保持 `workspace:^`，未写字面量，对齐仓库所有内部依赖。

### 3. 运行时零变更 ✅

- `git diff packages/sdk/server/src/server.ts` 无输出 → `server.ts` 零改动。
- 本 Phase 实际改动仅 `packages/sdk/server/tsconfig.json` + `packages/sdk/server/package.json` 两个文件。
- 未触碰任何 `.ts` 源码、未改运行时逻辑。

> 注：`git status` 工作区还混有其他 workflow 的未提交改动（如 `tsdown.config.ts` 的 `apps/vscode-dsh` workspace 条目、`apps/vscode-dsh/**`、`.specdev/specs/vscode-dsh-editor-chat-panel/**` 等），均与本 Phase 无关。HG-3 提交时应只 `git add` 本 Phase 的 2 个文件。

### 4. AC-3 达成 ✅

独立复跑：

```bash
export PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH
./node_modules/.bin/tsc -b packages/sdk/server --force
# 退出码 0，0 个 error TS6059 / TS6307（无任何输出）
```

### 5. 偏差评估（vitest 2 个失败）✅ 非本 Phase 回归

implementer 报告 `server.spec.ts` / `plugin-apply.spec.ts` 因 `FiberState.UNLOADING` 读取 `undefined` 失败。已独立核实根因：

- `vendor/cordis/src/fiber.ts:147`：`export const enum FiberState { ... UNLOADING ... }` —— `const enum` 编译期内联、**不产出运行时对象**。
- `packages/core/agent-loop/src/index.ts:39-43`：顶层 `new Set([FiberState.UNLOADING, FiberState.DISPOSED, FiberState.FAILED])` 在模块加载时访问 `FiberState`。
- vitest（source-plane，esbuild）不做跨文件 const enum 内联 → `FiberState` 为 `undefined` → 抛 `TypeError: Cannot read properties of undefined (reading 'UNLOADING')`。

本 Phase 仅改 sdk/server 的 tsconfig reference + package.json 依赖归属，未触碰 cordis、agent-loop 及任何运行时代码，无法影响该路径。**确为预先存在、与本 Phase 配置改动无关。**

## 桩检测报告

- 本 Phase 不涉及函数实现，无空壳函数、硬编码返回、`(void)args`、条件桩。
- 未引入 `@STUB` / `as any` / `as unknown as` 宽泛降级。
- `attachOrchestratorMetadata` 为既有真实实现（`dispatch.ts:109-111` 委托 `attachSpecdevMetadata`），非桩。

## 集成连通性验证结果

- **类型边界**：`tsc -b packages/sdk/server` 通过 project reference 解析 `@deepseek-ai/dsh-specdev`，30 条 TS6059/TS6307 结构性越界错误整体消失。✅
- **运行时边界**：`server.ts:27` 运行时 import 保留，`createSession()` 中 `attachOrchestratorMetadata(...)` 调用链未变。✅
- **依赖图**：specdev 从 peer/dev 移入 dependencies，与 `dsh-brand`（同为运行时 import、已在 dependencies）语义一致。✅

## 发现的问题

### 🔴 must-fix

无。

### 🟡 should-fix

无。

### 🟢 optional

1. `tsc -b` 会向部分引用项目（如 `vendor/cordis/src/` 等）emit `.js`/`.d.ts`/`.map` 到 `src/` 目录，产生大量未跟踪构建产物（`git status` 已见）。这是仓库既有现象，非本 Phase 引入；HG-3 提交时勿纳入这些产物，只提交 2 个配置文件。

## Registry 对照

- `tech-debt-registry.md` 活跃债务与已解决表均为空，与本 Phase 无交互。
- 未发现未注册债务；无桩代码可注册。
- 无可关闭的已解决条目。

## 验证命令建议（给 verifier）

1. 干净树复核（排除 `lib/types` 既有产物干扰）：

```bash
export PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH
pnpm run clean 2>/dev/null || tsx scripts/clean.ts
./node_modules/.bin/tsc -b packages/sdk/server --force
# 期望：退出码 0，0 个 error TS6059 / TS6307
```

2. 静态核验 references 与依赖归属（`jq` 或读取文件）：
   - `tsconfig.json` references[] 含 `../../specdev/specdev` 且仅 +1 项；
   - `package.json` dependencies 含 specdev、peer/dev 均不含。

3. 运行时 import 核验：`server.ts:27` 仍为 `import { attachOrchestratorMetadata } from '@deepseek-ai/dsh-specdev'`（无 `type`）。

4. 确认本 Phase 改动文件集合 = `packages/sdk/server/tsconfig.json` + `packages/sdk/server/package.json`（2 个），工作区其余未提交改动属其他 workflow。
