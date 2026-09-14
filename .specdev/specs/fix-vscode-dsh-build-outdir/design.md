# 架构设计：fix-vscode-dsh-build-outdir

<!--
  slug: fix-vscode-dsh-build-outdir
  audience: implementer / reviewer / verifier / HG-2
  language: zh (canonical)
  upstream: requirements.md（AC-1 ~ AC-11，EARS）
  nature: bugfix（构建产物目录一致性修复，不改运行时行为）
-->

## 1. 根因与设计目标（一句话）

`apps/vscode-dsh` 的 `tsconfig.json` 设 `outDir: "lib/types"`，使 `tsc -b` 把 runtime JS 与 `.d.ts` 一起发射到 `lib/types/`；但 `package.json` 的 `main`/`exports` 指向 `lib/*.js`，且该 app 既无包级 `tsdown.config.ts`、也不在根 `tsdown.config.ts` 的 `workspace` 中，导致 `lib/*.js` 一直是 2026-09-11 的旧产物、不含 editor-chat-panel。本设计的目标是：**让「构建产物落盘位置」与「`main`/`types`/`exports`/`files` 四个字段」严格对齐**，且完全复用仓库既有的「tsc 产中间态 + tsdown 打包 runtime」约定，不另起一套流程。

## 2. 关键架构决策

### 决策 1（对应 Q-1）：方向 B —— 保持 `outDir: "lib/types"` 中间态 + 补包级 `tsdown.config.ts`

- **选择**：`apps/vscode-dsh/tsconfig.json` 的 `outDir: "lib/types"` **保持不变**；新增 `apps/vscode-dsh/tsdown.config.ts`（参照 `apps/cli/tsdown.config.ts`），把 runtime 从 `lib/types/*.js` 打包到 `lib/*.js`（`dts: false`），并把该 app 纳入根 tsdown workspace。
- **理由**：
  1. 与 `docs/development.md` § TypeScript project layout 的权威约定完全一致——「Tsdown consumes only the JavaScript emitted to `lib/types` by the preceding tsc phase」。`tsc -b` 产中间态（JS + `.d.ts` 落 `lib/types/`），tsdown 把 runtime 打包到 `lib/`（`dts: false`），`.d.ts` 留在 `lib/types/`。
  2. `apps/cli` 就是这套组合的**已验证模板**（tsconfig 完全同构 `outDir: "lib/types"`，包级 `tsdown.config.ts` 产 `lib/bin.js`，根 workspace 已纳入）。`apps/vscode-dsh` 缺的正是「包级 tsdown 配置 + 根 workspace 纳入」这两块。
  3. tsdown 负责把 app 内部跨模块引用打平为单文件/共享 chunk，避免 runtime 里残留 `.ts` 扩展或相对路径错位（对应需求 R1）。
- **替代方案与放弃理由**：
  - **方向 A（改 `outDir` 回 `lib` + `declarationDir: "lib/types"`）**：偏离「tsc 产中间态 + tsdown 打包」的统一模式；且需额外验证 `rewriteRelativeImportExtensions` 下跨包相对导入在 Node 中可正确加载。放弃。
  - **方向 C（改 `main` 指向 `lib/types/extension.js`）**：runtime 与 `.d.ts`/`.map` 混目录，与 `files` 既有语义（`lib/types/**/*.d.ts` vs `lib/*.js`）冲突，vsce 可能混入不必要文件。最不推荐。放弃。

### 决策 2（对应 Q-2）：正确构建命令 = 根 `pnpm run build:lib:host`，且 `vscode:prepublish` 纳入 host 构建

- **选择**：
  1. **正确 host 侧构建命令 = `pnpm run build:lib:host`**（等价于 `node --max-old-space-size=4096 ./node_modules/typescript/bin/tsc -b tsconfig.host.json && tsdown --env.DSH_BUILD_FACE host`）。
  2. 为 `apps/vscode-dsh` 增加包级 `build:host` 脚本（`tsc -b && tsdown`），并把 `vscode:prepublish` / `prepublishOnly` 改为「先 host 构建、再 webview 构建」，保证 `vsce package` 产出最新 runtime。
- **理由**：
  1. 已核实 `apps/vscode-dsh` **已在 `tsconfig.host.json` 的 `references` 中**（第 277 行 `{ "path": "./apps/vscode-dsh" }`），故 `tsc -b tsconfig.host.json` 会把它编译到 `lib/types/`。把 `apps/vscode-dsh` 加入根 tsdown `workspace` 后，`tsdown --env.DSH_BUILD_FACE host` 会消费该中间态并产出 `lib/*.js`。因此根 `build:lib:host` 是**唯一**能同时产出「tsc 中间态 + tsdown 运行时」的仓库约定命令，且满足 AC-11（tsc + tsdown 均本地执行，无需 `DEEPSEEK_API_KEY` 或网络）。
  2. `vsce package` 会调用 `vscode:prepublish`（并由 npm 生命周期联动 `prepublishOnly`）；若这两者仍只跑 `webview:build`，则 `.vsix` 内的 `lib/*.js` 可能是磁盘上的旧产物（对应需求 R5）。纳入 host 构建后，`vsce package` 自洽产出最新 runtime。
  3. 包级 `build:host` 采用 `tsc -b && tsdown`：`tsc -b` 会自动构建引用图（ide-bridge / sdk-client / subprocess / file-reference，见 project-test skill 已核实条目）；`tsdown` 在无 `--env.DSH_BUILD_FACE` 时按「本地单包开发」模式返回包内入口（见 `.agents/notes/.../2026-08-08-api-remotes-generated-contract-build.md`：未指定 face 的包内 tsdown 仍返回正常入口）。
- **纳入根 workspace 与根 entry 是否冲突**：不冲突。根 `tsdown.config.ts` 的 host 面 `entry: ['lib/types/{index,invariant,startup}.js']` 是**缺省 entry**，只作用于「无包级配置」的包；`apps/vscode-dsh` 新增包级 `tsdown.config.ts` 后，tsdown 会优先使用包级 entry（这正是 `apps/cli` 的先例——它是 workspace 成员且用包级 entry 覆盖根 entry）。因此新增 `apps/vscode-dsh` 到 workspace 数组后，不会与根 entry 冲突。

### 决策 3（对应 Q-3、Q-6）：双入口 `entry` 数组 + `files` 改为 `lib/*.js` glob

- **选择**：
  1. `apps/vscode-dsh/tsdown.config.ts` 的 `entry` 用数组同时覆盖两个运行时入口：`entry: ['lib/types/extension.js', 'lib/types/index.js']`。tsdown 按 entry basename 产出 `lib/extension.js`（对应 `main`）与 `lib/index.js`（对应 `exports["."].default`）。
  2. `package.json` 的 `files` 从显式列举 `lib/index.js, lib/extension.js` 改为 glob `lib/*.js`（参照 `apps/cli/package.json` 的 `files: ["lib/*.js"]`），以覆盖 tsdown 可能产出的共享 chunk。
- **理由**：
  1. `src/index.ts` **已经** re-export editor-chat-panel 相关符号（`EDITOR_CHAT_PANEL_VIEW_TYPE`、`createEditorChatPanelController`、`ChatPanelHost`、`FakeWebviewPort`、`CHAT_PANEL_VIEW_ID` 等，见 `src/index.ts`），因此**无需补导出**，库入口天然含 editor-chat-panel。Q-3 的「若不 re-export 是否补充」分支不触发。
  2. `src/extension.ts`（编译为 `lib/types/extension.js`）在 `activate()` 中调用 `createEditorChatPanelController`；`src/index.ts`（编译为 `lib/types/index.js`）re-export 它。两个入口同源 `src/`、由同一次 `tsc -b` + tsdown 产出，满足 AC-3「同源、不分裂」。
  3. 已核实 `apps/cli/lib/` 的 tsdown 产物除入口 `bin.js` 外还含 hash 后缀 chunk（`plugin-WDISvmGc.js`、`profile-boot-BBDiUnZs.js` 等），`apps/cli` 用 `files: ["lib/*.js"]` 覆盖。`apps/vscode-dsh` 双入口共享大量依赖图（chat-panel / conversation-controller 等），tsdown 极可能产出共享 chunk，故 `files` 必须用 glob 而非枚举（对应 AC-5）。

## 3. 目标目录布局

```
apps/vscode-dsh/
├── tsconfig.json           # 不变：rootDir=src, outDir=lib/types（tsc 中间态）
├── tsdown.config.ts        # 新增：entry=[lib/types/extension.js, lib/types/index.js], outDir=lib, dts:false
├── package.json            # 改：files→lib/*.js；scripts 增 build:host；prepublish 链 host 构建；devDep 增 tsdown
├── src/
│   ├── extension.ts        # 插件激活入口（main）          → lib/types/extension.js → lib/extension.js
│   ├── index.ts            # 库入口（exports["."].default）→ lib/types/index.js     → lib/index.js
│   └── chat-panel/...      # editor-chat-panel 源码（已被两入口引用）
└── lib/                    # gitignored，构建产物（不入库）
    ├── extension.js        # tsdown 产物 = main             ✅ 含 editor-chat-panel
    ├── index.js            # tsdown 产物 = exports.default   ✅ 含 editor-chat-panel
    ├── <shared-chunk>*.js  # tsdown 共享 chunk（若有）       ✅ 被 lib/*.js 覆盖
    └── types/              # tsc 产物（中间态，.js + .d.ts）
        ├── extension.js / extension.d.ts
        ├── index.js / index.d.ts
        └── chat-panel/...
```

## 4. 构建链路图（ASCII）

```
干净树（apps/vscode-dsh/lib/ 已删除）
    │
    ▼
pnpm run build:lib:host
    │
    ├─ ① tsc -b tsconfig.host.json ───────────────► lib/types/*.js + *.d.ts（中间态）
    │     apps/vscode-dsh 已在 tsconfig.host.json references（行 277）
    │
    └─ ② tsdown --env.DSH_BUILD_FACE host ────────► lib/{extension,index}.js（最终态 runtime）
          · 根 tsdown workspace 新增 'apps/vscode-dsh'
          · 包级 tsdown.config.ts: entry=[lib/types/extension.js, lib/types/index.js]
          · 可能产出共享 chunk：lib/<chunk>*.js
    │
    ▼
package.json 四字段对齐（AC-1）：
   main            = lib/extension.js        ✅ 由 tsdown 产出
   exports["."].default = lib/index.js       ✅ 由 tsdown 产出
   types           = lib/types/extension.d.ts ✅ 由 tsc 产出（真实存在）
   exports["."].types = lib/types/index.d.ts  ✅ 由 tsc 产出（真实存在）
   files           = lib/*.js（覆盖 entry + 共享 chunk）+ lib/types/**/*.d.ts
    │
    ▼
vsce package（可选补充验证，AC-5 / AC-6）
   vscode:prepublish = build:host（tsc -b && tsdown）→ webview:build
```

## 5. 关键文件改动清单

| 文件 | 改动 | 性质 |
|------|------|------|
| `apps/vscode-dsh/tsdown.config.ts` | 新增：双入口打包配置（`entry: ['lib/types/extension.js', 'lib/types/index.js']`，`outDir: 'lib'`，`format: ['esm']`，`platform: 'node'`，`target: 'es2024'`，`fixedExtension: false`，`dts: false`，`clean: false`），逐字段对齐 `apps/cli/tsdown.config.ts` | 新增 |
| `tsdown.config.ts`（根） | `workspace` 数组由 `['vendor/*', 'packages/*/*', 'apps/cli']` 追加为 `['vendor/*', 'packages/*/*', 'apps/cli', 'apps/vscode-dsh']`；其余（root entry / outDir / typert 等）不变 | 修改 |
| `apps/vscode-dsh/package.json` | ① `files`：`lib/index.js, lib/extension.js` → `lib/*.js`；② `scripts` 增 `build:host: "tsc -b && tsdown"`；③ `vscode:prepublish` / `prepublishOnly` 改为 `pnpm run build:host && pnpm run webview:build`；④ `devDependencies` 增 `tsdown`（与根同版本 `^0.22.2`） | 修改 |
| `apps/vscode-dsh/tsconfig.json` | **不改**（保持 `outDir: "lib/types"`，对应决策 1） | 无改动 |
| `apps/vscode-dsh/src/**` | **不改**（`src/index.ts` 已 re-export editor-chat-panel，`src/extension.ts` 已在 activate 调用 `createEditorChatPanelController`，对应决策 3） | 无改动 |

> 维护动作（超出 AC 但 requirements.md §权威构建流程依据 要求回填）：implementer 完成后更新 `.cursor/skills/project-build/SKILL.md`，新增「vscode-dsh host 侧 tsc→tsdown 产物链」条目（含 `build:lib:host` / `build:host` 命令、Node 24.3.0 PATH、`lib/types`→`lib` 布局），并把现有「无需单独构建」的两条 render/session-search 条目标注为仅指 webview/纯 TS 面。

## 6. 风险与缓解

| 风险 | 说明 | 缓解 |
|------|------|------|
| **R-chunk（新增）** | 双入口共享依赖图可能使 tsdown 产出 hash 后缀共享 chunk，`files` 若仍枚举 `lib/index.js, lib/extension.js` 会漏包 | 决策 3：`files` 改为 `lib/*.js`（对照 `apps/cli` 先例），AC-5 用 `vsce package` 产物内容复核 |
| **R-prepublish（对应需求 R5）** | `vscode:prepublish` 若未纳入 host 构建，`vsce package` 打出旧 runtime | 决策 2：prepublish 链 `build:host`；实现者须实测 `vsce package` 触发链 |
| **R-external（跨包依赖）** | `@deepseek-ai/dsh-ide-bridge` 等 4 个 workspace 依赖被 tsdown 视为 external（bare import 保留），运行时需从 node_modules 解析 | 与 `apps/cli` 现状一致（其 `bin.js` 也保留 `@deepseek-ai/dsh-app-boot` bare import）；这 4 个包已在 `dependencies` 中，vsce 会按现有机制打包；本次不改变 `dependencies` |
| **R-client-pass（冗余重打包）** | 包级 tsdown 配置未做 `DSH_BUILD_FACE` 门控，Client pass 会重复打包 `lib/types/extension.js`（磁盘上仍在） | 与 `apps/cli` 完全一致（无 face 门控、双 pass 均返回入口），冗余但无害；不引入额外复杂度 |
| **R-stale（旧产物误判）** | `lib/` 根目录残留旧产物，可能使验证者误判「入口已存在即已修复」 | 验证以 AC-2（`rg -l "EDITOR_CHAT_PANEL_VIEW_TYPE|..."` 命中）＋ AC-9（干净树重建）双重锁定，避免误判 |

## 7. 范围与不变量

- **不改**任何运行时逻辑、线契约、webview 源码与 `webview/dist/`；**不新增**功能面；**不引入**运行时依赖（仅增 devDependency `tsdown`，见决策 2）。
- **不破坏** `fix-vscode-dsh-host-tsc` 建立的 `tsc -b apps/vscode-dsh` 0 错误基线（AC-7）。
- **不改变** `lib/` 被 gitignore 的事实；构建必须可从干净树重建（AC-9）、幂等（AC-10）、离线可跑（AC-11）。
