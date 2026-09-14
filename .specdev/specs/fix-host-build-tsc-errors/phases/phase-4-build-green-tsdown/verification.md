# Phase 4 验证报告

## 判决：PASS

## 测试执行矩阵

| 场景 | 来源 | 命令 | 结果 | 证据 |
|------|:--:|------|:--:|------|
| AC-1: tsc 退出码 0，0 个 error TS | spec | `node --max-old-space-size=4096 ./node_modules/typescript/bin/tsc -b tsconfig.host.json`（干净树，Node 24.3.0） | ✅ | `TSC_EXIT=0`；`grep -c "error TS"` = 0；耗时 ~50.7s |
| AC-2: build:lib:host 退出码 0（tsc + tsdown） | spec | 直调串联 `node .../tsc -b tsconfig.host.json && ./node_modules/.bin/tsdown --env.DSH_BUILD_FACE host` | ✅ | `TSC2_EXIT=0`、`TSDOWN_EXIT=0` |
| AC-2: pnpm 直调（原始命令） | spec | `pnpm run build:lib:host` | ⚠️ 环境失败 | `PNPM_BUILD_EXIT=1`，`install-lefthook.mjs` postinstall：git 2.25.1 < 2.26（宿主环境问题，非本 Phase 改动；spec.md §说明 允许直调绕过） |
| AC-6: 正确打包，不报 Cannot find entry | spec | `tsdown --env.DSH_BUILD_FACE host` 日志 grep | ✅ | `Cannot find entry` 计数 0；`config file: .../command-specdev/tsdown.config.ts`；`entry: lib/types/index.js`（单入口） |
| AC-6: lib/index.js 存在且非空 | spec | `ls` / `wc -c` | ✅ | `packages/specdev/command-specdev/lib/index.js` = 19672 字节（非空） |
| AC-6（静态）: tsdown.config.ts 存在且单入口 | spec | `cat` | ✅ | 存在，`entry: ['lib/types/index.js']`，8 字段与 3 个单入口兄弟包逐字一致 |
| AC-7: 任一步骤失败非 0 且可定位 | spec | 临时移除 `lib/types/index.js` 后重跑 tsdown（trap 自动恢复） | ✅ | `NEG_EXIT=1`；`[UNRESOLVED_ENTRY] Cannot resolve entry module lib/types/index.js.` |

## 独立验证场景（verifier 自己设计，非 implementer）

| 场景 | 命令 | 结果 |
|------|------|------|
| 端到端行为：打包产物可被真实 Node 24 运行时加载并导出正确符号 | `node --input-type=module -e "import('./packages/specdev/command-specdev/lib/index.js')..."` | ✅ `IMPORT_OK exports: apply, constitutionExists, formatStatusReport, inject, name, slugifyDescription, techDebtRegistryExists`（7 个导出，与 repo-exploration §8 记录一致） |
| clean:false 不误删 lib/ 已有产物 | tsdown 后检查 `lib/` 目录完整性 | ✅ tsdown 打包后 `lib/` 仍同时保留 `index.js`（tsdown 产物）与 `lib/types/{index.js,index.d.ts,index.js.map,index.d.ts.map}`（tsc 中间产物），证明 `clean:false` 未清空 outDir |
| tsc 产物真实性（非手工伪造） | 检查 `lib/types/index.js` 尾部 | ✅ 含 `//# sourceMappingURL=index.js.map`，确认由 tsc emit，非手工伪造掩盖未 emit |
| tsdown 优先采用包级配置（非根 brace 展开） | 检查 tsdown 日志 | ✅ `config file: .../command-specdev/tsdown.config.ts` + `entry: lib/types/index.js`，证明单入口生效、未回落根 `lib/types/{index,invariant,startup}.js` |

## Reviewer 建议的验证场景

| 场景 | 命令 | 结果 |
|------|------|------|
| Node 24.3.0 环境 | `node --version`（PATH 覆盖后） | ✅ `v24.3.0`（默认 shell 为 v20.16.0，低于 tsdown engines，已显式覆盖） |
| 干净树 | `./node_modules/.bin/tsx scripts/clean.ts` | ✅ `removed 224 paths`；`command-specdev/lib/` 目录整体移除 |
| AC-1 全量（排除增量缓存） | 干净树后 `tsc -b tsconfig.host.json`（无 .tsbuildinfo 缓存，等同 --force 全量） | ✅ exit 0，0 error TS |
| AC-7 反向恢复后回到绿态 | trap `mv` 恢复 + 重新确认 `lib/index.js` | ✅ `lib/types/index.js` 恢复 23165 字节；`lib/index.js` 19672 字节 |

## 端到端验证

| 数据路径 | 结果 | 证据 |
|---------|------|------|
| 干净树 → `tsc -b tsconfig.host.json`（emit `lib/types/index.js`）→ `tsdown --env.DSH_BUILD_FACE host`（读包级 config，单入口打包）→ `lib/index.js`（19672 字节，ESM）→ 动态 import 成功导出 7 个符号 | ✅ 全链路连通 | 见上矩阵与独立场景 |

## 残余风险

| 风险 | 严重性 | 说明 |
|------|:--:|------|
| `pnpm run build:lib:host` 在本宿主机因 git 2.25.1 < 2.26 触发 `install-lefthook` postinstall 失败 | 🟢 LOW | 环境问题（宿主 git 版本），非本 Phase 改动引入；spec.md §说明 已授权用 `./node_modules/.bin/*` 直调绕过。CI 宿主 git ≥ 2.26 时 `pnpm run build:lib:host` 可正常执行。 |

## Pipeline 合规检查

- ✅ 所有 source 改动在 `impl-*` 分支：当前分支 `impl-phase-4-build-green-tsdown`；唯一 source 交付物 `packages/specdev/command-specdev/tsdown.config.ts` 状态为 `??`（untracked，未提交，符合「implementer 在分支上不自行 commit」）。
- ✅ `git log --all --oneline` 显示 Phase 1/2/3 已按序提交合并；Phase 4 交付物保留在 impl 分支工作区待 HG-3 验收后由调度者提交。
- ✅ 无非 specs 文件在 `impl-*` 分支外被修改。

## 验证脚本

- `.specdev/specs/fix-host-build-tsc-errors/phases/phase-4-build-green-tsdown/test-scripts/verify-phase4.sh`（已落盘，含 clean-tree → AC-1 → AC-2 → AC-6 → AC-7 反向（trap 恢复）→ 端到端 import 全链，输出 ✅/❌ 汇总与退出码）

## 问题清单

无。AC-1/2/6/7 全部独立验证通过；端到端 import 成功；唯一残余风险（git 2.25.1 postinstall）为 🟢 LOW 环境问题，spec 已授权直调绕过，不构成 PASS 的阻碍。

## 判决依据

- AC-1 ✅ 干净树 tsc exit 0，0 error TS。
- AC-2 ✅ 直调串联 tsc + tsdown 两阶段 exit 0（pnpm 直调因宿主 git 版本环境失败，spec 允许绕过）。
- AC-6 ✅ `lib/index.js` 19672 字节非空；`Cannot find entry` 0；包级 config + 单入口生效。
- AC-7 ✅ 反向移除入口 → tsdown exit 1 + `[UNRESOLVED_ENTRY] Cannot resolve entry module lib/types/index.js.`（可定位到包与文件）。
- 独立端到端：产物被 Node 24 真实加载并导出 7 个符号。
