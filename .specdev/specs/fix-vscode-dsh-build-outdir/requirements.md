# 需求文档：fix-vscode-dsh-build-outdir

<!--
  slug: fix-vscode-dsh-build-outdir
  audience: plan-generator / implementer / reviewer / verifier / HG-1
  language: zh (canonical)。镜像：requirements-zh.md
  constitution: .specdev/specs/fix-vscode-dsh-build-outdir/constitution.md
  nature: bugfix（构建产物目录一致性修复，不改运行时行为）
  root cause: apps/vscode-dsh 的 tsc outDir=lib/types 与插件运行时入口 main=lib/extension.js 不一致，
             且 apps/vscode-dsh 既无 tsdown 配置、也不在根 tsdown.config.ts 的 workspace 中，
             导致 tsc 编译出的新代码（含 editor-chat-panel）产出在 lib/types/ 却不被插件加载，
             插件仍运行 lib/ 下的 2026-09-11 旧产物。
-->

## 术语（全文统一）

| 术语 | 含义 | 首次括注 |
|------|------|----------|
| **Host 侧源码** | `apps/vscode-dsh/src/` 下的扩展 Host 端 TypeScript 源码 | Host-side source |
| **运行时入口** | `package.json` 的 `main`（插件激活入口 `lib/extension.js`）与 `exports["."].default`（库入口 `lib/index.js`） | runtime entry |
| **类型入口** | `package.json` 的 `types`（`lib/types/extension.d.ts`）与 `exports["."].types`（`./lib/types/index.d.ts`） | type entry |
| **editor-chat-panel** | 编辑器区 WebviewPanel + React SPA（`src/chat-panel/editor-chat-panel.ts` 等），已提交至 master（6ddb7635d8） | editor chat panel |
| **中间产物 / 最终产物** | 仓库统一约定：`tsc -b` 将 JS 与 `.d.ts` emit 到 `lib/types/`（中间态），再由 tsdown 将 runtime 打包到 `lib/`（最终态） | intermediate / final artifact |
| **运行时自洽** | 代码在 vitest（vite/tsx 直接加载 TS）下正常运行、测试全绿；仅是「产物未被插件加载」的构建路径问题 | runtime self-consistent |

## 产品目标

让 `apps/vscode-dsh` 的**构建产物目录**与**插件运行时入口**严格一致：修复后，执行「正确构建命令」能从当前 `src/` 生成含 `editor-chat-panel` 的运行时产物，且产物落盘位置与 `package.json` 的 `main` / `types` / `exports` / `files` 四个字段一一对应。最终让用户在 VS Code 中加载扩展后，「编辑窗口显示」功能（Editor WebviewPanel）真正可用——**不再**因入口文件是旧产物而静默缺失。同时**不改变任何运行时行为**，不破坏前一修复（`fix-vscode-dsh-host-tsc`）建立的 `tsc -b apps/vscode-dsh` 0 错误基线。

## 问题陈述

`fix-vscode-dsh-host-tsc` 收尾后，`tsc -b apps/vscode-dsh` 已 0 错误通过，并把 `editor-chat-panel` 等新代码编译进 `apps/vscode-dsh/lib/types/`（如 `lib/types/chat-panel/editor-chat-panel.js`、`lib/types/extension.js`）。但插件运行时加载的是 `package.json.main = lib/extension.js`，而 `lib/` 根目录仍是 2026-09-11 的**旧产物**，不含 editor-chat-panel。直接后果：用户重载插件后，「编辑窗口显示」功能不可见。

根因拆解如下：

| # | 根因 | 现场（文件） | 后果 |
|---|------|-------------|------|
| **1. outDir 与运行时入口错位** | `apps/vscode-dsh/tsconfig.json` 设 `outDir: "lib/types"`，`extends tsconfig.base.json`（`declaration: true`、`composite: true`，**无** `emitDeclarationOnly`、**无** `declarationDir`）→ `tsc -b` 把 `.js` **和** `.d.ts` 都 emit 到 `lib/types/` | `apps/vscode-dsh/tsconfig.json:5`；`tsconfig.base.json:9-13` | runtime `.js` 落在 `lib/types/`，而 `main` 指向 `lib/` |
| **2. 缺少 tsdown 打包步骤** | 根 `tsdown.config.ts` 的 `workspace` = `['vendor/*', 'packages/*/*', 'apps/cli']`，**不含 `apps/vscode-dsh`**；host 面 entry 是 `lib/types/{index,invariant,startup}.js`，outDir `lib` | `tsdown.config.ts:19-21` | 无人把 `lib/types/*.js` 打包成 `lib/*.js` |
| **3. package.json 无 host 侧构建脚本** | `scripts` 只有 `webview:build` / `build:webview` / `vscode:prepublish` / `prepublishOnly`（均只跑 vite 构建 webview） | `apps/vscode-dsh/package.json:31-36` | 没有任何命令产出 `lib/extension.js` |
| **4. 旧产物残留** | `apps/vscode-dsh/lib/` 是 gitignored（根 `.gitignore:4` 的 `lib/`），`git ls-files` 计数 0；`lib/` 根目录为 2026-09-11 旧产物，grep `editor-chat-panel|createWebviewPanel|createEditorChatPanel` 命中 0，而 `lib/types/` 命中 ≥ 3 | 根 `.gitignore:4` | 插件加载旧产物，看不到新功能 |

**已确认的对比事实**（本次需求的事实基线）：

- `lib/types/extension.js` / `lib/types/index.js` / `lib/types/chat-panel/editor-chat-panel.js` 等新产物**已存在**（`tsc -b` 产出）。
- `lib/extension.js` / `lib/index.js` / `lib/chat-panel/*.js` 等旧产物**不含** editor-chat-panel。
- 仓库统一构建约定（参照 `apps/cli/tsconfig.json` + `apps/cli/tsdown.config.ts` + 根 `tsdown.config.ts` 注释）：`tsc -b` 产中间态到 `lib/types/`，tsdown 把 runtime 从 `lib/types/*.js` 打包到 `lib/*.js`（`dts: false`），`.d.ts` 留在 `lib/types/`。

## 权威构建流程依据（对应说明与 Skill）

> 本 bugfix 不是臆造流程，而是对齐仓库既有约定。以下为已核实的权威来源，plan-generator / implementer / verifier 必须以此为准，不得另起一套。

| 来源 | 位置 | 关键结论 |
|------|------|---------|
| **官方开发指南** | [`docs/development.md` § TypeScript project layout](../../../docs/development.md) | 根构建固定顺序：`tsc -b tsconfig.host.json` → `tsdown --env.DSH_BUILD_FACE host` → `tsc -b tsconfig.client.json` → `tsdown --env.DSH_BUILD_FACE client` → `pnpm run build:web`。**「Tsdown consumes only the JavaScript emitted to `lib/types` by the preceding tsc phase」**——即 `tsc -b` 产 JS 到 `lib/types/`（中间态），tsdown 把 runtime 从 `lib/types/*.js` 打包到 `lib/*.js`，`.d.ts` 留在 `lib/types/`。 |
| **正确模式参照** | `apps/cli/tsconfig.json` + `apps/cli/tsdown.config.ts` | `apps/cli` 与 `apps/vscode-dsh` 同用 `outDir: "lib/types"`（tsconfig 完全同构）；区别是 `apps/cli` 有包级 `tsdown.config.ts`（`entry: ['lib/types/bin.js']` → `outDir: 'lib'`、`dts: false`），且被根 `tsdown.config.ts` 的 `workspace: ['vendor/*', 'packages/*/*', 'apps/cli']` 纳入。`apps/vscode-dsh` **两者都缺**——这是本 bug 的根因，也是方向 B 的模板。 |
| **构建知识 Skill** | `.cursor/skills/project-build/SKILL.md` | 当前只记录了 `apps/vscode-dsh` 的「无需单独构建」条目（render 抽离、session search），**尚无 host 侧 tsc→tsdown 产物链记录**——本 bugfix 完成后须回填此 Skill（见 AC 之外的维护动作）。 |
| **测试知识 Skill** | `.cursor/skills/project-test/SKILL.md` | 已记录「vscode-dsh Host 侧 tsc 编译门禁」（`tsc -b` + `--force`、Node 24.3.0 PATH、`./node_modules/.bin/vitest` 直调绕过 pnpm postinstall）。验证阶段复用此条目。 |

**结论**：方向 B（保持 `outDir: "lib/types"` 中间态 + 为 `apps/vscode-dsh` 补 `tsdown.config.ts` + 纳入根 workspace 或等价构建路径）与 `docs/development.md` 和 `apps/cli` 既有约定**完全一致**，是唯一不偏离仓库规范的修复方向。方向 A（改 outDir 回 lib）会破坏「tsc 产中间态 + tsdown 打包」的统一模式，方向 C（改 main 指向 lib/types）会破坏 `files` 语义——两者均偏离权威依据，故 HG-2 应默认收敛到方向 B，除非发现新的硬性反证。

## 目标终态

- 执行「正确构建命令」（见 Q-2）后，`apps/vscode-dsh` 的运行时入口（`main` 与 `exports["."].default`）**从当前 `src/` 重新生成**，且内容包含 editor-chat-panel。
- 类型入口（`types` 与 `exports["."].types`）指向由 `tsc` 生成的 `.d.ts`，且真实存在。
- `package.json` 的 `main` / `types` / `exports` / `files` 与落盘产物**严格一致**，无错位、无指向缺失文件。
- `tsc -b apps/vscode-dsh` **仍 0 错误**；既有 vitest 用例**全绿**（运行时行为不变）。
- 构建**可复现、可重复**（`lib/` 被 gitignore，必须能从干净树重建）。

## 目标用户

- **开发者 / 维护者**：本地或 CI 执行构建后，能在 VS Code 中加载到含 editor-chat-panel 的扩展。
- **终端用户**：重载扩展后，「编辑窗口显示」功能可见可用（本次修复的唯一可见行为变化，即「修复本来该有却缺失的功能」）。
- **下游 implementer / reviewer / verifier**：拥有一个「构建产物 = 运行时入口」自洽的构建基线。

## 核心场景

- **S-1 构建产物一致**：开发者执行正确构建命令，期望 `main` 指向的文件被重新生成且含 editor-chat-panel。
- **S-2 插件加载新功能**：用户在 VS Code 加载构建后的扩展并触发「编辑窗口显示」，期望 Editor WebviewPanel 正常创建。
- **S-3 类型无回归**：`tsc -b apps/vscode-dsh` 仍 0 错误（不破坏 `fix-vscode-dsh-host-tsc`）。
- **S-4 运行时零回归**：既有 vitest 用例全绿。

## 预期范围

**范围内**：
1. 修正 `apps/vscode-dsh` 的构建产物目录与运行时入口的一致性（含必要的 tsconfig / package.json / 构建脚本 / tsdown 配置调整，方向见 Q-1、Q-2，由 plan-generator 在 HG-2 拍板）。
2. 确保构建后 `main` / `exports["."].default` 指向含 editor-chat-panel 的**新**产物。
3. 确保 `types` / `exports["."].types` 指向真实存在的 `.d.ts`。
4. 确保 `files` 字段覆盖所有被运行时入口引用的构建产物（vsce 打包不遗漏）。

**范围边界**：仅限「让构建产物 = 运行时入口自洽 + 插件能加载到新代码 + 无回归」。**不**改任何运行时逻辑、不改线契约、不改 Webview 源码与已构建 `webview/dist/`、不新增任何功能面。

## 功能区域

### 区域 A：构建产物目录一致性

`apps/vscode-dsh` 的 `tsconfig` outDir / `package.json` 入口 / tsdown 配置 / 构建脚本四者必须统一，使运行时 JS 落盘位置 = `main` 与 `exports["."].default` 的指向，类型 `.d.ts` 落盘位置 = `types` 与 `exports["."].types` 的指向。

### 区域 B：运行时入口新鲜度

`main` 与 `exports["."].default` 指向的文件必须是「本次构建」从当前 `src/` 生成的（含 editor-chat-panel），**不得**是历史残留旧产物。`lib/` 被 gitignore，因此构建必须从干净树可完整重建。

### 区域 C：类型入口有效性

`types` 与 `exports["."].types` 指向的 `.d.ts` 必须由 `tsc` 生成且真实存在；类型入口不得因修复而指向缺失文件或与运行时入口错位。

### 区域 D：构建可复现性

构建命令幂等、可重复执行；从干净树（移除 `lib/` 及 `lib/types/`）可完整重建所有运行时产物与类型声明；host 侧构建与 webview 构建职责清晰、互不破坏。

## 验收标准（EARS 格式）

> 判据以「构建后的可观测产物」为准，**不绑定具体实现方案**（方案由 Q-1/Q-2 在 HG-2 拍板）。

### 布局一致性

- **AC-1**（普遍型）：构建后的产物目录布局**必须**与 `apps/vscode-dsh/package.json` 的 `main` / `types` / `exports` / `files` 四个字段一一对应；**必须**不再出现「`.js` 与 `.d.ts` 同时落盘到 `lib/types/`，而运行时入口指向 `lib/`」的错位。

- **AC-2**（普遍型）：执行「正确构建命令」（Q-2）后，`main` 字段所指向的文件**必须**真实存在，且其内容**必须**含 editor-chat-panel 相关代码（以 `rg -l "EDITOR_CHAT_PANEL_VIEW_TYPE|createEditorChatPanelController|createWebviewPanel" <main 指向文件>` 命中 ≥ 1 为判据），**不得**仍是 grep 命中 0 的 2026-09-11 旧产物。

- **AC-3**（普遍型）：`exports["."].default` 所指向的文件（库入口）**必须**在构建后真实存在，且与 `main`（插件激活入口）**必须**由同一次构建、同源 `src/` 生成——二者内容**不得**出现「一个含 editor-chat-panel、另一个不含」的分裂。

- **AC-4**（普遍型）：`types`（`lib/types/extension.d.ts`）与 `exports["."].types`（`./lib/types/index.d.ts`）**必须**在构建后真实存在，且**必须**由 `tsc`（declaration 输出）生成，**不得**指向缺失或不存在的 `.d.ts`。

- **AC-5**（普遍型）：`package.json` 的 `files` 字段**必须**覆盖所有被 `main` / `exports` / `types` 实际引用且需要随扩展发布的构建产物；vsce 打包（`.vsix`）时**不得**遗漏运行时入口文件或其依赖的模块文件。

### 插件加载（端到端可观测）

- **AC-6**（事件驱动型）：**当** verifier 加载构建后的扩展并触发「编辑窗口显示」入口（`activate` 中调用 `createEditorChatPanelController`）**时**，插件**必须**能从 `main` 指向的运行时产物中解析到 editor-chat-panel 的完整可执行代码路径，并成功创建 Editor WebviewPanel；**不得**因入口产物缺失该模块而报错或静默不显示。

### 回归零风险

- **AC-7**（普遍型）：修复后执行 `tsc -b apps/vscode-dsh` **必须**仍以 0 个类型错误退出（无 `error TS` 输出）——**不得**破坏 `fix-vscode-dsh-host-tsc` 已建立的类型干净基线。

- **AC-8**（普遍型）：修复**必须**保持运行时行为与修复前一致——`apps/vscode-dsh` 既有 vitest 用例**必须**全部通过，且**不得**新增失败用例。

### 构建可复现 / 幂等

- **AC-9**（普遍型）：在干净树（移除 `apps/vscode-dsh/lib/` 与 `lib/types/` 全部内容）上执行「正确构建命令」**必须**能完整重建所有运行时产物与类型声明，**不得**依赖任何 gitignored 的残留旧产物。

- **AC-10**（普遍型）：「正确构建命令」**必须**可重复执行（幂等）——连续执行两次**必须**均成功退出，且两次产物一致，**不得**因第二次执行报错或产生脏差异。

- **AC-11**（不期望行为型）：**如果**构建命令在无 `DEEPSEEK_API_KEY`、无网络的环境下执行，**那么** host 侧构建（`tsc` + runtime 打包）**必须**仍成功完成，**不得**因缺少真实 API 凭据或网络而失败（构建不触发真实 API 调用）。

## 不在范围内（明确排除）

- ❌ 不改变任何**运行时行为**或既有**可见功能**（唯一可见变化 = 修复「编辑窗口显示」本应存在却因构建错位而缺失的功能）。
- ❌ 不修改 `webview/src` 与已构建的 `webview/dist/`（除非修复本身要求同步重建 webview，且必须保持其可被正确引用）。
- ❌ 不新增任何功能面（如 tier-3 全文检索、新的 UI 能力等）。
- ❌ 不重构 editor-chat-panel、chat-panel 或其他业务模块的运行时逻辑与线契约。
- ❌ 不解决与本次「构建产物目录错位」无关的其他历史构建/类型债。
- ❌ 不引入新的运行时依赖，仅为此目的（除非方案本身严格需要且 plan-generator 在 HG-2 说明理由）。

## 约束

- **C-1**：Node 版本范围 = 仓库支持范围（`node ^22.19 || >=24`），验收以 Node 24 为准。
- **C-2**：`lib/` 是 gitignored（根 `.gitignore:4`），构建产物**不入库**——因此构建必须可复现、可从干净树重建（对应 AC-9）。
- **C-3**：本仓库 pre-release 立场（`AGENTS.md`）：「优先正确的基础设施而非兼容补丁，可自由重命名/重打包并更新所有引用」——修复应追求**正确的构建布局**，而非最小 hack；但所有被修改的引用点必须同步更新。
- **C-4**：EARS 格式强制；每条 AC 可独立判定 ✅/❌。
- **C-5**：改动必须是对「构建产物目录一致性」的最小修复，不得趁机重构模块职责或改变对外类型签名（除构建布局所必需）。
- **C-6**：`tech-debt-registry.md` 当前为空；本 bugfix 修复的是「构建路径错位」，不产生 `@STUB`。若修复中发现必须推迟的关联构建债，须注册 `DEBT-N` 条目。

## 开放问题 / 决策点

- **Q-1（核心拍板，需用户在 HG-2 或此前确认）**：正确的构建产物布局是什么？
  - **方向 B（推荐）**：保持 `outDir: "lib/types"` 作为 tsc 中间产物，为 `apps/vscode-dsh` 增加 tsdown 配置（参照 `apps/cli/tsdown.config.ts`），把 runtime 从 `lib/types/*.js` 打包到 `lib/*.js`（`dts: false`），并纳入构建。**证据**：与仓库统一约定（根 `tsdown.config.ts` 注释、`apps/cli` 的 tsconfig/tsdown 组合）一致；tsdown 负责把跨项目引用（ide-bridge / sdk-client / subprocess / file-reference）打平，避免 runtime 里残留 `.ts` 扩展或路径错位。
  - **方向 A**：改 `outDir` 回 `lib` + `declarationDir: "lib/types"`，让 tsc 直接 emit runtime 到 `lib/`、`.d.ts` 到 `lib/types/`。**代价**：偏离「tsc 产中间态 + tsdown 打包 runtime」的统一模式；且 apps/vscode-dsh 依赖多个 project references，直接 emit runtime 需额外验证 `rewriteRelativeImportExtensions` 下跨包相对导入在 Node 中可正确加载。
  - **方向 C**：改 `main` 指向 `lib/types/extension.js`（即把 `lib/types/` 当最终产物）。**代价**：runtime 与 `.d.ts`/`.map` 混目录，与 `files` 字段既有语义（`lib/types/**/*.d.ts` vs `lib/index.js`/`lib/extension.js`）冲突，vsce 打包可能混入不必要文件，最不推荐。
  - **决策规则**：无论选哪个，都必须满足 AC-1～AC-6（布局自洽 + 入口含 editor-chat-panel + 类型入口有效）。

- **Q-2（正确构建命令）**：host 侧构建的正确命令是什么、产出到哪个目录？
  - 仓库根 `pnpm run build` = `tsx scripts/build.ts`（`tsc -b` 全图 + tsdown）。需拍板：`apps/vscode-dsh` 是**并入统一构建图**，还是提供独立的包内 `build:host` 脚本（类似 `webview:build`）。
  - 需拍板：`vscode:prepublish` / `prepublishOnly`（vsce 打包自动调用）当前**只**跑 `webview:build`，是否应**同时**包含 host 侧构建，保证 `vsce package` 产出含最新 runtime。

- **Q-3（入口覆盖）**：`main`（插件激活入口 `lib/extension.js`）与 `exports["."].default`（库入口 `lib/index.js`）是两个不同入口。需确认修复同时覆盖两者（`src/index.ts` 也 re-export editor-chat-panel 相关符号），且 `files` 同时包含 `lib/index.js` 与 `lib/extension.js`。

- **Q-4（验证方式，低风险，可由 verifier 拍板）**：端到端验证采用「Node 加载构建后入口并断言 editor-chat-panel 符号可达」的 smoke 方式，还是「vsce package 产出 .vsix + 在 VS Code 中安装加载」的完整方式。建议前者为主、后者在 CI/人工可用时补充。

## 风险 / 假设

- **假设 A1**：`lib/types/` 下由 `tsc -b` 产出的新产物（含 editor-chat-panel）已就绪且可被 tsdown 正确打包为 runtime；若打包过程中发现依赖项目（ide-bridge / sdk-client / subprocess / file-reference）的声明未产出，须先 `pnpm run build`（`tsc -b` 自动构建引用图）。
- **风险 R1**：若选方向 A（tsc 直接 emit runtime），跨项目引用的相对导入（`rewriteRelativeImportExtensions: true`）可能在 runtime `.js` 中残留 `.ts` 扩展或路径错位，导致 Node 加载失败——这正是方向 B（tsdown 打平）的优势，已作为 Q-1 决策要点列出。
- **风险 R2**：若选方向 C，runtime 与 types 混目录会破坏 `files` 语义、可能混包不必要文件，且类型入口解析易错——最不推荐。
- **风险 R3**：`main` 与 `exports["."].default` 两个入口若只修其一，仍会漏掉另一入口（插件激活走 `main`，库消费者走 `exports`），导致「半修复」——AC-3 已显式要求两者同源。
- **风险 R4**：`lib/` 根目录残留 2026-09-11 旧产物，可能使验证者误判「入口已存在即已修复」——AC-2 用 grep 命中 + AC-9 用干净树重建双重锁定，避免误判。
- **风险 R5**：`vscode:prepublish` 若未纳入 host 构建，`vsce package` 仍会打出旧 runtime——已列为 Q-2 决策点。

## 建议的 Phase 拆分方向

本 bugfix 为单一、内聚的构建配置修复，建议 **单 Phase**（`/bugfix` 流程不拆 Phase）。实现顺序建议（供 plan-generator 参考，非强制）：

1. 依据 Q-1/Q-2 拍板结果，调整 `apps/vscode-dsh` 的构建配置（tsconfig / tsdown / package.json scripts / files 字段）。
2. 在干净树执行正确构建命令，验证 `main` / `exports` 入口含 editor-chat-panel（AC-2/AC-3）。
3. 跑 `tsc -b apps/vscode-dsh` 确认 0 错误（AC-7）、跑相关 vitest 确认运行时无回归（AC-8）。
4. 幂等复验（AC-10）与干净树重建复验（AC-9）。
