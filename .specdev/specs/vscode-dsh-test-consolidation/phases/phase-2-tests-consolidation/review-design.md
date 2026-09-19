# Design Consistency Review — Phase 2

## 视角
**Design Consistency** — 代码是否遵循架构设计

## 判决
**SHOULD-FIX**

## 架构决策对照

| design.md 决策 | 实现是否遵循 | 证据 | 判定 |
|:---|:---|------|:--:|
| 决策 1：能力域定稿 10 个 | 是 | `capability-domains.json` 含 10 个 `domains` 条目，id 与定稿清单一致 | ✅ |
| 决策 2：命名 `cap-<domain>` + `CAP-<DOMAIN>-<NNN>` | 是 | 12 文件 `cap-*.spec.ts|tsx`；顶层 `describe('cap:<domain> — …')` | ✅ |
| 决策 3：台账 `assertion-map.md` 唯一追溯载体 | 是 | markdown 表 11 列，556 数据行；无 `.archive/`、无旧副本 | ✅ |
| 决策 4：DEBT-1 去重（Phase 3 范围） | 不适用 | Phase 2 不碰 `test-scripts/`（未改动，见范围检查） | N/A |
| 决策 5：lint 归零 glob 化（Phase 4 范围） | 不适用 | Phase 2 不改 `tsconfig.json` include | N/A |
| 决策 6：Phase 拆分 4 个 | 是 | 本 Phase 只做 tests 归并，未越界 scripts/lint | ✅ |
| 决策 7：verifier 独立性 = 流程义务 | 是 | 测试树内无 `.verifier-baseline.json`、无 `describe('verifier: ')` 块 | ✅ |

## 模块/命名/结构审查

### 1. 域文件命名与 R-4 jsdom 拆分

| 新文件 | 是否匹配 `cap-<domain>[<-part>].spec.ts|tsx` | 说明 |
|--------|:--:|------|
| `cap-session-host.spec.ts` | ✅ | 10 域定稿 id |
| `cap-conversation.spec.ts` | ✅ | |
| `cap-timeline.spec.ts` | ✅ | |
| `cap-interaction.spec.ts` | ✅ | |
| `cap-code-context.spec.ts` | ✅ | |
| `cap-change-list.spec.ts` | ✅ | |
| `cap-change-list.dom.spec.ts` | ✅ | R-4 拆分（jsdom），`<part>`=`dom`，AC-1 允许 |
| `cap-search.spec.ts` | ✅ | |
| `cap-chat-panel.spec.ts` | ✅ | |
| `cap-chat-panel.dom.spec.ts` | ✅ | R-4 拆分（jsdom），AC-1 允许 |
| `cap-webview.spec.tsx` | ✅ | `.tsx`(jsdom) 域，符合决策 2「webview 用 .spec.tsx」 |
| `cap-test-harness.spec.ts` | ✅ | |

- 12 文件 / 10 域，多出的 2 个 `.dom.spec.ts` 是 design.md §R-4（`requirements.md` R-4「允许拆为独立文件」）允许的 jsdom 拆分。
- 拆分理由成立：`cap-chat-panel.dom.spec.ts:1` 与 `cap-change-list.dom.spec.ts:1` 均带 `// @vitest-environment jsdom` 文件级 pragma，与 node 主文件（无 pragma）环境隔离；这是 `// @vitest-environment` 按文件生效（repo-exploration §3.4）下的唯一可行方案。

### 2. 顶层 describe 命名（AC-3）

12 个文件顶层 describe 首段 `cap:<domain>` 均与域 id 一致；全树 `describe('cap:…` 出现的域 id 集合 = 10 = 清单域 id 集合。✅

### 3. 台账 schema（design.md §205–221）

表头实测 11 列：

```
| 原文件 | 原标题 | 处置 | 理由码 | keepChecks.K1/K2/K3 | K 依据 | privateSymbols | replacementCap | 关闭依据 | 新 CAP- 编号 | weakened |
```

与 design.md §209–221 完全一致。逐列抽查：
- `keepChecks.K1/K2/K3` 三 bool 全部填写（556 行无空）。
- `K 依据`：K=true 行填 `路径:行号`（指向归并后域文件行号，路径真实存在）。
- `privateSymbols`：仅 D2 行填（`onDidSaveTextDocument`、`SNAPSHOT_STORE_SPIKE`、`showErrorMessage`，均可在原文件 grep 到）。
- `replacementCap`：本批无 D3 行 → 全空，合规。
- `关闭依据`：仅 D1 行填（`src/replay-hydrator.ts:363`、`src/change/snapshot-store.ts:42`、`src/chat-panel/chat-panel-provider.ts:190`、`src/continue-capability.ts:77`）。
- `新 CAP- 编号`：keep 行填；2 行 it.each（`sandbox-clean-state`）为多值（见 Observation O-3）。
- `weakened`：全 false（0 弱化）。

### 4. entryAssertions 结构（design.md §163–203 / AC-11）

10 域 `entryAssertions` 均非空，元素结构 `{ entrypoint, caps }` 与设计一致。entrypoint → `src/` 真实入口映射已核验：

| 域 | entrypoint | 真实入口 |
|---|---|---|
| session-host | `activate` | `src/extension.ts:377` |
| conversation | `dsh.test.newConversation` | `src/extension.ts`（registerCommand 命中 1） |
| timeline | `dsh.test.listHistory` | 同上 |
| interaction | `dsh.test.injectApproval` | 同上 |
| code-context | `dsh.test.resolveAtPath` | 同上 |
| change-list | `dsh.test.listChanges` | 同上 |
| search | `dsh.test.searchSessions` | 同上 |
| chat-panel | `dsh.showPanel` | 同上 |
| webview | `createMessageBridge` | `webview/src/bridge/message-bridge.ts:64` |
| test-harness | `dsh.test.simulateStartupOnly` | `src/extension.ts`（registerCommand 命中 1） |

8 个命令 id 在 `extension.ts` 中 `registerCommand` 各命中 1；`caps` 均为该域非空 `CAP-` 编号数组。

## 筛选规则忠实执行（K1–K3 / D1–D4）

- keep 543 行：理由码分布 `K1=272, K1,K3=227, K1,K2=19, K1,K2,K3=25`，均为 ≥1 K 命中。✅
- drop 13 行：`D1=10, D2=3, D3=0, D4=0`，理由码恰一 D。✅
- 结构交叉校验：0 行「keep + 全 false keepChecks」；0 行「drop + 任一 true keepChecks」→ 无「以 D1/D2 删 K 命中项」（AC-27 ①）。✅
- 逐域抽查 drop 判定与 repo-exploration §3.2 线索一致：spike-attribution-snapshot 6 drop（D1 固化/D2 私有符号）+ 1 keep（#7 K3 误报否定）；gap-005-009 仅 #2 源码文本断言 drop(D2)；spike-t0a/t0b 的 D1 drop 均指向生产固化位置。

## Constitution §2 检查

| 条款 | 是否违反 | 说明 |
|------|:--:|------|
| 依赖方向 | ✅ | 测试资产仅 import 生产模块，无反向依赖；未触碰核心/外围边界 |
| 写面范围 | ✅ | 仅 `tests/**` 与台账/清单，未改 `src/`、`webview/`、`packages/`、`test-scripts/`、`scripts/`、`constitution.md` |

## 范围克制检查（AC-24）

- `git status --short` 对 `src/`、`webview/`、`packages/`、`test-scripts/` 无改动（仅 1 个 `packages/typert/generator/tests/.generated-tools-Tlt0dU/` 未跟踪测试运行时产物，非源码修改）。
- `.merge-tools/` 已删除（Glob 0 命中），未引入设计外结构。✅
- 61 个旧 spec 已删除，无 `phase<数字>`/`gap-<数字>`/`spike-` 命名的 spec 残留，无 `verifier-phase<数字>` 目录下的 spec 文件。✅

## spike/gap 5 文件处置（AC-26）

| 文件 | 归属域 | 台账处置 |
|------|------|------|
| `gap-003-004-debt-fix.spec.ts` | conversation | 5 keep（K1/K3） |
| `gap-005-009-debt-fix.spec.ts` | interaction | 7 keep + 1 drop(D2) |
| `spike-attribution-snapshot.spec.ts` | timeline | 1 keep + 6 drop（5 D1 + 1 D2） |
| `spike-t0a-replay-rebuild.spec.ts` | test-harness | 2 keep + 2 drop(D1) |
| `spike-t0b-continue-capability.spec.ts` | test-harness | 1 keep + 3 drop(D1) |

5 文件均出现在 `capability-domains.json` 对应域 `absorbed` 中，每条断言在台账有明确处置。✅

## 关键发现

### 🔴 Must-Fix
- 无。

### 🟡 Should-Fix
- **S-1 空目录残留**：`apps/vscode-dsh/tests/` 下 `verifier-phase1/`、`verifier-phase2/`、`layer-a/`、`layer-a-rtl/` 四个空目录仍在工作区（文件已删、目录未删）。AC-1 明文「必须不存在 `verifier-phase<数字>` 目录」；`implementation.md` 声称 AC-1 ✅「无 verifier-phase<数字> 目录」与工作区实况不符。虽 git 不跟踪空目录（不会入提交）、机械判定 `find -type f | grep` 也为空，但为字面满足 AC-1 应 `rmdir` 清掉这 4 个空目录。

### 🟢 Observations
- **[文档保真] O-1** `capability-domains.json` 的 `spec` 字段：`change-list`、`chat-panel` 两域只填了主文件 `cap-<domain>.spec.ts`，未体现 `.dom.spec.ts` 拆分文件。schema 为单值路径（design §199），拆分决策晚于数据模型定稿，属文档层缺口，不影响 AC-2/AC-11 判定。
- **O-2 台账 `新 CAP- 编号` 多值**：2 行 `it.each` 静态声明（`sandbox-clean-state`）的「新 CAP- 编号」列含 8/7 个空格分隔值。design §220 该列语义为单值，但实现已在 `implementation.md` 偏差 3 说明理由（AC-9 按静态声明记 2 行 vs AC-6/AC-7 运行时展开 15 个唯一 CAP），属必要调和，非违规。
- **O-3 K 依据指向归并后域文件行号**：`K 依据` 列的 `路径:行号` 指向新域文件（如 `cap-session-host.spec.ts:3093`）而非生产源码「被断言对象读取位置」。AC-27 ② 的机械校验（路径存在 + 行号不越界）通过；依据是否支撑 K 成立属语义判断，归 `reviewer-correctness`。此处仅提示口径。
