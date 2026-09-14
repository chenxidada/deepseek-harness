# Phase 4: 构建端到端绿 + tsdown 硬化

## 目标

给 `packages/specdev/command-specdev` 补显式 `tsdown.config.ts`（对齐 4 个 specdev 兄弟包），并验证 `build:lib:host` 全链路（tsc + tsdown）端到端退出码 0。

## 前置条件（依赖的 spec 文件 + 已完成的 Phase）

- `requirements.md`（§FA-4、§AC-1/2/6/7、§Q-2）
- `design.md`（§决策 D-3、§逐文件改动清单 FA-4）
- 已完成：Phase 1（`phase-1-sdk-server-specdev-ref`）、Phase 2（`phase-2-specdev-gate-gitbranch`）、Phase 3（`phase-3-test-type-debt`）。

## 验收标准

- **AC-1**（普遍型）：`node --max-old-space-size=4096 ./node_modules/typescript/bin/tsc -b tsconfig.host.json` 必须以退出码 0 结束，输出中必须含 0 个 `error TSxxxx`。
- **AC-2**（普遍型）：`pnpm run build:lib:host` 必须以退出码 0 结束（tsc 阶段与 tsdown 阶段均成功）。
- **AC-6**（事件驱动型）：当 `tsc -b tsconfig.host.json` 通过后执行 `tsdown --env.DSH_BUILD_FACE host` 时，`@deepseek-ai/dsh-command-specdev` 必须能被正确打包，必须不报 `Cannot find entry`。
- **AC-7**（不期望行为型）：如果 `pnpm run build:lib:host` 任一步骤失败，那么该命令必须返回非 0 退出码，且错误信息必须能定位到具体包与文件。

## 验证策略（每条 AC 必须有对应的验证方案）

| AC | 验证类型 | 验证方法 | 预期结果 |
|----|---------|---------|---------|
| AC-1 | 编译验证 | 干净树后执行 `node --max-old-space-size=4096 ./node_modules/typescript/bin/tsc -b tsconfig.host.json` | 退出码 0；stdout/stderr 中 0 个 `error TS` |
| AC-2 | 运行时验证 | 干净树后执行 `pnpm run build:lib:host`（= `tsc -b tsconfig.host.json && tsdown --env.DSH_BUILD_FACE host`） | 退出码 0；两阶段均成功 |
| AC-6 | 编译验证 | 执行 `tsdown --env.DSH_BUILD_FACE host` 后检查 `packages/specdev/command-specdev/lib/index.js` | 文件存在且非空；输出无 `Cannot find entry` |
| AC-6 | 静态检查 | 读取 `packages/specdev/command-specdev/tsdown.config.ts` | 存在，且 `entry: ['lib/types/index.js']`（与 4 个兄弟包一致） |
| AC-7 | 运行时验证（反向） | 临时破坏任一已修复文件（如删除 `command-specdev/lib/types/index.js` 或注入一个类型错误）后重跑 `build:lib:host` | 返回非 0 退出码，错误信息含具体包名/文件路径 |
| AC-2 | 回归验证 | 执行 `pnpm run test:coverage`（vitest source-plane） | 与修复前基线一致，不回退 |

> 说明：verifier 必须从**干净树**开始（`pnpm run clean` 或 `tsx scripts/clean.ts`），先清空 `lib/` / `lib/types/` 产物再跑全链，确保不是依赖陈旧产物「假绿」。若 pnpm postinstall 因 git 版本失败，用 `./node_modules/.bin/tsc` / `./node_modules/.bin/tsdown` 直调绕过。

## 约束（来自 design.md 中与本 Phase 相关的架构决策）

- `tsdown.config.ts` 内容与 `specdev` / `specdev-gate` / `specdev-advance` / `specdev-presets` 完全一致（`entry: ['lib/types/index.js']`、`outDir: 'lib'`、`format: ['esm']`、`platform: 'node'`、`target: 'es2024'`、`fixedExtension: false`、`dts: false`、`clean: false`）。
- 不改变 `command-specdev` 的产物形态（仍为 `lib/index.js`）。
- 不引入 `@STUB` / `as any`；Q-2 的硬化不改变运行时行为。

## 产出清单

- 新增 `packages/specdev/command-specdev/tsdown.config.ts`
