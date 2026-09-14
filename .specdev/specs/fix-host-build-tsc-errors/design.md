# 方案设计：fix-host-build-tsc-errors

<!--
  slug: fix-host-build-tsc-errors
  audience: implementer / reviewer / verifier / HG-2
  language: zh (canonical)
  inputs: requirements.md（40 条错误清单 + AC-1~7 + FA-1~4 + 开放问题 Q-1~3）
  nature: bugfix（仅消除类型债与结构性配置缺口，不改运行时行为）
  HG-1 已拍板：
    Q-1 = all_fix（修全部 40 条；tests 目录是「修正测试类型」，非「从 host aggregate 排除」）
    Q-3 = ref_into_deps（sdk/server 加 project reference + specdev 从 peerDependencies 移入 dependencies）
    Q-2 = 由本方案阶段拍板（结论：纳入，见「决策 D-3」）
-->

## 范围覆盖

覆盖 requirements.md 中全部 4 个功能区域 FA-1~FA-4，对应 40 条 tsc 错误 + 1 条 tsdown 连锁症状。本设计按 `phase-plan.md` 拆成 4 个 Phase（3 个独立叶子 Phase + 1 个端到端集成 Phase），供 implementer/reviewer/verifier 逐 Phase 执行。

## 架构摘要

根因有 4 类、彼此独立：

1. **结构性 rootDir 越界（30 条）**：`packages/sdk/server` 在 `references[]` 缺少 `specdev` 的情况下做了运行时 import，TS 退化为 `paths` 别名解析，把 `packages/specdev/specdev/src` 整体拽进 sdk/server program，触发 15×TS6059 + 15×TS6307。
2. **真实类型债（2 条）**：`specdev-gate` 的三元表达式把 `undefined` 显式写进 `gitBranch` 可选属性，违反 `exactOptionalPropertyTypes`。
3. **测试文件类型债（8 条）**：`ide-bridge/tests`（1×TS2379 + 5×TS2769）与 `specdev/specdev-advance` tests（2×TS2352）在 host aggregate 直接 include 下未通过类型检查。
4. **tsdown 连锁症状（1 条）**：`command-specdev` 缺少自己的 `tsdown.config.ts`，回落到根 host entry 的 brace 展开；一旦 tsc 未 emit `index.js` 即报 "Cannot find entry"。

修复策略：修 1 处引用边界 + 1 处依赖声明（消 30 条）、1 处条件展开（消 2 条）、3 处测试断言补全（消 8 条）、补 1 个显式 tsdown 入口（硬化）。全部为「消除类型债/配置缺口」，不触碰运行时行为。

## 关键架构决策

### 决策 D-1：sdk/server 对 specdev 的 import 走 project reference（Q-3 = ref_into_deps）

- **选择**：在 `packages/sdk/server/tsconfig.json` 的 `references[]` 增加 `{ "path": "../../specdev/specdev" }`；同时把 `@deepseek-ai/dsh-specdev` 从 `peerDependencies` 移入 `dependencies`（保持 `workspace:^`），并从 `devDependencies` 移除冗余条目。
- **理由**：
  1. `server.ts:27` 是**运行时** import（`import { attachOrchestratorMetadata } from '@deepseek-ai/dsh-specdev'`），在 `createSession()` 中直接调用，性质等同 `@deepseek-ai/dsh-brand` 的 `brandString`（已在 `dependencies`），而非 Cordis host 注入的服务（`agent`/`session`/`subagent` 等才是 peer）。
  2. project reference 是仓库唯一允许的跨包源码引用通道（`tsconfig.base.json` 顶部注释明示）。加上 reference 后 TS 用 specdev 自身 composite 项目的 `.d.ts` 解析，不再走 `paths` 把 `src` 拽入 program，30 条 TS6059/TS6307 整体消失。
  3. 已用「`tsc -b packages/specdev/specdev` 单独构建 exit 0」佐证：specdev 自身无类型错误，纯属被错误引用牵连。
- **替代方案（否决）**：
  - *改为 type-only import / 延迟注入*：`attachOrchestratorMetadata` 是运行时行为，改成 `import type` 会导致运行期找不到符号；延迟注入会改变调用形态，超出「不改运行时行为」的范围。
  - *仅加 reference 不动 package.json*：reference 只解决类型边界，运行时 bundle 仍依赖 pnpm 能解析 specdev（现在挂在 peer 上，语义错误），不彻底。
  - *版本号用 `0.1.3-alpha.1`*：仓库所有内部 workspace 依赖一律 `workspace:^`（specdev 自身对外部 `zod` 才用 `^4.4.3`）。保持 `workspace:^` 才是「对齐仓库实际 specdev 版本」的正确语义。
- **版本号结论**：`dependencies` 新增 `"@deepseek-ai/dsh-specdev": "workspace:^"`，与仓库其余内部依赖一致。

### 决策 D-2：specdev-gate 用「条件展开」修 `gitBranch`（而非放宽类型）

- **选择**：把 `index.ts:127` 与 `:166` 的
  ```typescript
  evaluateRoleDispatch(role, auth, { gitBranch: role === 'implementer' ? gitReader(cwd) : undefined })
  ```
  改为
  ```typescript
  evaluateRoleDispatch(role, auth, {
    ...role === 'implementer' ? { gitBranch: gitReader(cwd) } : {},
  })
  ```
- **理由**：
  1. `GitBranchReader` 返回 `string | null`（`git-branch.ts:11` 确认），当 `role === 'implementer'` 时 `gitBranch` 为 `string | null`（合法），否则**整个键省略**，不产生 `undefined` 显式值。
  2. 该条件展开模式是仓库既定范式（`server.ts:168-169`、`ide-bridge/src/index.ts` 多处同款），零学习成本、零语义变化。
  3. **不动 `check.ts` 的类型契约**：`EvaluateRoleOptions.gitBranch` 保持 `readonly gitBranch?: string | null`；`evaluateImplementer` 里 `actual === undefined`（`check.ts:148`）仍严格表示「调用方省略了分支检查」这一 fail-closed 语义，不会被显式 `undefined` 污染。
- **替代方案（否决）**：把类型放宽为 `string | null | undefined` 会弱化契约——将来调用方可显式传 `undefined` 而掩盖意图，且 `actual === undefined` 的「省略」语义与「显式 undefined」语义混同。

### 决策 D-3：给 command-specdev 补显式 `tsdown.config.ts`（Q-2，纳入本方案）

- **选择**：新增 `packages/specdev/command-specdev/tsdown.config.ts`，内容与 4 个 specdev 兄弟包完全一致：
  ```typescript
  import { defineConfig } from 'tsdown'
  export default defineConfig({
    entry: ['lib/types/index.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  })
  ```
- **理由**：
  1. **对齐一致性**：`specdev` / `specdev-gate` / `specdev-advance` / `specdev-presets` 4 个兄弟包均已有该配置，仅 `command-specdev` 缺失（其 `src` 只有 `index.ts`，无 `invariant.ts`/`startup.ts`）。
  2. **消除 brace 展开脆弱性**：根 `tsdown.config.ts` 的 host entry 是 `['lib/types/{index,invariant,startup}.js']`，对「只有 index.js」的包而言，一旦 tsc 未 emit 就报 "Cannot find entry"；显式 `entry: ['lib/types/index.js']` 使入口意图明确、失败信息更清晰。
  3. **零运行时影响**：产物同为 `lib/index.js`，格式/目标/平台不变；command-specdev 无 typert 类型图，不涉及 typertPlugin 行为变化。
- **结论**：**纳入**。虽然它在「index.js 已存在」时并非跑绿的必要条件（requirements.md 已实证），但它是低风险的「tsdown 一致性硬化」，且让 FA-4 的端到端绿具备确定性。

## 逐文件改动清单

### FA-1（sdk/server ↔ specdev，消 30 条 TS6059/TS6307）

| 文件 | 改动 |
|------|------|
| `packages/sdk/server/tsconfig.json` | `references[]` 新增 `{ "path": "../../specdev/specdev" }`（放在 `../../subagent/subagent` 之前或之后，按现有顺序插在语义合适处） |
| `packages/sdk/server/package.json` | ① `dependencies` 新增 `"@deepseek-ai/dsh-specdev": "workspace:^"`（排在 `dsh-brand` 之后、`schemastery` 之前）；② `peerDependencies` 删除 `"@deepseek-ai/dsh-specdev": "workspace:^",`；③ `devDependencies` 删除 `"@deepseek-ai/dsh-specdev": "workspace:^",` |

- `server.ts:27` 的运行时 import **保持不变**——reference 只解决类型边界，运行时仍需 import `attachOrchestratorMetadata`。
- 相对路径核对：`packages/sdk/server` → `../..` = `packages/` → `specdev/specdev`，故为 `../../specdev/specdev`（与 `../../core/agent`、`../../llm/llm` 同构）。

### FA-2（specdev-gate gitBranch，消 2 条 TS2379）

| 文件 | 改动 |
|------|------|
| `packages/specdev/specdev-gate/src/index.ts` | 第 127-129 行与第 166-168 行两处 `evaluateRoleDispatch(role, auth, { gitBranch: ... : undefined })` 改为条件展开（见决策 D-2） |

- **不改** `check.ts` 的 `EvaluateRoleOptions.gitBranch` 类型与 `evaluateImplementer` 的 `undefined`/`null` 分支。

### FA-3（测试类型债，消 8 条）

| 文件 | 错误 | 修法 |
|------|------|------|
| `packages/ide/ide-bridge/tests/ide-bridge.spec.ts:380` | TS2379（`boundarySeq: options?.boundarySeq`） | `forked.push({ parent: parentSessionId, ...options?.boundarySeq === undefined ? {} : { boundarySeq: options.boundarySeq } })` |
| `packages/ide/ide-bridge/tests/ide-bridge.spec.ts` `:444/:480/:513/:545/:569` | 5×TS2769（`ctx.waterfall('approval/request'|'user-questions/request', …)` 载荷的 `agent` 是部分对象，不满足全量 `Agent`） | 引入 `import type { Agent } from '@deepseek-ai/dsh-agent'` + 顶部 `stubAgent(id, sessionId)` 助手（`return { id, session: { id: sessionId } } as unknown as Agent`），5 处 `agent: { id:…, session: { id:… } }` 替换为 `agent: stubAgent(…)` |
| `packages/specdev/specdev-advance/tests/specdev-advance.spec.ts:117` | TS2352（`{ nextAction; kind; version }` 断言为 `{ snapshot }` 缺字段） | `expect((data as unknown as { snapshot: unknown }).snapshot).toBeNull()` |
| `packages/specdev/specdev/tests/specdev.spec.ts:313` | TS2352（`{ options }` 断言为 `Agent` 缺字段） | `const agent = { options: {} as Record<string, unknown> } as unknown as Agent` |

- **判定「测试修正」而非「Events 类型声明补全」**：`approval/request`（`@deepseek-ai/dsh-user-approval/types.ts:76-90`）与 `user-questions/request`（`@deepseek-ai/dsh-user-questions/types.ts:76-90`）**均已**通过 `declare module '@deepseek-ai/cordis' { interface Events }` 声明，事件名与载荷类型**不缺**。错误本质是测试用「鸭子类型部分 agent」去喂全量 `Agent` 类型的 payload，属**测试侧断言补全**，不触碰任何 Events 声明。

### FA-4（端到端绿 + Q-2 硬化）

| 文件 | 改动 |
|------|------|
| `packages/specdev/command-specdev/tsdown.config.ts` | **新增**，内容见决策 D-3（与 4 个兄弟包一致） |

## Phase 拆分表

| Phase | id | 名称 | 范围 | 依赖 | 消错数 | AC |
|-------|----|------|------|------|:--:|:--:|
| Phase 1 | `phase-1-sdk-server-specdev-ref` | sdk/server ↔ specdev 引用边界 | FA-1 | 无 | 30 | AC-3 |
| Phase 2 | `phase-2-specdev-gate-gitbranch` | specdev-gate 类型修复 | FA-2 | 无 | 2 | AC-4 |
| Phase 3 | `phase-3-test-type-debt` | 测试文件类型修复 | FA-3 | 无 | 8 | AC-5 |
| Phase 4 | `phase-4-build-green-tsdown` | 构建端到端绿 + 硬化 | FA-4 + Q-2 | 1,2,3 | 1(tsdown) | AC-1,2,6,7 |

（完整 DAG 见 `phase-plan.md`。）

## 关键技术选择

- **参考基准**：`exactOptionalPropertyTypes` 下所有可选属性显式赋值都遵循「条件展开或省略」，本设计全量沿用（D-2、FA-3 的 `boundarySeq`）。
- **断言风格**：TS2352/TS2769 一律用 `as unknown as X` 双重断言，与仓库 `strict: true` + 禁止 `as any` 的既有约定一致（`specdev.spec.ts` 已有多处 `as unknown as` 先例）。
- **workspace 依赖版本**：内部依赖统一 `workspace:^`，不写 `0.1.3-alpha.1` 字面量。

## 风险

| 风险 | 等级 | 缓解 |
|------|:--:|------|
| specdev 从 peer→dependencies 改变 sdk-server 依赖图（bundle 体积/依赖图回退） | 低 | specdev 体积小、纯函数导出；`@deepseek-ai/dsh-brand` 已采用同模式（dependencies-only） |
| 删 devDependencies 中的 specdev 后 `test`/`test:coverage` 受影响 | 低 | vitest 走 source-plane + `paths` 别名，不依赖 package.json 依赖声明；specdev 仍在 workspace 内可解析 |
| 加 reference 后若 specdev 尚未被构建，sdk/server 的类型解析依赖 specdev 的 `.d.ts` | 低 | `tsc -b tsconfig.host.json` 按引用拓扑先构建 specdev（已在 host aggregate `references[]` 第 313 行注册），顺序有保证 |
| `stubAgent` 用 `as unknown as Agent` 掩盖未来 Agent 接口变更 | 低 | 测试仅消费 `id`/`session.id`（与 `resolveBridgeSessionId` 的鸭子类型一致）；Agent 接口变更会被 specdev 等其他测试覆盖 |

## 验证策略（供 verifier 独立执行）

| 命令 | 期望 | 对应 AC |
|------|------|:--:|
| `node --max-old-space-size=4096 ./node_modules/typescript/bin/tsc -b tsconfig.host.json` | exit 0，0 个 `error TSxxxx` | AC-1 |
| `pnpm run build:lib:host` | exit 0（tsc + tsdown 两阶段） | AC-2 |
| `tsc -b packages/sdk/server` | 0 个 TS6059/TS6307 | AC-3 |
| `tsc -b packages/specdev/specdev-gate` | 0 个 TS2379 | AC-4 |
| 上述 tsc 输出中 `packages/ide/ide-bridge/tests`、`packages/specdev/specdev/tests`、`packages/specdev/specdev-advance/tests` | 0 个 TS2379/TS2769/TS2352 | AC-5 |
| `tsdown --env.DSH_BUILD_FACE host` 后 `packages/specdev/command-specdev/lib/index.js` 存在 | 无 "Cannot find entry"，产物落盘 | AC-6 |
| 反向：人为破坏任一文件后重跑 `build:lib:host` | 返回非 0 + 可定位到具体包/文件 | AC-7 |
| `pnpm run test:coverage`（vitest source-plane） | 不回退（与修复前基线一致） | 约束 |

> 约束：pnpm postinstall 可能因 git 2.25.1 失败，验证时用 `./node_modules/.bin/tsc` / `./node_modules/.bin/tsdown` 直调绕过。

## 设计修订记录

| # | 日期 | 原设计章节 | 修改为 | 批准人 | 偏差来源 |
|---|------|-----------|--------|--------|---------|
| A1 | 2026-09-14 | §决策 D-3 | 「与 4 个 specdev 兄弟包完全一致」澄清为「与 3 个单入口兄弟包（specdev / specdev-gate / specdev-advance）逐字一致；specdev-presets 为双入口数组变体，command-specdev 因 src 仅含 index.ts 采用单入口形式」 | reviewer | implementation.md 偏差 1 |

## 建议的下一步

进入 Phase 1（`phase-1-sdk-server-specdev-ref`）实现；Phase 1/2/3 可并行，Phase 4 待前三者完成后启动。
