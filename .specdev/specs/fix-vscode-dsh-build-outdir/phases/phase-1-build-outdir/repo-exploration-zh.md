# 代码库调研报告 — Phase 1：构建产物目录一致性修复

## 1. 任务背景

这是 bugfix `fix-vscode-dsh-build-outdir` 的 Phase 1，目标是把 `apps/vscode-dsh` 的「构建产物落盘位置」与 `package.json` 的入口字段（`main` / `types` / `exports` / `files`）严格对齐。根因：`apps/vscode-dsh/tsconfig.json` 的 `outDir: "lib/types"` 与 `main: "lib/extension.js"`、`exports["."].default: "./lib/index.js"` 指向的 `lib/` 不一致，导致扩展宿主仍加载 9/11 旧产物（不含 editor-chat-panel）。已确认的修复方案（方向 B）：保留 `lib/types` 中间态，新增包级 `tsdown.config.ts`（双入口 `lib/types/{extension,index}.js` → `outDir: lib`，`dts: false`），把该 app 纳入根 `tsdown.config.ts` 的 `workspace`，并更新 `package.json`（`files` / `scripts` / `devDependencies`）。本报告逐项核实 implementer / reviewer / verifier 依赖的事实。

## 2. 仓库概览

- **语言 / 工具**：TypeScript，全 ESM（`"type": "module"`），pnpm workspaces（`pnpm@11.7.0`），Node `^22.19.0 || >=24.0.0`。
- **构建管线**：`pnpm run build:lib:host` = `node .../tsc -b tsconfig.host.json && tsdown --env.DSH_BUILD_FACE host`。根 `tsdown.config.ts` 驱动多包 workspace 构建（`workspace: ['vendor/*', 'packages/*/*', 'apps/cli']`），构建基础是 tsc 产出的 `lib/types` JS。
- **`apps/vscode-dsh`** 是一个 VS Code 扩展（`@deepseek-ai/dsh-vscode-dsh`，`private: true`，`engines.vscode ^1.90.0`）。`src/` 下共 57 个 TS 文件；两个已发布的运行时入口是 `src/extension.ts`（激活入口）和 `src/index.ts`（公共库入口）。

## 3. 最相关区域

| 路径 | 相关性 | 来源 |
|------|--------|:------:|
| `apps/vscode-dsh/package.json` | 待改的 `main`/`types`/`exports`/`files`/`scripts`/`devDependencies` | 👁 已读 |
| `apps/vscode-dsh/tsconfig.json` | `outDir: "lib/types"`（保持不变），项目 `references` | 👁 已读 |
| `apps/vscode-dsh/src/extension.ts` | 激活入口 `activate()`；import `./chat-panel/index.ts` | 👁 已读 |
| `apps/vscode-dsh/src/index.ts` | 库入口；re-export `chat-panel` + `extension` 符号 | 👁 已读 |
| `apps/vscode-dsh/src/chat-panel/index.ts` | editor-chat-panel 符号 barrel | 👁 已读 |
| `apps/vscode-dsh/lib/` | 9/11 旧产物（当前 `main`/`exports` 指向） | 👁 ls |
| `apps/vscode-dsh/lib/types/` | 9/14 新 tsc 产物（当前未被加载） | 👁 ls |
| `tsdown.config.ts`（根） | `workspace`（追加 `apps/vscode-dsh`）、host `entry` 缺省值 | 👁 已读 |
| `apps/cli/tsdown.config.ts` | 逐字段对齐的模板 | 👁 已读 |
| `apps/cli/package.json` | `bin`/`files` 先例 | 👁 已读 |
| `apps/cli/lib/bin.js` | workspace 依赖保持 bare import 的证据 | 👁 已读 |
| `package.json`（根） | `tsdown` 版本 + `build:lib:host` 脚本 | 👁 已读 |
| `tsconfig.host.json` | `references` 含 `./apps/vscode-dsh` | 👁 已读 |
| `.specdev/specs/fix-vscode-dsh-build-outdir/tech-debt-registry.md` | 桩交叉核对（为空） | 👁 已读 |

## 4. 关键入口 / 调用路径

### 路径 1 — 扩展激活（运行时）
```
VS Code 加载 package.json "main": "lib/extension.js"   ← 9/11 旧产物
  └─ src/extension.ts  export function activate(context, vscodeArg?)
       └─ import './chat-panel/index.ts'  (ChatPanelHost, createEditorChatPanelController, ...)
```

### 路径 2 — 公共库入口（exports）
```
require('@deepseek-ai/dsh-vscode-dsh')  →  exports["."].default: "./lib/index.js"  ← 9/11 旧产物
  └─ src/index.ts  re-exports:
       ├─ './chat-panel/index.ts'  (EDITOR_CHAT_PANEL_VIEW_TYPE, createEditorChatPanelController, ...)
       └─ './extension.ts'  (activate, deactivate, ...)
```

### 路径 3 — Host 构建（本次修复面）
```
pnpm run build:lib:host
  ├─ tsc -b tsconfig.host.json  → apps/vscode-dsh/src/*.ts  →  lib/types/*.js + *.d.ts  (outDir "lib/types")
  └─ tsdown --env.DSH_BUILD_FACE host  (根配置，workspace 含 apps/vscode-dsh)
       └─ apps/vscode-dsh/tsdown.config.ts (新增，包级)
            entry: ['lib/types/extension.js', 'lib/types/index.js']  →  outDir 'lib'  →  lib/extension.js, lib/index.js (+ 共享 chunk)
```

## 5. 可能受影响面

| 文件 | 改动 | 风险 |
|------|------|:----:|
| `apps/vscode-dsh/tsdown.config.ts` | 新增 — 双入口打包配置 | 低（对齐 `apps/cli`） |
| `tsdown.config.ts`（根） | `workspace` 追加 `'apps/vscode-dsh'` | 低（纯追加） |
| `apps/vscode-dsh/package.json` | `files`→`lib/*.js`+d.ts；增 `build:host`；prepublish 链 host 构建；增 `tsdown` devDep | 低-中（脚本链） |
| `apps/vscode-dsh/tsconfig.json` | **不改** | — |
| `apps/vscode-dsh/src/**` | **不改** | — |

## 6. 既有约束 / 规范

- **tsdown 配置字段规范**（对齐 `apps/cli/tsdown.config.ts`）：`entry`、`outDir: 'lib'`、`format: ['esm']`、`platform: 'node'`、`target: 'es2024'`、`fixedExtension: false`、`dts: false`、`clean: false`。包级无 `plugins`。
- **`dts: false`**：声明由 `tsc -b` 产出（`.d.ts` 留在 `lib/types/`），与所有包（含 `apps/cli`）一致。
- **workspace 依赖为 external**：`apps/cli/lib/bin.js` 保留 bare import（`import { loadLayeredEnv } from "@deepseek-ai/dsh-app-boot"; import { Command, CommanderError } from "commander";`），即 tsdown 不内联 `@deepseek-ai/*` workspace 包或三方依赖。`apps/vscode-dsh` 的依赖（`dsh-file-reference`、`dsh-ide-bridge`、`dsh-sdk-client`、`dsh-subprocess`）将保持 bare import。
- **ESM + `.ts` 本地 import**：`type: module`；本地相对 import 显式带 `.ts` 扩展（如 `./chat-panel/index.ts`）。
- **`lib/` 已 gitignore**；构建须从干净树可重建（AC-9）、幂等（AC-10）、离线可跑（AC-11）。

## 7. 风险 / 未知（标注确认度）

| # | 发现 | 确认度 |
|---|------|:------:|
| 1 | `src/extension.ts` 是 `main: "lib/extension.js"` 引用的激活入口；第 336 行声明 `export function activate(context: ExtensionContextLike, vscodeArg?: VsCodeLike): void`。 | ✅ CONFIRMED |
| 2 | `src/index.ts` re-export editor-chat-panel 符号：`ChatPanelHost`、`FakeWebviewPort`、`CHAT_PANEL_VIEW_ID`、`EDITOR_CHAT_PANEL_VIEW_TYPE`、`buildThinChatHtml`、`buildSidebarMigrationHtml`、`buildEditorChatSpaHtml`、`canRegisterChatPanel`、`canCreateEditorChatPanel`、`createEditorChatPanelController`、`registerChatPanelProvider`、`parseWebviewToHostMessage`（以及类型 `HostToWebviewMessage`、`WebviewToHostMessage`、`PanelMode`、`RejectSendReason`、`SendGateResult`、`EditorChatPanelController`）。同时从 `extension.ts` re-export `activate`/`deactivate`。 | ✅ CONFIRMED |
| 3 | 根 `tsdown.config.ts` 的 `workspace` = `['vendor/*', 'packages/*/*', 'apps/cli']`（无 `apps/vscode-dsh`）；host `entry` 缺省 = `['lib/types/{index,invariant,startup}.js']`。 | ✅ CONFIRMED |
| 4 | 根 `tsdown` 版本 = `^0.22.2`（根 `package.json` devDependencies）。 | ✅ CONFIRMED |
| 5 | `apps/vscode-dsh` 目前**没有** `tsdown.config.ts`。 | ✅ CONFIRMED |
| 6 | `tsconfig.host.json` 的 `references` 第 277 行 = `{ "path": "./apps/vscode-dsh" }`，故 `tsc -b tsconfig.host.json` 会编译它。 | ✅ CONFIRMED |
| 7 | 两个入口共享 `chat-panel` 依赖图（`extension.ts` 第 64 行 import `./chat-panel/index.ts`；`index.ts` 第 97 行 re-export `./chat-panel/index.ts`，且 `index.ts` 又 re-export `./extension.ts`）。因此 tsdown 会在 `extension.js` 与 `index.js` 之间产出至少一个共享 chunk。 | ✅ CONFIRMED |
| 8 | 包级 `tsdown.config.ts` 会覆盖该包的根配置（含根 `plugins: [typertPlugin(...)]`）——证据是 `apps/cli` 的 `lib/bin.js` 无 typert 处理且其自身配置未定义 plugins。`apps/vscode-dsh` 不需要 typert。 | ⚠️ HYPOTHESIS（有强先例，但未对 vscode-dsh 实测复核） |
| 9 | `files` glob `lib/*.js` 必须覆盖双入口构建产出的共享 chunk，而非仅 `index.js`/`extension.js`。chunk 具体文件名由 tsdown 在构建时确定。 | ⚠️ HYPOTHESIS |
| 10 | `apps/vscode-dsh/.vscodeignore` 存在（311 B）；vsce 打包（可选 AC-5）可能在 `files` 之外再过滤文件。 | ❓ UNKNOWN（未读；非核心修复面） |

## 8. 不确定 / 未验证

- **tsdown chunk 命名 / 数量**：未实测观察；implementer 必须在构建后检查 `apps/vscode-dsh/lib/`，确保 `files: ["lib/*.js", ...]` 覆盖所有产出的 `.js`（入口 + 共享 chunk）。
- **`pnpm run build:lib:host` 是否拾取新包级配置**：根 `workspace` glob 追加后必须让 `tsdown` 发现 `apps/vscode-dsh/tsdown.config.ts`。`apps/cli` 先例已证实该机制，但本 app 的集成在真实构建前未验证。
- **`build:host` 脚本写法**（`tsc -b && tsdown`）：implementer 选定的 cwd/tsc 调用方式必须解析到项目本地的 `typescript`/`tsdown` bin（根脚本用 `node .../node_modules/typescript/bin/tsc -b`）。在此 app 上下文未验证。
- **离线/无 key 的 host 构建（AC-11）**：根 host tsdown 应用 `typertPlugin`；vscode-dsh 的包级配置避开了它，因此离线构建应成立——端到端未验证。

## 9. 桩检测 & Registry 交叉核对

### Registry 校验结果
| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| — | — | 空表 | — | — |

slug `fix-vscode-dsh-build-outdir` 的 `tech-debt-registry.md` 为空（「活跃债务」与「已解决」表均只有占位 `—` 行）。无已注册桩需交叉核对。

### 桩检测摘要
- ✅ 已确认桩：**0**（匹配 registry）
- ⚠️ Registry 不一致：**0**（代码已变但 registry 未更新）
- 🔴 未注册桩：**0**（代码中存在但未注册）

调研过程中在 `src/extension.ts`、`src/index.ts`、`src/chat-panel/index.ts` 均未发现 `@STUB` / 空函数体 / 硬编码 return 的桩信号，三处均为真实实现。本次修复是构建路径对齐，不应引入 `@STUB`；若有关联构建债必须推迟，注册 `DEBT-N`（见 `spec.md`）。

## 10. 推荐后续阅读

1. ⭐ 必读 — `apps/vscode-dsh/package.json`（待改的四字段 + scripts）
2. ⭐ 必读 — `apps/cli/tsdown.config.ts`（逐字段对齐的模板）
3. ⭐ 必读 — 根 `tsdown.config.ts`（需扩展的 `workspace` 行）
4. ⭐ 必读 — `apps/vscode-dsh/src/index.ts`（re-export 清单；不改）
5. 🔷 建议读 — `.specdev/specs/fix-vscode-dsh-build-outdir/phases/phase-1-build-outdir/spec.md`（AC-1..11 + 关键配置要点）
6. 🔷 建议读 — `apps/vscode-dsh/tsconfig.json` + `tsconfig.host.json`（第 120-341 行）（不改；核对 `references`）
7. 🔷 建议读 — `apps/cli/lib/bin.js`（确认 bare-import external 行为）
8. 🔹 可选 — `apps/vscode-dsh/src/chat-panel/index.ts`（完整 barrel 符号清单）
9. 🔹 可选 — `.cursor/skills/project-build/SKILL.md` + `.cursor/skills/project-test/SKILL.md`（构建/测试调用知识）
