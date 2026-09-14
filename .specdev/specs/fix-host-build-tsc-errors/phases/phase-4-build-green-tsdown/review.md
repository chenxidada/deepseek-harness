# Phase 4 审查报告

## 判决：PASS

## 逐条验收标准审查

| AC | 验收标准 | 审查结果 | 证据 |
|----|---------|:--:|------|
| AC-1 | `tsc -b tsconfig.host.json` 退出码 0，0 个 `error TSxxxx` | ✅ | 复现：`node --max-old-space-size=4096 ./node_modules/typescript/bin/tsc -b tsconfig.host.json` → `TSC_EXIT=0`，stdout/stderr 无 `error TS` |
| AC-2 | `pnpm run build:lib:host` 退出码 0（tsc + tsdown 两阶段） | ✅ | 复现直调串联：`tsc -b tsconfig.host.json && tsdown --env.DSH_BUILD_FACE host` → 两阶段均 exit 0（`TSC_EXIT=0`、`TSDOWN_EXIT=0`）。`pnpm run build:lib:host` 本身因宿主 git 2.25.1 < 2.26 触发 postinstall 失败，属环境问题，spec.md §说明 已允许直调绕过 |
| AC-6 | command-specdev 正确打包，不报 `Cannot find entry`，`lib/index.js` 存在且非空 | ✅ | 复现 tsdown 日志：`config file: .../command-specdev/tsdown.config.ts`、`entry: lib/types/index.js`（单入口，未回落到根 brace 展开）、`lib/index.js 19.67 kB`、`Build complete`；全量日志 `Cannot find entry` 计数 0；`lib/index.js` 实测 19672 字节（非空） |
| AC-6（静态） | `tsdown.config.ts` 存在，`entry: ['lib/types/index.js']` | ✅ | 文件存在，8 字段与 3 个单入口兄弟包逐字一致（见下表） |
| AC-7 | 任一步骤失败时非 0 退出码且错误可定位到包/文件 | ✅ | 反向复现：`mv` 掉 `lib/types/index.js` 后重跑 tsdown → `NEG_EXIT=1`，错误 `[UNRESOLVED_ENTRY] Cannot resolve entry module lib/types/index.js.` 精确指向 command-specdev 的 entry 文件 |

### 8 字段逐字一致性核验

新增 `packages/specdev/command-specdev/tsdown.config.ts` 与 `specdev` / `specdev-gate` / `specdev-advance` 三个单入口兄弟包逐字比对：

| 字段 | command-specdev | 3 个单入口兄弟包 | 一致 |
|------|----------------|-----------------|:--:|
| entry | `['lib/types/index.js']` | `['lib/types/index.js']` | ✅ |
| outDir | `'lib'` | `'lib'` | ✅ |
| format | `['esm']` | `['esm']` | ✅ |
| platform | `'node'` | `'node'` | ✅ |
| target | `'es2024'` | `'es2024'` | ✅ |
| fixedExtension | `false` | `false` | ✅ |
| dts | `false` | `false` | ✅ |
| clean | `false` | `false` | ✅ |

文件内容（含 import 行 + JSDoc 注释行）与兄弟包**逐字节一致**，未照抄 `specdev-presets` 的双入口数组变体（见 Amendments A1）。

## 桩检测报告

- **新增文件**（`tsdown.config.ts`）是纯 `defineConfig` 配置对象，无函数体，不存在空壳函数 / 硬编码返回 / 条件桩。
- 未引入 `@STUB` / `as any` / `(void)args`。
- 未手工伪造 `lib/types/index.js` 来掩盖 tsc 未 emit 的问题——该文件由 `tsc -b tsconfig.host.json` 通过 command-specdev 自身 composite `tsconfig.json`（`outDir: lib/types`）正常产出（实测 23165 字节，来自 tsc emit）。
- `src/index.ts` 已由 code-explorer（repo-exploration §9）确认无桩信号（601 行真实实现），本 Phase 未改动该文件。

**桩结论：0 个。**

## 集成连通性验证结果

1. **tsdown workspace 发现**：根 `tsdown.config.ts` `workspace: ['vendor/*', 'packages/*/*', ...]` 自动发现 command-specdev；复现日志确认 tsdown 对该包**优先采用包级配置**（`config file: .../command-specdev/tsdown.config.ts`），而非根默认的 brace 展开 entry。
2. **单入口生效**：日志 `entry: lib/types/index.js` 确认不再回落 `['lib/types/{index,invariant,startup}.js']`；失败信息由模糊的 brace 展开变为精确的 `[UNRESOLVED_ENTRY] Cannot resolve entry module lib/types/index.js.`（印证 design D-3 理由 2）。
3. **package.json 无需改动**（已确认）：`main: lib/index.js`、`exports["."].default: ./lib/index.js`、`files: [lib/index.js, lib/types/**/*.d.ts]`、`types: lib/types/index.d.ts` 全部正确指向产物。
4. **tsconfig.json 无需改动**（已确认）：`rootDir: src` + `outDir: lib/types` + 正确 references，tsc 正常 emit 中间产物。
5. **产物形态不变**：仍为 `lib/index.js`（esm/node/es2024），零运行时行为变化。

**结论：上下游连通，无断裂。**

## 发现的问题

### 🟢 optional（不阻塞，已通过 amendment 消解）

1. **文档措辞不精确**：spec.md §约束 与 design.md §决策 D-3 均表述「与 4 个 specdev 兄弟包完全一致」，但 `specdev-presets` 实际是**双入口数组变体**（`defineConfig([{ index }, { orchestrator-tool-policy }])`）。实现正确采用单入口形式（command-specdev 的 `src/` 只有 `index.ts`，无双入口需求）。已记录为 amendment A1（见下文），修正措辞为「与 3 个单入口兄弟包逐字一致」。

### 🟢 optional（环境提示，非代码缺陷）

2. **构建依赖 Node ≥ 22.18**：默认 shell 的 `node` 是 v20.16.0（低于 tsdown 0.22.2 的 engines `^22.18.0 || >=24.0.0`），此时 tsdown 会回退到未安装的可选 peer `unrun` 而报 `Failed to import module "unrun"`。用 `/usr/local/bin/node`（v24.3.0）执行即正常。这是环境约束，非本 Phase 改动引入，verifier 复现时需显式使用 Node 24.3.0。

## Registry 对照

- `tech-debt-registry.md` 为空（活跃债务 / 已解决 均无条目）。
- 本 Phase 无新增债（交付物为纯配置对象，无桩/空壳/缺失）。
- 无需新增条目，也无可关闭的已解决条目。

## Amendments 处理

本轮审查处理 1 个 amendment（对应 implementation.md 偏差 1）：

| 编号 | 日期 | 原始章节 | 变更内容 | 批准人 | 偏差来源 |
|------|------|---------|---------|--------|---------|
| A1 | 2026-09-14 | spec.md §约束、design.md §决策 D-3 | 澄清「与 4 个兄弟包完全一致」→「与 3 个单入口兄弟包（specdev / specdev-gate / specdev-advance）逐字一致；specdev-presets 为双入口变体，command-specdev 因 src 仅含 index.ts 采用单入口形式」 | reviewer | implementation.md 偏差 1 |

- 已写入 spec.md `## Amendments` 章节与 design.md `## 设计修订记录` 表。
- 该偏差合理：design.md §决策 D-3 给出的代码片段本身即单入口形式，实现与其逐字一致，产物形态不变，零运行时影响。

## 验证命令建议（给 verifier）

1. **环境**：显式使用 Node 24.3.0（`export PATH=/usr/local/bin:$PATH`；`node --version` 应为 v24.3.0），否则 tsdown 在 Node 20 下回退到缺失的 `unrun` 而失败。
2. **干净树**：先 `pnpm run clean`（或 `tsx scripts/clean.ts`）清空 `lib/` / `lib/types/`，再跑全链，排除陈旧产物假绿。
3. AC-1：`node --max-old-space-size=4096 ./node_modules/typescript/bin/tsc -b tsconfig.host.json` → exit 0，0 个 `error TS`；建议追加 `--force` 全量重编译排除增量缓存假阳性。
4. AC-2：`node .../tsc -b tsconfig.host.json && ./node_modules/.bin/tsdown --env.DSH_BUILD_FACE host` → 两阶段均 exit 0（若 `pnpm run build:lib:host` 因 git postinstall 失败，属环境问题，用直调绕过）。
5. AC-6：tsdown 日志 grep 确认 `config file: .../command-specdev/tsdown.config.ts` + `entry: lib/types/index.js`；`lib/index.js` 存在且非空；`Cannot find entry` 计数 0。
6. AC-7 反向：临时 `mv packages/specdev/command-specdev/lib/types/index.js` 到别处 → 重跑 tsdown → exit 1 + `[UNRESOLVED_ENTRY] Cannot resolve entry module lib/types/index.js.`；验证后 `mv` 恢复，重新跑通全链回到绿态。
7. AC-2 回归：`pnpm run test:coverage`（vitest source-plane）与修复前基线一致，不回退（本 Phase 不改运行时，预期无回退）。
