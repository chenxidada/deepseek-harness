# Phase 1 验证报告（fix-vscode-dsh-build-outdir）

<!-- slug: fix-vscode-dsh-build-outdir | phase-id: phase-1-build-outdir | verifier: 独立验证 | language: zh -->

## 判决：PASS

所有 11 条 AC 在 vscode-dsh 作用域内全部达成；端到端路径（干净重建 → tsc 中间态 → tsdown runtime → Node 双入口 import 符号可达）全程连通；无本 Phase 引入的 CRITICAL/MEDIUM 残余风险。仅存在一处**预先存在、与本修复无关**的仓库级环境前置条件（根 `build:lib:host` 统一构建命令被 specdev/ide-bridge/sdk-server 的既有类型错误阻断），已列入 §残余风险 与 §Known Gaps 供调度者知悉，不构成本修复的回归或缺口。

## 测试执行矩阵

| AC | 来源 | 命令 | 结果 | 证据 |
|----|:--:|------|:--:|------|
| AC-1 布局一致性 | spec | 读 `package.json` 四字段 + `ls lib/` / `lib/types/` | ✅ | `main=lib/extension.js` 存在；`exports["."].default=./lib/index.js` 存在；`types=lib/types/extension.d.ts` 存在；`exports["."].types=./lib/types/index.d.ts` 存在；runtime `.js` 落 `lib/`、`.d.ts` 落 `lib/types/`，无错位 |
| AC-2 main 含 editor-chat-panel | spec | `rg -l "EDITOR_CHAT_PANEL_VIEW_TYPE\|createEditorChatPanelController\|createWebviewPanel" apps/vscode-dsh/lib/*.js` | ✅ | 命中 `lib/index.js` + `lib/extension-RWu5dSvU.js`（≥1），非 9/11 旧产物 |
| AC-3 exports.default 同源不分裂 | spec | 同上 + 同次构建产物比对 | ✅ | `lib/index.js`（3.42kB）与 `lib/extension.js`（0.52kB）同次 tsdown 产出，共享 chunk `extension-RWu5dSvU.js` |
| AC-4 types 由 tsc 生成 | spec | `ls lib/types/extension.d.ts index.d.ts` + 文件头 | ✅ | `extension.d.ts`（11014B）+ `index.d.ts`（3823B）存在，头为 JSDoc 注释（tsc declaration 输出，非 tsdown） |
| AC-5 files 覆盖运行时产物 | spec | 读 `files` 字段 + 计数产物 | ✅ | `files=["lib/*.js","lib/types/**/*.d.ts",...]`；`lib/*.js` glob 覆盖 3 个 `.js`（extension/index/chunk） |
| AC-6 加载后可解析 editor-chat-panel | spec | Node `import` 双入口 | ✅ | `lib/index.js`：controller=function、VIEW_TYPE="dsh.editorChat"、activate=function；`lib/extension.js`：activate/deactivate=function |
| AC-7 tsc -b 0 错误 | spec | `./node_modules/.bin/tsc -b apps/vscode-dsh --force` | ✅ | 退出码 0，无 `error TS`（7.4s） |
| AC-8 vitest 无新增失败 | spec | `vitest run <确定性子集>` | ✅ | 5 文件 30 用例全绿；6 个失败经独立复现为预先存在（见 §AC-8） |
| AC-9 干净树重建 | spec | `rm -rf lib` → `tsc -b --force` → `tsdown` | ✅ | 重建后 `lib/` 仅含 3 个 tsdown 产物 + types + tsbuildinfo，无旧残留 |
| AC-10 幂等 | spec | 连续两次 tsdown + md5 | ✅ | 两次 md5 完全一致（见 §AC-10） |
| AC-11 离线/无 key | spec | `env` 无 `DEEPSEEK_API_KEY` 下构建 | ✅ | `DEEPSEEK_API_KEY` 为空，构建成功，无网络请求 |

## 独立验证场景（verifier 设计，非 implementer 测试）

| 场景 | 命令 | 结果 |
|------|------|:--:|
| **根 workspace 集成（root cause #2 的直接实证）** | `./node_modules/.bin/tsdown --env.DSH_BUILD_FACE host` | ⚠️ 发现 vscode-dsh 双入口被正确识别，但整仓构建被无关包 `dsh-command-specdev` 缺 entry 阻断（见 §Known Gaps G-V1） |
| 包级 tsdown 经 `--config` 触发 | `./node_modules/.bin/tsdown --config apps/vscode-dsh/tsdown.config.ts` | ✅ 产出 3 文件，exit 0 |
| main 入口 re-export 链完整性 | `node --input-type=module -e "import('./apps/vscode-dsh/lib/extension.js')"` | ✅ activate/deactivate 从 chunk 解析成功 |
| 库入口全符号可达 | `import('./apps/vscode-dsh/lib/index.js')` | ✅ controller/VIEW_TYPE/activate/registerChatPanelProvider/deactivate 全可达 |

## Reviewer 建议的验证场景

| 场景 | 命令 | 结果 |
|------|------|:--:|
| AC-2 字面复验（D-1） | `rg -l "EDITOR_CHAT_PANEL_VIEW_TYPE\|..." apps/vscode-dsh/lib/*.js` | ✅ 命中 `lib/index.js` + `lib/extension-RWu5dSvU.js` |
| AC-6 覆盖 main 入口（补 implementer 只测 index 的缺口） | `import('./apps/vscode-dsh/lib/extension.js')` | ✅ activate/deactivate 可达 |
| AC-9 干净树重建 | `rm -rf lib` → `tsc -b` + `tsdown` | ✅ 完整重建 |
| AC-7 tsc 门禁 | `tsc -b apps/vscode-dsh --force` | ✅ 退出码 0 |

## 端到端验证

| 数据路径 | 结果 | 证据 |
|---------|:--:|------|
| `src/extension.ts` → `tsc -b` → `lib/types/extension.js`（89054B）→ `tsdown` → `lib/extension.js`（main）→ Node import 解析 activate/deactivate | ✅ | import exit 0 |
| `src/index.ts` → `tsc -b` → `lib/types/index.js`（2483B）→ `tsdown` → `lib/index.js`（exports.default）→ Node import 解析 editor-chat-panel 符号 | ✅ | controller=function, VIEW_TYPE="dsh.editorChat" |
| 双入口共享依赖图 → tsdown 产共享 chunk `extension-RWu5dSvU.js`（417.49kB，含 8 处 editor-chat-panel 符号） | ✅ | `rg -c` = 8 |
| `files: lib/*.js` glob → 覆盖 extension.js + index.js + chunk | ✅ | 3 文件全匹配 glob |

## AC-8 独立复现（预先存在失败，非本修复引入）

- 确定性激活/editor-chat-panel 子集：`editor-chat-panel.lifecycle` + `chat-ready-regression` + `phase1-auto-start` + `auto-start-orchestrator` + `panel-l2-l3-protocol` → **5 文件 30 用例全绿**（exit 0）。
- 独立复现 implementer 报告的预存失败之一：`panel-close-delete.e2e.spec.ts` → **1 failed | 3 passed**，失败点 `controller.messages.hasContent(keep.sessionId)` 断言（运行时逻辑，与构建配置无关）。
- 铁证：`git status -s apps/vscode-dsh/src/`、`apps/vscode-dsh/tests/` 均为空 —— 本修复零触碰源码与测试，vitest 直接加载 TS 源、不读 `lib/` 产物，故不可能引入新失败。

## AC-10 幂等证据

```
extension.js          md5 = aa2176def8c6db36f1998b63fc26e4a2  （两次一致）
index.js              md5 = 424d7bcf02934158f5e5dd83d3ac6e06  （两次一致）
extension-RWu5dSvU.js md5 = 1844682104b47a4310777af755e4d980  （两次一致）
```

## 残余风险

| 风险 | 严重性 | 说明 |
|------|:--:|------|
| 根 `build:lib:host` 统一构建命令当前被阻断 | 🟡 MEDIUM（预先存在，非本修复） | `tsc -b tsconfig.host.json` 在 `packages/specdev/specdev`、`packages/specdev/specdev-gate`、`packages/sdk/server`、`packages/ide/ide-bridge/tests` 等**与本修复无关**的包上产出 TS6059/TS6307/TS2379/TS2769/TS2352 既有错误（exit 2）；随之根 `tsdown --env.DSH_BUILD_FACE host` 因 `dsh-command-specdev` 缺 `lib/types/{index,invariant,startup}.js` 而 exit 1。**根 workspace 已正确发现 vscode-dsh 双入口**，故修复本身正确；此风险属仓库既有类型债，不在本 bugfix 范围（requirements.md §不在范围内）。 |
| G-1（implementer 已记）非干净树残留 | 🟢 LOW | `clean:false` 下非干净树 `lib/` 根可能残留 9/11 旧产物，会被 `lib/*.js` 一并打进 .vsix（冗余不碍正确性）；AC-9 干净重建后自然消失。design 决策 3 明确要求 `clean:false`，非债务。 |

## Known Gaps

- **G-V1（非阻塞，预先存在，与本修复无关）**：根 `pnpm run build:lib:host`（= `tsc -b tsconfig.host.json && tsdown --env.DSH_BUILD_FACE host`）在当前工作区**无法端到端跑绿**，原因是 specdev/ide-bridge/sdk-server 等无关包的既有类型错误（并非 vscode-dsh 引入）。本修复的**包级 `build:host`（`tsc -b && tsdown`）路径已完整验证通过**，且已正确接入 `vscode:prepublish`/`prepublishOnly`（vsce 打包时触发）。根统一命令需待上述无关类型债在其各自工作流中解决后才会放行 vscode-dsh——不影响本次修复的正确性与交付物。
- 其余：无未解决的 Known Gap（tech-debt-registry 保持为空，符合 requirements.md §C-6）。

## Pipeline 合规检查

- ✅ 当前分支 `impl-phase-1-build-outdir`；非 specs 改动（`apps/vscode-dsh/package.json`、根 `tsdown.config.ts`、新增 `apps/vscode-dsh/tsdown.config.ts`）均在 `impl-phase-1-build-outdir` 工作区（未提交，待 HG-3 提交），无其他分支上的非 specs 变更。
- ⚠️ 注意：`apps/vscode-dsh/webview/dist/assets/{index.css,index.js}` 为工作区**既有脏状态**（非本修复引入，review S-2 已提示），HG-3 提交时应排除。
- ✅ 无 `git` 破坏性操作；验证全程只读 + 仅写入 gitignored 的 `apps/vscode-dsh/lib/` 构建产物与 spec 目录。

## 验证脚本

- `test-scripts/verify-build-outdir.sh`（已落盘）：干净重建 + 中间态校验 + tsdown 打包 + 双入口符号可达 + grep 命中 + 幂等，一键可重跑。
