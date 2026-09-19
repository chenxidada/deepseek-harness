# Repository Exploration Report — Phase 4: lint program 与收口

## 1. Task Context

本 Phase 把 `apps/vscode-dsh/tests/tsconfig.json` 的 `include` 从 12 文件逐文件白名单改为 glob 覆盖全目录，使 tests 目录整体进入 lint program；在**测试资产内**修掉真实 lint 缺陷使 `oxlint` 归零（AC-16）；显式记录 tsc 类型错误口径（AC-18）；Node 24.3.0 下 `vitest run apps/vscode-dsh/tests` 全绿最终收口（AC-14）。

本次调研目标：确认 `tests/tsconfig.json` 现状、tests 目录文件清单、oxlint 当前真实 error 数、lint 缺陷分类、tsc 类型错误现状、oxlint 门禁挂载位置，并交叉验证 registry 的 DEBT-1/4/5 与 DEBT-019 口径，指出 glob 化可能带来的新 lint 面与语义变更风险。

## 2. Repository Overview

- **语言/框架**：TypeScript（`strict: true` + `noImplicitAny`），ESM（`"type": "module"`），pnpm workspaces monorepo。
- **本工作流写面**：仅 `apps/vscode-dsh/tests/**`、`apps/vscode-dsh/test-scripts/**`、`.specdev/specs/vscode-dsh-test-consolidation/tech-debt-registry.md`；`apps/vscode-dsh/src/**`、`webview/**`、`packages/**`、`scripts/**`、`.oxlintrc*.json` 一律不动（AC-24）。
- **Lint 栈**：oxlint `1.76.0`，全局 `typeAware: true`（`.oxlintrc.json:9`），入口 `tsx scripts/run-oxlint.ts`。
- **当前分支**：`impl-phase-4-lint-and-closure`（`git branch --show-current` 实测），从 `new/vscode-dsh` 切出（spec.md 前置条件一致）。

## 3. Most Relevant Areas

| 文件 / 目录 | 与本 Phase 的关系 | 证据 |
|---|---|---|
| `apps/vscode-dsh/tests/tsconfig.json` | AC-15/AC-17 唯一写面：`include` 改 glob + 头部注释更新 | 全文见下 §3.1 |
| `apps/vscode-dsh/tests/cap-*.spec.ts|tsx`（12 文件） | lint 修复主战场 | `find` 实测 |
| `apps/vscode-dsh/tests/{spike-attribution-helpers,spike-t0a-replay-hydrator,spike-t0b-continue-helpers}.ts`（3 helper） | glob 必须覆盖，否则 helper 无 program → `no-unsafe-*` 噪声 | `find` 实测 |
| `scripts/run-oxlint.ts` | oxlint 命令入口（本 Phase 不新增，只让既有门禁通过） | `:5-95` |
| `scripts/run-gates.ts` | `check:test-scripts-syntax` 挂载点 | `:293-314`（`:312` 挂载） |
| `scripts/check-test-scripts-syntax.sh` | shell 资产 `bash -n` 门禁（test-scripts，非 tests） | `:24-27` |
| `.oxlintrc.json` | type-aware 规则 + tests 专属 override | `:9` `:32-150` `:199-216` |
| `apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts` | `buildThinChatHtml` 已废弃（`no-deprecated` 25 处来源） | `:7` `:190` |
| `apps/vscode-dsh/src/chat-panel/editor-chat-panel.ts` | 替代实现 `buildEditorChatSpaHtml` | `:116` |
| `.specdev/specs/vscode-dsh-test-consolidation/tech-debt-registry.md` | AC-18 tsc 口径落点；DEBT-1/4/5 交叉验证 | 全文已读 |

### 3.1 `tests/tsconfig.json` 现状（AC-15/AC-17 起点）✅ CONFIRMED

当前 `include` 是 **12 文件逐文件白名单**（非 glob），头部注释仍陈述「目录过大不可作为 program」：

```36:49:apps/vscode-dsh/tests/tsconfig.json
  "include": [
    "host-diagnostics.spec.ts",
    "node-env-guard.spec.ts",
    "session-host.spec.ts",
    "layer-v-inject-disconnect.spec.ts",
    "sandbox-clean-state.spec.ts",
    "build-freshness.spec.ts",
    "artifact-index.spec.ts",
    "display-evidence.spec.ts",
    "display-evidence-shell.spec.ts",
    "spike-t0a-replay-hydrator.ts",
    "spike-t0a-replay-rebuild.spec.ts",
    "spike-t0b-continue-capability.spec.ts"
  ]
```

头部注释关键行（AC-17 需删除/改写的部分）：

```8:14:apps/vscode-dsh/tests/tsconfig.json
  // The list is explicit rather than a glob because the directory is not clean as a program:
  // `pnpm exec tsc -p apps/vscode-dsh/tests/tsconfig.json --noEmit` reports 171 errors for the
  // twelve files below, while a probe of the same base over the whole directory (the file
  // `{"extends": "../../../tsconfig.base.json", "include": ["**/*.ts"]}` written into this
  // directory) reports 460. This program is private to the lint contract — no `references` graph in
  // the repository names it — so the rest of the directory's lint baseline stays with the
  // repository-wide debt (DEBT-019) and is deliberately absent here.
```

> 🔴 **关键现状（Phase 2 归并后白名单已失效）**：白名单 12 文件里 **11 个已被 Phase 2 删除**（`host-diagnostics`/`node-env-guard`/`session-host`/`layer-v-inject-disconnect`/`sandbox-clean-state`/`build-freshness`/`artifact-index`/`display-evidence`/`display-evidence-shell`/`spike-t0a-replay-rebuild`/`spike-t0b-continue-capability`），**仅 `spike-t0a-replay-hydrator.ts` 仍存在**（现为 helper）。即当前 program 实际只剩 1 个文件，且它 import 的图会连锁拉入 `vendor/cordis/src`。

## 4. Key Entry Points / Call Paths

### 4.1 oxlint（type-aware 规则）✅ CONFIRMED

```
npx tsx scripts/run-oxlint.ts apps/vscode-dsh/tests
  └─ scripts/run-oxlint.ts:59 main() → spawnSync(node, oxlintCLI, args)
       └─ node_modules/oxlint/bin/oxlint（v1.76.0，typeAware: true @ .oxlintrc.json:9）
            └─ 对每个 spec 文件做 type-aware 解析：匹配「最近的 tsconfig.json」
                 └─ tests/tsconfig.json（当前白名单 → 11/12 已删除 → cap-*.spec.ts 无 program）
                      └─ import 解析为 `error` 类型 → `no-unsafe-*` 全量触发（= 1906 的成因）
```

### 4.2 tsc 类型检查 ✅ CONFIRMED

```
npx tsc -p apps/vscode-dsh/tests/tsconfig.json --noEmit
  └─ 当前白名单仅 spike-t0a-replay-hydrator.ts 存活
       └─ 沿 import 图拉入 src/** → vendor/cordis/src → 报 vendor/cordis 错误（非 tests 自身）
  └─ glob 化后（临时 probe，见 §7）→ 15 条 tests 自身类型错误
```

### 4.3 shell 门禁（本 Phase 只让它通过，不新增）✅ CONFIRMED

```
ciSharedStaticGates() @ scripts/run-gates.ts:293
  └─ pnpmScript('test-scripts-syntax', 'check:test-scripts-syntax') @ scripts/run-gates.ts:312
       └─ scripts/check-test-scripts-syntax.sh → bash -n 校验 test-scripts/**/*.sh（pin 3 + glob 发现）
```

## 5. Likely Impact Surface

| 影响面 | 动作 | 风险 |
|---|---|:--:|
| `apps/vscode-dsh/tests/tsconfig.json` | `include` 改 glob + 头部注释改写（AC-15/AC-17） | 🟡 中 |
| 12 个 `cap-*.spec.ts|tsx` | 测试资产内修 lint（`no-unsafe-*` 收窄、`no-deprecated` 改引用、`no-unnecessary-*` 删除） | 🔴 高（量大 + 语义变更风险） |
| 3 个 helper `.ts` | glob 纳入 program 后可能新增 lint 面（当前白名单不含它们） | 🟡 中 |
| `.specdev/.../tech-debt-registry.md` | 新增 tsc 口径条目（AC-18） | 🟢 低 |
| `apps/vscode-dsh/src/**` | **禁止改动**（AC-24） | —（红线） |

**测试目录当前文件清单（glob 应覆盖的集合，`find` 实测，共 15 个）**：

```
12 个 spec：cap-session-host / cap-conversation / cap-timeline / cap-interaction /
            cap-code-context / cap-change-list / cap-change-list.dom / cap-search /
            cap-chat-panel / cap-chat-panel.dom / cap-test-harness (.spec.ts) + cap-webview (.spec.tsx)
3 个 helper：spike-attribution-helpers.ts / spike-t0a-replay-hydrator.ts / spike-t0b-continue-helpers.ts
```

> ⚠️ 注意：文件数是 **12 spec（非 design.md 的 10）** —— `change-list` 与 `chat-panel` 各多出一个 `.dom.spec.ts` 变体（Phase 2 归并时按 node/jsdom 拆分的演化）。AC-15 的 glob 需覆盖全部 12 spec + 3 helper。

## 6. Existing Constraints / Conventions（测试资产内修 lint 的既有约束）

以下约束来自 `design.md`（AC-24/AC-29）、`.oxlintrc.json` 与 `tsconfig.json` 注释，新代码修复必须遵守：

1. **不得改 `src/**`（AC-24 红线）**：所有 lint 修复必须在 `apps/vscode-dsh/tests/**` 内完成。若某条 lint 缺陷的根因在生产代码（如 `EditorChatWebviewPanel` 未从 `chat-panel/index.ts` 重导出、`buildThinChatHtml` 已废弃）→ 只能在测试侧改 import 路径 / 改引用 `buildEditorChatSpaHtml`，不得改 src 以满足 lint；必须改 src 时 → HG-2/HG-3 显式升级。
2. **`no-unsafe-*` 必须显式类型收窄，不得用 `any` 或裸 `as` 糊弄**：`no-explicit-any: error` 对 tests 依然生效（`.oxlintrc.json:83`），每个刻意保留的 `any` 需要窄豁免 + 理由。类型感知 `no-unsafe-*`（`.oxlintrc.json:109-116`）的正确修法是给 mock/断言对象显式类型或收窄联合类型，而非关规则。
3. **修 lint 若触发断言语义变更 → 记台账 `weakened`（AC-29 ③）**：例如把 `buildThinChatHtml`（fixture-only 已废弃）替换为 `buildEditorChatSpaHtml` 会改变 fixture HTML 内容，若相关断言对 HTML 字符串做断言则断言变弱 → 必须在 `assertion-map.md` 该行标 `weakened: true` + 理由，且在 `implementation.md` 偏差章节记录。
4. **tests 已放松的规则（不要再额外开豁免）**：`.oxlintrc.json:199-216` 对 `apps/*/tests/**` 已关闭 `no-non-null-assertion`、`no-unnecessary-condition`、`only-throw-error`、`require-await`、`restrict-template-expressions`。修复时不要把「这些已关的规则」当成要修的项，也不要为其它规则新开文件级豁免。
5. **`no-deprecated`（`.oxlintrc.json:78`）**：`buildThinChatHtml` 已标记 deprecated（`chat-panel-provider.ts:7`，AD-ECP-8/DEBT-ECP-001），25 处 `no-deprecated` error 的修法是（design.md 步骤 4）：改为 `buildEditorChatSpaHtml`（`editor-chat-panel.ts:116`）或移除该 fixture 路径，属测试资产变更（AC-24 补充条款允许）。
6. **`no-unnecessary-*` 系列**（`.oxlintrc.json:102/105/107/108` 等）：直接删除多余断言/转换/参数，纯机械修复，无语义风险。
7. **不新增门禁脚本**：本 Phase 只让既有 `run-oxlint.ts`、`check:test-scripts-syntax` 对 tests/test-scripts 通过，不新增 gate（design.md 约束）。
8. **桩必须登记**：测试资产内若因修 lint 临时留 `@STUB(...)` → 立即登记 `tech-debt-registry.md`（gate 在 hg3 校验）。正常修复不应产生桩。

## 7. Risks / Unknowns

### 7.1 当前 oxlint error 实测 = 1906，且绝大部分是「无 program」噪声 ✅ CONFIRMED

```
npx tsx scripts/run-oxlint.ts apps/vscode-dsh/tests   → 退出码 1，1906 条 error
```

按规则分布（实测）：

| 规则族 | 条数 | 性质 |
|---|:--:|---|
| `no-unsafe-call` | 831 | 🔴 绝大多数是「`error` 类型值」= 无 program 症状 |
| `no-unsafe-assignment` | 510 | 同上 |
| `no-unsafe-member-access` | 227 | 同上 |
| `no-unsafe-argument` | 131 | 同上 |
| `no-unsafe-return` | 46 | 同上 |
| `no-unnecessary-type-assertion` | 92 | ✅ 真实缺陷（与 program 无关） |
| `no-deprecated` | 25 | ✅ 真实缺陷（`buildThinChatHtml`） |
| `no-confusing-void-expression` | 17 | ✅ 真实缺陷 |
| `no-unnecessary-type-parameters` | 12 | ✅ 真实缺陷 |
| `no-unnecessary-boolean-literal-compare` | 8 | ✅ 真实缺陷 |
| `no-unnecessary-type-conversion` | 4 | ✅ 真实缺陷 |
| `unbound-method` / `no-redundant-type-constituents` / `no-base-to-string` | 1+1+1 | ✅ 真实缺陷 |

> 1906 与 `tsconfig.json:2-6` 注释描述的「无 program → Node builtin/`process` 解析为 `error` → `no-unsafe-*` 触发」完全一致。即：**Phase 2 归并后白名单已指向 11 个已删除文件，12 个 cap-*.spec 全部无 program**，导致 `no-unsafe-*` 大面积误报。改 glob 后这些「error 类型」噪声会消失，只留下真实缺陷 + 由 15 条真实类型错误引发的少数 `no-unsafe-*`。

### 7.2 「glob 后 203」基线已过时 ❌ 修正

design.md 步骤 6 / Phase 1 记载「glob 化后 203 error」是在 **Phase 2 归并前（61 文件时代）** 实测的。当前 tests 已归并为 12 cap + 3 helper 文件，文件集完全改变，**203 不再是当前 glob 化后的真实起点**。真实 glob 化后 error 数的**下界估计** ≈ 161（上表非 `no-unsafe-*` 真实缺陷之和）+ 由 15 条 tsc 类型错误引发的少量 `no-unsafe-*`。⚠️ HYPOTHESIS：本调研无法在不改写被跟踪的 `tsconfig.json` 的情况下实测 glob 化后的精确 oxlint 数（见 §7.3），故此处为估计，不是实测值。

### 7.3 glob 化后的精确 oxlint 数未被实测（只读限制）⚠️ HYPOTHESIS

我尝试用 `npx tsx scripts/run-oxlint.ts --tsconfig=apps/vscode-dsh/tests/.probe-glob.json apps/vscode-dsh/tests`（临时 probe 文件 extends 原 tsconfig 但 override `include: ["**/*.ts","**/*.tsx"]`）实测 glob 化后的 error 数，结果与白名单运行**完全一致（仍是 1906）** —— 说明 oxlint 1.76 的 `--tsconfig` 旗标只覆盖「import resolution」，**不改变 type-aware 规则（`no-unsafe-*`）使用的 per-file program 发现**（它仍发现目录内的 `tsconfig.json`）。因此精确 glob 化 oxlint 数必须在 AC-15 真正改写 `tests/tsconfig.json` 后才能复测。implementer 改动 `include` 为 glob 后**立即**运行 `npx tsx scripts/run-oxlint.ts apps/vscode-dsh/tests` 取得真实起点，勿把 203 当已确认值。

### 7.4 glob 必须覆盖 3 个 helper，否则 helper 仍「无 program」🔴 高

design.md 步骤 1 建议 glob 为 `["**/*.ts", "**/*.tsx"]`（覆盖 helper），但 spec.md AC-15 只写「glob 覆盖全目录」。若实现成 `["**/*.spec.ts", "**/*.spec.tsx"]`，3 个 helper（`spike-attribution-helpers.ts`/`spike-t0a-replay-hydrator.ts`/`spike-t0b-continue-helpers.ts`）不在 program 内 → 继续报 `no-unsafe-*` 噪声。当前实测 helper 已贡献 23+6=29 条 error（`spike-attribution-helpers.ts` 23 条、`spike-t0b-continue-helpers.ts` 6 条），需确认 glob 含 `**/*.ts`。

### 7.5 tsc 类型错误现状（AC-18 口径的起点）✅ CONFIRMED

**当前白名单 config 下**：`npx tsc -p apps/vscode-dsh/tests/tsconfig.json --noEmit` 报错来自 `vendor/cordis/src/**`（`spike-t0a-replay-hydrator.ts` 沿 import 图拉入 vendor），非 tests 自身 —— 白名单已失效的佐证。

**glob 化后（临时 probe `include: ["**/*.ts","**/*.tsx"]`，跑完已删）**：`tsc --noEmit` 报 **15 条类型错误，全部在 `apps/vscode-dsh/tests/` 内**，无 vendor 噪声：

| # | 位置 | 错误 | 性质 |
|:--:|---|---|---|
| 1 | `cap-change-list.spec.ts:499` | TS2379 `messageId: string\|undefined` vs `messageId?: string`（`exactOptionalPropertyTypes`） | mock 对象可选属性 |
| 2-4 | `cap-chat-panel.spec.ts:207/465/522` | TS2322 `() => Promise<CancelActiveTurnResult>` vs `() => Promise<void>` | mock 签名不匹配 |
| 5 | `cap-chat-panel.spec.ts:589` | TS2339 `Property 'status' does not exist on type '{}'` | 断言对象缺类型 |
| 6 | `cap-code-context.spec.ts:479` | TS18048 `'plan.selection' is possibly undefined` | 收窄缺失 |
| 7 | `cap-conversation.spec.ts:2` | TS2305 `'EditorChatWebviewPanel'` 未从 `chat-panel/index.ts` 导出 | **import 路径 bug**（该接口定义于 `editor-chat-panel.ts:32`，但 index 未重导出）→ 测试侧改 import 来源 |
| 8 | `cap-conversation.spec.ts:366` | TS2345 `unknown[]` 参数 | 类型收窄 |
| 9-10 | `cap-conversation.spec.ts:787/797` | TS7006 隐式 any 参数 | 缺注解 |
| 11 | `cap-conversation.spec.ts:1627` | TS2339 `Property 'interactions' does not exist on type '{}'` | 断言对象缺类型 |
| 12-13 | `cap-conversation.spec.ts:1668/1669` | TS2345 状态联合 vs `string` | 回调签名 |
| 14 | `cap-conversation.spec.ts:1702` | TS2322 `NavBackResult` vs `Promise<unknown>` | mock 签名 |
| 15 | `cap-conversation.spec.ts:2428` | TS2379 `command` 可选属性 | mock 对象 |

> AC-18 要求「未归零必须写下来」，不是要求归零。这 15 条是 tests 自身真实类型错误，其中 `cap-conversation.spec.ts:2`（TS2305）是明确可修 bug（改 import 来源到 `editor-chat-panel.ts`），其余多为 mock 对象/回调的类型收窄，**理论上可归零但非本工作流验收义务**。implementer 须在 `tech-debt-registry.md` 新登记一条（承接 `DEBT-019` 的 tests 段口径，见 §9），逐条或汇总记录这 15 条及后续归属。

### 7.6 修 lint 触发语义变更的风险点（R-3）🔴 高

- `no-deprecated`（25 处）全部来自 `buildThinChatHtml`：替换为 `buildEditorChatSpaHtml` 会改变 fixture HTML 内容；`cap-timeline.spec.ts:856-858`（`CAP-TIMELINE-016` 断言 `buildThinChatHtml` 消费 continue/deferredRestoreCount）、`cap-chat-panel.spec.ts:630`（`buildThinChatHtml('vscode-csp')` 带 csp 参数）等对 HTML 内容有断言 → 替换会削弱/改变断言语义，必须走台账 `weakened` 记录。
- `no-unsafe-*` 收窄时若用 `as any` 或改 mock 返回值类型，可能掩盖真实行为差异 → 优先显式类型，而非断言放宽。

## 8. Uncertain / Unverified

| 项 | 状态 | 说明 |
|---|---|:--|
| glob 化后的精确 oxlint error 数 | ❓ UNKNOWN | 只读限制无法实测（`--tsconfig` 旗标不改 type-aware program）；implementer 改 include 后立即复测 |
| 「glob 后 ~161+」估计的准确度 | ⚠️ HYPOTHESIS | 非 `no-unsafe-*` 规则之和 161 是「与 program 无关」的下界；真实数可能略高（15 条 tsc 错误引发的残余 `no-unsafe-*`） |
| `buildEditorChatSpaHtml` 是否可无副作用替换所有 25 处 `buildThinChatHtml` 调用 | ⚠️ HYPOTHESIS | 两函数签名与产物 HTML 不同（`editor-chat-panel.ts:116` vs `chat-panel-provider.ts:190`），逐处需人工判定 |
| 3 个 helper 在 glob 化后是否本身产生新 lint 错误 | ⚠️ HYPOTHESIS | helper 此前基本不在 program（仅 `spike-t0a-replay-hydrator.ts` 在白名单），glob 化后其真实类型错误面未完全暴露 |
| 15 条 tsc 错误修复后是否连带消除对应 `no-unsafe-*` | ⚠️ HYPOTHESIS | tsc 类型错误点通常就是残余 `no-unsafe-*` 的来源，但一一对应关系未逐一核对 |

## 9. Stub Detection & Registry Cross-Validation

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| `DEBT-1@vscode-dsh-e2e-closure` | `test-scripts/layer-v-support/primitives.cjs`（19 项镜像原语） | 已解决（phase-3） | `primitives.cjs` 存在（12999 B）；两 driver 均 `require('../layer-v-support/primitives.cjs')`（`extension.cjs:58` / `capability-runner.cjs:65`）；`captureScreenshot` 定义处数=1（实测） | ✅ 匹配 |
| `DEBT-4@vscode-dsh-e2e-closure` | `test-scripts/layer-v-capabilities.json`（3 项 capability 从未真机执行） | 活跃，不关闭 | `layer-v-capabilities.json` 存在（59246 B）；属功能缺失 gap，非桩 | ✅ 匹配（不关闭正确） |
| `DEBT-5@vscode-dsh-e2e-closure` | 同上（5 项 capability） | 活跃，不关闭 | 同上 | ✅ 匹配（不关闭正确） |
| `DEBT-019`（tsc 口径） | — | **本工作流 registry 中无此条目** | 仅被 `tsconfig.json:14` 注释引用，为**仓库级债务**（另见 `vscode-dsh-usable-loop` 的 `review-design.md:167`「DEBT-019：2218 条 / 107 文件」） | 🟡 待 Phase 4 补录 tests 段口径 |

### Stub Detection Summary

- ✅ Confirmed stubs: 0 个（tests 资产内未发现桩代码）
- ✅ Registry matched: DEBT-1（已解决）、DEBT-4/5（正确保持不关闭）
- 🟡 Registry 待补：DEBT-019 的 tests 段 tsc 口径（AC-18 要求在本工作流 registry 显式登记，不是沉默略过）
- 🔴 Unregistered stubs: 0 个

## 10. Recommended Next Reads

1. ⭐ **MUST READ** — `apps/vscode-dsh/tests/tsconfig.json`（AC-15/17 唯一写面，白名单 11/12 已失效）
2. ⭐ **MUST READ** — `.oxlintrc.json`（`:199-216` tests 专属 override + `:109-116` `no-unsafe-*` + `:78` `no-deprecated` + `:83` `no-explicit-any`）
3. ⭐ **MUST READ** — `.specdev/specs/vscode-dsh-test-consolidation/design.md` §lint 归零方案（`:299-306`）与 §高风险子系统 R-3（`:331`）
4. 🔷 **SHOULD READ** — `scripts/run-oxlint.ts`（`:59-95`，理解 `--tsconfig` 旗标为何不救 glob 探测）
5. 🔷 **SHOULD READ** — `apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts:190` + `editor-chat-panel.ts:116`（`buildThinChatHtml` vs `buildEditorChatSpaHtml` 替换评估）
6. 🔹 **OPTIONAL** — `.specdev/specs/vscode-dsh-test-consolidation/phases/phase-1-baseline-domain-inventory/implementation.md` §4（oxlint 基线口径「1183/203」，注意已过时）
