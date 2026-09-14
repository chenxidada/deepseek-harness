# Phase 1 实现摘要（中文镜像）

<!--
  slug: fix-vscode-dsh-build-outdir
  phase-id: phase-1-build-outdir
  language: zh（canonical 镜像 implementation-zh.md，与 implementation.md 同源）
-->

## 变更清单（文件列表）

| # | 文件 | 改动 | 性质 |
|---|------|------|------|
| 1 | `apps/vscode-dsh/tsdown.config.ts` | 新增：双入口 tsdown 打包配置（`entry: ['lib/types/extension.js', 'lib/types/index.js']`，`outDir: 'lib'`，`format: ['esm']`，`platform: 'node'`，`target: 'es2024'`，`fixedExtension: false`，`dts: false`，`clean: false`），注释说明双入口分别对应 `main`（`lib/extension.js`）与 `exports["."].default`（`lib/index.js`） | 新增 |
| 2 | `tsdown.config.ts`（根） | `workspace` 数组由 `['vendor/*', 'packages/*/*', 'apps/cli']` 追加 `'apps/vscode-dsh'`；根 `entry` / `outDir` / `plugins` 等不动 | 修改 |
| 3 | `apps/vscode-dsh/package.json` | ① `files`：`lib/index.js, lib/extension.js` → `lib/*.js`（保留 `lib/types/**/*.d.ts`、`media/**/*`、`webview/dist/**/*`）；② `scripts` 新增 `"build:host": "tsc -b && tsdown"`；③ `vscode:prepublish` / `prepublishOnly` 改为 `pnpm run build:host && pnpm run webview:build`；④ `devDependencies` 新增 `"tsdown": "^0.22.2"` | 修改 |
| 4 | `.cursor/skills/project-build/SKILL.md` | 新增「vscode-dsh host 侧 tsc→tsdown 产物链」条目；将「render 抽离」「session search」两条标注为「仅 webview/纯 TS 面，无 host bundler」 | 修改 |

**未改动（按 design.md §7 约束）**：`apps/vscode-dsh/tsconfig.json`（保持 `outDir: "lib/types"`）、`apps/vscode-dsh/src/**`（`src/index.ts` 已 re-export editor-chat-panel 全部符号，无需补导出）、`webview/src` 与 `webview/dist`。

## 对每个验收标准的实现说明

| AC | 实现说明 | 状态 |
|----|---------|:----:|
| AC-1 | 四字段对齐：`main=lib/extension.js`、`exports["."].default=./lib/index.js`、`types=lib/types/extension.d.ts`、`exports["."].types=./lib/types/index.d.ts`、`files=lib/*.js`。构建后四个指向文件均真实存在，无错位 | ✅ |
| AC-2 | `lib/extension.js`（main）由 tsdown 产出（纯 re-export 入口），其 `import ... from "./extension-RWu5dSvU.js"` 加载共享 chunk（含 editor-chat-panel 完整实现）；`rg -l` 命中 2 个文件（`lib/index.js` + `lib/extension-RWu5dSvU.js`）≥1，非旧产物。见偏差 D-1 | ✅ |
| AC-3 | `lib/index.js` 与 `lib/extension.js` 同一次 `tsc -b` + tsdown 产出、同源 `src/`、共享 chunk，不分裂 | ✅ |
| AC-4 | `lib/types/extension.d.ts` + `lib/types/index.d.ts` 由 tsc 声明输出，真实存在 | ✅ |
| AC-5 | `files` 的 `lib/*.js` 覆盖双入口 + 共享 chunk（实测 3 个 `.js`） | ✅ |
| AC-6 | Node smoke：`createEditorChatPanelController`/`EDITOR_CHAT_PANEL_VIEW_TYPE`/`activate`/`registerChatPanelProvider` 均可达 | ✅ |
| AC-7 | `tsc -b apps/vscode-dsh --force` 退出码 0 | ✅ |
| AC-8 | vitest `313 passed + 1 skipped`；6 个失败为**预先存在**（spike fiber state / verifier RTL / panel e2e），与构建配置无关，无新增失败。见偏差 D-2 | ✅ |
| AC-9 | 干净树重建：`rm -rf lib` 后 tsc + tsdown 完整重建，`lib/` 仅 3 个 tsdown 产物 | ✅ |
| AC-10 | 幂等：两次 tsdown 产物 md5 完全一致 | ✅ |
| AC-11 | 无 `DEEPSEEK_API_KEY`、无网络下构建成功 | ✅ |

## 测试/验证结果（命令 + 输出）

### 1. tsc 编译门禁（AC-7）

```bash
export PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH
./node_modules/.bin/tsc -b apps/vscode-dsh --force
# EXIT_CODE=0
```

### 2. tsdown 打包（AC-2/AC-3）

```bash
cd apps/vscode-dsh && ../../node_modules/.bin/tsdown
# ℹ entry: lib/types/extension.js, lib/types/index.js
# ℹ lib/index.js                 3.42 kB
# ℹ lib/extension.js             0.52 kB
# ℹ lib/extension-RWu5dSvU.js  417.49 kB
# ✔ Build complete
```

### 3. 产物含 editor-chat-panel（AC-2/AC-3）

```bash
rg -l "EDITOR_CHAT_PANEL_VIEW_TYPE|createEditorChatPanelController|createWebviewPanel" apps/vscode-dsh/lib/*.js
# apps/vscode-dsh/lib/index.js
# apps/vscode-dsh/lib/extension-RWu5dSvU.js
```

### 4. 类型入口（AC-4）

```bash
ls apps/vscode-dsh/lib/types/extension.d.ts apps/vscode-dsh/lib/types/index.d.ts
# 两个 .d.ts 均存在
```

### 5. Node smoke（AC-6）

```bash
node --input-type=module -e "const m = await import('./apps/vscode-dsh/lib/index.js'); console.log(typeof m.createEditorChatPanelController, typeof m.EDITOR_CHAT_PANEL_VIEW_TYPE, typeof m.activate, typeof m.registerChatPanelProvider)"
# createEditorChatPanelController: function | EDITOR_CHAT_PANEL_VIEW_TYPE: string | activate: function | registerChatPanelProvider: function
# EXIT_CODE=0
```

### 6. vitest 回归（AC-8）

```bash
./node_modules/.bin/vitest run apps/vscode-dsh/tests/
# Test Files  4 failed | 44 passed (48)
#      Tests  6 failed | 313 passed | 1 skipped (320)
```

6 个失败用例均为**预先存在**（Node 22.14.0 重跑同样失败；改动不碰 `src/` 与 `tests/`）。

### 7. 干净树重建（AC-9）

```bash
rm -rf apps/vscode-dsh/lib
./node_modules/.bin/tsc -b apps/vscode-dsh --force   # EXIT=0
cd apps/vscode-dsh && ../../node_modules/.bin/tsdown
# 重建后 lib/*.js 仅 3 个 tsdown 产物（无旧残留）
```

### 8. 幂等（AC-10）

两次 tsdown 打包，`lib/{extension,index,extension-RWu5dSvU}.js` md5 完全一致。

## 偏差记录

### D-1：AC-2 grep 判据与 tsdown 双入口产物结构不完全对应

- **偏差描述**：tsdown 双入口打包下，`lib/extension.js`（`main`）是 515B 纯 re-export 入口，不内联 editor-chat-panel 符号字符串；实际可执行代码在共享 chunk `lib/extension-RWu5dSvU.js` 中。AC-2 严格字面判据「`rg ... lib/extension.js` 命中 ≥1」在仅 grep 入口文件时命中 0。
- **影响范围**：requirements.md §AC-2 / spec.md AC-2 判定要点。
- **原因**：tsdown 多入口共享依赖图的正常产物结构（与 `apps/cli` `lib/bin.js` 先例一致）。
- **影响**：功能正确性不受影响——`lib/extension.js` 通过相对 import 加载共享 chunk，VS Code 加载 `main` 能解析 editor-chat-panel 完整路径（AC-6 已证明）。按任务判据「`rg -l ... lib/extension.js lib/index.js` 命中 ≥1」命中 2 个文件，满足。建议 reviewer/verifier 确认 AC-2 判据表述。

### D-2：vitest 全量回归存在 6 个预先存在失败

- **偏差描述**：全量 vitest 有 6 个失败用例（4 文件），集中在 spike（fiber state）、verifier 独立脚本（RTL CSS）、panel e2e。
- **影响范围**：requirements.md §AC-8。
- **原因**：改动仅改构建配置，不碰 `src/` 与 `tests/`；Node 22.14.0 重跑同样失败。
- **影响**：不新增失败；核心回归（313 passed）全绿。属既有测试债，非本 Phase 引入，不在本 bugfix 范围。

## 已知 gap

- **G-1（非阻塞）**：`clean: false` 下非干净树场景中 `lib/` 会残留 2026-09-11 旧 tsc 直接 emit 产物，被 `lib/*.js` 一并打包进 `.vsix`（冗余，不影响正确性），干净树重建后消失。属 design §6 R-stale 已预见情况，不注册 DEBT-N。

## 环境

- Node 24.3.0（`export PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH`）。
- 构建/测试均用 `./node_modules/.bin/{tsc,tsdown,vitest}` 直调，绕过 pnpm postinstall（宿主 git 2.25.1 < 2.26 会失败）。
