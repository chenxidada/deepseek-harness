# 仓库调研报告 — Phase 4：构建端到端绿 + tsdown 硬化

## 1. 任务上下文

Phase 4（`phase-4-build-green-tsdown`）是 `fix-host-build-tsc-errors` bugfix 工作流的最后一个集成 Phase。范围很窄、只涉及单文件：给 `packages/specdev/command-specdev` 补一个显式的 `tsdown.config.ts`，使其对齐 3 个单入口的 specdev 兄弟包（`specdev` / `specdev-gate` / `specdev-advance`），然后从干净树端到端验证 `build:lib:host` 全链路（tsc `-b` + tsdown）退出码 0。

本 Phase **不**修复任何残留 tsc 类型错误——Phase 1–3 已消除 40 条 tsc 错误，tsdown 的 "Cannot find entry" 症状只是 tsc 未能 emit `lib/types/index.js` 的下游连锁后果。Phase 4 的职责是确定性硬化（决策 D-3）加上 AC-1/2/6/7 的验收验证。本报告需要支撑的验收标准：

- **AC-1**：`node --max-old-space-size=4096 ./node_modules/typescript/bin/tsc -b tsconfig.host.json` 以退出码 0 结束，0 个 `error TSxxxx`。
- **AC-2**：`pnpm run build:lib:host` 退出码 0（tsc 与 tsdown 两阶段均成功）。
- **AC-6**：tsc 通过后，`tsdown --env.DSH_BUILD_FACE host` 打包 `@deepseek-ai/dsh-command-specdev` 不报 `Cannot find entry`；产出 `lib/index.js`；存在 `tsdown.config.ts` 且 `entry: ['lib/types/index.js']`。
- **AC-7**：`build:lib:host` 任一步失败返回非 0，且能定位到具体包/文件。

## 2. 仓库概览

- **语言 / 运行时**：TypeScript（全仓 ESM，`"type": "module"`），Node `^22.19 || >=24`，`strict: true` + `exactOptionalPropertyTypes` + `noImplicitAny`（经 `tsconfig.base.json`）。
- **包管理**：pnpm 11.7.0 workspaces（`packages/*/*`、`vendor/*`、`apps/*`、`native/*`、`website`）。
- **打包器**：`tsdown` `^0.22.2`（基于 esbuild，workspace 模式）。`typescript` `^6.0.3`。
- **构建模型**（仓库统一的「中间产物 / 最终产物」划分）：
  1. `tsc -b <aggregate>` 类型检查并把**中间** JS + `.d.ts` emit 到各包 `lib/types/`（各包自己的 `outDir`）。
  2. `tsdown` 把 emit 出来的 JS 打包成**最终**的 `lib/index.js`。
- **相关子树**：`packages/specdev/` 下有 5 个包——`specdev`、`specdev-gate`、`specdev-advance`、`command-specdev`、`specdev-presets`。5 个包都注册为 host aggregate 的 project reference（`tsconfig.host.json` 313–317 行）。

## 3. 最相关区域

| 文件 | 作用 | 来源 |
|------|------|:--:|
| `packages/specdev/command-specdev/tsdown.config.ts` | **待创建**（唯一交付物） | — |
| `packages/specdev/specdev/tsdown.config.ts` | 模板（单入口） | 👁 已读 |
| `packages/specdev/specdev-gate/tsdown.config.ts` | 模板（单入口） | 👁 已读 |
| `packages/specdev/specdev-advance/tsdown.config.ts` | 模板（单入口） | 👁 已读 |
| `packages/specdev/specdev-presets/tsdown.config.ts` | 模板（双入口数组变体） | 👁 已读 |
| `packages/specdev/command-specdev/package.json` | `main`/`types`/`exports`/`files` 指向 `lib/index.js` + `lib/types/` | 👁 已读 |
| `packages/specdev/command-specdev/tsconfig.json` | `rootDir: src`、`outDir: lib/types`、`include: ["src"]`、refs cosmokit/cordis/commands/specdev | 👁 已读 |
| `packages/specdev/command-specdev/src/index.ts` | 唯一源文件（无 `invariant.ts`/`startup.ts`） | 👁 已读 |
| `tsdown.config.ts`（根） | workspace 模式 host/client 配置，含 brace 展开的默认入口 | 👁 已读 |
| `tsconfig.host.json`（根） | host aggregate；`references` 含 command-specdev | 👁 已读 |
| `package.json`（根） | `build:lib:host` 脚本定义 | 👁 已读 |
| `.specdev/specs/fix-host-build-tsc-errors/tech-debt-registry.md` | 空注册表（交叉验证输入） | 👁 已读 |

## 4. 关键入口 / 调用路径

### 4.1 `build:lib:host` 链路（根 `package.json:23`）

```
pnpm run build:lib:host
  └─ node --max-old-space-size=4096 ./node_modules/typescript/bin/tsc -b tsconfig.host.json
  │    ├─ 按依赖拓扑构建所有被引用的 project（composite）
  │    │    ├─ ... → packages/specdev/command-specdev  （引用见 tsconfig.host.json:316）
  │    │    │      └─ emit lib/types/index.js + lib/types/index.d.ts（tsconfig outDir: lib/types）
  │    │    └─ ...（specdev / specdev-gate / specdev-advance / specdev-presets，313-317 行）
  │    └─ aggregate 对 tests/scripts 的 include glob 做 noEmit 类型检查
  └─ tsdown --env.DSH_BUILD_FACE host
       └─ 根 tsdown.config.ts：workspace ['vendor/*', 'packages/*/*', 'apps/cli', 'apps/vscode-dsh']
            └─ 对每个包：有本地 tsdown.config.ts ？ 用本地 : 用根 host 入口
                 └─ command-specdev（无本地配置）→ 根入口 ['lib/types/{index,invariant,startup}.js']
                      └─ glob 解析 lib/types/ → 打包 → lib/index.js
```

### 4.2 command-specdev 当前为何报 `Cannot find entry`

```
command-specdev 没有本地 tsdown.config.ts   （✅ 已确认）
  → tsdown 回落到根 host 入口：['lib/types/{index,invariant,startup}.js']
  → command-specdev 只 emit lib/types/index.js（无 invariant.js / startup.js）
  → 若 tsc 从未 emit lib/types/index.js，brace glob 匹配到 0 个文件 → "Cannot find entry"
```

因此根因**不是**独立的 tsdown 配置缺陷：而是 brace 展开的默认入口撞上了「只产出 index.js」的包，在 tsc（被 Phase 1–3 错误阻断）未能 emit 该文件时暴露出来。

### 4.3 修复效果（决策 D-3）

```
新增 packages/specdev/command-specdev/tsdown.config.ts，entry: ['lib/types/index.js']
  → tsdown 使用包本地单入口配置（优先级已由 3 个兄弟包证实）
  → 入口意图明确（无 brace 展开），失败信息指向确切文件
  → 产物不变：lib/index.js（esm/node/es2024），零运行时行为变化
```

## 5. 可能的影响面

| 区域 | 变更 | 风险 |
|------|------|:--:|
| `packages/specdev/command-specdev/tsdown.config.ts` | **新增**（单个新文件） | 低 |
| `packages/specdev/command-specdev/package.json` | **不变** — `main: lib/index.js`、`exports["."].default: ./lib/index.js`、`files: [lib/index.js, lib/types/**/*.d.ts]` 已正确 | 无 |
| `packages/specdev/command-specdev/tsconfig.json` | **不变** — 已是 `outDir: lib/types` + `rootDir: src` + 正确 refs | 无 |
| `packages/specdev/command-specdev/src/index.ts` | **不变** | 无 |
| 根 `tsdown.config.ts` / `tsconfig.host.json` / `package.json` | **不变** | 无 |

交付物是一个纯新增的配置文件。它不改变 emit 出的 bundle 形态（`lib/index.js`、`format: esm`、`platform: node`、`target: es2024`），因此运行时行为不变——满足 bugfix 宪法「不改运行时行为」。

## 6. 现有约束 / 惯例

- **8 字段模板在 4 个兄弟包间完全一致。** 字段*值*处处相同：`outDir: 'lib'`、`format: ['esm']`、`platform: 'node'`、`target: 'es2024'`、`fixedExtension: false`、`dts: false`、`clean: false`。`entry` 目标也始终是 `lib/types/index.js`。
- **⚠️ 细微差异 — design.md/spec.md 里「4 个兄弟包完全一致」的说法不够精确。** 其中 3 个包（`specdev`、`specdev-gate`、`specdev-advance`）用单对象形式：
  ```ts
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
  `specdev-presets` 用**双入口数组**形式（`index.js` + `orchestrator-tool-policy.js`），背后是带 `as const` 注解的 `shared` 常量：
  ```ts
  const shared = { outDir: 'lib', format: ['esm'] as const, platform: 'node' as const, target: 'es2024', fixedExtension: false, dts: false, clean: false }
  export default defineConfig([
    { ...shared, entry: ['lib/types/index.js'] },
    { ...shared, entry: ['lib/types/orchestrator-tool-policy.js'] },
  ])
  ```
  **对 command-specdev，正确模板是单入口形式**（它只有 `src/index.ts`）。**不要**照抄 `specdev-presets` 的双入口数组。
- **注释横幅惯例**：3 个单入口包都带 JSDoc 行 `/** Bundle the package root from emitted TypeScript JS. */`。新文件应匹配这一仓库风格（design D-3 的片段省略了它，但与 3 个真实兄弟包保持一致意味着应加上——implementer 应按兄弟文件逐字照抄）。
- **tsdown workspace 模式的包本地配置优先级**已在仓库内被证实：4 个兄弟包各自都带着与根 brace 入口不同的本地配置，且都正确构建到 `lib/index.js`。command-specdev 只是恢复对齐。
- **`build:lib:host` 是门禁依赖**：`build`、`typecheck`、`lint`、`lint:fix`、`doc-typecheck` 都以 `npm run build:lib:host` 为前置（根 `package.json`）。`test:coverage`（vitest，source-plane）**不**经过它。

## 7. 风险 / 未知

- ✅ **已确认** — `command-specdev` 没有 `tsdown.config.ts`（shell `ls` 显示该文件不存在；只有 `package.json`、`tsconfig.json`、`src/`、`tests/`、`lib/`、`node_modules/`、`README*`）。
- ✅ **已确认** — `src/` 下恰好只有 1 个源文件 `index.ts`；没有 `invariant.ts` 或 `startup.ts`。因此根 brace 入口 `{index,invariant,startup}` 永远只会匹配到 `index`。
- ✅ **已确认** — `tsconfig.host.json` 在 `references` 里包含 `{ "path": "./packages/specdev/command-specdev" }`（316 行），所以 `tsc -b tsconfig.host.json` 会经该包自己的 composite `tsconfig.json`（`outDir: lib/types`）emit `lib/types/index.js`。顶层 `noEmit: true` 只作用于 aggregate 自己的 `include` glob（tests/scripts），不影响被引用项目。
- ✅ **已确认** — 根 `build:lib:host` = `node --max-old-space-size=4096 ./node_modules/typescript/bin/tsc -b tsconfig.host.json && tsdown --env.DSH_BUILD_FACE host`（根 `package.json:23`）。
- ✅ **已确认** — 根 `tsdown.config.ts` 的 `workspace: ['vendor/*', 'packages/*/*', 'apps/cli', 'apps/vscode-dsh']` 包含 `packages/*/*`，所以即便没有本地配置，command-specdev 也会被自动发现。
- ⚠️ **假设** — `entry: ['lib/types/{index,invariant,startup}.js']` 的确切 brace/glob 解析语义（仅在 `lib/types/index.js` 缺失时才匹配 0 文件并报错）是从 `requirements.md` 记录的观测（「index.js 存在 → exit 0；index.js 缺失 → `Cannot find entry`」）加字面错误串推断的，本次未重新执行。对规划而言一致且可依赖，但 verifier 必须在干净树上重新确认。
- ⚠️ **假设** — 显式 `entry: ['lib/types/index.js']` 在文件缺失时会给出*更清晰*的失败信息（相较 brace 形式）是 design 的陈述意图，但仓库内未实测。这不影响正确性：`lib/types/index.js` 存在时两种形式打包结果一致。
- ⚠️ **假设** — 当前磁盘上的 `lib/index.js`（时间戳 13:58）相对 `lib/types/index.js`（15:49）是**陈旧**的：它由更早的一次 emit 打包而来。这证实 tsdown 之前确实为这个包运行过（不构成矛盾），但 verifier 必须从 `pnpm run clean` 开始，避免陈旧产物造成「假绿」（spec.md §说明已强制要求）。

## 8. 不确定 / 未核实

- **tsdown workspace 遍历顺序与优先级**（根 `tsdown.config.ts` 的 `workspace` + 包本地配置发现）：该*机制存在且对 4 个兄弟包有效*（它们有本地配置且构建正确），但底层 tsdown 内部实现（如何 glob `packages/*/*`、如何合并根与本地配置）**未**读 tsdown 源码。下游 agent 应把「新增本地 `tsdown.config.ts` 使 tsdown 对该包采用它」视为**仓库内先例已证实**，而非文档化的 tsdown 保证。
- **`tsdown` 版本相关 API**：`defineConfig`、`workspace`、`plugins`、`--env.DSH_BUILD_FACE` 的用法与根配置一致，且根配置已被 `build:lib:host` 实际执行。本方案不改变这些，故风险低。
- **`command-specdev` 运行时导出**（`name`、`inject`、`apply`，及辅助导出 `slugifyDescription`、`formatStatusReport`、`techDebtRegistryExists`、`constitutionExists`）：已读并确认为真实实现，但其*运行时*行为不是本 Phase 关注点，也未实际执行。不是桩（见 §9）。

## 9. 桩检测与注册表交叉验证

`tech-debt-registry.md` 是**空**的：活跃债务表与已解决表都只有占位 `—` 行。本工作流没有已注册的桩。

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| — | （无注册项） | 空 | n/a | — |

### Stub Detection Summary
- ✅ 已确认桩：**0**（注册表为空；本不应有）
- ⚠️ 注册表不匹配：**0**
- 🔴 未注册桩：**0**

**对 `command-specdev/src/index.ts`（601 行）的人工扫描**未发现任何桩信号：
- 无 `(void)args` / 空函数体；每个导出函数都有真实逻辑。
- 无硬编码 `return Ok(0) / return [] / return true` 占位。
- 无 `@STUB(...)` 标记。`STUB-001`、`STUB-002`、`Q-3` 这几个 token **只出现在 JSDoc/docstring 注释里**（195、300 行），是已关闭项的历史引用（"AC-17 / STUB-001"、"Q-3 / STUB-002 closed"）——这些**不是**活跃桩，正确地未出现在空注册表中。

**给审查阶段的提示**：因为 Phase 4 的交付物是配置文件（而非源码），reviewer 应额外确认新增 `tsdown.config.ts` **不**引入任何桩式构造（不会——它是纯 `defineConfig` 对象），且没有为掩盖 tsc 未 emit 而手工编写 `lib/types/index.js`（它必须来自 tsc）。

## 10. 推荐后续阅读

1. ⭐ 必读 — `packages/specdev/specdev/tsdown.config.ts`（要逐字照抄的精确单入口模板）
2. ⭐ 必读 — `packages/specdev/command-specdev/tsconfig.json`（确认 `outDir: lib/types`；无需改动）
3. ⭐ 必读 — `tsdown.config.ts`（根；理解要被避开的 brace 入口与 workspace 发现）
4. 🔷 应读 — `packages/specdev/command-specdev/package.json`（确认 `main`/`exports`/`files` 已指向 `lib/index.js`）
5. 🔷 应读 — `tsconfig.host.json` 313–317 行（确认 5 个 specdev 包都是 reference）
6. 🔷 应读 — `.specdev/specs/fix-host-build-tsc-errors/phases/phase-4-build-green-tsdown/spec.md`（AC-1/2/6/7 + 干净树验证说明）
7. 🔹 可选 — `packages/specdev/specdev-presets/tsdown.config.ts`（看双入口变体；对 command-specdev **不要**照抄其形态）
8. 🔹 可选 — `.specdev/specs/fix-host-build-tsc-errors/design.md` §决策 D-3（单入口配置的规范理由）
