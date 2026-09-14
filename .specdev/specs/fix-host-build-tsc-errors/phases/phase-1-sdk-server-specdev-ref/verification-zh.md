# Phase 1 验证报告 — sdk/server ↔ specdev 引用边界修复

## 判决：PASS

AC-3 全部达成：`tsc -b packages/sdk/server --force` 退出码 0、0 个 TS6059/TS6307；sdk/server program 经 project reference 解析 specdev 的 `.d.ts`（`.tsbuildinfo` 引 `specdev/specdev/lib/types/*.d.ts`×15、引 `specdev/specdev/src`×0），根因（rootDir 越界）确已消除；运行时零变更（仅 2 个配置文件改动）。无 CRITICAL/MEDIUM 残余风险。

## 测试执行矩阵

| 场景 | 来源 | 命令 | 结果 | 证据 |
|------|:--:|------|:--:|------|
| AC-3 核心：构建退出码 0 | spec | `./node_modules/.bin/tsc -b packages/sdk/server --force` | ✅ | `TSC_EXIT_CODE=0`，stdout/stderr 无任何 `error TS` |
| AC-3：0 个 TS6059 / TS6307 | spec | 同上 `2>&1 \| grep -cE 'TS6059\|TS6307'` | ✅ | `TS6059_TS6307_COUNT=0` |
| AC-3：import 经 project reference 解析 | spec | 检查 `.tsbuildinfo` specdev 引用 | ✅ | `lib/tsconfig.tsbuildinfo` 引 `specdev/specdev/lib/types`×15，`specdev/specdev/src`×0 |
| AC-3：`references[]` 含 `../../specdev/specdev` | spec | 读 `tsconfig.json` | ✅ | 第 38-40 行 `{ "path": "../../specdev/specdev" }`（末尾新增 1 项） |
| AC-3：依赖归属正确 | spec | `node -e` 检查 package.json | ✅ | `dependencies` 含 specdev（`workspace:^`），peer/dev 均不含 |
| AC-3：`server.ts:27` 仍是运行时 import | spec | grep server.ts | ✅ | `import { attachOrchestratorMetadata } from '@deepseek-ai/dsh-specdev'`（无 `type` 关键字），`:427` 运行时调用 |

## 独立验证场景（你自己设计的）

| 场景 | 命令 | 结果 | 证据 |
|------|------|:--:|------|
| **V-IND-1 根因消除（引用边界）**：确认 sdk/server program 不再把 `specdev/src` 拽入 program，改用 specdev 自身 composite 产出的 `.d.ts` | 检查 sdk/server 两处 `.tsbuildinfo` 的 specdev 引用 | ✅ | 两个 `.tsbuildinfo` 均 `specdev/specdev/src`×0；`lib/tsconfig.tsbuildinfo` 引 `specdev/specdev/lib/types`×15 |
| **V-IND-2 产物层符号可达**：编译产物对 specdev 的 import 走包名而非相对 src 路径 | `grep specdev packages/sdk/server/lib/types/server.js` | ✅ | `import { attachOrchestratorMetadata } from '@deepseek-ai/dsh-specdev';`（包名解析，非 `../specdev/src`） |
| **V-IND-3 依赖归属全字段核验**：`dependencies` 含、`peerDependencies`/`devDependencies` 均不含、版本为 `workspace:^` | `node -e` 脚本 | ✅ | `IN_DEPS=true IN_PEER=false IN_DEV=false`；版本 `workspace:^` |
| **V-IND-4 运行时零变更（源码面）**：改动仅限 2 个配置文件，`src/` 零改动 | `git diff -- packages/sdk/server/src/` + `git diff --name-only` | ✅ | `src/` diff 为空；改动文件集合 = `package.json` + `tsconfig.json` 恰好 2 个 |
| **V-IND-5 符号定义与调用链完整**：`attachOrchestratorMetadata` 定义↔import↔调用三端一致 | `grep -n attachOrchestratorMetadata` | ✅ | `dispatch.ts:109` 定义 → `server.ts:27` 运行时 import → `server.ts:427` 调用 |
| **V-IND-6 回归抽查**：reference 未破坏 specdev 自身构建 | `./node_modules/.bin/tsc -b packages/specdev/specdev --force` | ✅ | `SPECDEV_EXIT_CODE=0` |

> `--force --listFiles` 曾出现 15 处 `specdev/specdev/src`，经核实属 specdev **自身**被作为 reference 重建时枚举其 own program 的源码文件（正确行为），非 sdk/server program 拽入；`.tsbuildinfo` 权威证据（`src`×0、`lib/types`×15）已澄清此点。

## Reviewer 建议的验证场景

| 场景 | 命令 | 结果 |
|------|------|:--:|
| 干净树复核（排除 `lib/types` 既有产物干扰） | `tsc -b packages/sdk/server --force`（`--force` 等价从零重编译） | ✅ exit 0，0 错误 |
| 静态核验 references 与依赖归属 | 读 `tsconfig.json` + `package.json` | ✅ |
| 运行时 import 核验 `server.ts:27` 无 `type` | grep | ✅ |
| 确认改动文件集合 = 2 个配置文件 | `git diff --name-only packages/sdk/server/` | ✅ |

## 端到端验证

| 数据路径 | 结果 | 证据 |
|------|:--:|------|
| tsc（类型边界）：`tsc -b packages/sdk/server --force` → sdk/server program → project reference → specdev 自身 composite 的 `.d.ts` → 0 个 TS6059/TS6307 | ✅ | exit 0；`.tsbuildinfo` 引 `.d.ts`×15、`src`×0 |
| 运行时边界（未改、仅复核）：`server.ts:27` import → `createSession()` `:427` 调用 `attachOrchestratorMetadata(handle.agent, slug)` → `dispatch.ts:109` 定义 | ✅ | 三端 grep 一致，产物 `server.js` 仍以包名 import |
| 依赖图：specdev 从 peer/dev 迁入 dependencies（`workspace:^`），与 `dsh-brand`（同为运行时 import、已在 dependencies）语义对齐 | ✅ | `node -e` 全字段核验通过 |

## 残余风险

| 风险 | 严重性 | 说明 |
|------|:--:|------|
| `tsc -b` 会向部分引用项目（如 `vendor/cordis/src/`）emit `.js`/`.d.ts`/`.map` 构建副产物 | 🟢 LOW | 仓库既有现象（project-build skill 已记录），非本 Phase 引入；HG-3 提交时只 add 2 个配置文件 |
| sdk/server tests 的 `const enum FiberState` source-plane 失败 | 🟢 LOW（与本 Phase 无关） | 属 vendored cordis source-plane 约束（`const enum` 不产运行时对象），本 Phase 仅改配置文件、零运行时改动，无法触发或影响该路径 |
| 全链 `build:lib:host` 端到端绿 | （不适用本 Phase） | 属 Phase 4 的 AC-1/AC-2 范围，本 Phase 仅验收 AC-3 |

## 已知问题清单（无）

无 CRITICAL / MEDIUM 残余问题。判决为 PASS 的理由：AC-3 的四条子项（构建 0 错误、project reference 解析、依赖归属、运行时 import 保留）全部由**独立执行证据**验证；根因（sdk/server program 拽入 specdev/src 导致 rootDir 越界）已通过 `.tsbuildinfo` 权威证据确认消除（`src`×0、`.d.ts`×15）；运行时零变更由 `git diff` 源码面核实。

## Pipeline 合规检查

- ✅ 本 Phase 的非 specs 改动（`packages/sdk/server/tsconfig.json` + `packages/sdk/server/package.json`）均在 `impl-phase-1-sdk-server-specdev-ref` 分支上（`git branch --show-current` 确认）。
- ⚠️ 工作区另含其他 workflow 的未提交改动（`apps/vscode-dsh/**`、`tsdown.config.ts`、若干 `.specdev/specs/vscode-dsh-*` 文件），与本 Phase 无关（review.md 已注明）；HG-3 提交时只 `git add` 本 Phase 的 2 个文件。

## 验证脚本

- 落盘脚本：`.specdev/specs/fix-host-build-tsc-errors/phases/phase-1-sdk-server-specdev-ref/test-scripts/verify-phase1.sh`
- 运行结果：**11 passed, 0 failed**（exit 0），覆盖 Node 版本、AC-3 核心、引用边界、依赖归属、运行时零变更、回归抽查共 6 组检查。

```bash
export PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH
bash .specdev/specs/fix-host-build-tsc-errors/phases/phase-1-sdk-server-specdev-ref/test-scripts/verify-phase1.sh
```
