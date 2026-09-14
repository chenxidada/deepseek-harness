# Phase 3 审查报告：测试文件类型债修复

## 判决：PASS

所有 8 处类型错误已按 design.md §FA-3 的方案正确修复，`tsc -b tsconfig.host.json`（含 `--force` 全量重编译）退出码 0、输出为空（0 个 TS2379 / TS2769 / TS2352，且 0 个任意 `error TS`）。仅修改 `tests/` 目录，未触碰任何 Events 声明，未引入 `@ts-expect-error` / `@ts-ignore` / `as any` / `@STUB`。

---

## 逐条验收标准审查

### AC-5（三个测试文件在 host aggregate 下 0 个 TS2379 / TS2769 / TS2352）

| 检查项 | 结果 | 证据 |
|--------|:--:|------|
| `tsc -b tsconfig.host.json` 退出码 0、0 个 TS2379/TS2769/TS2352 | ✅ | 实测：`EXIT_CODE=0`，输出为空 |
| `--force` 全量重编译（排除 composite 缓存假阳性） | ✅ | 实测：`EXIT_CODE=0`，96s，输出为空，0 个任意 `error TS` |
| `ide-bridge.spec.ts:380` boundarySeq 条件展开 | ✅ | 第 383 行 `...(options?.boundarySeq === undefined ? {} : { boundarySeq: options.boundarySeq })`，无 `boundarySeq: options?.boundarySeq` 直赋 |
| `ide-bridge.spec.ts` 顶部 `import type { Agent }` | ✅ | 第 9 行 `import type { Agent } from '@deepseek-ai/dsh-agent'` |
| `ide-bridge.spec.ts` 5 处 `agent:` 改 `stubAgent(…)` | ✅ | 第 448/485/517/549/573 行，共 5 处，与 5×TS2769 一一对应 |
| `specdev-advance.spec.ts:117` 改 `as unknown as { snapshot: unknown }` | ✅ | 第 117 行 `expect((data as unknown as { snapshot: unknown }).snapshot).toBeNull()` |
| `specdev.spec.ts:313` 改 `as unknown as Agent` | ✅ | 第 313 行 `const agent = { options: {} as Record<string, unknown> } as unknown as Agent` |
| 回归验证（vitest source-plane 不回退） | ⚠️ 见下 | `ide-bridge.spec.ts` 23/23 通过；`specdev`/`specdev-advance` 因预存 `const enum FiberState` 问题无法在 vitest 下运行（与本 Phase 无关，详见「发现的问题」） |

**AC-5 结论：✅ 通过**。核心验收（host aggregate 0 个目标错误）已独立复核达成；回归验证的 ⚠️ 为预存测试基础设施问题，非本 Phase 引入（改动均为编译期擦除的纯类型断言，零运行时差异）。

---

## 桩检测报告

三个目标文件逐一扫描：**未发现空壳函数、硬编码返回、`(void)args`、`#ifdef` 假实现、`@STUB`、`as any`、`@ts-expect-error`、`@ts-ignore`**。

- 新增的 `stubAgent` 助手（`ide-bridge.spec.ts:647-649`）是**测试侧的类型构造辅助**，含真实返回逻辑（构造 `{ id, session: { id } }` 并通过 `as unknown as Agent` 断言），非空壳/硬编码桩：
  ```ts
  function stubAgent(id: string, sessionId: string): Agent {
    return { id, session: { id: sessionId } } as unknown as Agent
  }
  ```
- 该助手的 `as unknown as Agent` 是 spec.md 约束明确允许的「严格模式断言风格」（与仓库 `strict: true` + 禁止 `as any` 约定一致，`specdev.spec.ts` 已有同类先例），**不是**桩信号。

**结论：0 桩，0 未注册债务。**

---

## 集成连通性验证结果

1. **`stubAgent` 最小接口与运行时鸭子类型一致** ✅
   - 运行时消费者 `resolveBridgeSessionId(agent: { id: string; session?: { id?: string } })`（`packages/ide/ide-bridge/src/index.ts:200-205`）只读 `agent.session?.id` 与回退 `agent.id`。
   - `stubAgent` 返回 `{ id, session: { id: sessionId } }`，完全满足该鸭子类型；`as unknown as Agent` 只是编译期绕过富 `Agent` 的缺字段，运行时对象形状正确。
2. **5 处替换语义等价** ✅
   - 原字面量 `{ id: 'a', session: { id: 'sess-1' | 's' } }` 与 `stubAgent('a', 'sess-1' | 's')` 产出的运行时值完全相同，`resolveBridgeSessionId` 解析到的 sessionId 不变，测试断言实质含义未变。
   - 第 525-527 行的 `user-questions/request` 无 `agent` 字段（`agent?: Agent` 可选），非 TS2769 源，正确保持原样。
3. **`import type { Agent } from '@deepseek-ai/dsh-agent'` 可解析** ✅
   - `packages/core/agent/src/index.ts:19` 通过 `export * from './types.ts'` 重新导出 `Agent`，包根导入成立（`specdev.spec.ts` / `specdev-advance.spec.ts` 亦从包根导入 `Agent` 作先例）。
   - `Agent` 在 `types.ts` 为薄接口 `{ readonly id: SessionId }`，经 `runtime-types.ts` 的 `declare module './types.ts'` 增补富成员；`as unknown as` 对薄/富两种解析均健壮（与 repo-exploration §7 的 HYPOTHESIS 一致，不影响正确性）。
4. **只改 `tests/`，未触碰 Events 声明** ✅
   - `git status` 确认 source 改动仅 3 个测试文件（`M`）。
   - `packages/interaction/user-approval/src/types.ts` 与 `packages/interaction/user-questions/src/types.ts` **无改动**，`ApprovalRequestEvent.agent: Agent`（必填）与 `AskUserQuestionRequestEvent.agent?: Agent`（可选）声明完整，符合「测试修正而非 Events 声明补全」的判定。

---

## 发现的问题

### 🔴 must-fix
- 无。

### 🟡 should-fix
- 无。功能正确、边界处理到位，无需阻塞性修复。

### 🟢 optional / 提示
- **回归验证受预存 `const enum FiberState` 影响**：`vitest run` 直接运行 `specdev.spec.ts` / `specdev-advance.spec.ts` 时，`ctx.plugin(...)` 触发 `scripts/test-invariants.ts:88` 的 `FiberState.PENDING`，因 `FiberState`（`vendor/cordis/src/fiber.ts:147` 的 `const enum`）在 esbuild 转译下无运行时值而抛 `TypeError`。这是**仓库既有基础设施问题**，与本 Phase 的 `as unknown as` 纯类型断言（编译期擦除、零运行时差异）无关。implementer 已在 implementation.md「偏差记录」如实记录，未掩盖。**建议 verifier 在干净树独立复核此失败确为预存现象**（可通过 `git stash` 回退本 Phase 改动后复跑确认，或直接认 `tsc -b --force` exit 0 为核心证据）。
- **`tsc -b --force` 构建副作用**：全量重编译会向部分引用项目（`packages/interaction/user-approval/src/`、`user-questions/src/` 等）emit `.js`/`.d.ts`/`.map` 产物（非 tracked 改动）。这是 project-build skill 已记载的已知副作用，提交时只 add 实际改动的 3 个测试源文件即可，非缺陷。

---

## Registry 对照

- `tech-debt-registry.md` 当前为空（活跃/已解决表均仅占位 `—`）。
- 本 Phase **未发现需注册的未注册债务**（0 桩、0 空壳、0 `as any`）。
- 无「已解决」条目需关闭。
- 无需写入或更新 registry。

---

## Amendments 处理

- implementation.md「偏差记录」中的「偏差 1：specdev/specdev-advance 回归测试受既有 const enum 问题影响」属**验证环境限制**，非 spec/design 的范围或方案变更——spec.md 的 AC-5 验收标准、design.md 的 FA-3 方案均未改变。
- 因此**不新增 spec.md Amendments / design.md Design Amendments 条目**；该偏差已在 review.md「发现的问题 🟢」中如实呈现，交 verifier 独立复核。无未对应 amendment 的实质性偏差。

---

## 验证命令建议（给 verifier）

1. **核心（AC-5 主验证）** — 干净树全量重编译，确认 0 个目标错误：
   ```sh
   export PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH
   ./node_modules/.bin/tsc -b tsconfig.host.json --force 2>&1; echo "EXIT_CODE=$?"
   ```
   预期：`EXIT_CODE=0`，输出为空，0 个 `TS2379` / `TS2769` / `TS2352`，0 个任意 `error TS`。
2. **静态复核（可选，防篡改）** — 确认 3 个文件无 `@ts-expect-error` / `@ts-ignore` / `as any` / `@STUB`：
   ```sh
   rg -n "@ts-expect-error|@ts-ignore|as any|@STUB" \
     packages/ide/ide-bridge/tests/ide-bridge.spec.ts \
     packages/specdev/specdev/tests/specdev.spec.ts \
     packages/specdev/specdev-advance/tests/specdev-advance.spec.ts
   ```
   预期：无输出。
3. **回归（vitest source-plane）** — 仅验证 `ide-bridge.spec.ts`（本 Phase 唯一含运行时相关改动的文件）：
   ```sh
   ./node_modules/.bin/vitest run packages/ide/ide-bridge/tests/ide-bridge.spec.ts
   ```
   预期：23/23 通过。`specdev`/`specdev-advance` 两个文件会因预存 `const enum FiberState` 失败，属环境现象、与本 Phase 无关，可作已知偏差跳过或独立确认其预存性。
4. **范围确认** — `git diff --stat` 应仅见 3 个测试文件改动；Events 声明文件（`user-approval/src/types.ts`、`user-questions/src/types.ts`）无改动。
