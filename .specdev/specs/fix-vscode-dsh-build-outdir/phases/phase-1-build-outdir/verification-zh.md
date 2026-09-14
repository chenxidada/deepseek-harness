# Phase 1 验证报告（中文镜像）

<!-- 镜像：verification.md（zh canonical） | slug: fix-vscode-dsh-build-outdir | phase: phase-1-build-outdir -->

## 判决：PASS

vscode-dsh 作用域内 11 条 AC 全部达成；端到端路径（干净重建 → tsc 中间态 → tsdown runtime → Node 双入口 import）全程连通；无本 Phase 引入的 CRITICAL/MEDIUM 残余风险。唯一需知悉的是**预先存在、与本修复无关**的仓库级环境前置条件（根 `build:lib:host` 被 specdev/ide-bridge/sdk-server 既有类型错误阻断），详见「残余风险」与「Known Gaps」。

## 测试执行矩阵

| AC | 结果 | 关键证据 |
|----|:--:|------|
| AC-1 布局一致性 | ✅ | runtime `.js` 落 `lib/`、`.d.ts` 落 `lib/types/`，四字段指向文件全部真实存在 |
| AC-2 main 含 editor-chat-panel | ✅ | `rg` 命中 `lib/index.js` + `lib/extension-RWu5dSvU.js`（≥1） |
| AC-3 exports.default 同源 | ✅ | 与 main 同次 tsdown 产出，共享 chunk |
| AC-4 types 由 tsc 生成 | ✅ | `extension.d.ts`（11014B）+ `index.d.ts`（3823B）存在，JSDoc 头 |
| AC-5 files 覆盖 | ✅ | `lib/*.js` glob 覆盖 3 个 runtime 文件 |
| AC-6 符号可达 | ✅ | Node import 双入口全符号可达 |
| AC-7 tsc 0 错误 | ✅ | `tsc -b apps/vscode-dsh --force` 退出码 0 |
| AC-8 无新增失败 | ✅ | 确定性子集 30 用例全绿；6 失败独立复现为预先存在 |
| AC-9 干净树重建 | ✅ | `rm -rf lib` 后完整重建 |
| AC-10 幂等 | ✅ | 两次 md5 完全一致 |
| AC-11 离线/无 key | ✅ | `DEEPSEEK_API_KEY` 为空，构建成功 |

## 独立验证场景

| 场景 | 结果 |
|------|:--:|
| 根 workspace 集成（`tsdown --env.DSH_BUILD_FACE host`） | ⚠️ 正确发现 vscode-dsh 双入口，但整仓构建被无关包 `dsh-command-specdev` 阻断（见 G-V1） |
| 包级 tsdown（`--config` 触发） | ✅ 产出 3 文件，exit 0 |
| main 入口 re-export 链 | ✅ `import lib/extension.js` → activate/deactivate 可达 |
| 库入口全符号 | ✅ `import lib/index.js` → controller/VIEW_TYPE/activate/registerChatPanelProvider 全可达 |

## 端到端验证

| 数据路径 | 结果 |
|---------|:--:|
| `src/extension.ts` → `lib/types/extension.js`（89054B）→ `lib/extension.js`（main）→ import 解析 activate/deactivate | ✅ |
| `src/index.ts` → `lib/types/index.js`（2483B）→ `lib/index.js` → import 解析 editor-chat-panel 符号 | ✅ |
| 双入口共享依赖图 → 共享 chunk `extension-RWu5dSvU.js`（417.49kB，含 8 处符号） | ✅ |
| `files: lib/*.js` → 覆盖 extension.js + index.js + chunk | ✅ |

## 残余风险

| 风险 | 严重性 | 说明 |
|------|:--:|------|
| 根 `build:lib:host` 被阻断 | 🟡 MEDIUM（预先存在，非本修复） | 无关包 specdev/ide-bridge/sdk-server 的既有类型错误；vscode-dsh 包级 `build:host` 已完整验证通过 |
| G-1 非干净树残留 | 🟢 LOW | `clean:false` 下旧产物冗余，AC-9 干净重建后消失 |

## Known Gaps

- **G-V1（非阻塞，预先存在）**：根 `build:lib:host` 无法端到端跑绿（无关包既有类型错误）；本修复包级 `build:host` 已验证通过并接入 prepublish，不影响交付物正确性。
- 其余：无未解决 Known Gap（tech-debt-registry 保持为空）。

## Pipeline 合规检查

- ✅ 非 specs 改动均在 `impl-phase-1-build-outdir` 工作区。
- ⚠️ `apps/vscode-dsh/webview/dist/assets/*` 为既有脏状态，HG-3 提交时排除。

## 验证脚本

- `test-scripts/verify-build-outdir.sh`（已落盘，一键可重跑）。
