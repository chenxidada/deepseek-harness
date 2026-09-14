# Phase 2 验证报告：specdev-gate gitBranch 类型修复

## 判决：PASS

## 测试执行矩阵

| 场景 | 来源 | 命令 | 结果 | 证据 |
|------|:--:|------|:--:|------|
| AC-4: `specdev-gate` 0 个 TS2379 | spec | `export PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH; ./node_modules/.bin/tsc -b packages/specdev/specdev-gate --force` | ✅ | 退出码 0，stdout/stderr 无任何错误输出 |
| AC-4: 明确 TS2379 计数 = 0 | spec | `./node_modules/.bin/tsc -b packages/specdev/specdev-gate --force 2>&1 \| grep -c "error TS2379"` | ✅ | `0` |
| AC-4: 任意 TS 错误计数 = 0 | spec | `... --force 2>&1 \| grep -c "error TS"` | ✅ | `0` |
| AC-4: 两处改为条件展开，无 `: undefined` 三元尾 | spec | `git diff -- packages/specdev/specdev-gate/src/index.ts` | ✅ | 仅 2 行 `-gitBranch: ... : undefined,` → `+...role === 'implementer' ? { gitBranch: gitReader(cwd) } : {},` |
| AC-4: `check.ts` 契约未放宽 | spec | `git diff -- .../check.ts` + `grep -n "gitBranch?:" check.ts` | ✅ | `check.ts` 无 diff；`:24` 仍为 `readonly gitBranch?: string | null` |
| AC-4: fail-closed 分支仍在 | spec | 读 `check.ts:146-167` | ✅ | `actual === undefined`(:148)、`actual === null \|\| length===0`(:155)、`actual !== expected`(:161) 均完整 |

## 独立验证场景（我自己设计的）

| 场景 | 命令 | 结果 |
|------|------|:--:|
| 静态残留检查：`index.ts` 无 `: undefined,` / `as any` / `@STUB` / 旧三元 | `grep -nE ": undefined,\|as any\|as unknown as\|@STUB\|gitBranch: role === 'implementer' \\? gitReader\\(cwd\\) : undefined" .../index.ts \| wc -l` | ✅ `0` |
| 静态残留检查：`index.ts` 无非空断言 `!` | `grep -nE "![.,)]" .../index.ts \| wc -l` | ✅ `0` |
| 运行时等价性证明（省略键 vs 显式 undefined） | `node .../test-scripts/verify-runtime-equivalence.mjs` | ✅ 13 passed, 0 failed |
| 包内既有 vitest 独立复跑 | `./node_modules/.bin/vitest run packages/specdev/specdev-gate/tests/specdev-gate.spec.ts` | ⚠️ 9 failed（已知 FiberState source-plane 限制，见残余风险，与本 Phase 无关） |

## Reviewer 建议的验证场景

| 场景 | 命令 | 结果 |
|------|------|:--:|
| 权威编译验证（`tsc -b --force` + TS2379 grep） | `./node_modules/.bin/tsc -b packages/specdev/specdev-gate --force` + grep | ✅ 退出码 0，TS2379=0 |
| 静态核对 `git diff` 仅两行改动 | `git diff -- .../index.ts` | ✅ 仅 `:128` 与 `:167` 两处条件展开 |
| 契约不变核对 `grep gitBranch?:` | `grep -n "gitBranch?:" check.ts` | ✅ `readonly gitBranch?: string \| null` |

## 端到端验证

本 Phase 为纯类型层一致性修复，不改变任何运行时行为（条件展开「省略键」与「显式 undefined」在 `actual === undefined` 判断下运行时等价）。无独立的「运行时端到端数据路径」可测——AC-4 的验收语义即「编译通过」（`tsc -b` 退出码 0 + 0 个 TS2379）。

运行时等价性证明（独立脚本 13/13 passed）覆盖了 fail-closed 数据路径的四个分支：

| 数据路径 | 结果 | 证据 |
|----------|:--:|------|
| `role !== implementer` → 键省略 → `options.gitBranch === undefined` → 拒绝 | ✅ | 脚本场景 1 |
| `role === implementer` 且 git 返回 `null` → `actual === null` → 拒绝 | ✅ | 脚本场景 2 |
| `role === implementer` 且分支匹配 → 允许 | ✅ | 脚本场景 3 |
| `role === implementer` 且分支不匹配 → 拒绝 | ✅ | 脚本场景 4 |

关键等价性论证：省略键与显式 `undefined` 的唯一差异是 `'gitBranch' in obj`（前者 `false`、后者 `true`），但 `check.ts` 的 `evaluateImplementer` 只使用 `actual === undefined` 判断，不依赖 `in` 操作符，因此二者判定结果完全一致（脚本场景 5 实证）。

## 残余风险

| 风险 | 严重性 | 说明 |
|------|:--:|------|
| 包内既有 vitest 9/9 失败 | 🟢 LOW（本 Phase 无关） | 失败根因为 `const enum FiberState` 在 vitest source-plane（esbuild）下不被跨文件内联，运行时 `FiberState` 为 `undefined`（`scripts/test-invariants.ts` 读 `.ACTIVE` 抛 TypeError）。这是**已知、已文档化**的环境限制（`.cursor/skills/project-test/SKILL.md` §274-280），发生在测试 harness 的 `requireActive` 不变量检查阶段，**先于**本 Phase 修改的 `index.ts` dispatch 路径执行。本 Phase 为纯类型层修复，无运行时行为变化，AC-4 验收以 tsc 编译验证为准（spec 已明确）。 |

## Pipeline 合规检查

✅ Pipeline compliance：本 Phase 非 specs 文件（`packages/specdev/specdev-gate/src/index.ts`）的改动在 `impl-phase-2-specdev-gate-gitbranch` 分支上。

- 当前分支（`git branch --show-current`）= `impl-phase-2-specdev-gate-gitbranch`
- `git status --short -- packages/specdev/specdev-gate` = ` M packages/specdev/specdev-gate/src/index.ts`（未提交工作区改动，符合「implementer 在分支上不自行 commit」约定）
- `git log --all --name-only -- packages/specdev/specdev-gate/src/index.ts` 唯一历史提交为 `b924a6783e`（原始实现，属 Phase-3-gate-advance 基线，非本 Phase 改动）

## 主动问题上报

无。本 Phase 为编译级验收，判决 PASS 的依据：

- AC-4 权威证据：独立运行 `tsc -b packages/specdev/specdev-gate --force`（Node 24.3.0）退出码 0，0 个 TS2379，0 个任意 TS 错误。
- 静态残留检查：`index.ts` 无 `: undefined` 三元尾、无 `as any` / `@STUB` / 非空断言；`check.ts` 契约 `readonly gitBranch?: string | null` 未放宽；fail-closed 三分支完整。
- 运行时等价性独立脚本 13/13 passed，证明省略键与显式 undefined 在 `actual === undefined` 下语义等价。

唯一未跑通的 vitest 为已知、已文档化的 FiberState source-plane 限制，与本 Phase 类型层改动无因果关系，不构成 PARTIAL/FAIL 依据。

## 验证脚本

- `.specdev/specs/fix-host-build-tsc-errors/phases/phase-2-specdev-gate-gitbranch/test-scripts/verify-runtime-equivalence.mjs`（13 场景运行时等价性证明，exit 0）
