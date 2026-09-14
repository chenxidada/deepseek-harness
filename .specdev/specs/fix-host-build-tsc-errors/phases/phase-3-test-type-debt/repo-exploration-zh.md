# 仓库探索报告 — Phase 3：测试文件类型债修复

## 1. 任务上下文

Phase 3 修复根 host aggregate（`tsconfig.host.json`）直接类型检查的 3 个测试文件里 8 条预先存在的类型错误：`packages/ide/ide-bridge/tests/ide-bridge.spec.ts` 的 1×TS2379 + 5×TS2769，以及 `packages/specdev/specdev-advance/tests/specdev-advance.spec.ts`、`packages/specdev/specdev/tests/specdev.spec.ts` 的 2×TS2352。验收标准 AC-5 要求 `tsc -b tsconfig.host.json` 对这三个文件产出 0 个 `TS2379` / `TS2769` / `TS2352`。这是「修正测试」，不是「补 Events 类型声明」，也不是「把 tests 目录从 host aggregate 排除」——`approval/request` 与 `user-questions/request` 事件均已声明完整载荷类型。

## 2. 仓库概览

- **语言 / 运行时**：TypeScript，纯 ESM（`"type": "module"`），Node ≥22.19，pnpm workspaces 单仓。
- **Vendored 框架**：`vendor/cordis/` 承载 Cordis 的 `Context` / `Events` / 派发机制，包括这里唯一相关的 `waterfall`。
- **Aggregate**：两个检查单元——host（`tsconfig.host.json`）与 client（`tsconfig.client.json`）。host aggregate `include` 了 `packages/*/*/tests/**/*.ts`（第 99 行），因此把所有包测试作为一个 `noEmit` 程序类型检查。
- **严格性**：`tsconfig.base.json` 开启 `strict: true`、`exactOptionalPropertyTypes: true`、`noUncheckedIndexedAccess: true`（第 19-21 行）。每个包 tsconfig 都 extends `tsconfig.base.json`。
- **Branding**：跨边界的不透明 id 用 `@deepseek-ai/dsh-brand` 的 `Branded<B>` 做名义字符串；`SessionId = Branded<'SessionId'>`。

## 3. 最相关区域

| 区域 | 路径 | 相关性 |
|------|------|--------|
| 测试文件（TS2379 + 5×TS2769） | `packages/ide/ide-bridge/tests/ide-bridge.spec.ts` | 主要改动目标 |
| 测试文件（1×TS2352） | `packages/specdev/specdev-advance/tests/specdev-advance.spec.ts` | 改动目标 |
| 测试文件（1×TS2352） | `packages/specdev/specdev/tests/specdev.spec.ts` | 改动目标 |
| 精简 `Agent` 类型 | `packages/core/agent/src/types.ts` | `interface Agent { readonly id: SessionId }` |
| 富 `Agent` 增强 | `packages/core/agent/src/runtime-types.ts` | `declare module './types.ts'` 追加 live 成员 |
| `Agent` 包入口 | `packages/core/agent/src/index.ts` | 二者 re-export；`@deepseek-ai/dsh-agent` |
| `approval/request` 事件 + 载荷 | `packages/interaction/user-approval/src/types.ts` | `ApprovalRequestEvent.agent: Agent` |
| `user-questions/request` 事件 + 载荷 | `packages/interaction/user-questions/src/types.ts` | `AskUserQuestionRequestEvent.agent?: Agent` |
| `waterfall` 签名 | `vendor/cordis/src/events.d.ts` | 泛型 `Parameters<Events[K]>` |
| `SessionId` / `Branded` | `packages/core/session/src/types.ts`、`packages/util/brand/src/index.ts` | 名义 id 根因 |
| 运行时 `agent` 消费 | `packages/ide/ide-bridge/src/index.ts` | `resolveBridgeSessionId` 鸭子类型 |
| Aggregates / 严格性 | `tsconfig.host.json`、`tsconfig.base.json`、3 个包 `tsconfig.json` | AC-5 验证入口 |

来源标注：👁 = 手动读取文件（无代码地图工具；`code2prompt` 不在 PATH）。

## 4. 关键入口 / 调用路径

### 路径 1 — 测试为何被类型检查（AC-5 入口）

```
tsc -b tsconfig.host.json
  └─ tsconfig.host.json extends tsconfig.base.json（strict + exactOptionalPropertyTypes）
       └─ "include": [ ..., "packages/*/*/tests/**/*.ts", ... ]   （第 99 行）
            └─ packages/ide/ide-bridge/tests/ide-bridge.spec.ts
               packages/specdev/specdev/tests/specdev.spec.ts
               packages/specdev/specdev-advance/tests/specdev-advance.spec.ts
```

### 路径 2 — TS2769（5×）：`ctx.waterfall` 载荷 → `Events` → `Agent`

```
ctx.waterfall('approval/request', { agent: {...}, toolName: 'bash' }, next)
  └─ waterfall<K extends keyof Events>(name: K, ...args: Parameters<Events[K]>)
       └─ K = 'approval/request'
            └─ Parameters<Events['approval/request']> = [req: ApprovalRequestEvent, next]
                 └─ ApprovalRequestEvent.agent: Agent   （Agent 来自 '@deepseek-ai/dsh-agent/types'）
                      └─ Agent = { readonly id: SessionId }   ← 字面量 { id: 'a', session: {...} } 不匹配

ctx.waterfall('user-questions/request', { agent: {...}, questions: [...] }, next)
  └─ Parameters<Events['user-questions/request']> = [req: AskUserQuestionRequestEvent, next]
       └─ AskUserQuestionRequestEvent.agent?: Agent   ← 同样的失败
```

### 路径 3 — `agent` 的运行时消费（`stubAgent` 为何必须带 `session.id`）

```
ide-bridge src/index.ts
  └─ ctx.on('approval/request', (request) => resolveBridgeSessionId(request.agent))
  └─ ctx.on('user-questions/request', (request) => resolveBridgeSessionId(request.agent))
       └─ resolveBridgeSessionId(agent: { id: string; session?: { id?: string } })
            └─ 返回 agent.session?.id（否则回退 agent.id）
```

## 5. 影响面

| 文件 | 错误 | 修法 | 风险 |
|------|------|------|------|
| `packages/ide/ide-bridge/tests/ide-bridge.spec.ts` | 1×TS2379（`:380`）、5×TS2769（`:444/:481/:513/:545/:569`） | `boundarySeq` 条件展开；新增 `import type { Agent }` + `stubAgent` 助手；替换 5 处 `agent:` 字面量 | 低——仅测试 |
| `packages/specdev/specdev-advance/tests/specdev-advance.spec.ts` | 1×TS2352（`:117`） | `(data as unknown as { snapshot: unknown }).snapshot` | 低——仅测试 |
| `packages/specdev/specdev/tests/specdev.spec.ts` | 1×TS2352（`:313`） | `{ options: {} as Record<string, unknown> } as unknown as Agent` | 低——仅测试 |

无需改动任何 `Events` 声明（`@deepseek-ai/dsh-user-approval/types.ts`、`@deepseek-ai/dsh-user-questions/types.ts` 均完整声明）。不改运行时行为；不引入 `@STUB` / `as any`。

## 6. 既有约束 / 约定

- **纯 ESM**；本地导入用 `.ts` 扩展名；跨包导入用 `@deepseek-ai/dsh-*` 包名。
- **`exactOptionalPropertyTypes: true`**（来自 `tsconfig.base.json:21`）：可选属性一旦写出就不能是 `undefined`；「条件展开、否则省略」是既定修法（`specdev-gate/src/index.ts` 与 `ide-bridge/src/index.ts` 已用 `...x === undefined ? {} : { ... }`）。
- **`strict: true` + 名义 id**：`SessionId` 是 `string & { [BRAND]: 'SessionId' }`；裸字符串字面量不是 `SessionId`。
- **断言风格**：严格模式禁止 `as any`；仓库已在测试中用 `as unknown as X` 做刻意窄化（`specdev.spec.ts` 已有 `as unknown as` 先例）。
- **测试位于 `packages/<group>/<pkg>/tests/`**，不在 `src/__tests__/`；只被 host aggregate 类型检查，不被包自身 `tsconfig.json`（只 `include` `src`）检查。

## 7. 风险 / 未知

- ✅ **CONFIRMED** — 三个包 tsconfig（`ide-bridge`、`specdev`、`specdev-advance`）均 `extends ../../../tsconfig.base.json` 且只 `include` `src`；它们不覆盖 `strict`/`exactOptionalPropertyTypes`，因此测试从 host aggregate 程序（extends `tsconfig.base.json`）继承严格性。
- ✅ **CONFIRMED** — `tsconfig.host.json` `include` 了 `packages/*/*/tests/**/*.ts`（第 99 行）且 `extends ./tsconfig.base.json`，所以 `tsc -b tsconfig.host.json` 是 AC-5 验证入口。
- ✅ **CONFIRMED** — `ApprovalRequestEvent.agent` 与 `AskUserQuestionRequestEvent.agent` 引用的是从 `@deepseek-ai/dsh-agent/types`（解析到 `packages/core/agent/src/types.ts`）导入的 `Agent`，其声明为 `interface Agent { readonly id: SessionId }`。
- ⚠️ **HYPOTHESIS** — 精简 `Agent`（`types.ts`）还被 `runtime-types.ts` 通过 `declare module './types.ts'` 增强，追加 `options/session/inbox/ctx/status/cancel/whenIdle/runMaintenance/send/followup/steer/inject`。该相对增强是否对经 `@deepseek-ai/dsh-agent/types` 别名导入的消费者可见，此处未做实证复核。这不改变修法：测试字面量对精简版（brand 不匹配 + 多余 `session`）与富版（缺成员）都会失败。
- ✅ **CONFIRMED** — 运行时只读 `agent.id` 与 `agent.session?.id`（`resolveBridgeSessionId`，`ide-bridge/src/index.ts:200-205`），因此 `stubAgent` 返回 `{ id, session: { id } }` 即可满足运行时鸭子类型，与编译期 `Agent` 形态无关。
- ✅ **CONFIRMED** — `forkSession` 第二参数是 `options?: { boundarySeq?: number }`（测试第 379 行）；`options?.boundarySeq` 为 `number | undefined`，在 `exactOptionalPropertyTypes` 下被 `boundarySeq?: number` 拒绝（TS2379）。

## 8. 未确定 / 未验证

- ❓ **UNKNOWN** — 精简 `Agent` 经 `runtime-types.ts` 相对增强后的确切运行时身份（见 §7）。下游 agent 不应假设 `@deepseek-ai/dsh-agent/types` 解析为精简版还是富版；`as unknown as Agent` 修法对两者都稳健。
- ❓ **UNKNOWN** — 本环境下 `tsc -b` 退出码是 1 还是 2（requirements.md 记录本地为 1、上游为 2）。与修法无关，但 verifier 应在干净树上复核实际退出码。
- ⚠️ **HYPOTHESIS** — `noUncheckedIndexedAccess: true` 不直接导致这 8 条错误（无一处涉及索引访问）；仅作为环境严格性列出。

## 9. 桩检测 & Registry 交叉校验

`tech-debt-registry.md` 为**空**（活跃表与已解决表都只有占位 `—` 行）。三个目标测试文件及其依赖的类型声明中不存在 `@STUB`、空函数体、`(void)`、硬编码 return、`TODO/FIXME` 占位。

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| — | （registry 为空） | — | — | — |

### 桩检测摘要

- ✅ 确认桩：0
- ⚠️ Registry 不匹配：0
- 🔴 未注册桩：0

## 10. 推荐优先阅读

1. ⭐ **必读** — `packages/ide/ide-bridge/tests/ide-bridge.spec.ts`（全文；6 处错误位点在 `:380`、`:442-449`、`:478-490`、`:511-525`、`:543-547`、`:567-571`）。
2. ⭐ **必读** — `packages/core/agent/src/types.ts` + `runtime-types.ts` + `index.ts`（精简 vs 富 `Agent` 及 `@deepseek-ai/dsh-agent` 导出面）。
3. 🔷 **应读** — `packages/interaction/user-approval/src/types.ts` 与 `user-questions/src/types.ts`（已声明的 `Events` 载荷类型——确认其完整、不可改动）。
4. 🔷 **应读** — `packages/ide/ide-bridge/src/index.ts:168-205`（`resolveBridgeSessionId` 与两处 `ctx.on` 消费者——确认 `stubAgent` 需提供的运行时 `agent` 形态）。
5. 🔷 **应读** — `vendor/cordis/src/events.d.ts:77-79`（驱动 TS2769 的 `waterfall` 重载）。
6. 🔹 **可选** — `packages/specdev/specdev-advance/tests/specdev-advance.spec.ts:41-59`（已有的富 `stubAgent(session): Agent` 助手——作为 ide-bridge 助手的参考）与 `packages/specdev/specdev/tests/specdev.spec.ts:311-325`（`as unknown as` 先例）。
7. 🔹 **可选** — `tsconfig.base.json` / `tsconfig.host.json`（严格性与 AC-5 入口 glob）。
