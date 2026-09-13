# 连通性审查 — Phase 6（feature-regression）

## 视角
**Integration Connectivity** — 模块间是否真正连通

## 判决
**PASS**

## 端到端路径追踪

### Path 1: 一键回归入口 → phase-1…5 + AC-27 套件
```
入口: bash apps/vscode-dsh/test-scripts/run-chat-ready-regression.sh
  → ROOT = apps/vscode-dsh/test-scripts/../../..  （= 仓库根）✅
  → [1] vitest run（显式文件列表）:
       chat-ready-regression.spec.ts              ✅ 矩阵 smoke
       auto-start-orchestrator.spec.ts            ✅ phase-1 L1
       phase1-auto-start.spec.ts                  ✅ AC-1a 反向 + 自动建连
       phase2-auto-ready.spec.ts                  ✅ 视图可见就绪
       phase3-chat-ui-chassis.spec.ts             ✅ Chat UI 底盘 L3
       phase4-new-conversation-chrome.spec.ts     ✅ 新建 chrome L2
       phase5-should-polish.spec.ts               ✅ 抛光 AC-28…32/34
       phase3-restart-continue.spec.ts            ✅ AC-27 抽测
       phase2-multitab-history-replay.spec.ts     ✅ AC-27 抽测
       panel-close-delete.e2e.spec.ts             ✅ AC-27 抽测
  → [2] vitest 复跑 phase-1…4 五个文件（AC-R2）✅
  → [3] tech-debt-registry.md 活跃块 → `| （无） |` 哨兵 ✅
  → [4] git diff name-only agent-loop 守卫 ✅
出口: "ALL CHAT-READY REGRESSION STEPS OK" / exit 0
```
**判定**: ✅ 数据路径完整 — 一键入口显式挂到全部矩阵文件；10/10 磁盘存在；债表与 agent-loop 守卫可读

### Path 2: Phase-6 薄包装 → 产品脚本
```
入口: bash .specdev/.../phase-6-feature-regression/test-scripts/run-chat-ready-regression.sh
  → ROOT = ../../../../../.. （= 仓库根）✅ 与 apps 脚本 ROOT 一致
  → exec bash $ROOT/apps/vscode-dsh/test-scripts/run-chat-ready-regression.sh ✅
出口: 同 Path 1
```
**判定**: ✅ 包装不另起逻辑，委托产品入口，ROOT 解析正确

### Path 3: chat-ready-regression.spec.ts → 磁盘上的脚本
```
入口: vitest chat-ready-regression.spec.ts
  → resolve(import.meta.dirname, '../test-scripts/run-chat-ready-regression.sh')
  → apps/vscode-dsh/test-scripts/run-chat-ready-regression.sh ✅ existsSync
出口: 脚本存在时 smoke 通过
```
**判定**: ✅ 矩阵文档用例与真实入口脚本双向绑定（脚本跑该 spec；spec 断言脚本存在）

### Path 4: 交付摘要（AC-R4）消费路径
```
入口: feature-delivery-summary.md（+ -zh.md）
  → 文档化一键命令 = Path 1 脚本 ✅
  → 矩阵表锚点 = 脚本 [1] 文件列表 ✅
  → 结果摘要 [1]/[2]/[3]/[4] 与脚本步骤一一对应 ✅
  → README「Chat-ready Feature regression」节链接到同路径 ✅
出口: 人类/下游可从 README → 脚本 → 摘要闭环发现回归入口
```
**判定**: ✅ 交付摘要写入且被 README 消费；无「写后即弃」

## 上下游连接检查

| 新函数/组件 | 上游（谁调用） | 连接状态 | 下游（调用谁） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| `apps/.../run-chat-ready-regression.sh` | README / 交付摘要 / phase-6 包装 / chat-ready-regression.spec | ✅ | vitest 显式 10 文件 + registry + git | ✅ |
| phase-6 `test-scripts/run-chat-ready-regression.sh` | 交付摘要等价包装路径 | ✅ | apps 产品脚本（`exec`） | ✅ |
| `chat-ready-regression.spec.ts` | 脚本步骤 [1] vitest 列表 | ✅ | `existsSync(run-chat-ready-regression.sh)` | ✅ |
| `feature-delivery-summary.md` | AC-R4 / README 链接 | ✅ | 回归命令 + 矩阵 + OOS(AC-33) | ✅ |
| phase1…5 / AC-27 `*.spec.ts` | 脚本 [1]/[2] 文件列表 | ✅ | 既有 Fake vscode / Host 测试（phase 已冻结） | ✅ |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| 脚本 → vitest 路径 | `apps/vscode-dsh/tests/<name>.spec.ts` | 10 个文件均存在于磁盘 | ✅ |
| 脚本 [3] → registry | `## 活跃债务`…`## 已解决` 含 `\| （无） \|`，无 STUB/DEBT/GAP 活跃行 | 活跃表仅「（无）」；债务在「已解决」 | ✅ |
| spec smoke → 脚本相对路径 | `tests/../test-scripts/run-chat-ready-regression.sh` | 文件存在 | ✅ |
| README → 脚本 / summary | 同仓库根相对路径 | 两路径均可解析 | ✅ |
| 交付摘要 → 脚本步骤 | [1]–[4] 命名与结果列 | 脚本四步 echo 标签一致 | ✅ |
| README「等价 vitest 列表」 | 与脚本 [1] 对齐的套件 | 列出 phase1–5 + AC-27 九文件；**未**列入 `chat-ready-regression.spec.ts`（该文件在旁注说明） | ⚠️ 文档轻度不对称，非运行时断裂 |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| `auto-start-orchestrator` / `phase1-auto-start` | phase-1 | HG-3 通过；本 Phase 未改产品 src | ✅ |
| `phase2-auto-ready` | phase-2 | 已冻结套件；脚本 [1]+[2] 引用 | ✅ |
| `phase3-chat-ui-chassis` + AC-27 continue/multitab/close | phase-3 / 前序 Feature | 文件存在；脚本引用 | ✅ |
| `phase4-new-conversation-chrome` | phase-4 | 脚本 [1]+[2] 引用 | ✅ |
| `phase5-should-polish` | phase-5 | 脚本 [1] 引用；AC-R2 不强制复跑 phase-5（符合 AC-R2 文案） | ✅ |
| `tech-debt-registry` 活跃空 | 全 Feature | 哨兵存在；AC-33 仅在 delivery OOS，非活跃债 | ✅ |
| 冻结产品 API（orchestrator/coordinator/chrome） | phase-1…5 | **未改** `apps/vscode-dsh/src/**`；未触碰 `agent-loop` | ✅ |

## 关键发现

### 🔴 Must-Fix
- （无）

### 🟡 Should-Fix
- （无阻塞级）README「Equivalent vitest file list」未含 `chat-ready-regression.spec.ts`，而脚本步骤 [1] 包含它。旁注已指向该文件，**不构成路径断裂**；若追求列表与脚本字节级一致可补一行（可选）。

### 🟢 Observations
- 一键入口落在 `apps/vscode-dsh/test-scripts/`（产品侧），phase-6 `test-scripts/` 仅为薄包装 — 与 exploration 推荐一致且 ROOT 双端验证匹配。
- `chat-ready-regression.spec.ts` 有意只做入口存在性 smoke，行为覆盖留在 phase 套件 — 避免重复，且仍被脚本 [1] 纳入可编程矩阵。
- AC-R4 交付摘要（en/zh）与 README 互相链接；矩阵勾选表与脚本文件列表同构。
- 无跨 Phase 冻结接口签名变更；无循环依赖；无「只写不读」的交付物黑洞。

## 结论

**Wiring complete.** 一键回归入口 → 显式 vitest 文件列表（phase-1…5 + AC-27）→ 债表/agent-loop 守卫 → delivery summary → README 文档入口，端到端连通且契约一致。
