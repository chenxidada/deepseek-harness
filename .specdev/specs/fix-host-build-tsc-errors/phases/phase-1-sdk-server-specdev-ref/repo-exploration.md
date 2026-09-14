# Repository Exploration Report — Phase 1: sdk/server ↔ specdev 引用边界修复

## 1. Task Context

本 Phase 修复 `packages/sdk/server` 对 `@deepseek-ai/dsh-specdev` 的**运行时 import** 未经 project reference 解析、反而退化走 `paths` 别名把 `packages/specdev/specdev/src` 整包拽进 sdk/server program 的结构性问题。该问题产生 30 条结构性 rootDir 越界错误（15×TS6059 + 15×TS6307）。修复方向（HG-2 已确认 D-1）：给 `packages/sdk/server/tsconfig.json` 的 `references[]` 加一项 `{"path":"../../specdev/specdev"}`，并把 `@deepseek-ai/dsh-specdev` 从 `peerDependencies` 移入 `dependencies`（`workspace:^`），同时清掉 `devDependencies` 里的冗余项。**不改动 `server.ts` 源码，不改运行时行为。**

## 2. Repository Overview

- **语言/运行时**：TypeScript (ESM, `"type":"module"`)，Node `^22.19 || >=24`。
- **包管理**：pnpm workspaces。所有内部包名 `@deepseek-ai/dsh-<name>`，内部依赖版本统一 `workspace:^`。
- **构建**：`tsc -b` project references；每个包 `rootDir: src`、`outDir: lib/types`，`composite: true` 从 `tsconfig.base.json` 继承。
- **聚合**：`tsconfig.host.json` 与 `tsconfig.client.json` 是两个 check unit；`packages/sdk/server` 属于 host 聚合（`tsconfig.host.json:280` 已登记 `{ "path": "./packages/sdk/server" }`）。
- **目录结构**（本 Phase 相关）：
  - `packages/sdk/server/` — SDK JSON-RPC server（consumer，本 Phase 修改对象）
  - `packages/specdev/specdev/` — SpecDev domain runtime（producer，被引用的目标）
  - `tsconfig.base.json` / `tsconfig.host.json` — 根级配置

## 3. Most Relevant Areas

| 文件 | 相关性 | 来源 |
|------|--------|:--:|
| `packages/sdk/server/tsconfig.json` | **本 Phase 修改点 1**：`references[]` 缺 `../../specdev/specdev` | 👁 |
| `packages/sdk/server/package.json` | **本 Phase 修改点 2**：`@deepseek-ai/dsh-specdev` 归属错误 | 👁 |
| `packages/sdk/server/src/server.ts` | 运行时 import 点（`server.ts:27`），不改动 | 👁 |
| `packages/specdev/specdev/tsconfig.json` | 被引用项目：`composite` 继承自 base（`true`） | 👁 |
| `packages/specdev/specdev/package.json` | 被引用包：`name`/`exports`/`types` 入口 | 👁 |
| `packages/specdev/specdev/src/dispatch.ts` | `attachOrchestratorMetadata` 定义点（`dispatch.ts:109`） | 👁 |
| `tsconfig.base.json` | `paths` 里 `@deepseek-ai/dsh-specdev → ./packages/specdev/specdev/src`（错误退化的根源） | 👁 |
| `tsconfig.host.json` | 已含 `specdev/specdev`（line 313）与 `sdk/server`（line 280）reference | 👁 |
| 同构参考：`packages/specdev/specdev-gate/tsconfig.json` 等 | 已正确引用 `../specdev`，作为对照 | 👁 |

## 4. Key Entry Points / Call Paths

调用链（运行时，不改动，仅供 verifier 复核）：

```
packages/sdk/server/src/server.ts:27
  import { attachOrchestratorMetadata } from '@deepseek-ai/dsh-specdev'   // 运行时 import，非 import type
        │
        ▼
server.ts:422  const specdev = this.ctx.get('specdev')   // 服务经 cordis 注入，非 import
server.ts:427  attachOrchestratorMetadata(handle.agent, active?.slug ?? `sdk-${sessionId}`)
        │
        ▼
packages/specdev/specdev/src/dispatch.ts:109
  export function attachOrchestratorMetadata(agent, slug) → attachSpecdevMetadata(agent, { role:'orchestrator', slug })
```

类型边界调用链（本 Phase 修复对象）：

```
tsc -b packages/sdk/server
  → packages/sdk/server/tsconfig.json (references[] 缺 specdev)
  → moduleResolution: bundler 解析 '@deepseek-ai/dsh-specdev'
  → 命中 tsconfig.base.json paths["@deepseek-ai/dsh-specdev"] = ["./packages/specdev/specdev/src"]
  → 把 specdev/src 整包纳入 sdk/server program → rootDir 越界 → 15×TS6059 + 15×TS6307
  → 修复后：走 project reference 的 .d.ts 输出，不再拉 src
```

## 5. Likely Impact Surface

| 改动文件 | 改动内容 | 风险 |
|---------|---------|:--:|
| `packages/sdk/server/tsconfig.json` | `references[]` 新增 `{"path":"../../specdev/specdev"}` | 🟢 低（纯配置，对齐既有 reference 写法） |
| `packages/sdk/server/package.json` | `dependencies` +`@deepseek-ai/dsh-specdev`，`peerDependencies` −该项，`devDependencies` −该项 | 🟢 低（依赖归属纠正，版本号不变 `workspace:^`） |

**不改动**：`server.ts` 源码、`packages/specdev/specdev/*`、`tsconfig.base.json`、`tsconfig.host.json`。

## 6. Existing Constraints / Conventions

- 所有内部依赖版本用 `workspace:^`，**不写字面量**（如 `0.1.3-alpha.1`）。
- Package tsconfig：`extends tsconfig.base.json`、`rootDir: src`、`outDir: lib/types`、`references[]` 引用 workspace 依赖（见 `packages/AGENTS.md` "Naming rules"）。
- `composite`/`declaration`/`incremental` 由 `tsconfig.base.json` 统一提供，各包 tsconfig 不重复声明。
- 跨 group 引用的相对路径写法：`packages/sdk/server` → 其他 group 用 `../../<group>/<pkg>`（如 `../../llm/llm`、`../../core/agent`、`../../subagent/subagent`）；同 group 兄弟用 `../<pkg>`（如 specdev-gate → `../specdev`）。
- project reference 是唯一正确的源码边界机制；`paths` 别名仅作 source-level resolution facade（`tsconfig.base.json:27-30` 注释明确 "Project references, not declaration path aliases, keep each package/vendor source compiled under its own tsconfig boundary"）。

## 7. Risks / Unknowns

- ✅ **CONFIRMED**：`packages/sdk/server/tsconfig.json` 当前 `references[]` 共 9 项，**不含** `../../specdev/specdev`。顺序：`../../../vendor/cordis`、`../../../vendor/schemastery`、`../../llm/llm`、`../../llm/llm-deepseek`、`../../core/agent`、`../../attachment/attachment`、`../../core/session`、`../protocol`、`../../subagent/subagent`。
- ✅ **CONFIRMED**：`extends` 指向 `../../../tsconfig.base.json`；`rootDir: src`；`outDir: lib/types`；`composite` 未在本文件声明，但**继承 base 的 `composite: true`**（`tsconfig.base.json:12`）。
- ✅ **CONFIRMED**：`@deepseek-ai/dsh-specdev` 当前在 `peerDependencies`（package.json line 42）**和** `devDependencies`（line 59）各出现一次，版本均为 `workspace:^`；**不在** `dependencies`。
- ✅ **CONFIRMED**：`@deepseek-ai/dsh-brand` 已在 `dependencies`（line 30），`@deepseek-ai/schemastery` 也在 `dependencies`（line 31）——dependencies 仅这两项。
- ✅ **CONFIRMED**：`server.ts:27` 是运行时 import（`import { attachOrchestratorMetadata } from '@deepseek-ai/dsh-specdev'`，无 `type` 关键字），在 `createSession()`（line 427）运行时调用。全文件仅此一个 specdev import 符号。
- ✅ **CONFIRMED**：`packages/specdev/specdev/tsconfig.json` 无显式 `composite`，但继承 base 的 `composite: true`；`declaration: true`（base line 9）；`rootDir: src`、`outDir: lib/types`。满足被 project reference 引用的前提。
- ✅ **CONFIRMED**：`packages/specdev/specdev/package.json` `name` = `@deepseek-ai/dsh-specdev`；`main` = `lib/index.js`；`types` = `lib/types/index.d.ts`；`exports["."]` = `{ types: ./lib/types/index.d.ts, default: ./lib/index.js }`。
- ✅ **CONFIRMED**：`tsconfig.base.json` paths 中 `"@deepseek-ai/dsh-specdev": ["./packages/specdev/specdev/src"]`（line 359）——这是错误退化把 src 拽进来的根源。
- ✅ **CONFIRMED**：`tsconfig.host.json` references 已含 `{ "path": "./packages/specdev/specdev" }`（line 313）与 `{ "path": "./packages/sdk/server" }`（line 280）——host 聚合层面 specdev 已登记，缺的是 sdk/server 自己的局部 reference。
- ✅ **CONFIRMED**：`../../specdev/specdev` 相对路径正确：从 `packages/sdk/server/` 出发 `../..` → `packages/`，再加 `specdev/specdev` 命中 `packages/specdev/specdev`；与既有 `../../llm/llm`、`../../core/agent` 写法一致。
- ⚠️ **HYPOTHESIS**：修复后 `tsc -b packages/sdk/server` 是否还残留其他结构性错误（如 specdev 自身依赖未构建）需 verifier 在干净树复核——本报告只确认 Phase 1 的目标错误（TS6059/TS6307）根因，未执行编译。

## 8. Uncertain / Unverified

- `attachOrchestratorMetadata` 内部调用的 `attachSpecdevMetadata` 与 specdev 其余符号（`defaultRolePrompt`、`dispatchSpecdevRole` 等）未逐个核验函数体，但 `attachOrchestratorMetadata` 本体已确认非空壳（`dispatch.ts:109-111` 真实委托）。
- 未执行 `pnpm run clean` + `tsc -b` 实测（code-explorer 只读，不做编译验证）；这是 verifier 的职责。

## 9. Stub Detection & Registry Cross-Validation

### Registry 校验结果

本工作流 `tech-debt-registry.md` 的「活跃债务」与「已解决」表均为空（无条目）。本次探索未发现桩代码。

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| — | — | — | — | — |

### Stub Detection Summary

- ✅ Confirmed stubs: 0 个
- ⚠️ Registry mismatch: 0 个
- 🔴 Unregistered stubs: 0 个（本 Phase 涉及的 `attachOrchestratorMetadata` 为真实实现，非桩）

## 10. Recommended Next Reads

1. ⭐ MUST READ — `packages/sdk/server/tsconfig.json`（本 Phase 修改点 1，references[] 新增位置）
2. ⭐ MUST READ — `packages/sdk/server/package.json`（本 Phase 修改点 2，依赖字段迁移）
3. 🔷 SHOULD READ — `packages/sdk/server/src/server.ts`（import 用法 + 运行时调用点，确认不改动）
4. 🔷 SHOULD READ — `packages/specdev/specdev/tsconfig.json` + `package.json`（确认被引用项目满足 composite/name/exports 前提）
5. 🔷 SHOULD READ — `packages/specdev/specdev-gate/tsconfig.json`（同构已正确引用 `../specdev` 的对照样例）
6. 🔹 OPTIONAL — `tsconfig.base.json`（paths 别名机制，理解错误退化根因）
7. 🔹 OPTIONAL — `tsconfig.host.json`（host 聚合 reference 全貌）
