# Phase 4 实现摘要：构建端到端绿 + tsdown 硬化

## 变更清单（文件列表）

| 文件 | 变更 |
|------|------|
| `packages/specdev/command-specdev/tsdown.config.ts` | **新增**（唯一交付物） |

内容（照抄 `specdev` / `specdev-gate` / `specdev-advance` 三个单入口兄弟包，逐字一致）：

```ts
import { defineConfig } from 'tsdown'

/** Bundle the package root from emitted TypeScript JS. */
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

## 对每个验收标准的实现说明

### AC-1（tsc 全量退出码 0，0 个 error TSxxxx）

- 补显式 `tsdown.config.ts` 后，`tsc -b tsconfig.host.json` 不受影响（tsdown 配置对 tsc 无副作用）。
- 实测：`node --max-old-space-size=4096 ./node_modules/typescript/bin/tsc -b tsconfig.host.json` 退出码 **0**，输出 0 个 `error TSxxxx`。
- 为排除 composite 增量缓存假阳性，额外执行 `--force` 全量重编译：退出码 **0**，`grep "error TS"` 命中 0 条（输出 `NO_ERRORS_FOUND`），耗时约 50.7s。

### AC-2（build:lib:host 退出码 0，tsc + tsdown 两阶段均成功）

- 直调串联等价链路（spec 允许的降级路径）：
  `node --max-old-space-size=4096 ./node_modules/typescript/bin/tsc -b tsconfig.host.json && ./node_modules/.bin/tsdown --env.DSH_BUILD_FACE host`
  退出码 **0**（`DIRECT_CHAIN_EXIT=0`），两阶段均成功。
- `pnpm run build:lib:host` 本身因宿主 git 2.25.1 < 2.26 触发 pnpm 依赖状态检查 → `install-lefthook.mjs` postinstall 失败而返回 exit 1。这是**环境问题**，非本 Phase 改动导致，且 requirements.md §约束 与 design.md 均明确允许用 `./node_modules/.bin/tsc` / `./node_modules/.bin/tsdown` 直调绕过。

### AC-6（command-specdev 正确打包，不报 Cannot find entry，lib/index.js 存在且非空）

- tsdown 日志确认使用包级配置：
  - `config file: .../packages/specdev/command-specdev/tsdown.config.ts`
  - `[@deepseek-ai/dsh-command-specdev] entry: lib/types/index.js`（单入口，不再回落到根 brace 展开）
  - `[@deepseek-ai/dsh-command-specdev] lib/index.js  19.67 kB │ gzip: 5.75 kB`
  - `✔ [@deepseek-ai/dsh-command-specdev] Build complete`
- 实测产物：`packages/specdev/command-specdev/lib/index.js` 存在，大小 **19672 字节**（非空）。
- 全量 tsdown 日志 `Cannot find entry` 计数 **0**。
- 静态检查：`tsdown.config.ts` 存在，`entry: ['lib/types/index.js']`。

### AC-7（任一步骤失败时非 0 退出码且错误可定位）

- 反向验证：临时 `mv` 掉中间产物 `lib/types/index.js` 后重跑 `tsdown --env.DSH_BUILD_FACE host`：
  - 退出码 **1**（`NEG_EXIT=1`）。
  - 错误信息精确可定位：
    ```
    ERROR  Error: Build failed with 1 error:
    [UNRESOLVED_ENTRY] Cannot resolve entry module lib/types/index.js.
    ```
    定位到 `@deepseek-ai/dsh-command-specdev` 包与其具体 entry 文件 `lib/types/index.js`。
  - 相比修复前根 brace 展开的模糊错误 `Cannot find entry: ["lib/types/{index,invariant,startup}.js"]`，显式单入口让失败信息更清晰（印证 design D-3 理由 2）。
- 验证后已 `mv` 恢复中间产物，并重新跑通直调链路，工作区回到绿态（`lib/index.js` 19672 字节存在，`Cannot find entry` 计数 0）。

## 测试结果（命令 + 输出）

| 验证项 | 命令 | 结果 |
|--------|------|------|
| AC-1 增量 | `node --max-old-space-size=4096 ./node_modules/typescript/bin/tsc -b tsconfig.host.json` | exit 0，0 error |
| AC-1 全量 | `... tsc -b tsconfig.host.json --force` | exit 0，`NO_ERRORS_FOUND` |
| AC-2 直调串联 | `tsc -b tsconfig.host.json && tsdown --env.DSH_BUILD_FACE host` | `DIRECT_CHAIN_EXIT=0` |
| AC-6 产物 | `ls -la packages/specdev/command-specdev/lib/index.js` | 19672 字节，非空 |
| AC-6 错误计数 | `grep -c "Cannot find entry" <tsdown log>` | 0 |
| AC-7 反向 | 删中间产物后 `tsdown --env.DSH_BUILD_FACE host` | `NEG_EXIT=1`，`UNRESOLVED_ENTRY: lib/types/index.js` |

> 说明：本 Phase 是构建产物验证，非功能验证，无需写功能集成测试。spec.md 明确 AC-2 回归验证（`pnpm run test:coverage`）归 verifier 在干净树独立执行。

## 偏差记录

### 偏差 1：未照抄 `specdev-presets` 的双入口数组变体

- **偏差描述**：design.md §决策 D-3 与 spec.md §约束 均表述「与 4 个 specdev 兄弟包完全一致」，但 `specdev-presets` 实际是**双入口数组变体**（`defineConfig([{ ...index }, { ...orchestrator-tool-policy }])`），并非单入口对象形式。实现时**照抄了单入口模板**（`specdev` / `specdev-gate` / `specdev-advance` 三个包），未照抄 `specdev-presets`。
- **影响范围**：design.md §决策 D-3（"与 4 个兄弟包完全一致" 表述不精确）、spec.md §约束。
- **原因**：`command-specdev` 的 `src/` 只有 `index.ts` 一个源文件（无 `invariant.ts` / `startup.ts` / `orchestrator-tool-policy.ts`），不存在第二个入口；`specdev-presets` 因有 `orchestrator-tool-policy.ts` 第二个入口才使用数组形式。照抄双入口数组反而会产生一个不存在的 entry 引用。repo-exploration §6 已明确此点并建议采用单入口形式。
- **影响**：无。产出配置与 design.md §决策 D-3 给出的代码片段**逐字一致**（该片段本身就是单入口形式），产物形态仍为 `lib/index.js`，运行时行为不变。

## 反桩 / 空壳自检

- 交付物是纯配置对象（`defineConfig`），无函数体，不存在空壳/桩代码。
- 未引入 `@STUB` / `as any`。
- 未改变 `command-specdev` 的产物形态（仍 `lib/index.js`）。
- `tech-debt-registry.md` 保持为空（无新增债，无需注册）。
