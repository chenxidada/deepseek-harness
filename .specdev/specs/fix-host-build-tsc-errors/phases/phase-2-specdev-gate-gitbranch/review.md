# Phase 2 审查报告：specdev-gate gitBranch 类型修复

## 判决：PASS

## 审查范围

- 活跃工作流 slug：`fix-host-build-tsc-errors`
- 当前 Phase：`phase-2-specdev-gate-gitbranch`
- 改动文件：仅 `packages/specdev/specdev-gate/src/index.ts`（两处，`:128` 与 `:167`）
- `check.ts`、`git-branch.ts`、`authority.ts` 均未改动（已验证）

## 逐条验收标准审查

| AC | 内容 | 验证方法 | 结果 |
|----|------|---------|:--:|
| AC-4 | `packages/specdev/specdev-gate` 构建产出 0 个 TS2379 | 亲跑 `tsc -b packages/specdev/specdev-gate --force`（node 24.3.0） | ✅ 退出码 0，输出 0 条 `error TS2379`，无任何其他错误 |
| AC-4 | `index.ts:127-129` 与 `:166-168` 两处改为条件展开，无 `: undefined` 三元尾 | `git diff` + 读源码 | ✅ 两处均为 `...role === 'implementer' ? { gitBranch: gitReader(cwd) } : {}` |
| AC-4 | `check.ts:22-25` 的 `EvaluateRoleOptions.gitBranch` 仍为 `readonly gitBranch?: string | null`，未被放宽 | 读 `check.ts:22-25` | ✅ 契约未变 |
| AC-4 | `evaluateImplementer` 的 `actual === undefined`（`:148`）与 `actual === null`（`:155`）分支仍在 | 读 `check.ts:146-160` | ✅ fail-closed 矩阵完整 |

## 实现正确性

两处改动完全符合预期，语义分析如下：

1. **根因消除**：原三元 `role === 'implementer' ? gitReader(cwd) : undefined` 的类型为 `string | null | undefined`，在 `exactOptionalPropertyTypes: true` 下，可选属性 `gitBranch?: string | null` 一旦显式写出，值不能为 `undefined`，触发 TS2379。改为条件展开后，`role === 'implementer'` 时 `gitBranch` 以 `string | null` 作为属性存在（合法）；否则**整个键省略**，不产生显式 `undefined`。TS2379 消除。

2. **fail-closed 语义保持**（关键点已逐分支核对）：
   - `role !== 'implementer'` 时键省略 → `options.gitBranch` 读得 `undefined` → `check.ts:148` `actual === undefined` 分支命中 → `SPECDEV_BRANCH_UNKNOWN` 拒绝。**「省略=拒绝」语义未被破坏**。
   - `readGitBranch` 返回 `null`（git 不可用）→ 键存在但值为 `null` → `check.ts:155` `actual === null` 分支命中 → 拒绝。
   - 分支不匹配 → `check.ts:161` `actual !== expected` → `SPECDEV_BRANCH_MISMATCH` 拒绝。
   - 条件展开「省略键」与旧代码「显式 undefined」在运行时均表现为属性缺失，`actual === undefined` 分支仍命中，运行时行为完全一致。

3. **无 `(void)args` / 空函数体 / 硬编码返回**：本 Phase 为纯类型层改写，未新增任何函数体，无桩信号。

## 设计一致性

- ✅ 完全遵循 design.md **决策 D-2** 的条件展开形态，逐字符一致：`...role === 'implementer' ? { gitBranch: gitReader(cwd) } : {}`。
- ✅ 未采用被否决的替代方案（放宽类型为 `string | null | undefined`）。
- ✅ 未使用 `as any` / `as unknown as` / `!` 非空断言等规避手段。
- ✅ 未触碰 `check.ts` 类型契约，未超出 Phase 范围（`git diff` 确认仅 `index.ts` 两行改动）。

## 集成连通性

- ✅ `GitBranchReader`（`git-branch.ts:11`）返回 `string | null`，与 `EvaluateRoleOptions.gitBranch?: string | null`（`check.ts:24`）类型匹配。
- ✅ 两条调用链（`wrapDispatchRole` → `evaluateRoleDispatch`；`denyForAgent`/`evaluateForRole` → `evaluateRoleDispatch`）的对象字面量实参形状保持不变，`evaluateRoleDispatch(role, auth, options)` 的第三参仍为 `EvaluateRoleOptions`，下游 `evaluateImplementer` 读取 `options.gitBranch` 的契约不受影响。
- ✅ `wrapDispatchRole` 与 `evaluateForRole` 两个调用方均使用同一条件展开形态，对称一致。

## 桩检测报告

| 信号 | 检查结果 |
|------|---------|
| 函数体只有 `(void)args` / 空 `{}` | 无（本 Phase 未新增函数） |
| 硬编码 `return` 假实现 | 无 |
| `#ifdef` 假实现无 `#else` | 无 |
| 函数名暗示逻辑但空壳 | 无 |

`readGitBranch` 的 `catch { return null }` 是 fail-closed 契约行为（git 不可用即拒绝），非桩。**未发现任何空壳函数或虚假实现。**

## 发现的问题

- 🔴 must-fix：无。
- 🟡 should-fix：无。
- 🟢 optional：无。

## Registry 对照

- `tech-debt-registry.md`「活跃债务」与「已解决」均为空，无已注册桩需对照。
- 未发现未注册的桩，无需新增条目。
- 无已解决条目需关闭。

## Amendment Tracking

- implementation.md「偏差记录」声明「无偏差」，与设计 D-2 和 spec AC-4 一致，无需处理 Amendments。
- spec.md 与 design.md 的修订记录表均为空，无需追加。

## 验证命令建议（给 verifier）

1. **权威编译验证**（本 reviewer 已亲跑复现，结果一致）：
   ```bash
   export PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH
   ./node_modules/.bin/tsc -b packages/specdev/specdev-gate --force
   # 期望：退出码 0，无任何错误输出
   ./node_modules/.bin/tsc -b packages/specdev/specdev-gate --force 2>&1 | grep -c "error TS2379"
   # 期望：0
   ```
2. **静态核对**：`git diff -- packages/specdev/specdev-gate/src/index.ts` 应仅显示 `:128` 与 `:167` 两行 `-gitBranch: ... : undefined,` → `+...role === 'implementer' ? { gitBranch: gitReader(cwd) } : {},`。
3. **契约不变核对**：`grep -n "gitBranch?:" packages/specdev/specdev-gate/src/check.ts` 应仍为 `readonly gitBranch?: string | null`。
4. **说明**：本 Phase 为纯类型层修复，无运行时行为变化可测。specdev-gate 的 vitest 单测因 vendored cordis 的 `const enum FiberState` source-plane 失败（已知环境限制，见 `.cursor/skills/project-test/SKILL.md`），与本 Phase 无关，不纳入本 Phase 验收判定；验收证据以 AC-4 的 tsc 编译验证为准（spec 已明确）。
