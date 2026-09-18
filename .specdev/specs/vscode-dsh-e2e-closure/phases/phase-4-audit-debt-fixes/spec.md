# Phase 4: 审计遗留偏差 4/5/6 修复

## 目标

实际修复三个审计遗留偏差（非仅登记）：

- **偏差 4**（AC-11）：`vscode-dsh-editor-chat-panel` 两个 Phase 的「层 V 真机视觉验证从未执行」PARTIAL 根因。其截图/视觉断言证据由 Phase 1（editor-chat-panel 主呈现路径打样）+ Phase 2/3 产出；本 Phase 负责对该工作流缺失的 `review-visual.md` / `ui-spec.md` / `visual-baseline.md` 三文件给出处理方式（补齐或在偏差记录中显式声明「本工作流为验证基础设施、不产出产品 UI 视觉基线」）。
- **偏差 5**（AC-12）：清理 `lib/` 18 个陈旧 hash chunk，改 `tsdown clean: true` + `package.json#files` 收窄，使 `.vsix` 不再包含陈旧 chunk。
- **偏差 6**（AC-13）：`vendor/cordis/src/fiber.ts:147` 的 `const enum FiberState` → 普通 `enum`，登记进 `tech-debt-registry.md`（当前为空），并遵循 `vendor/README.md` 同步策略与本地修改记录流程。

## 前置条件

- 依赖 spec 文件：`../requirements.md`（AC-11~AC-13）、`../design.md`（AD-5/AD-6）、`../repo-exploration.md`（§偏差 5/6、§9 registry）。
- 前置 Phase：`phase-1-driver-framework-pilot`（偏差 4 的截图证据由此产出）。
- 与 Phase 2/3 无依赖，可并行（偏差 5/6 为纯代码修复，与能力驱动无代码交集）。

## 验收标准（本 Phase 覆盖）

| AC | 内容（摘要） |
|----|------|
| AC-11 | 偏差 4：产出 editor-chat-panel 层 V 视觉验证证据，消除 PARTIAL 根因；三文件处理方式在 implementation.md 偏差章节显式说明 |
| AC-12 | 偏差 5：清理 18 个陈旧 chunk + 调整 files 字段，`.vsix` 不再包含陈旧 chunk |
| AC-13 | 偏差 6：`const enum` → 普通 `enum` 修复 + 登记 tech-debt-registry + 遵循 vendor 同步策略 |

## 验证策略

| AC | 验证类型 | 验证方法 | 预期结果 |
|----|---------|---------|---------|
| AC-11 | 运行时验证 + 静态检查 | ① 引用 Phase 1/2/3 已产出的 editor-chat-panel 真机截图 + 视觉断言作为偏差 4 证据；② 检查本 Phase implementation.md 偏差章节对 `review-visual.md`/`ui-spec.md`/`visual-baseline.md` 三文件给出显式处理方式声明 | ① 存在 editor-chat-panel 真机截图证据 + 视觉断言（非「从未执行」）；② 三文件处理方式显式声明（本工作流为验证基础设施、不产出产品 UI 视觉基线） |
| AC-12 | 编译验证 + 静态检查 | ① `pnpm run build`（`apps/vscode-dsh`）后清点 `lib/` 的 `extension-<hash>.js` 数量与 `package.json#files` 清单；② 用 `vsce ls`（或等价打包清单核对）确认 `.vsix` 文件清单不含陈旧 chunk | ① `lib/` 仅含当前 1 个 `extension-BAEHy5fU.js`，`files` 精确收窄为入口文件；② 打包产物不含陈旧 chunk |
| AC-13 | 编译验证 + 运行时验证 + 静态检查 | ① 改 `fiber.ts:147` 为 `export enum FiberState`；② 跑受影响包 source-plane vitest（`pnpm --filter @deepseek-ai/dsh-sdk-server test`、`--filter @deepseek-ai/dsh-specdev ...` 等）确认不再 `TypeError`；③ 检查 `vendor/README.md` 本地修改记录新增条目 + `tech-debt-registry.md` 有偏差 6 条目 | ① 编译通过；② 受影响包 vitest source-plane 可运行（无 `Cannot read properties of undefined (reading 'UNLOADING')`）；③ vendor 记录 + registry 均登记 |

## 约束（来自 design.md）

- **AD-5**：偏差 5 用 `clean: true` + `files` 精确收窄（治本，防复发），不「只删陈旧 chunk 不改 clean」。
- **AD-6**：偏差 6 遵循 `vendor/README.md:53-61` 同步流程（重放本地修改 + 更新 manifest + `pnpm install && pnpm run test && pnpm run build`），并在 `:29-51` 本地修改记录追加条目。
- **registry 门禁**：`tech-debt-registry.md` 必须存在且登记偏差 6（`pipeline-gate.sh` 在 `hg3=passed` 时程序化校验 `@STUB`/债登记）。
- **开放问题**：偏差 6「受影响包完整集合」在 repo-exploration 标 ⚠️ HYPOTHESIS，本 Phase 以「修复后对已知受影响包 + 全仓 `pnpm run test`」实测收敛，不做先验断言。

## 产出清单

```
apps/vscode-dsh/tsdown.config.ts                         # 修改：clean: false → true
apps/vscode-dsh/package.json                             # 修改：files 精确收窄
vendor/cordis/src/fiber.ts                               # 修改：const enum FiberState → enum FiberState
vendor/README.md                                         # 修改：追加本地修改记录条目
.specdev/specs/vscode-dsh-e2e-closure/tech-debt-registry.md  # 修改：登记偏差 6
.specdev/specs/vscode-dsh-e2e-closure/phases/phase-4-audit-debt-fixes/implementation.md  # 新增：偏差章节（含 AC-11 三文件声明）
```
