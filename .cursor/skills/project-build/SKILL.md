---
name: project-build
description: >-
  Build/compile knowledge: commands, flags, dependency install, environment setup,
  common build errors and solutions. Use when: building, compiling, encountering
  build errors, changing build configuration, or installing dependencies.
  Trigger words: cmake, build, compile, make, ninja, gcc, clang, link, library, dependency.
---

## 项目构建技能

本文件由 implementer agent 在项目开发过程中自动维护，validator agent 交叉验证。
记录项目特有的构建知识，避免每次重新摸索。

**⚠️ 维护规则**：
- 每条知识有验证状态：✅ 已验证 / ⚠️ 已过期 / ❌ 未验证
- 错误或过期的条目标记为 ⚠️ 而非删除，保留历史但注明不再适用
- 同一事物的多条记录应合并，而非并列
- validator 在验证失败时也应检查并更新构建知识

---

## 构建命令

> **状态说明**：✅=已验证可用 | ⚠️=已过期/不可用 | ❌=未验证

### OpenCode 插件（.mjs）— 无需构建
- **状态**：✅ 已验证
- **环境**：Node.js 20.16.0
- **说明**：`.opencode/plugins/` 下的 `.mjs` 文件是纯 JavaScript ES Module，由 OpenCode 框架直接加载执行，无需编译或构建步骤。用到的 API 仅限于标准 Node.js 模块（`fs/promises`、`path`），无外部依赖。
- **文件**：`enforcement-gate.mjs`、`kb-sync-runtime.mjs`
- **最后验证**：2026-06-16 by implementer，Phase 2 enforcement plugin 加载测试通过

### vscode-dsh chat-panel render 抽离 — 无需单独构建（仅 webview/纯 TS 面）
- **状态**：✅ 已验证
- **环境**：Node 22.14.0；TypeScript ESM 由 vitest/vite 直接加载
- **说明**：`apps/vscode-dsh/src/chat-panel/render/*` 与 `probes.ts` 为纯 TS 模块；产品路径通过 `*BrowserSource()` 字符串嵌入 `buildThinChatHtml`，无 bundler 步骤。改 render 算法后须同步维护同文件内 browser source。**本条目仅指 webview/纯 TS 面，无 host bundler**；host 侧 runtime 产物链见下一条。
- **最后验证**：2026-09-10 by implementer（layer-a 10/10 + chassis 回归）

### vscode-dsh session search（phase-6）— 无需单独构建（仅纯 TS 面）
- **状态**：✅ 已验证
- **环境**：Node 22.14.0；vitest 直接加载 TS ESM
- **说明**：`apps/vscode-dsh/src/search/*` 为纯 Host 侧模块（workspaceState 持久化）；无 bundler。改动后跑 `apps/vscode-dsh/tests/chat-ux-session-search.spec.ts`。**本条目仅指纯 TS 面（vitest 直接加载 TS），无 host bundler**；host 侧 runtime 产物链见下一条。
- **最后验证**：2026-09-11 by implementer（6/6）

### vscode-dsh host 侧 tsc→tsdown 产物链 — 需构建
- **状态**：✅ 已验证
- **环境**：Node 24.3.0（`export PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH`；仓库默认 PATH 是 Node 20.16.0，不在支持范围）
- **正确构建命令**：根 `pnpm run build:lib:host`（= `node --max-old-space-size=4096 ./node_modules/typescript/bin/tsc -b tsconfig.host.json && tsdown --env.DSH_BUILD_FACE host`）；或包级 `cd apps/vscode-dsh && pnpm run build:host`（= `tsc -b && tsdown`）。
- **产物链**：`tsc -b` 产中间态到 `apps/vscode-dsh/lib/types/`（`.js` + `.d.ts`），`tsdown` 打包 runtime 到 `apps/vscode-dsh/lib/`（`lib/extension.js` = `main`，`lib/index.js` = `exports["."].default`）。`lib/types/*.js` 是中间态，插件运行时加载的是 `lib/*.js`。
- **配置**：`apps/vscode-dsh/tsdown.config.ts` 双入口 `entry: ['lib/types/extension.js', 'lib/types/index.js']`，`dts: false`（声明由 tsc 产出）；`apps/vscode-dsh` 已纳入根 `tsdown.config.ts` 的 `workspace`。
- **注意**：`lib/` 是 gitignored 构建产物（不入库，可从干净树重建）；tsdown/tsc/vitest 用 `./node_modules/.bin/*` 直调绕过 pnpm postinstall（宿主 git 2.25.1 < 2.26 会失败）。
- **最后验证**：2026-09-14 by implementer（tsc -b 0 错误；tsdown 产出 `lib/extension.js` + `lib/index.js` 且含 editor-chat-panel）

### ✅ sdk/server ↔ specdev 引用边界（project reference 修复）
- **状态**：✅ 已验证
- **环境**：Linux, **Node 24.3.0**（`export PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH`）
- **命令**：`./node_modules/.bin/tsc -b packages/sdk/server --force`（全量重编译，排除 composite 缓存假阳性；约 13s）
- **说明**：`packages/sdk/server/tsconfig.json` 的 `references[]` 现含 `{ "path": "../../specdev/specdev" }`，使其对 `@deepseek-ai/dsh-specdev` 的运行时 import 走 project reference（`.d.ts` 解析），不再走 `paths` 把 `packages/specdev/specdev/src` 拽入 program。`@deepseek-ai/dsh-specdev` 同时从 `peerDependencies`/`devDependencies` 移入 `dependencies`（`workspace:^`）。
- **注意**：`tsc -b` 会产生构建副作用，向部分引用项目（如 `vendor/cordis/src/`）emit `.js`/`.d.ts`/`.map`（非 tracked 改动，提交时只 add 实际改动的源文件）。
- **最后验证**：2026-09-14 by implementer（`tsc -b packages/sdk/server --force` exit 0，0 个 `error TS`，TS6059/TS6307 计数 0）

---

## 依赖安装

<!-- 格式同上，标注状态 + 环境 + 最后验证时间 -->

*（尚无已验证的依赖安装信息 — 插件使用标准 Node.js API，无需额外依赖）*

---

## 环境要求

### Node.js
- **状态**：✅ 已验证
- **版本**：v20.16.0（经 nvm 管理）
- **路径**：`/home/chendc/.nvm/versions/node/v20.16.0/bin/node`
- **最后验证**：2026-06-16 by implementer

<!-- 特殊环境变量、工具版本等，同样标注验证状态 -->

---

## 常见问题与解决方案

<!-- 遇到编译错误并解决后记录，标注问题现象 + 解决方案 + 验证状态 -->

*（尚无记录的构建问题）*

---

## 注意事项

### Phase 1: 文本规则硬化
- **状态**: ✅ 已验证
- **说明**: Phase 1（Enforcement System Text Rule Hardening）为纯文本配置变更，修改 `.opencode/agents/orchestrator.md`、`AGENTS.md`、`.opencode/snippets/escalation-protocol.md`、`.opencode/snippets/unified-pipeline.md`。无需编译/构建步骤。
- **最后验证**: 2026-06-16 by implementer

*（尚无特殊注意点）*
