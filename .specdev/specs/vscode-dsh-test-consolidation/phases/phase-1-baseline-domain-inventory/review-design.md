# Design Consistency Review — Phase 1

## 视角
**Design Consistency** — 代码是否遵循架构设计

## 判决
**PASS**

## 架构决策对照

| design.md 决策 | 实现是否遵循 | 证据 | 判定 |
|:---|:---|------|:--:|
| 决策 1：能力域定稿为 10 个（非「9 个左右」） | 是 | `capability-domains.json` `domains[]` 共 10 条，域 id 集合与 `design.md` §能力域定稿清单逐一相等：`session-host` / `conversation` / `timeline` / `interaction` / `code-context` / `change-list` / `search` / `chat-panel` / `webview` / `test-harness` | ✅ |
| 决策 2：命名 `cap-<domain>` + `CAP-<DOMAIN>-<NNN>` | 是 | 每域 `spec` 字段值匹配 `cap-<domain>.spec.ts\|tsx`（`webview` 为 `.spec.tsx`，其余 9 域 `.spec.ts`）；`CAP-` 编号留待 Phase 2，本 Phase 未提前引入（无越界） | ✅ |
| 决策 3：台账 `assertion-map.md` 是唯一追溯载体 | 是 | 台账表头严格对齐 design.md §数据模型第 209–221 行定稿 11 列，`所属域` 列已移除，域归属唯一真相源回归 `capability-domains.json` 的 `absorbed` | ✅ |
| 决策 6：Phase 拆分 4 个（1 → 2、1 → 3、2+3 → 4） | 是 | Phase 1 仅产出基线 + 两个骨架文件，未越界搬动/归并/改写任何既有 spec；`tests/` 下无 `cap-*.spec.ts` 提前出现（该产物属 Phase 2） | ✅ |

## 模块/命名/结构审查

### 目录合理性
| 新文件 | 所在目录 | 是否合理 | 说明 |
|--------|---------|:--:|------|
| `capability-domains.json` | `apps/vscode-dsh/tests/` | ✅ | design.md 数据模型指定位置 |
| `assertion-map.md` | `apps/vscode-dsh/tests/` | ✅ | design.md 数据模型指定位置 |

### schema 一致性
| JSON 字段 | design.md 定义 | 实现 | 判定 |
|-----------|---------------|------|:--:|
| `schemaVersion` | 有 | `1` | ✅ |
| `groupMapping` | 12 group → 10 域，逐项定稿 | 12 键完全对齐 design.md §group→domain 映射表（`react-spa-main→webview`…`test-hooks→test-harness`） | ✅ |
| `domains[].id` | 小写连字符域 id | 与定稿 10 域逐一相等 | ✅ |
| `domains[].spec` | `cap-<domain>.spec.ts\|tsx` 或 null | 全部非 null，命名匹配（`webview` 为 `.tsx`） | ✅ |
| `domains[].scripts` | test-scripts 文件路径（AC-19 归属） | 存在（见 Observations-1） | ✅ |
| `domains[].absorbed` | 吸收的整合前 spec 路径 | 10 域并集与 design.md §能力域定稿清单逐一相等，无张冠李戴 | ✅ |
| `domains[].entryAssertions` | `{entrypoint, caps}`，caps 非空 | `caps: []` 留空（spec.md 明确「caps 待 Phase 2 回填」），`entrypoint` 骨架已填 | ✅ |
| `domains[].verifierSources` | 可选，仅记录 | 全部 `null` | ✅ |

### absorbed 归属核对（逐域与 design.md 定稿比对）
10 个域的 `absorbed` 文件列表与 design.md §能力域定稿清单**逐字相等**，无文件张冠李戴、无遗漏、无重复（如 `phase4-subagent-enter-pin.spec.ts` 归属 conversation、`chat-ux-fork-retry-branch.spec.ts` 归属 timeline、`layer-a/*` 归属 chat-panel / change-list 等，均与定稿一致）。

### 台账列一致性核对
`assertion-map.md` 表头 11 列顺序与 design.md 第 209–221 行定稿**完全一致**：

`原文件` / `原标题` / `处置` / `理由码` / `keepChecks.K1/K2/K3` / `K 依据` / `privateSymbols` / `replacementCap` / `关闭依据` / `新 CAP- 编号` / `weakened`

- 分隔行 11 个 `---`，列数对齐。
- 上一轮私增的 `所属域` 列已移除（`grep -c '所属域'` = 0）。
- 数据行仅「原文件 / 原标题」两列填实，其余 9 列留空占位，符合「Phase 1 只冻结两列、待 Phase 2 回填」的约定（spec.md §约束）。

### 范围克制
- `tests/` 目录下仍为 61 个整合前 `.spec.ts/.spec.tsx`（Glob 实测 61 个），未出现 `cap-*.spec.ts`（0 个）——Phase 2 的归并产物未提前产生。
- 变更清单仅新增 2 个产物文件（json + md）+ `implementation.md`，无既有 spec 内容被改写。

### 未引入设计外结构
- JSON 全部字段、台账全部列名均在 design.md 数据模型定义内，无新增未定义字段/列名。

## 关键发现

### 🔴 Must-Fix
无。

### 🟡 Should-Fix
无。

### 🟢 Observations
- **O-1（`scripts` 字段骨架化分配，已登记偏差）**：8 个产品域 `scripts: []`，16 个 test-scripts 文件全部归入 `session-host`（4）与 `test-harness`（12）。design.md 数据模型仅给 session-host 示例、未定义 16 文件的逐域完整映射（AC-19 属 Phase 3 写面），故 Phase 1 以「每文件恰归属一域」落骨架是**合理的骨架化处理**，且已在 `implementation.md` §偏差记录 D-1 显式留痕，属「登记的偏差」而非「未登记的设计违反」。待 Phase 3 收敛，不阻塞本 Phase。
- **O-2（`entrypoint` 骨架值的选择）**：`session-host` 的 `entrypoint` 填 `activate`（design.md 示例为 `dsh.test.getStartState`）。design.md 明确该示例为占位（`/* ... */`），且 `entrypoint` 语义定义为「命令 id / 导出符号 / IPC 消息 / 工具名」，`activate` 属合法入口。spec.md 明确授权「entrypoint 骨架本 Phase 填」，`entrypoint→caps` 与 `src/` 真实调用路径的语义核对由 AC-11 划归 `reviewer-correctness`，不在本视角范围。记记录项，不参与判决。

## 结论
上一轮 MUST-FIX（`assertion-map.md` 表头偏离 11 列定稿、私增「所属域」列）已修复：表头 11 列严格对齐 design.md 第 209–221 行定稿、「所属域」列已移除；10 域 id 与 schema、absorbed 归属、台账列、范围克制、无设计外结构均与 design.md 一致。
