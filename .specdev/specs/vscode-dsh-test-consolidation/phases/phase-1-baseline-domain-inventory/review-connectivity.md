# Connectivity Review — Phase 1

## 视角
**Integration Connectivity** — 模块间是否真正连通

## 判决：PASS

> 本轮为 MUST-FIX 回流后的重跑审查。上一轮唯一的 SHOULD-FIX（第 545 行 `sandbox-clean-state` 标题多 1 个转义反斜杠）已修复并核实对齐；其余连接维度全部连通，无悬空、无重复、无断裂。

## 端到端路径追踪

### Path 1: 能力域清单 → 冻结文件集（AC-2 双向差集）
```
Entry: capability-domains.json 各域 absorbed[]
  → 61 条 absorbed 路径
    → 逐条 fs.existsSync("apps/vscode-dsh/tests/"+path)   ✅ 全部存在（0 悬空）
    → 去重检测                                            ✅ 0 重复
    → 与 implementation.md §1 冻结 61 文件集比对          ✅ 双向差集为空
Exit: 每个整合前 spec 恰好归属一个域
```
**判定**: ✅ 数据路径完整，起点到终点连通

### Path 2: groupMapping → manifest → 域 id（AC-19 映射闭环）
```
Entry: capability-domains.json groupMapping（12 键）
  → 键集合 vs layer-v-capabilities.json 实际 12 group     ✅ 完全一致（双向差集为空）
  → 值集合 vs domains[].id 集合                          ✅ 每个值都是合法域 id
Exit: 12 group 全部多对一映射到 10 域
```
**判定**: ✅ 映射链闭合，无悬空键、无越界值

### Path 3: 台账 → 源文件反查（AC-4 审计性，S-4 审计场景）
```
Entry: assertion-map.md 每行「原文件 + 原标题」
  → 61 个唯一「原文件」vs 61 absorbed                     ✅ 双向差集为空（0 悬空 / 0 遗漏）
  → 556 数据行 = implementation.md §2 声明的 556 静态声明  ✅ 一致
  → 抽查标题 vs 源文件 grep                               ✅ 精确一致（见下表）
Exit: 任一历史 spec 路径可反查断言处置（Phase 2 回填后闭环）
```
**判定**: ✅ 反查链路无断裂

## 上下游连接检查

| 新文件/字段 | 上游（谁产生） | 连接状态 | 下游（谁消费） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| `capability-domains.json.absorbed` | 冻结 `find` 61 文件集 | ✅ | Phase 2 归并（AC-2 判据） | ✅ |
| `capability-domains.json.scripts`（16） | `test-scripts/` 16 文件 | ✅ | Phase 3 四类分层（AC-19） | ✅ |
| `capability-domains.json.groupMapping`（12） | `layer-v-capabilities.json` 12 group | ✅ | AC-19 映射判定 | ✅ |
| `capability-domains.json.entryAssertions.entrypoint` | `src/` 命令注册 / 导出符号 | ✅ | Phase 2 回填 `caps` | ✅ |
| `capability-domains.json.spec` | design.md 定稿命名 | ✅ | Phase 2 建 `cap-*.spec.ts|tsx` | ✅ |
| `assertion-map.md` 表头（11 列） | design.md §205–221 定稿 | ✅ | Phase 2 逐行回填处置 | ✅ |
| `assertion-map.md` 数据行（556，原文件/原标题） | 61 spec 源文件 | ✅ | Phase 2 AC-9 双向差集 | ✅ |

## 跨模块契约验证

| 模块间 | 上游期望 | 下游实际 | 一致？ |
|--------|-----------|-------------|:--:|
| design.md §124–135 → JSON | 10 域 id（小写连字符） | `session-host` … `test-harness`（10 个，逐一对应） | ✅ |
| design.md §265 → JSON.spec | `cap-<domain>.spec.ts`，webview 用 `.tsx` | 9 个 `.ts` + 1 个 `.tsx`（webview） | ✅ |
| design.md §140–157 → JSON.groupMapping | 12 group → 10 域 | 12 键，值 ∈ 域 id | ✅ |
| design.md §201 → JSON.entryAssertions | `{ entrypoint, caps[] }` 非空骨架 | 10 域均 `entrypoint` 非空、`caps: []` | ✅ |
| requirements AC-2 → absorbed | 61 文件恰好归属一个域 | 61 条、0 重复、0 悬空 | ✅ |
| requirements AC-9 → 台账 | 最小单元静态声明行，不遗漏不重复 | 556 行、61 唯一文件双向差集空 | ✅ |

## entryAssertions 骨架可回填性（Phase 2 前提）

每域 `entrypoint` 均映射到 `src/` 中真实、唯一的入口（`grep -F` 精确命中），Phase 2 回填 `caps` 时不存在悬空入口：

| 域 | entrypoint | src/ 命中 |
|---|-----------|:--:|
| session-host | `activate` | ✅（`extension.ts:377` export） |
| conversation | `dsh.test.newConversation` | ✅ 1 处 |
| timeline | `dsh.test.listHistory` | ✅ 1 处 |
| interaction | `dsh.test.injectApproval` | ✅ 1 处 |
| code-context | `dsh.test.resolveAtPath` | ✅ 1 处 |
| change-list | `dsh.test.listChanges` | ✅ 1 处 |
| search | `dsh.test.searchSessions` | ✅ 1 处 |
| chat-panel | `dsh.showPanel` | ✅（`extension.ts:512` registerCommand） |
| webview | `message-bridge` | ✅（`webview/src/App.tsx` 等） |
| test-harness | `dsh.test.simulateStartupOnly` | ✅ 1 处 |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| `absorbed` 61 文件基线 | 冻结（本 Phase 产出） | Phase 2/3 写面判据 | ✅ |
| `groupMapping` 12 键 | design.md 定稿 | Phase 3 AC-19 判据 | ✅ |
| 16 `scripts` 覆盖 | repo-exploration §3.4 | Phase 3 四类分层基线 | ✅ |
| oxlint 基线（1183/203） | 本 Phase 复测 | Phase 4 AC-16 对比 | ✅（实现留档可复算） |
| AC-23 退出码基线（smoke 4 / capabilities 0） | 本 Phase 采集 | Phase 3 AC-23 对比 | ✅ |

## 台账反查抽查结果（AC-4 审计性，含第 545 行）

| 台账行 | 标题 | 源文件 grep | 一致？ |
|:--:|---|-----------|:--:|
| 545 | `leaves the run\'s own session file alone` | `sandbox-clean-state.spec.ts:109` `it('leaves the run\'s own session file alone', …)` | ✅ 单反斜杠对齐 |
| 544 | `reports a session file that predates the run` | `sandbox-clean-state.spec.ts:101` | ✅ |
| 499 | `every target id exists in the manifest` | `layer-v-capabilities-phase3.spec.ts:91` | ✅ |
| 8 | `reuses connected Host without a second start (AC-1 / AC-5)` | `auto-start-orchestrator.spec.ts:41` | ✅ |
| 199 | `AC-6 via button: active empty reused; content + leftover empty → New not steal` | `phase4-new-conversation-chrome.spec.ts:248` | ✅ |
| 154 | `derives titles from the first user message (AC-11)` | `conversation-registry.spec.ts:33` | ✅ |

> 第 545 行上一轮的 `run\\'s`（双反斜杠）已修正为 `run\'s`（单反斜杠），与源文件 `:109` 逐字节一致（`cat -A` 复核）。

## 关键发现
### 🔴 Must-Fix
- 无。

### 🟡 Should-Fix
- 无。

### 🟢 Observations
- `scripts` 字段的域归属为 Phase 1 骨架（产品 8 域填 `[]`，16 文件全部归 `session-host` 4 项 + `test-harness` 12 项）；实现已显式登记为偏差 D-1，完整 4 类分层留待 Phase 3。连接上无悬空（16 文件每文件恰归属一个域），不阻塞。
- `entryAssertions.caps` 全部为 `[]` 属 Phase 1 预期骨架（Phase 2 回填），非缺口。
