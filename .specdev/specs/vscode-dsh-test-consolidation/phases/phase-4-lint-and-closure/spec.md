# Phase 4: lint program 与收口

## 目标

把 `tests/tsconfig.json` 的 `include` 改为 glob 覆盖全目录，使 tests 目录整体进入 lint program；在测试资产内修掉 203 条真实 lint 缺陷使 `oxlint` 归零；显式记录 tsc 类型错误口径；Node 24.3.0 下 `vitest run apps/vscode-dsh/tests` 全绿最终收口。

## 前置条件

- 依赖 spec 文件：`design.md`（lint 归零方案 + oxlint 基线口径 + tsc 口径）、`phase-plan.md`。
- 已完成的 Phase：`phase-2-tests-consolidation`（tests 定稿）、`phase-3-test-scripts-consolidation`（scripts 定稿 + DEBT-1 关闭）。
- 运行环境：Node 24.3.0，命令 `env PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" <cmd>`。
- Git 分支：`impl-phase-4-lint-and-closure`（从 `new/vscode-dsh` 切出）。

## 验收标准

| 编号 | 内容 |
|------|------|
| AC-13 | 域修改验证为完整域文件运行（verification.md 记录完整域文件运行命令与输出） |
| AC-14 | Node 24.3.0 下 `vitest run apps/vscode-dsh/tests` 失败用例数 = 0 |
| AC-15 | `tests/tsconfig.json` `include` 以 glob 覆盖全目录，不再用逐文件白名单 |
| AC-16 | `npx tsx scripts/run-oxlint.ts apps/vscode-dsh/tests` 退出码 0（0 error） |
| AC-17 | `tests/tsconfig.json` 头部注释更新为整合后事实（不再陈述「目录过大不可作为 program」） |
| AC-18 | 残留 tsc 类型错误口径显式记录（写 registry），不沉默略过 |

## 验证策略

| AC | 验证类型 | 验证方法 | 预期结果 |
|----|---------|---------|---------|
| AC-13 | 静态检查 | verification.md 含完整域文件运行命令与输出（如 `vitest run apps/vscode-dsh/tests/cap-<domain>.spec.ts`） | 完整域文件运行留痕 |
| AC-14 | 运行时验证 | `env PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" ./node_modules/.bin/vitest run apps/vscode-dsh/tests` | `failed` = 0 |
| AC-15 | 静态检查 | 读 `tests/tsconfig.json` 的 `include`，确认无具体文件名；`include` 匹配文件集合 vs 清单 spec 集合双向差集 | glob 覆盖，双向差集为空 |
| AC-16 | 运行时验证 | `npx tsx scripts/run-oxlint.ts apps/vscode-dsh/tests` | 退出码 0，0 error |
| AC-17 | 静态检查 | 读 `tests/tsconfig.json` 头部注释 | 无「目录过大不可作为 program」陈述，含新 glob 口径说明 |
| AC-18 | 静态检查 | 读 registry，确认 tsc 类型错误口径条目存在 + 后续归属 | 显式记录，非沉默 |

## 约束（来自 design.md）

- 203 条 lint 缺陷**在测试资产内**修，不得为修 lint 改 `src/**`（AC-24）；若某条必须改生产代码 → HG-2/HG-3 显式升级。
- lint 修复若触发断言语义变更 → 记入 `implementation.md` 偏差章节 + 台账 `weakened`（AC-29 ③）。
- tsc 归零**不是**本工作流验收条件，但「未归零」必须写下来（AC-18），归属 `DEBT-019` tests 段口径。
- 不新增门禁脚本；本 Phase 只让既有门禁（`run-oxlint.ts`、`check:test-scripts-syntax`）对 tests/test-scripts 通过。

## 产出清单

- `apps/vscode-dsh/tests/tsconfig.json`（`include` 改 glob + 头部注释更新）
- `apps/vscode-dsh/tests/` 内 lint 修复（测试资产内）
- `.specdev/specs/vscode-dsh-test-consolidation/tech-debt-registry.md`（tsc 口径条目，如需）
- `.specdev/specs/vscode-dsh-test-consolidation/phases/phase-4-lint-and-closure/implementation.md`
