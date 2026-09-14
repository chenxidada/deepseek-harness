# Phase 3 验证报告：测试文件类型债修复

## 判决：PASS

核心验收 AC-5（host aggregate 下三个测试文件 0 个 TS2379 / TS2769 / TS2352）已用真实执行证据独立复核达成：干净树 `tsc -b tsconfig.host.json --force`（Node 24.3.0，全量重编译，排除 composite 缓存假阳性）退出码 0、输出为空（0 个 TS2379、0 个 TS2769、0 个 TS2352，且 0 个任意 `error TS`）。静态残留检查通过（0 处 `@ts-expect-error` / `@ts-ignore` / `as any` / `@STUB`），三文件改动与 spec.md/design.md 方案逐条一致，未触碰任何 Events 声明。运行时可验证文件 `ide-bridge.spec.ts` 独立运行 17/17 通过。

---

## 测试执行矩阵

| 场景 | 来源 | 命令 | 结果 | 证据 |
|------|:--:|------|:--:|------|
| AC-5: host aggregate 全量重编译 0 个目标错误 | spec | `./node_modules/.bin/tsc -b tsconfig.host.json --force`（Node 24.3.0） | ✅ | `EXIT_CODE=0`，输出为空，0 个 `error TS`（实测 96.8s） |
| AC-5: 无残留类型压制 | spec | `rg "@ts-expect-error\|@ts-ignore\|as any\|@STUB" <三文件>` | ✅ | 无匹配（rg exit 1） |
| AC-5: boundarySeq 条件展开（无直赋） | spec | `rg "boundarySeq: options\?\.boundarySeq"` | ✅ | 无匹配；diff 显示 `...(options?.boundarySeq === undefined ? {} : { boundarySeq: options.boundarySeq })` |
| AC-5: 5 处 `agent:` 改 `stubAgent(…)` | spec | `git diff` + `rg "stubAgent\("` | ✅ | 6 次出现（1 定义 + 5 调用），diff 显示 5 处替换 |
| AC-5: 两处 `as unknown as` 断言正确 | spec | `rg "as unknown as" <三文件>` | ✅ | `:117` `as unknown as { snapshot: unknown }`；`:648` `as unknown as Agent`（stubAgent）；`:313` `as unknown as Agent` |
| AC-5: 回归（vitest source-plane） | spec | `vitest run ide-bridge.spec.ts` | ✅ | 17/17 通过（见「回归验证」） |
| AC-5: 回归（specdev 两文件） | spec | `vitest run specdev.spec.ts specdev-advance.spec.ts` | ⚠️ | 12 failed / 6 passed，失败点为预存 `const enum FiberState`（见「发现的问题」） |

---

## 独立验证场景（verifier 自行设计）

### 场景 1：`stubAgent` 与 `resolveBridgeSessionId` 运行时鸭子类型等价性（implementer 未单独论证的运行时字段读取）

追踪运行时消费者 `resolveBridgeSessionId`（`packages/ide/ide-bridge/src/index.ts:200-205`），其函数体只读两个字段：

```typescript
function resolveBridgeSessionId(agent: { id: string; session?: { id?: string } }): string {
  const fromSession = agent.session?.id
  return fromSession === undefined || fromSession === '' ? agent.id : fromSession
}
```

`stubAgent(id, sessionId)` 返回 `{ id, session: { id: sessionId } }`（`as unknown as Agent` 仅编译期绕过富 `Agent` 缺字段，运行时对象形状不变）。因此 `resolveBridgeSessionId(stubAgent('a', 'sess-1'))` 返回 `'sess-1'`，与原字面量 `{ id: 'a', session: { id: 'sess-1' } }` 逐字段等价（`fromSession` 非空 → 返回 `session.id`）。结论：5 处替换的运行时断言语义未变。

### 场景 2：全量测试数核对（独立重跑 + 逐条 `it(` 枚举）

| 场景 | 命令 | 结果 |
|------|------|------|
| 枚举 ide-bridge 全部 `it(` 用例数 | 逐行 grep `it(` | 17 个用例，无 `it.skip`/`it.todo`/`describe.skip` |
| 独立运行全文件 | `vitest run packages/ide/ide-bridge/tests/ide-bridge.spec.ts` | 17 passed / 1 file，`VITEST_EXIT=0` |

> ⚠️ **报告偏差发现**：implementer/reviewer 报告写「23/23 通过」，实测该文件仅 17 个 `it(` 用例，独立重跑为 **17/17**。属上报计数不实（🟢 LOW 表面问题），不影响类型层验收实质——所有真实存在的用例全部通过。

### 场景 3：specdev 两文件失败根因的「预存性」独立确认

- 失败栈：`TypeError: Cannot read properties of undefined (reading 'ACTIVE')`，位于 `scripts/test-invariants.ts:188` 的 `requireActive`，即 vitest 测试 harness 在**进入改动行之前**读取 `const enum FiberState.ACTIVE`（`vendor/cordis/src/fiber.ts`）即抛错。
- `git diff` 证明 specdev 两文件的改动**纯属 `as unknown as` 类型断言**（`:117` 与 `:313` 各一行），编译期擦除、零运行时差异，不可能引入该运行时失败。
- 与 `project-test/SKILL.md` 已登记的预存问题一致（specdev-gate / sdk-server 的 `const enum FiberState` source-plane 失败，均判「非本 bugfix 引入」）。

结论：失败为仓库既有 vitest/esbuild 与 `const enum` 的固有不兼容，**非本 Phase 引入**。

---

## Reviewer 建议的验证场景

| 场景 | 命令 | 结果 |
|------|------|------|
| 干净树全量重编译 0 个目标错误 | `tsc -b tsconfig.host.json --force` | ✅ exit 0，输出空 |
| 静态复核无 `@ts-ignore`/`as any`/`@STUB` | `rg` 三文件 | ✅ 无匹配 |
| 回归 vitest（ide-bridge 仅） | `vitest run ide-bridge.spec.ts` | ✅ 17/17 |
| 范围确认仅 3 测试文件改动 | `git diff --stat` + `git status -s` | ✅ 3 个 `.spec.ts` 为 `M`；Events 声明文件无改动 |

---

## 端到端验证

| 数据路径 | 结果 | 证据 |
|---------|:--:|------|
| `tsc -b tsconfig.host.json` → host aggregate 编译整树（含 `packages/*/*/tests/**/*.ts`） | ✅ | exit 0，0 个任意类型错误 |
| `ctx.waterfall('approval/request', { agent: stubAgent(...) })` → `resolveBridgeSessionId(request.agent)` → `session.id` | ✅ | `ide-bridge.spec.ts` 17/17 通过（含 AC-16/17/20 端到端断言 + AC-19 fail-closed） |
| `forkSession` 的 `boundarySeq` 条件展开 → `forked.push({ parent, ...boundarySeq })` | ✅ | `ide-bridge.spec.ts` `session/fork` 用例通过 |

---

## 发现的问题（分条清单）

本判决为 **PASS**（而非 PARTIAL/FAIL）的理由与存在但非阻塞的问题分列如下：

1. 🟢 **implementer/reviewer 上报的「23/23」测试数不实**：`ide-bridge.spec.ts` 实际 17 个用例，独立重跑 17/17 全部通过。属表面计数误差，不影响「所有真实用例通过」的实质结论，故不判 PARTIAL。
2. 🟡 **specdev / specdev-advance 无法在 vitest 下做运行时回归**：失败点为预存 `const enum FiberState`（`scripts/test-invariants.ts:188 requireActive` 读 `FiberState.ACTIVE`），发生在改动行之前、属仓库既有基础设施问题。两文件改动为编译期擦除的纯 `as unknown as` 断言，零运行时差异，故不构成本 Phase 引入的回归。核心验收 AC-5（编译级 0 错误）已由 tsc exit 0 权威达成。此项仍按「无端到端运行时验证 → 至少 MEDIUM」列为残余风险（见下），但为**预存**、非本 Phase 引入。
3. 🟢 **`tsc -b --force` 构建副作用**：全量重编译会向部分引用项目 emit `.js`/`.d.ts`/`.map`（构建产物，非 tracked 改动），提交时只 add 3 个测试源文件即可（工作流已强制显式 `git add`）。

---

## 残余风险

| 风险 | 严重性 | 说明 |
|------|:--:|------|
| specdev / specdev-advance 无 vitest 运行时回归 | 🟡 MEDIUM | 预存 `const enum FiberState` 阻断 vitest source-plane；两文件改动为编译期擦除断言，无运行时行为可验证，AC-5 以 tsc exit 0 权威覆盖。非本 Phase 引入，建议记录为仓库既有债（const enum → vitest 兼容），不在本 Phase 范围。 |
| ide-bridge 测试数上报偏差 | 🟢 LOW | 报告「23/23」，实测 17 用例；纯计数误差，无功能影响。 |
| 工作区存在无关非 specs 改动 | 🟢 LOW | `apps/vscode-dsh/webview/dist/assets/*` 有未提交修改（本 Phase 无关的构建产物），调度者提交时须只 add 3 个测试文件。 |

---

## Pipeline 合规检查

- 当前分支：`impl-phase-3-test-type-debt` ✅
- `git log --all --oneline`：Phase 1（`phase-1-sdk-server-specdev-ref`）、Phase 2（`phase-2-specdev-gate-gitbranch`）均已独立 commit 并位于历史；本 Phase 的 3 个测试文件改动在 `impl-phase-3-test-type-debt` 分支工作区（`M`）。
- 本 Phase 的 3 个 source 改动（`ide-bridge.spec.ts` / `specdev.spec.ts` / `specdev-advance.spec.ts`）均在 `impl-*` 分支上 ✅。
- **合规观察（非违规）**：工作区另有 `apps/vscode-dsh/webview/dist/assets/index.{js,css}`（tracked 构建产物）未提交修改，与本 Phase 无关，不应纳入 Phase 3 提交（工作流已强制显式列举改动文件，风险可控）。
- Events 声明文件（`packages/interaction/user-approval/src/types.ts`、`user-questions/src/types.ts`）经 `git status` 确认**零改动**，符合「测试修正而非 Events 声明补全」约束 ✅。

Pipeline compliance: ✅ 本 Phase 全部 source 变更均在 `impl-phase-3-test-type-debt` 分支（另见上述无关 webview/dist 观察）。

---

## 验证脚本

- `.specdev/specs/fix-host-build-tsc-errors/phases/phase-3-test-type-debt/test-scripts/verify-phase3.sh`
  - 一键复现：tsc 全量重编译 + 三类错误计数 + 残留压制扫描 + 形态静态核对 + ide-bridge vitest 回归。

---

## 结论

AC-5 编译级验收由真实执行证据（`tsc -b tsconfig.host.json --force` 退出码 0、0 个 TS2379/TS2769/TS2352、0 个任意类型错误）独立复核达成；三文件改动与 spec 逐条一致、无压制残留、未触碰 Events 声明；运行时可验证文件 17/17 通过。specdev 两文件 vitest 失败为预存 `const enum FiberState` 基础设施问题（非本 Phase 引入）。判 **PASS**。
