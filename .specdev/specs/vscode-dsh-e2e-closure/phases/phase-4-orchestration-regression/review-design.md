# Design Consistency Review — Phase 4

## 视角
**Design Consistency** — 代码是否遵循架构设计

## 判决
**SHOULD-FIX**

## 架构决策对照

| design.md 决策 | 实现是否遵循 | 证据 | 判定 |
|:---|:---|------|:--:|
| §权衡「全链入口」：新增 `run-vscode-dsh-e2e-closure.sh` **薄封装**，只做「全量 + 汇总 + 回归」 | 是 | 编排入口不 launch 任何 host、不重建 closure/journal 判定，每个 batch 是一次独立 `run-layer-v-capabilities.sh` 调用（`run-vscode-dsh-e2e-closure.sh:238`）；`assessClosedLoop`/`classifyAssertionStrength` 零重建 | ✅ |
| §权衡「闭环结论的表达」：新增正交 `closedLoop`，**不改退出码契约**（0/1/2/3/4） | 是 | 编排入口聚合结果仍是五值之一，无新退出码（无「5=NOT_CLOSED」）；`conclusion_of`/`severity_of` 只映射 0/1/2/3/4，未知码 fail-closed 归 4（`:114-134`） | ✅ |
| §权衡「能力批次序」：非模型批先、模型批后（串行） | 是 | `main()` 先 `run_batch "nonmodel"` 再 `run_batch "model"`（`:345-354`）；分批成员从 `requiresModel` 实时派生，不硬编码 id 列表（`:86-96`） | ✅ |
| §高风险子系统 #4：`run-chat-ready-regression.sh`「改为引用 `cap-*.spec.ts` **或登记为过时并归档**，不静默删除」 | **部分** | 采用「标记过时注释 + 登记 DEBT-11」（`run-chat-ready-regression.sh:6-16`），但**未归档**（文件原位保留，`git status` 为 `M` 非 `D`） | 🟡 偏差（缺归档步骤，需设计修订记录回写） |
| §实现方案「artifact-index 行」：复用 `artifact-index.cjs`，不改 smoke 脚本 | 是 | 编排入口经共享 `layer-v-support/artifact-index.cjs append` 追加行（`:208-221`）；未动 smoke 脚本 | ✅ |

## 模块/命名/结构审查

### 目录合理性
| 新文件 | 所在目录 | 是否合理 | 说明 |
|--------|---------|:--:|------|
| `run-vscode-dsh-e2e-closure.sh` | `apps/vscode-dsh/test-scripts/` | ✅ | AC-13 铁律：真机脚本落 `test-scripts/`，非 `tests/` |
| `run-chat-ready-regression.sh`（头部注释） | `apps/vscode-dsh/test-scripts/` | ✅ | 原位处置，未移动、未删 |
| `run-layer-v-capabilities.sh`（`rm -f` 扩清 base） | `apps/vscode-dsh/test-scripts/` | ✅ | DEBT-6 收尾，改动点正确落在 shell 层 |

### 命名规范审查
| 文件/符号 | 实际命名 | 应遵循规范 | 判定 |
|-----------|---------|-----------|:--:|
| 编排入口函数 | `run_batch` / `aggregate_exit` / `build_closure_row` | 沿用 smoke/能力脚本的 `snake_case` shell 约定 | ✅ |
| 编排入口变量 | `RUN_DIR` / `PLAN_PATH` / `CAPABILITIES_SCRIPT` | 沿用既有大写 env 约定 | ✅ |
| 注释语言 | 英文（`run-vscode-dsh-e2e-closure.sh` 头部） | 与 smoke/能力脚本既有英文头注一致 | ✅ |

### Constitution §2 + Phase ID 铁律检查
| 条款 | 内容 | 是否违反 | 说明 |
|------|------|:--:|------|
| §2.1 单一职责 | 编排入口只做编排/汇总/索引，不实现 closure 判定 | ✅ | 判定逻辑全部复用 `run-layer-v-capabilities.sh` → `capability-runner.cjs` |
| §2.2 依赖方向 | 编排入口只依赖 `test-scripts/` 内既有脚本 + 共享原语，不触产品代码 | ✅ | 无 `src/`/`webview/src/` 改动 |
| Phase ID 铁律（DEBT 目标Phase） | 目标Phase 不得含 DAG JSON 之外的 phantom phase ID | ✅ | 见下方专节 |

**DEBT 目标Phase 核验（用户点名的单一真相源检查）**：本 Phase 收尾后，registry 中所有活跃条目的 `目标Phase` 均为「后续 feature（…）」或合法的 `phase-4-orchestration-regression`（仅 `DEBT-6` 已解决表的 `解决Phase` 列），**无任何 phantom phase ID 残留**。重定向前 repo-exploration §9 记录的「`DEBT-2/3/8/10` 目标Phase=`phase-4`（非合法 DAG id）」已全部消除。

## 关键发现

### 🔴 Must-Fix
无。

### 🟡 Should-Fix

1. **design.md §设计修订记录缺少 Phase 4 决策（方案 C）回写**。本 Phase 对 `run-chat-ready-regression.sh` 采用了 design.md §高风险子系统 #4 与 spec.md §约束 均未列出的**第三种处置**——「标记过时 + 登记 DEBT-11、不归档、不修复、不改守卫」。design.md #4 原文是「改为引用 `cap-*.spec.ts` **或登记为过时并归档**」，其中「归档」动作（`git rm` / 移入归档目录）在本实现中被省略（文件原位保留，`git status` 为 `M`）。实现本身诚实（头部 obsolete 注释 + DEBT-11 已登记，非静默留破）、理由充分（4 处已完成工作流守卫引用，删除会破坏 `existsSync` 断言），且 implementation.md 偏差 1 已声明为「调度者授权偏差」；但 **design.md 作为单一真相源当前与实际决策不一致**（文档说「归档」，实现「不归档」）。按 §设计修订记录既有模式（#1–#5 均为「implementer 偏差 → HG-3 SHOULD-FIX 回填」），应追加一条 #6，记录「方案 C：标记过时 + 登记 DEBT-11，不归档」，批准人=调度者，偏差来源=implementation.md 偏差 1。

### 🟢 Observations

2. `[文档保真]` **跨 batch 退出码聚合的优先级排序未在 design.md §权衡「全链入口」行显式声明**，属 repo-exploration §7 R1 预判的「实现决策点」。但该排序 `4 > 1 > 2 > 3 > 0` **精确等于**既有 `CONCLUSION_PRECEDENCE`（`HARNESS_ERROR > LINK_FAILURE > SKIPPED_NO_CREDENTIALS > PASS`）按 repo-exploration 建议「把 `SKIPPED_NO_DISPLAY`(2) 插入 3 之前」后的扩展，与既有约定一致、非新发明语义，且代码注释已完整交代理由（`:19-25`）。属「汇总」范畴，不属被禁止的「判定逻辑」重建，**不参与判决**；建议后续在 design.md 补一句该聚合顺序的来源，但不阻塞。

3. registry 的 `源Phase` 列仍保留若干重写前的历史 phase 名（`DEBT-2/3` 源 `phase-2-session-main-path-llm`、`DEBT-1` 源 `phase-1-driver-framework-pilot`、`DEBT-4/5` 源 `phase-3-remaining-capabilities`），与当前 DAG JSON 的 id 不符。这是**历史来源**列（债务产生于重写前工作流），非向前看的 `目标Phase`，本 Phase 既未引入也未要求修正，不影响单一真相源（`目标Phase` 已干净）。仅记录，不改动。

## 结论

Phase 4 实现整体严格遵循 design.md 的架构决策：全链入口确为「薄封装」（不新增 closure 判定逻辑、不改退出码契约、批次序与 manifest 派生符合设计）、registry 收尾（DEBT-2/3/8/10 转后续、DEBT-6 移已解决、新增 DEBT-11）与 AC-15「不补齐、如实登记」一致、无 phantom 目标Phase。唯一需处理的是：**方案 C 偏离 design.md §高风险子系统 #4 的「归档」字样，应回写 design.md §设计修订记录 #6**，使单一真相源与实际决策保持一致。此项不涉及代码改动，判 SHOULD-FIX。
