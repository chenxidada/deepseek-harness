# Phase 1: 构建产物目录一致性修复

<!--
  slug: fix-vscode-dsh-build-outdir
  phase-id: phase-1-build-outdir
  upstream: ../../requirements.md (AC-1 ~ AC-11) + ../../design.md + ../../phase-plan.md
  language: zh (canonical)
-->

## 目标

让 `apps/vscode-dsh` 的「构建产物落盘位置」与 `package.json` 的 `main`/`types`/`exports`/`files` 四字段严格对齐；执行正确构建命令后，`main` 与 `exports["."].default` 从当前 `src/` 重新生成且含 editor-chat-panel；类型入口真实存在；`tsc -b apps/vscode-dsh` 仍 0 错误；既有 vitest 全绿；构建可复现、幂等、离线可跑。

## 前置条件

- 已读取 `requirements.md`（AC-1 ~ AC-11）与 `design.md`（决策 1/2/3）与 `phase-plan.md`（DAG JSON）。
- `tech-debt-registry.md` 当前为空（本次修复「构建路径错位」，不产生 `@STUB`；若发现必须推迟的关联构建债，注册 `DEBT-N`）。
- 依赖项目（`@deepseek-ai/dsh-ide-bridge`、`@deepseek-ai/dsh-sdk-client`、`@deepseek-ai/dsh-subprocess`、`@deepseek-ai/dsh-file-reference`）的声明已就绪——若打包中发现声明未产出，先跑根构建让 `tsc -b` 自动构建引用图（对应需求假设 A1）。

## 改动范围（文件清单）

| 文件 | 改动 | 性质 |
|------|------|------|
| `apps/vscode-dsh/tsdown.config.ts` | 新增，双入口打包配置，逐字段对齐 `apps/cli/tsdown.config.ts` | 新增 |
| `tsdown.config.ts`（根） | `workspace` 数组追加 `'apps/vscode-dsh'` | 修改 |
| `apps/vscode-dsh/package.json` | ① `files` 改 `lib/*.js`；② `scripts` 增 `build:host`；③ `vscode:prepublish`/`prepublishOnly` 链 host 构建；④ `devDependencies` 增 `tsdown` | 修改 |
| `apps/vscode-dsh/tsconfig.json` | **不改** | 无 |
| `apps/vscode-dsh/src/**` | **不改** | 无 |

### 关键配置要点（implementer 必须遵守）

1. **`apps/vscode-dsh/tsdown.config.ts`**：

```ts
import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['lib/types/extension.js', 'lib/types/index.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
```

   - `entry` 双入口：`lib/types/extension.js`（→ `lib/extension.js` = `main`）与 `lib/types/index.js`（→ `lib/index.js` = `exports["."].default`）。
   - `dts: false`：声明由 `tsc -b` 产出（`.d.ts` 留 `lib/types/`），与 `apps/cli` 一致。
   - 其余字段（`format`/`platform`/`target`/`fixedExtension`/`clean`）与 `apps/cli/tsdown.config.ts` **逐字段一致**。

2. **根 `tsdown.config.ts`**：仅把 `workspace` 改为 `['vendor/*', 'packages/*/*', 'apps/cli', 'apps/vscode-dsh']`；`entry`/`outDir`/`plugins` 等**不动**（`apps/vscode-dsh` 有包级 entry 覆盖根缺省 entry，无冲突）。

3. **`apps/vscode-dsh/package.json`**：
   - `files`: `["lib/*.js", "lib/types/**/*.d.ts", "media/**/*", "webview/dist/**/*"]`（`lib/index.js`/`lib/extension.js` 由 `lib/*.js` 覆盖，并覆盖 tsdown 共享 chunk）。
   - `scripts`: 增 `"build:host": "tsc -b && tsdown"`；`"vscode:prepublish": "pnpm run build:host && pnpm run webview:build"`；`"prepublishOnly": "pnpm run build:host && pnpm run webview:build"`。
   - `devDependencies`: 增 `"tsdown": "^0.22.2"`（与根同版本）。

## 验收标准（引用 requirements.md，不重写）

| AC | 类型 | 判定要点（摘要） |
|----|------|----------------|
| AC-1 | 普遍型 | 产物布局与 `main`/`types`/`exports`/`files` 一一对应，无「`.js`+`.d.ts` 同落 `lib/types/` 而入口指 `lib/`」错位 |
| AC-2 | 普遍型 | `main` 指向文件真实存在，且 `rg -l "EDITOR_CHAT_PANEL_VIEW_TYPE|createEditorChatPanelController|createWebviewPanel"` 命中 ≥1，非旧产物 |
| AC-3 | 普遍型 | `exports["."].default` 指向文件存在，且与 `main` 同源同次构建、不分裂 |
| AC-4 | 普遍型 | `types` 与 `exports["."].types` 指向的 `.d.ts` 由 tsc 生成且真实存在 |
| AC-5 | 普遍型 | `files` 覆盖所有被引用的运行时产物，vsce 打包不遗漏入口或依赖模块 |
| AC-6 | 事件驱动型 | 加载构建后扩展并触发「编辑窗口显示」，能从 `main` 产物解析 editor-chat-panel 完整可执行路径并成功创建 WebviewPanel |
| AC-7 | 普遍型 | `tsc -b apps/vscode-dsh` 仍 0 错误退出，无 `error TS` |
| AC-8 | 普遍型 | 既有 vitest 用例全绿，无新增失败 |
| AC-9 | 普遍型 | 干净树（删除 `lib/` 与 `lib/types/`）上正确构建命令可完整重建 |
| AC-10 | 普遍型 | 正确构建命令幂等，连续两次均成功且产物一致 |
| AC-11 | 不期望行为型 | 无 `DEEPSEEK_API_KEY`/无网络时 host 侧构建仍成功 |

## 验证策略

> 验证类型：**编译验证**（编译命令通过）/ **运行时验证**（构造输入→执行→检查输出，端到端）/ **fixture dry-run**（喂样例数据给脚本/hook）/ **静态检查**（grep/diff，仅非端到端时使用并标注）/ **回归验证**（确认既有功能未破坏）。

正确构建命令（Q-2 拍板）：**`pnpm run build:lib:host`**（根）。类型门禁（Q-2/AC-7 对应 `tsc -b apps/vscode-dsh`）：`cd apps/vscode-dsh && ../../node_modules/.bin/tsc -b --force`（Node 24.3.0 PATH，见 project-test skill）。

| AC | 验证类型 | 验证方法 | 预期结果 |
|----|---------|---------|---------|
| AC-1 | 静态检查 | 构建后读 `apps/vscode-dsh/package.json` 四字段，与落盘产物逐项比对：`main`=`lib/extension.js` 存在；`exports["."].default`=`./lib/index.js` 存在；`types`=`lib/types/extension.d.ts` 存在；`exports["."].types`=`./lib/types/index.d.ts` 存在；`files` 含 `lib/*.js` | 四字段指向的文件全部真实存在，无错位 |
| AC-2 | 运行时验证 | 构建后执行 `rg -l "EDITOR_CHAT_PANEL_VIEW_TYPE\|createEditorChatPanelController\|createWebviewPanel" apps/vscode-dsh/lib/extension.js` | 命中 `lib/extension.js`（≥1），非 grep 命中 0 的旧产物 |
| AC-3 | 运行时验证 | 构建后执行 `rg -l "EDITOR_CHAT_PANEL_VIEW_TYPE\|createEditorChatPanelController" apps/vscode-dsh/lib/index.js`；并与 `lib/extension.js` 的构建时间戳/内容同源比对 | `lib/index.js` 命中；两入口同次构建、同源，不分裂 |
| AC-4 | 静态检查 | 构建后 `ls apps/vscode-dsh/lib/types/extension.d.ts apps/vscode-dsh/lib/types/index.d.ts`；确认由 `tsc`（declaration）产出（文件头非 tsdown 产物） | 两个 `.d.ts` 均存在且为 tsc 声明输出 |
| AC-5 | 运行时验证（可选补充）+ 静态检查 | ① 静态：`files` 含 `lib/*.js`（glob 覆盖 entry+chunk）；② 可选：`vsce package`（或 `pnpm --filter @deepseek-ai/dsh-vscode-dsh exec vsce package`）后解包 .vsix，确认 `lib/extension.js`/`lib/index.js` 及其 chunk 均被包含 | vsce 产物不遗漏入口与依赖模块 |
| AC-6 | 运行时验证（端到端 smoke） | Node 加载构建后 `lib/index.js`（`import` 断言 `EDITOR_CHAT_PANEL_VIEW_TYPE`/`createEditorChatPanelController` 可达）；可选：注入 duck-typed vscode 调用 `activate()` 断言 `createWebviewPanel` 被调用且不抛错 | 符号可达、激活路径可解析 editor-chat-panel，无报错/无静默缺失 |
| AC-7 | 编译验证 | `cd apps/vscode-dsh && ../../node_modules/.bin/tsc -b --force`（Node 24.3.0 PATH） | 退出码 0，无 `error TS` 输出 |
| AC-8 | 回归验证 | `./node_modules/.bin/vitest run apps/vscode-dsh/tests/`（复用 project-test skill 已核实的直调方式） | 全绿，无新增失败用例 |
| AC-9 | 运行时验证 | `rm -rf apps/vscode-dsh/lib apps/vscode-dsh/lib/types` 后执行 `pnpm run build:lib:host`，再跑 AC-2/AC-4 检查 | 干净树完整重建所有运行时产物与类型声明 |
| AC-10 | 运行时验证（幂等） | 连续执行两次 `pnpm run build:lib:host`；比对两次 `apps/vscode-dsh/lib/{extension,index}.js` 的 hash/内容一致 | 两次均成功退出且产物一致，无脏差异 |
| AC-11 | 运行时验证 | 在 `env -u DEEPSEEK_API_KEY`（且断开网络）下执行 `pnpm run build:lib:host` | 成功完成，不因缺凭据/网络失败 |

## 约束（来自 design.md 与本 Phase 相关决策）

- 保持 `apps/vscode-dsh/tsconfig.json` 的 `outDir: "lib/types"` 不变（决策 1）；不改 `src/**`（决策 3，`src/index.ts` 已 re-export editor-chat-panel）。
- tsdown 配置逐字段对齐 `apps/cli/tsdown.config.ts`（仅 `entry` 为双入口数组）。
- 根 `tsdown.config.ts` 仅追加 workspace 成员，不改根 entry / outDir / plugins。
- 不引入运行时依赖；仅增 devDependency `tsdown`（决策 2）。
- 不改变运行时行为、不改 webview 源码与 `webview/dist/`、不新增功能。
- `lib/` 保持 gitignored，构建必须从干净树可重建（AC-9）、幂等（AC-10）、离线可跑（AC-11）。

## 产出清单

- [ ] `apps/vscode-dsh/tsdown.config.ts`（新增）
- [ ] `tsdown.config.ts`（根 workspace 追加）
- [ ] `apps/vscode-dsh/package.json`（files / scripts / devDependencies）
- [ ] `tech-debt-registry.md`（如有关联构建债则注册 `DEBT-N`，否则保持空）
- [ ] `.cursor/skills/project-build/SKILL.md`（回填 vscode-dsh host 侧 tsc→tsdown 产物链条目）
- [ ] `implementation.md`（implementer 写变更清单 + 偏差记录）
