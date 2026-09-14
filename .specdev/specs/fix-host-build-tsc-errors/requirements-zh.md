# 需求文档：fix-host-build-tsc-errors

<!--
  slug: fix-host-build-tsc-errors
  audience: plan-generator / implementer / reviewer / verifier / HG-1
  language: zh (mirror of requirements.md)
  constitution: .specdev/specs/fix-host-build-tsc-errors/constitution.md
  nature: bugfix（修复根统一构建命令 build:lib:host 被预先存在的类型错误阻断，不改运行时行为）
-->

## 术语（全文统一）

| 术语 | 含义 |
|------|------|
| **host 面 / host aggregate** | 根 `tsconfig.host.json`：以 `noEmit` 聚合所有 host 侧 package 的 project references + 直接 include 测试文件，是两大 type-check 单元之一 |
| **project reference** | 每个 package 的 `tsconfig.json` 的 `references[]`，唯一允许跨包引用源码的正确通道 |
| **tsconfig paths 别名** | `tsconfig.base.json` 的 `paths`，把 `@deepseek-ai/dsh-*` 映射到各包 `src/`；若 import 一个不在 references 里的包，paths 会把被 import 包的源码拽入本包 program，触发 rootDir 越界 |
| **exactOptionalPropertyTypes** | 严格选项：可选属性一旦显式写出，值不能是 `undefined` |
| **中间产物 / 最终产物** | `tsc -b` emit 到 `lib/types/`（中间态），tsdown 打包到 `lib/`（最终态） |

## 产品目标

让根统一构建命令 `pnpm run build:lib:host` 在当前工作区**端到端跑绿（退出码 0）**：从干净树执行一次即可完成 host 侧全部类型检查与运行时打包，不再被预先存在的类型错误阻断。

## 问题陈述

`build:lib:host` 无法跑绿，被两类问题阻断：

1. **tsc 阶段失败（实测退出码 1）**：40 个类型错误（TS6059×15、TS6307×15、TS2379×3、TS2769×5、TS2352×2）。
2. **tsdown 阶段失败（退出码 1）**：`dsh-command-specdev` 报 `Cannot find entry: ["lib/types/{index,invariant,startup}.js"]`。

这阻塞了 `build:lib:host` → `build:lib` → `build`，以及 `typecheck`、`lint`、`lint:fix`、`doc-typecheck`。CI 覆盖率门禁 `test:coverage`（vitest，source-plane）不受影响。

## 目标终态

- `tsc -b tsconfig.host.json` 退出码 0，0 个 `error TSxxxx`。
- `pnpm run build:lib:host` 退出码 0（tsc + tsdown 均成功）。
- 不改变运行时行为、不引入 `@STUB`/占位实现。

## 目标用户

仓库维护者 / CI（需要 build/typecheck/lint 门禁稳定跑绿）；后续 feature 工作流（依赖 build:lib:host 作基线）。

## 核心场景

1. 干净克隆上 `pnpm install && pnpm run build:lib:host` 端到端跑绿。
2. CI 执行 `typecheck` / `lint` 不再因本组错误失败。
3. 后续 Phase 依赖 tsc 产出 `lib/types/` 供 tsdown 打包，产物齐全。

## 预期范围

- 范围内：修复 40 个类型错误；确保 tsdown 在 tsc 通过后正确打包（含 command-specdev）。
- 范围内（确认性质）：specdev-gate、ide-bridge/tests、specdev/tests、specdev-advance/tests、sdk/server 5 处。
- 边界待定：是否把 3 个测试文件纳入本轮（见 Q-1）。

## 完整错误清单（实测，40 条）

环境：Node 24.3.0，`tsc -b tsconfig.host.json`，退出码 **1**（上游报告为 2，实测为 1）。

### 分组 A — 结构性 rootDir 越界（30 条：TS6059×15 + TS6307×15）

- 触发点：`packages/sdk/server/src/server.ts:27` `import { attachOrchestratorMetadata } from '@deepseek-ai/dsh-specdev'`。
- 根因：`packages/sdk/server/tsconfig.json` 的 `references[]` 缺 `../../specdev/specdev`，TS 走 paths 别名把 specdev 整个 `src/*` 拽进 sdk/server program，rootDir 越界。
- 证据：`tsc -b packages/specdev/specdev` 单独构建 exit 0 —— specdev 自身无错。
- 类别：结构性（缺 project reference），非 specdev 源码类型债。

### 分组 B — specdev-gate 真实类型债（2 条：TS2379×2）

- `packages/specdev/specdev-gate/src/index.ts:127` 与 `:166`。
- 根因：`gitBranch: role === 'implementer' ? gitReader(cwd) : undefined` 类型 `string | null | undefined` 不满足 `EvaluateRoleOptions.gitBranch?: string | null`（exactOptionalPropertyTypes）。
- 类别：真实类型债。

### 分组 C — ide-bridge/tests 类型债（6 条：TS2379×1 + TS2769×5）

- `packages/ide/ide-bridge/tests/ide-bridge.spec.ts`：`:380`（boundarySeq undefined）、`:444`/`:480`/`:513`/`:545`/`:569`（ctx.waterfall 事件名/载荷不匹配 Events）。
- 类别：测试文件类型债。

### 分组 D — specdev 相关 tests 类型债（2 条：TS2352×2）

- `packages/specdev/specdev-advance/tests/specdev-advance.spec.ts:117`、`packages/specdev/specdev/tests/specdev.spec.ts:313`。
- 类别：测试文件类型债（断言需 `as unknown` 或修正）。

### tsdown 阶段诊断（实测）

- `index.js` 存在 → tsdown exit 0，正确产出 `lib/index.js`。
- `index.js` 缺失 → tsdown exit 1，报 `Cannot find entry: ["lib/types/{index,invariant,startup}.js"]`。
- 根因：command-specdev 无自己的 tsdown.config.ts（4 个 specdev 兄弟包都有），回落根配置 entry `{index,invariant,startup}`；只有 index.ts，index.js 缺失时 brace 展开匹配不到即报错。
- 结论：tsdown 失败是 tsc 未 emit 的连锁症状，非独立配置缺陷。

## 功能区域

- **FA-1 依赖边界修复**：sdk/server 对 specdev 的 import 走 project reference + 修正依赖声明，消掉 30 条 TS6059/TS6307。
- **FA-2 specdev-gate 类型修复**：gitBranch 实参 exactOptionalPropertyTypes 自洽，消掉 2 条 TS2379。
- **FA-3 测试文件类型修复**：3 个测试文件过类型检查，消掉 8 条错误（范围见 Q-1）。
- **FA-4 构建端到端绿**：build:lib:host（tsc + tsdown）exit 0，含 command-specdev 打包成功。

## 验收标准（EARS 格式）

- **AC-1**（普遍型）：`node --max-old-space-size=4096 ./node_modules/typescript/bin/tsc -b tsconfig.host.json` **必须**退出码 0，**必须**含 0 个 `error TSxxxx`。
- **AC-2**（普遍型）：`pnpm run build:lib:host` **必须**退出码 0（tsc + tsdown 均成功）。
- **AC-3**（普遍型）：`packages/sdk/server` **必须**产出 0 个 TS6059 与 0 个 TS6307；对 `@deepseek-ai/dsh-specdev` 的 import **必须**经 project reference 解析。
- **AC-4**（普遍型）：`packages/specdev/specdev-gate` **必须**产出 0 个 TS2379（gitBranch 实参不含 undefined）。
- **AC-5**（普遍型）：`ide-bridge.spec.ts`、`specdev.spec.ts`、`specdev-advance.spec.ts` 在 host aggregate 下 **必须**产出 0 个 TS2379/TS2769/TS2352。
- **AC-6**（事件驱动型）：**当** tsc 通过后执行 `tsdown --env.DSH_BUILD_FACE host` **时**，`dsh-command-specdev` **必须**能被正确打包，**必须不**报 `Cannot find entry`。
- **AC-7**（不期望行为型）：**如果** `build:lib:host` 任一步骤失败，**那么**命令 **必须**返回非 0 退出码且错误能定位到具体包与文件。

## 不在范围内（明确排除）

- 不改任何包的运行时行为；不引入 `@STUB`/`as any` 压平错误。
- 不重构 specdev 模块划分。
- 不触碰 client 面，除非 plan 论证强相关。
- 不处理 apps/vscode-dsh 构建产物问题（属 fix-vscode-dsh-build-outdir 范围）。

## 约束

- 遵守 constitution.md（无空壳、集成测试、端到端验证、无模糊 AC）。
- 遵守 AGENTS.md / packages/AGENTS.md：ESM、strict、exactOptionalPropertyTypes、project reference 唯一通道、source/artifact plane 分离、非平凡改动更新 Agent Note 与关键快照。
- Node 24.3.0；pnpm postinstall 可能失败，用 `./node_modules/.bin/tsc`/`tsdown` 直调。
- `pnpm run test:coverage` 不得回退。

## 开放问题

- **Q-1（范围）**：修全部 40 个错误，还是只修阻塞 build:lib:host 的最小集？tests 目录错误是「修正测试」还是「从 host aggregate 临时排除」？
- **Q-2（tsdown 一致性，非阻塞）**：是否给 command-specdev 补显式 tsdown.config.ts（entry: lib/types/index.js），对齐 4 个 specdev 兄弟包？
- **Q-3（依赖归属）**：server.ts 是运行时 import 但 specdev 在 peerDependencies；修复方向是「加入 references 并移入 dependencies」还是「改 type-only import / 延迟注入」？

## 风险/假设

- 假设：分组 A 由 sdk/server 缺 reference 单点触发，修复即可消掉 30 条（已用单独构建 exit 0 佐证）。
- 风险：specdev 移入 sdk/server dependencies 需确认 bundle 体积/依赖图无回退。
- 风险：ide-bridge/tests 的 waterfall 事件名可能暴露 Events 类型声明缺口，需更深补全。
- 假设：test/test:coverage（vitest）不受影响，但误改 paths/导出可能间接影响，需 verifier 复核。
- 测量差异：上游报告 tsc exit 2 / tsdown exit 1，实测为 exit 1 /（index.js 存在时）exit 0；以实测为准，实施阶段应以干净树复核。

## 建议的 Phase 拆分方向

- Phase A（结构性根因）：sdk/server ↔ specdev reference + 依赖声明，消 30 条。
- Phase B（真实类型债）：specdev-gate gitBranch，消 2 条。
- Phase C（测试类型债）：3 个测试文件，消 8 条（依赖 Q-1）。
- Phase D（构建端到端绿 + 可选硬化）：验证 exit 0；按 Q-2 决定是否补 command-specdev tsdown.config.ts。

依赖：A 无前置；B、C 可与 A 并行；D 依赖 A+B+C。
