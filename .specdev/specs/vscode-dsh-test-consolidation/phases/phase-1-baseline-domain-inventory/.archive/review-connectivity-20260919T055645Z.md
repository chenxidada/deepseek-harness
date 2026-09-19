# Connectivity Review — Phase 1 基线冻结与能力域清单

## 视角
**Integration Connectivity** — 模块间是否真正连通（Phase 1 产出物作为 Phase 2/3/4 上游输入，数据路径是否可被下游正确消费）

## 判决
**SHOULD-FIX**

> 核心产出（`capability-domains.json`）三条链路（absorbed / scripts / groupMapping）全部连通、零悬空；唯一缺陷是 `assertion-map.md` 第 545 行台账标题存在 1 处多余转义，导致「台账 → 源文件」反查（AC-4 审计性）对单条用例断裂，需在 Phase 2 做 AC-9 双向差集前修正。

## 端到端路径追踪

### Path 1: absorbed 路径 → 真实文件（AC-2 判定对象，Phase 2 归并输入）
```
capability-domains.json[domains][*].absorbed[]  (61 条，相对 apps/vscode-dsh/tests/)
  → 逐条 ls apps/vscode-dsh/tests/<path>
      ├─ 61/61 全部存在 ✅
      ├─ 无缺失（悬空路径）= 0
      ├─ 无重复（一文件被多域吸收）= 0
      └─ 无「暂无法归属」文件 = 0
Exit: 双向差集为空，每文件恰好归属一个域 ✅
```
**判定**: ✅ 数据路径完整，61 文件集与 absorbed 并集严格双射

### Path 2: scripts 字段 → test-scripts 真实文件（Phase 3 AC-19 归属基线）
```
capability-domains.json[domains][*].scripts[]  (16 条，相对 apps/vscode-dsh/test-scripts/)
  → 逐条 ls apps/vscode-dsh/test-scripts/<path>
      ├─ 16/16 全部存在 ✅
      ├─ 无重复归属（dup = []）✅
      └─ 16 = test-scripts 目录实际文件数（find -type f = 16）✅
Exit: scripts 并集与 test-scripts 目录文件集双射 ✅
```
**判定**: ✅ 数据路径完整，16 test-scripts 文件恰好覆盖（session-host 4 + test-harness 8 产品域空，共 16）

### Path 3: groupMapping → manifest group 集合（Phase 3 AC-19 判定对象）
```
capability-domains.json.groupMapping  (12 键)
  vs  layer-v-capabilities.json[capabilities][*].group 去重 (12 group)
      ├─ 缺失键（manifest 有、mapping 无）= 0 ✅
      ├─ 多余键（mapping 有、manifest 无）= 0 ✅
      └─ mapping 值 ∈ 域 id 集合 = 9/9 全部 ✅
Exit: group 集合 ⊆ 映射表键，映射值全部落入域 id ✅
```
**判定**: ✅ 12 group ↔ 12 键严格对齐；`chat-panel` 无 group 是 design.md 定稿（UI 底盘经 `editor-panel` 归 conversation 侧），非断裂

### Path 4: 台账 → 源文件反查（AC-4/S-4 审计性）
```
assertion-map.md (556 数据行: 原文件 + 原标题)
  → 逐条反向 grep apps/vscode-dsh/tests/<原文件>
      ├─ 555/556 命中 ✅
      └─ 1 条未命中 ❌ (见下)
        sandbox-clean-state.spec.ts
          台账标题: "leaves the run\\'s own session file alone"  (2 反斜杠)
          源文件:   it('leaves the run\'s own session file alone')  (1 反斜杠, :109)
          → grep -F 台账形式 命中 0 次 ❌
Exit: 反查链路对 1 条用例断裂
```
**判定**: ⚠️ SHOULD-FIX — 555/556 可反查，1 条因多余转义断裂

### Path 5: spec 字段 → 目标域文件名（Phase 2 归并落盘契约）
```
10 域 spec 字段:
  session-host → cap-session-host.spec.ts
  conversation → cap-conversation.spec.ts
  timeline     → cap-timeline.spec.ts
  interaction  → cap-interaction.spec.ts
  code-context → cap-code-context.spec.ts
  change-list  → cap-change-list.spec.ts
  search       → cap-search.spec.ts
  chat-panel   → cap-chat-panel.spec.ts
  webview      → cap-webview.spec.tsx  (✅ 唯一 .tsx，符合 design.md 决策 2 的 .tsx/.ts 分文件约束)
  test-harness → cap-test-harness.spec.ts
  vs design.md 决策 2 命名 cap-<domain>.spec.ts|tsx
Exit: 10/10 域 id 与 spec 文件名、.tsx 归属完全一致 ✅
```
**判定**: ✅ 契约一致，Phase 2 归并后可按 spec 字段正确落盘

### Path 6: entryAssertions entrypoint 骨架 → src 真实入口（Phase 2 回填 caps 前置）
```
10 域 entrypoint（caps 均 []，待 Phase 2 回填）:
  activate / dsh.test.newConversation / dsh.test.listHistory / dsh.test.injectApproval /
  dsh.test.resolveAtPath / dsh.test.listChanges / dsh.test.searchSessions / dsh.showPanel /
  message-bridge / dsh.test.simulateStartupOnly
  → 全部在 layer-v-capabilities.json steps 与 src evidence 中真实出现（dsh.* 命令 / activate 符号 / IPC bridge）
Exit: 结构 {entrypoint, caps:[]} 满足 AC-11 可回填形状 ✅
```
**判定**: ✅ entrypoint 均为真实可观察入口，caps 空数组是可回填的骨架，不构成断裂

## 上下游连接检查

| 新产出物 | 上游（谁生产） | 连接状态 | 下游（谁消费） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| `capability-domains.json` | Phase 1 implementer | ✅ | Phase 2（absorbed/spec/entryAssertions） | ✅ |
| `capability-domains.json` | Phase 1 implementer | ✅ | Phase 3（scripts/groupMapping，AC-19） | ✅ |
| `assertion-map.md` 骨架 | Phase 1 implementer | ✅ | Phase 2（回填处置列 + AC-9 双向差集） | ⚠️ 1 行标题失实 |
| `layer-v-capabilities-phase3.spec.ts` 登记 | Phase 1（absorbed + 台账） | ✅ | HG-3 调度者 `git add`（D-2 已声明） | ✅ 登记完成，`git add` 待调度者 |
| 冻结基线快照（implementation.md） | Phase 1 | ✅ | Phase 2/3/4 的 AC-2/9/23/16 判定基准 | ✅ 可复算 |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| design.md 决策 2 → capability-domains.json `spec` | `cap-<domain>.spec.ts`（webview 用 `.tsx`） | 10 域 spec 均 `cap-<domain>.spec.ts|tsx`，webview=`.tsx` | ✅ |
| design.md §group→domain 表 → `groupMapping` | 12 group 全映射，值 ∈ 域 id | 12 键 + 值全 ∈ 域 id（9 个不同值，chat-panel 无 group 符合定稿） | ✅ |
| repo-exploration §3.4（16 文件）→ `scripts` | 16 test-scripts 文件恰好归属 | 16 条 scripts，无重复、无遗漏 | ✅ |
| AC-9「原标题=原文」→ `assertion-map.md` 标题 | 标题原文 | 1 处 `run\\'s` ≠ 源文件 `run\'s`（多 1 反斜杠） | 🔴 单条 |
| AC-11 `{entrypoint, caps}` 结构 → `entryAssertions` | 非空数组，元素含 entrypoint+caps | 每域 1 元素，entrypoint 真实、caps 空（Phase 1 骨架，Phase 2 回填） | ✅ |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| design.md 能力域定稿清单（10 域） | 设计阶段 | 已冻结 | ✅ |
| repo-exploration §3.1（61 文件映射） | workflow 级调研 | 已冻结 | ✅ |
| `layer-v-capabilities.json`（12 group） | 既有资产（非本工作流产出） | 未改动 | ✅ |
| 冻结基线（文件集/退出码/oxlint/vitest） | 本 Phase 自身采集 | 已留档，可复算 | ✅ |
| `git add` 未入库 spec | 调度者 HG-3 统一执行 | 本 Phase 未执行（D-2 已声明，符合「不 commit」硬约束） | ✅ 不阻塞（AC-2 用 find 不依赖 git） |

## 关键发现
### 🔴 Must-Fix
- （无）

### 🟡 Should-Fix
- **SF-1** `assertion-map.md` 第 545 行（`sandbox-clean-state.spec.ts`）标题转义失实：台账 `leaves the run\\'s own session file alone`（2 反斜杠）与源文件 `leaves the run\'s own session file alone`（`sandbox-clean-state.spec.ts:109`，1 反斜杠）不一致，多 1 个反斜杠。影响：① 反向 grep 命中 0 次（AC-4 审计性对单条断裂）；② Phase 2 做 AC-9「台账行 ↔ 冻结用例声明集」双向差集时，该行会与源文件声明不匹配。建议 Phase 2 前将该行标题修正为源文件原文（或统一台账提取命令与源文件转义口径）。

### 🟢 Observations
- **[文档保真]** `implementation.md` §2 声称「556 行 = 表头 7 + 556 数据行 = 563 行」，实测 `assertion-map.md` 总行数 563、数据行 556，陈述与实际一致，无失实。
- **[文档保真]** `implementation.md` §1 声称「oxlint 现状 1183 / glob 203」，与 design.md「1184→203」的差异已在 §4 显式纠偏（1183 为本 Phase 实测值），非失实而是有意修正。
- **台账标题含 markdown 必要转义**：第 358 行 `layer-a/activity-stream.spec.ts` 标题 `done \| failed \| aborted` 中 `\|` 是 markdown 表格的正确转义（源文件为裸 `|`，`layer-a/activity-stream.spec.ts:116`）。反向 grep 时需先将 `\|` 还原为 `|`，属载体固有编码而非失实。Phase 2 做 AC-9 双向差集时，判定命令需对台账标题做 markdown 反转义后再与源文件标题比对，否则含 `|` 的标题行会被系统性误判为「不匹配」。
- **`scripts` 字段 8 产品域为 `[]`**：conversation/timeline/interaction/code-context/change-list/search/chat-panel/webview 的 `scripts` 均为空数组，16 个 test-scripts 文件全部归入 session-host(4) + test-harness(12)。这是 implementation.md 偏差 D-1 已声明的骨架口径，`groupMapping` 已承载产品域 ↔ group 的能力覆盖关系；Phase 3 落地 AC-19 四类分层时以此 16 文件覆盖为基线，无需重排。
- **`chat-panel` 无独立 group**：`groupMapping` 值集合（9 个）不含 `chat-panel`，但 10 域 id 含 `chat-panel`。这是 design.md 定稿（「UI 底盘，manifest 无独立 group」），AC-19 只要求「manifest group ⊆ 映射键，映射值 ∈ 域 id」，不要求每域都有 group，故非断裂。
