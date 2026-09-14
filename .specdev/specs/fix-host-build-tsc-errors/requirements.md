# 需求文档：fix-host-build-tsc-errors

<!--
  slug: fix-host-build-tsc-errors
  audience: plan-generator / implementer / reviewer / verifier / HG-1
  language: zh (canonical)。镜像：requirements-zh.md
  constitution: .specdev/specs/fix-host-build-tsc-errors/constitution.md
  nature: bugfix（修复根统一构建命令 build:lib:host 被预先存在的类型错误阻断，不改运行时行为）
  root cause: (1) packages/sdk/server 在无 project reference 的情况下 import @deepseek-ai/dsh-specdev，
             经由 tsconfig paths 把 specdev 整个 src 拉进 sdk/server program，产生 30 个 TS6059/TS6307；
             (2) packages/specdev/specdev-gate 在 exactOptionalPropertyTypes 下 gitBranch 实参含 undefined（2 个 TS2379）；
             (3) 3 个测试文件在 host aggregate 下存在 TS2379/TS2769/TS2352（8 个）；
             (4) tsdown 阶段 dsh-command-specdev 缺 lib/types 入口，是 tsc 未 emit 的连锁症状。
-->

## 术语（全文统一）

| 术语 | 含义 | 首次括注 |
|------|------|----------|
| **host 面 / host aggregate** | 根 `tsconfig.host.json`：以 `noEmit` 聚合所有 host 侧 package 的 project references + 直接 include `packages/*/*/tests/**/*.ts` 等测试文件，是两大 type-check 单元之一（另一为 client 面） | host aggregate |
| **project reference** | 每个 package 的 `tsconfig.json` 的 `references[]`，是唯一允许跨包引用源码的正确通道（见 `tsconfig.base.json` 顶部注释） | project reference |
| **tsconfig paths 别名** | `tsconfig.base.json` 的 `compilerOptions.paths`，把 `@deepseek-ai/dsh-*` 映射到各包 `src/`，仅供解析 facade；一旦某包 import 一个**不在其 references** 里的包，paths 会把被 import 包的源码直接拽入本包 program，触发 rootDir 越界 | tsconfig paths alias |
| **exactOptionalPropertyTypes** | `tsconfig.base.json` 开启的严格选项：可选属性一旦显式写出，值**不能**是 `undefined` | exactOptionalPropertyTypes |
| **中间产物 / 最终产物** | 仓库统一约定：`tsc -b` 把 JS + `.d.ts` emit 到各包 `lib/types/`（中间态），再由 tsdown 把 runtime 打包到 `lib/`（最终态） | intermediate / final artifact |

## 产品目标

让根统一构建命令 `pnpm run build:lib:host`（= `node --max-old-space-size=4096 ./node_modules/typescript/bin/tsc -b tsconfig.host.json && tsdown --env.DSH_BUILD_FACE host`）在当前工作区**端到端跑绿（退出码 0）**。修复后，从干净树（`pnpm run clean` 后）执行一次该命令即可完成 host 侧全部类型检查与运行时打包，不再被预先存在、与本仓库其他工作流无关的类型错误阻断。

## 问题陈述

当前工作区的 `build:lib:host` 无法跑绿，被两类问题阻断：

1. **tsc 阶段失败（实测退出码 1）**：`tsc -b tsconfig.host.json` 产出 40 个类型错误（`TS6059`×15、`TS6307`×15、`TS2379`×3、`TS2769`×5、`TS2352`×2），分布在 4 个逻辑分组（详见「完整错误清单」）。
2. **tsdown 阶段失败（退出码 1）**：`dsh-command-specdev` 报 `Cannot find entry: ["lib/types/{index,invariant,startup}.js"]`。

这些问题**阻塞了整条构建/门禁链**：`build:lib:host` → `build:lib` → `build`，以及 `typecheck`、`lint`、`lint:fix`、`doc-typecheck`（这些脚本都以 `npm run build:lib:host` 为前置）。CI 覆盖率门禁 `test:coverage`（vitest）**不受影响**，因为它走 source-plane、不经 tsc build。

## 目标终态

- `node --max-old-space-size=4096 ./node_modules/typescript/bin/tsc -b tsconfig.host.json` 退出码 0，0 个 `error TSxxxx`。
- `pnpm run build:lib:host` 退出码 0（tsc + tsdown 两阶段均成功）。
- 不改变任何包的运行时行为、不引入 `@STUB`/占位实现，仅消除类型债与结构性配置缺口。

## 目标用户

- 仓库维护者 / CI：需要 `build`、`typecheck`、`lint` 等门禁能在干净树上稳定跑绿。
- 后续 feature 工作流：任何新改动依赖 `build:lib:host` 作为基线，当前阻断使基线不可用。

## 核心场景

1. 维护者在干净克隆上执行 `pnpm install && pnpm run build:lib:host`，命令端到端跑绿。
2. CI 执行 `typecheck` / `lint` 时不再因本组类型错误失败。
3. 后续 Phase 依赖 `tsc -b tsconfig.host.json` 产出 `lib/types/` 供 tsdown 打包，中间产物齐全、最终产物落盘正确。

## 预期范围

- **范围内**：修复 `tsc -b tsconfig.host.json` 的 40 个类型错误；确保 `tsdown --env.DSH_BUILD_FACE host` 在 tsc 通过后能正确打包（含 `dsh-command-specdev`）。
- **范围内（确认性质）**：`packages/specdev/specdev-gate`、`packages/ide/ide-bridge/tests`、`packages/specdev/specdev/tests`、`packages/specdev/specdev-advance/tests`、`packages/sdk/server` 这 5 处涉及的包/文件。
- **边界待定**：是否把 `ide-bridge/tests`、`specdev/tests`、`specdev-advance/tests` 3 个测试文件纳入本轮修复（见开放问题 Q-1）。

## 完整错误清单（实测，40 条）

诊断环境：Node 24.3.0，`tsc -b tsconfig.host.json`（`node --max-old-space-size=4096`），退出码 **1**（上游报告为 2，本次实测为 1）。

### 分组 A — 结构性 rootDir 越界（30 条：TS6059×15 + TS6307×15）

- **触发点**：`packages/sdk/server/src/server.ts:27` `import { attachOrchestratorMetadata } from '@deepseek-ai/dsh-specdev'`（运行时 import）。
- **根因**：`packages/sdk/server/tsconfig.json` 的 `references[]` **没有** `../../specdev/specdev`。于是 TS 走 `tsconfig.base.json` 的 paths 别名把 `packages/specdev/specdev/src/*`（index/dispatch/metadata/paths/phase-plan/projection/templates/wiki/git/review-merge/rerun/tech-debt/gate-reply/types/status 等）整体拽进 sdk/server program。因 sdk/server 的 `rootDir` 是 `src`，这些 specdev 源文件全部触发 TS6059/TS6307。
- **证据**：`tsc -b packages/specdev/specdev` 单独构建退出码 0 —— specdev 自身无类型错误，纯属被 sdk/server 错误引用导致的连带错误。
- **类别**：结构性（缺 project reference / 依赖声明），非 specdev 源码本身的类型债。

### 分组 B — specdev-gate 真实类型债（2 条：TS2379×2）

- `packages/specdev/specdev-gate/src/index.ts:127` 与 `:166`。
- **根因**：`evaluateRoleDispatch(role, auth, { gitBranch: role === 'implementer' ? gitReader(cwd) : undefined })`。三元表达式的类型是 `string | null | undefined`，而 `EvaluateRoleOptions.gitBranch` 声明为 `readonly gitBranch?: string | null`（见 `packages/specdev/specdev-gate/src/check.ts:22-25`）。在 `exactOptionalPropertyTypes: true` 下 `undefined` 不合法。
- **类别**：真实类型债（需条件构造 options 或调整类型）。

### 分组 C — ide-bridge/tests 类型债（6 条：TS2379×1 + TS2769×5）

- `packages/ide/ide-bridge/tests/ide-bridge.spec.ts`：`:380`（TS2379，`boundarySeq: options?.boundarySeq` 值为 `number | undefined` 不满足 `boundarySeq?: number`）、`:444`/`:480`/`:513`/`:545`/`:569`（TS2769，`ctx.waterfall('approval/request' | 'user-questions/...' , {...})` 的事件名/载荷不匹配 `Events` 类型映射）。
- **类别**：测试文件类型债（tests 目录，属 host aggregate 直接 include）。

### 分组 D — specdev 相关 tests 类型债（2 条：TS2352×2）

- `packages/specdev/specdev-advance/tests/specdev-advance.spec.ts:117`（TS2352：`{ nextAction; kind; version }` 断言为 `{ snapshot: unknown }` 缺少 `snapshot`）。
- `packages/specdev/specdev/tests/specdev.spec.ts:313`（TS2352：`{ options: Record<string, unknown> }` 断言为 `Agent` 缺少 id/session/inbox/status 等属性）。
- **类别**：测试文件类型债（需 `as unknown as X` 或修正断言）。

### tsdown 阶段诊断（实测）

- `tsdown --env.DSH_BUILD_FACE host`：当 `packages/specdev/command-specdev/lib/types/index.js` **存在**时退出码 0，且正确产出 `lib/index.js`（实测）。
- 当 `packages/specdev/command-specdev/lib/types/index.js` **缺失**时退出码 1，报错 `[@deepseek-ai/dsh-command-specdev] Cannot find entry: ["lib/types/{index,invariant,startup}.js"]`（已复现）。
- **根因**：`packages/specdev/command-specdev` **没有**自己的 `tsdown.config.ts`（其 4 个 specdev 兄弟包 specdev/specdev-gate/specdev-advance/specdev-presets 都有 `entry: ['lib/types/index.js']`），因此回落到根 `tsdown.config.ts` 的 host 面 entry `['lib/types/{index,invariant,startup}.js']`。该包只有 `index.ts`（无 `invariant.ts`/`startup.ts`），一旦 tsc 未 emit `index.js`，brace 展开匹配不到任何文件即报 "Cannot find entry"。
- **结论**：tsdown 失败是 **tsc 未 emit 的连锁症状**，非独立的 tsdown 配置缺陷。tsc 修复并通过后，`command-specdev` 的 `lib/types/index.js` 会被 emit，tsdown 即可通过（已由「index.js 存在时 exit 0」实证）。

## 功能区域

### FA-1 依赖边界修复（sdk/server ↔ specdev）

- 让 `packages/sdk/server` 对 `@deepseek-ai/dsh-specdev` 的 import 走 **project reference**（加入 `references[]`），并修正 `package.json` 依赖声明（当前 specdev 位于 `peerDependencies` + `devDependencies`，但 `server.ts` 是运行时 import）。
- 消掉分组 A 的 30 条 TS6059/TS6307。

### FA-2 specdev-gate 类型修复

- 让 `evaluateRoleDispatch` 的 `gitBranch` 实参在 `exactOptionalPropertyTypes` 下类型自洽，消掉分组 B 的 2 条 TS2379。

### FA-3 测试文件类型修复

- 让 `ide-bridge/tests`、`specdev/tests`、`specdev-advance/tests` 在 host aggregate 下通过类型检查，消掉分组 C + D 的 8 条错误（范围见 Q-1）。

### FA-4 构建端到端绿

- 保证 `build:lib:host`（tsc + tsdown）端到端退出码 0，含 `dsh-command-specdev` 打包成功。

## 验收标准（EARS 格式）

- **AC-1**（普遍型）：`node --max-old-space-size=4096 ./node_modules/typescript/bin/tsc -b tsconfig.host.json` **必须**以退出码 0 结束，输出中 **必须**含 0 个 `error TSxxxx`。
- **AC-2**（普遍型）：`pnpm run build:lib:host` **必须**以退出码 0 结束（tsc 阶段与 tsdown 阶段均成功）。
- **AC-3**（普遍型）：`packages/sdk/server` 的构建 **必须**产出 0 个 `TS6059` 与 0 个 `TS6307`；其对 `@deepseek-ai/dsh-specdev` 的 import **必须**经 project reference 解析，不得把 `packages/specdev/specdev/src` 拉入 sdk/server program。
- **AC-4**（普遍型）：`packages/specdev/specdev-gate` 的构建 **必须**产出 0 个 `TS2379`（`evaluateRoleDispatch` 的 `gitBranch` 实参在 `exactOptionalPropertyTypes` 下不含 `undefined`）。
- **AC-5**（普遍型）：`packages/ide/ide-bridge/tests/ide-bridge.spec.ts`、`packages/specdev/specdev/tests/specdev.spec.ts`、`packages/specdev/specdev-advance/tests/specdev-advance.spec.ts` 在 host aggregate 下 **必须**产出 0 个 `TS2379` / `TS2769` / `TS2352`。
- **AC-6**（事件驱动型）：**当** `tsc -b tsconfig.host.json` 通过后执行 `tsdown --env.DSH_BUILD_FACE host` **时**，`@deepseek-ai/dsh-command-specdev` **必须**能被正确打包，**必须不**报 `Cannot find entry`。
- **AC-7**（不期望行为型）：**如果** `pnpm run build:lib:host` 任一步骤失败，**那么**该命令 **必须**返回非 0 退出码，且错误信息 **必须**能定位到具体包与文件（保持可诊断性，不吞错）。

## 不在范围内（明确排除）

- 不改动任何包的**运行时行为**；本 bugfix 仅消除类型债与结构性配置缺口。
- 不引入 `@STUB` / 占位实现 / `as any` 宽泛降级来「压平」错误（见宪法 §1）。
- 不重构 specdev 的模块划分（分组 A 是引用边界问题，不是 specdev 内部设计问题）。
- 不触碰 client 面（`tsconfig.client.json` / `tsdown --env.DSH_BUILD_FACE client`），除非 plan 阶段论证其与本 bugfix 强相关。
- 不处理 `apps/vscode-dsh` 的构建产物问题（那是 `fix-vscode-dsh-build-outdir` 的范围）；本 bugfix 仅确保 vscode-dsh 作为 host reference 之一不再被整链失败拖累。

## 约束

- 必须遵守 `.specdev/specs/fix-host-build-tsc-errors/constitution.md`：无空壳、集成测试、端到端验证、无模糊 AC。
- 必须遵守仓库 `AGENTS.md` / `packages/AGENTS.md`：ESM、`strict: true`、`exactOptionalPropertyTypes`、project reference 是跨包引用的唯一通道、源码/产物 plane 分离、每次非平凡改动更新 Agent Note 与关键无 key 快照。
- Node 24.3.0；pnpm postinstall 可能因 git 2.25.1 失败，需用 `./node_modules/.bin/tsc` / `./node_modules/.bin/tsdown` 直调绕过。
- 修复后 `pnpm run test:coverage`（CI 覆盖率门禁）不得回退——它走 source-plane，本 bugfix 不应破坏其绿态。

## 开放问题

- **Q-1（范围）**：本轮是否修复**全部 40 个错误**，还是只修「阻塞 `build:lib:host` 的最小集」？其中 `ide-bridge/tests`（6 条）、`specdev/tests` + `specdev-advance/tests`（2 条）位于 `tests/` 目录、由 host aggregate 直接 include——是「修正测试类型」，还是「将 tests 目录临时从 host aggregate 排除」？后者改动范围更小但可能弱化类型门禁。
- **Q-2（tsdown 一致性，非阻塞）**：是否给 `packages/specdev/command-specdev` 补一个显式 `tsdown.config.ts`（`entry: ['lib/types/index.js']`），对齐其 4 个 specdev 兄弟包？当前它在「index.js 存在」时可正常打包，属硬化项，不是 `build:lib:host` 跑绿的必要条件。
- **Q-3（依赖归属，需 plan 拍板）**：`server.ts:27` 是运行时 import，但 specdev 当前声明为 `peerDependencies`。修复方向是「把 specdev 加入 `references[]` 并从 peerDependencies 移入 `dependencies`」，还是「改为 type-only import / 延迟注入」？这决定 sdk/server 与 specdev 的依赖边界，需在 HG-2 方案阶段确认。

## 风险/假设

- **假设**：分组 A 的 30 条错误全部由 sdk/server 缺 specdev reference 单点触发；修复该 reference 即可消掉，无需改动 specdev 源码。已用「`tsc -b packages/specdev/specdev` 单独构建 exit 0」佐证。
- **风险**：若把 specdev 从 sdk/server 的 peerDependencies 移入 dependencies，需确认 bundle 体积/依赖图无回退（sdk-server 是 stdio JSON-RPC server 插件）。
- **风险**：`ide-bridge/tests` 的 `ctx.waterfall(...)` 事件名可能引用了尚未声明进 `Events` 映射的自定义事件；「修正测试」可能反过来暴露 `Events` 类型声明缺口，需要更深的类型补全。
- **假设**：`test` / `test:coverage`（vitest，source-plane）不受本 bugfix 影响；若实现误改 tsconfig `paths` 或包导出，可能间接影响，需 verifier 独立复核。
- **测量差异**：上游报告 tsc「exit 2」，本次实测为 **exit 1**；tsdown 上游报告「exit 1」，本次在「index.js 存在」时为 **exit 0**。本需求以实测为准，但实施/验证阶段应再次以干净树复核最终退出码。

## 建议的 Phase 拆分方向

> 高层指引，供 plan-generator 决定；`/bugfix` 流程默认单 Phase，但可按依赖切分。

- **Phase A（结构性根因）**：sdk/server ↔ specdev 的 project reference + 依赖声明修复，消掉 30 条 TS6059/TS6307（FA-1）。这是最大单项，且独立于其他分组。
- **Phase B（真实类型债）**：specdev-gate `gitBranch`（2 条 TS2379，FA-2）。
- **Phase C（测试类型债）**：ide-bridge/tests + specdev/specdev-advance tests（8 条，FA-3），依赖 Q-1 的范围决策。
- **Phase D（构建端到端绿 + 可选硬化）**：验证 `build:lib:host` 全链路 exit 0（FA-4）；按 Q-2 决定是否补 command-specdev 的显式 tsdown.config.ts。

依赖关系：A 无前置；B、C 可与 A 并行；D 依赖 A+B+C 完成。
