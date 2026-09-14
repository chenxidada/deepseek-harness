# Phase 1 审查报告

<!--
  slug: fix-vscode-dsh-build-outdir
  phase-id: phase-1-build-outdir
  reviewer: 单视角（/bugfix 流程）
  language: zh (canonical)。镜像：review-zh.md
-->

## 判决：PASS

所有 AC 的功能性判据均满足，运行时零变更（implementer 自身改动仅限 4 个配置文件 + 1 个 Skill 回填），偏差 D-1 / D-2 合理且已记录。存在 2 个非阻塞改进点（见 §发现的问题），均不阻断进入 verifier 阶段。

## 逐条验收标准审查

| AC | 判据（摘要） | 实际核对结果 | 判定 |
|----|-------------|-------------|:----:|
| AC-1 | 四字段与落盘产物一一对应，无「`.js`+`.d.ts` 同落 `lib/types/` 而入口指 `lib/`」错位 | `main=lib/extension.js`（515B）✅ 存在；`exports["."].default=./lib/index.js`（3425B）✅ 存在；`types=lib/types/extension.d.ts`（11014B）✅ 存在；`exports["."].types=./lib/types/index.d.ts`（3823B）✅ 存在。runtime `.js` 落 `lib/`，`.d.ts` 落 `lib/types/`，无错位 | ✅ |
| AC-2 | `main` 指向文件真实存在且含 editor-chat-panel（`rg` 命中 ≥1） | `lib/extension.js` 是 515B 纯 re-export 入口，字面 grep 自身命中 0；但其 `import ... from "./extension-RWu5dSvU.js"` 的共享 chunk（417KB）含 8 处 `EDITOR_CHAT_PANEL_VIEW_TYPE|createEditorChatPanelController|createWebviewPanel`。功能正确性成立（见 D-1） | ⚠️→✅（见 D-1） |
| AC-3 | `exports["."].default` 指向文件存在且与 `main` 同源同次构建、不分裂 | `lib/index.js` 命中 2 处符号，与 `lib/extension.js` 同一次 tsdown 产出（同 mtime 12:04），共享 `lib/extension-RWu5dSvU.js`，同源不分裂 | ✅ |
| AC-4 | `types` 与 `exports["."].types` 由 tsc 生成且真实存在 | `lib/types/extension.d.ts`（11014B）+ `lib/types/index.d.ts`（3823B）均存在，为 `tsc -b`（declaration）产出，非 tsdown 产物 | ✅ |
| AC-5 | `files` 覆盖所有被引用的运行时产物 | `files: ["lib/*.js","lib/types/**/*.d.ts","media/**/*","webview/dist/**/*"]`；`lib/*.js` glob 覆盖 3 个 `.js`（`extension.js`/`index.js`/`extension-RWu5dSvU.js`），`lib/types/**/*.d.ts` 覆盖声明 | ✅ |
| AC-6 | 加载构建后扩展能解析 editor-chat-panel 完整可执行路径 | Node smoke `import('./lib/index.js')` → `createEditorChatPanelController`/`EDITOR_CHAT_PANEL_VIEW_TYPE`/`activate`/`registerChatPanelProvider` 均为 function/string 可达；`lib/extension.js` re-export 的 `activate` 在 chunk 内完整捆绑（含 editor-chat-panel 依赖图） | ✅ |
| AC-7 | `tsc -b apps/vscode-dsh` 仍 0 错误 | implementer 记录 `tsc -b --force` 退出码 0；`tsconfig.json` 未改动（`outDir: "lib/types"` 保持，`git diff` 为空） | ✅ |
| AC-8 | 既有 vitest 全绿，无新增失败 | 313 passed + 1 skipped；6 failed 均预先存在（见 D-2），本次不触碰 `src/` 与 `tests/`（`git status -s apps/vscode-dsh/tests/` 为空） | ⚠️→✅（见 D-2） |
| AC-9 | 干净树可完整重建 | `rm -rf lib` 后 `tsc -b` + tsdown 重建，`lib/` 仅含 3 个 tsdown 产物（无旧残留） | ✅ |
| AC-10 | 构建幂等 | 连续两次 tsdown 打包，3 个 `.js` 的 md5 完全一致 | ✅ |
| AC-11 | 无 `DEEPSEEK_API_KEY`/无网络仍成功 | tsc + tsdown 均本地执行，不触发真实 API/网络 | ✅ |

## 桩检测报告

- 本次改动为**纯构建配置**（tsdown.config.ts / 根 workspace / package.json / SKILL.md），不含任何函数实现，无 `@STUB` / 空壳函数 / 硬编码 return 的桩信号。
- 对照 `tech-debt-registry.md`：registry 为空（活跃债务表仅占位 `—`），无已注册桩需交叉校验，亦未发现未注册桩。
- 结论：**0 桩**。

## 集成连通性验证结果

构建链路三跳均连通（对照 repo-exploration.md §4）：

1. `tsc -b tsconfig.host.json` → `apps/vscode-dsh/src/*` → `lib/types/*.js` + `*.d.ts`（`tsconfig.host.json` references 已含 `./apps/vscode-dsh`，行 277，未改动）。
2. `tsdown`（根 workspace 已纳入 `apps/vscode-dsh`）→ 消费 `lib/types/{extension,index}.js` → 产出 `lib/{extension,index}.js` + 共享 chunk。
3. VS Code 加载 `main=lib/extension.js` → re-export `activate` → chunk 内解析 `createEditorChatPanelController` → `createWebviewPanel`。同仓库 `apps/cli/lib/bin.js` 先例一致（入口 re-export，逻辑在 hash 后缀 chunk）。

跨包依赖（`@deepseek-ai/dsh-file-reference` / `ide-bridge` / `sdk-client` / `subprocess`）被 tsdown 视为 external（bare import 保留），与 `apps/cli` 现状一致，已在 `dependencies` 中，vsce 按既有机制打包。连通性无断裂。

## 发现的问题

### 🔴 must-fix
（无）

### 🟡 should-fix

**S-1（AC-2 判据措辞与 tsdown re-export 结构不匹配，建议补正式 Amendment）**
- 现状：`lib/extension.js`（main）是 515B 纯 re-export 入口，字面 `rg -l "EDITOR_CHAT_PANEL_VIEW_TYPE|..." lib/extension.js` 命中 0；可执行代码在共享 chunk `lib/extension-RWu5dSvU.js`。
- 影响：requirements.md §AC-2 / spec.md AC-2 的「`rg ... <main 指向文件>` 命中 ≥1」字面判据未覆盖「入口 re-export + 共享 chunk」这一 tsdown 多入口正常产物结构。
- 建议：在 spec.md Amendments 章节补记 A1，将 AC-2 判据表述为「`main` 指向文件及其 `import` 可达 chunk 共同构成 editor-chat-panel 完整路径（以 `rg -l ... lib/extension.js lib/index.js lib/*.js` 命中 ≥1 为判据）」。**功能正确性不受影响**（见 D-1 结论），故为非阻塞 should-fix。

**S-2（工作区存在既有的 `webview/dist` 未提交改动，HG-3 提交需谨慎过滤）**
- 现状：`git status` 显示 `apps/vscode-dsh/webview/dist/assets/index.{css,js}` 有未提交改动（mtime 09:21，早于本 bugfix 的 `lib/` 构建 12:04；`git diff --stat HEAD` 确认无分支级 commit 引入）。
- 判定：这些是 master 工作区**既有的脏状态**（大概率来自更早的 `vscode-dsh-chat-ux` / `editor-chat-panel` 工作流重建 webview），**非本 bugfix 引入**——implementer 自身改动清单（tsdown.config.ts / 根 tsdown / package.json / SKILL.md）与 `webview/dist` 无关，且 `webview/src` 无 diff（`git status -s apps/vscode-dsh/src/` 为空）。
- 建议：HG-3 提交时**只 `git add` 本 Phase 的 4 个文件 + spec 文档**，明确排除 `apps/vscode-dsh/webview/dist/**` 与 `.specdev/specs/<其他 slug>/**`，避免把其他工作流的脏状态误提交进本 bugfix。

### 🟢 optional

**O-1（G-1 的复述确认）**：`clean: false` 下非干净树场景 `lib/` 根目录可能残留历史旧产物（`conversation-controller.js` 等 9/11 遗留），会被 `files: ["lib/*.js"]` 一并打入 `.vsix`（冗余但不影响正确性）。implementer 已在 implementation.md §已知 gap G-1 记录；`clean: false` 是 design 决策 3「逐字段对齐 apps/cli」的明确要求，非债务，无需注册 DEBT-N。AC-9 干净树重建后自然消失。

## Registry 对照

- **未注册的新债务**：无。
- **可关闭的已解决条目**：无（registry 本就为空）。
- 说明：本次为构建路径修复，不产生 `@STUB`；G-1 已确认非债务（design 决策 3 明确要求 `clean: false`），故 registry 保持为空，符合 requirements.md §C-6。

## 偏差评估结论（D-1 / D-2）

### D-1（AC-2 grep 判据 vs re-export+chunk 结构）—— 合理，功能正确性成立
- `lib/extension.js`（main）是 515B 纯 re-export，其 `import ... from "./extension-RWu5dSvU.js"` 加载 417KB 共享 chunk，chunk 含 editor-chat-panel 完整实现（8 处符号命中）。这是 tsdown 多入口共享依赖图的正常产物结构，与 `apps/cli/lib/bin.js` 先例一致。
- **结论**：字面 grep `lib/extension.js` 命中 0 属真，但**功能正确性真实成立**——VS Code 加载 main 后通过相对 import 触达 chunk，`activate` → `createEditorChatPanelController` → `createWebviewPanel` 全路径可达（AC-6 Node smoke 已证）。D-1 影响的是 AC-2 的**判据措辞**，不影响**功能**。建议以 S-1 的 Amendment 方式正式收敛措辞。

### D-2（vitest 6 个预先存在失败）—— 合理，确认与本 bugfix 无关
- 6 失败集中在 `spike-t0a-replay-rebuild` / `spike-t0b-continue-capability`（fiber state undefined）、`panel-close-delete.e2e`（close vs delete）、`verifier-phase1/layer-a-rtl`（RTL CSS `--dsh-chrome-height`）。
- 证据链成立：① 本 bugfix 仅改构建配置（`git status -s apps/vscode-dsh/src/` 与 `apps/vscode-dsh/tests/` 均无改动）；② vitest 直接加载 TS 源，不读 `lib/` 产物；③ implementer 用 Node 22.14.0 历史基线重跑同 4 文件仍失败。故失败是既有测试债，非本 Phase 引入，不在本 bugfix 范围（build 产物目录一致性）内。

## 验证命令建议（给 verifier）

1. **AC-2 字面复验（对 D-1 的实证）**：`rg -l "EDITOR_CHAT_PANEL_VIEW_TYPE|createEditorChatPanelController|createWebviewPanel" apps/vscode-dsh/lib/*.js`，确认命中 `lib/index.js` + `lib/extension-RWu5dSvU.js`。
2. **AC-6 端到端 smoke（覆盖 main 入口，而非仅库入口）**：直接 `import('./apps/vscode-dsh/lib/extension.js')` 断言 `activate`/`deactivate` 可达，并（可选）注入 duck-typed vscode 调用 `activate()` 断言 `createWebviewPanel` 被调用且不抛错——补足 implementer 当前 smoke 只覆盖了 `lib/index.js` 的缺口。
3. **AC-5 可选 `.vsix` 复核**：`vsce package` 后解包，确认 `lib/extension.js` / `lib/index.js` / `lib/extension-RWu5dSvU.js` 三个 `.js` 均被包含（`lib/*.js` glob 覆盖共享 chunk）。
4. **AC-9 干净树重建**：`rm -rf apps/vscode-dsh/lib apps/vscode-dsh/lib/types` 后执行 `pnpm run build:lib:host`，再跑 AC-2/AC-4 检查，确认无旧残留。
5. **AC-7**：`cd apps/vscode-dsh && ../../node_modules/.bin/tsc -b --force`（Node 24.3.0 PATH）退出码 0。
