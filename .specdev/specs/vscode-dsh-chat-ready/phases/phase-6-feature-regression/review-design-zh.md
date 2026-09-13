# 设计一致性审查 — Phase 6（phase-6-feature-regression）

## 视角
**设计一致性** — 实现是否遵循架构设计

## 判决
**PASS**

## 架构决策对照

| design.md / phase-plan 决策 | 实现是否遵循 | 证据 | 判定 |
|:---|:---|------|:--:|
| R3：phase-6 = Feature 收口回归；**不**改 AD-CR 产品架构 | 是 | `git status`：`apps/vscode-dsh/src/**` 与 `packages/core/agent-loop` **无改动**；`implementation.md` 写明「无新产品架构」 | ✅ |
| R3 / phase-plan：phase-6 仅 AC-R1…R4 | 是 | 产出为统一回归脚本 + 矩阵文档 smoke + 交付摘要 + 债表静态检查；无新功能 AC | ✅ |
| R3：**AC-33 Out of Scope**（不做动画） | 是 | `feature-delivery-summary.md`「Out of Scope」显式列出 AC-33；本 Phase 未改底盘动画相关产品代码 | ✅ |
| phase-6 约束：禁止重开 Out-of-Scope / 禁止改 agent-loop | 是 | 脚本步骤 [4] 守卫 agent-loop；交付摘要重申禁止；工作区无 agent-loop diff | ✅ |
| AC-R1：可编程一键入口（非人工点一遍） | 是 | `apps/vscode-dsh/test-scripts/run-chat-ready-regression.sh` 显式 vitest 文件列表；README 已文档化 | ✅ |
| AC-R2：phase-1…4 套件仍绿 | 是 | 脚本步骤 [2] 单独复跑 5 个 phase1–4 文件 | ✅ |
| AC-R3：活跃债空或仅文档化 OOS | 是 | `tech-debt-registry.md` 活跃表仅「（无）」；脚本步骤 [3] 断言；AC-33 在 summary 标 OOS（非静默 Should） | ✅ |
| AC-R4：`feature-delivery-summary.md` | 是 | 新增 en + zh；含已交付 Must、AC-33 Out、回归命令与结果矩阵 | ✅ |
| design R3 注：主体 AD-CR 未改，仅收口门禁 | 是 | 无新 Host/Controller/webview 架构面；无新 AD-CR 实现 | ✅ |
| constitution §5.1：Must 或 Out，禁止 Should 偷懒 | 是 | AC-33 明确 OOS；无新增「以后再做」Should 债行 | ✅ |

## 模块/命名/结构审查

### 目录合理性

| 新文件 | 所在目录 | 是否合理 | 说明 |
|--------|---------|:--:|------|
| `run-chat-ready-regression.sh` | `apps/vscode-dsh/test-scripts/` | ✅ | 产品侧一键入口；与 exploration「shell aggregator」一致 |
| `chat-ready-regression.spec.ts` | `apps/vscode-dsh/tests/` | ✅ | 矩阵文档 + 入口存在性 smoke；不重复 phase 套件 |
| phase 包装脚本 | `phases/phase-6-…/test-scripts/` | ✅ | 薄 `exec` 委托 apps 脚本；沿用既有 verifier 脚本目录惯例 |
| `feature-delivery-summary.md`（+zh） | `.specdev/specs/vscode-dsh-chat-ready/` | ✅ | AC-R4 约定路径；对齐 conversation-ui 模板 |
| `README.md` 增节 | `apps/vscode-dsh/` | ✅ | 文档化入口；属 harness/docs，非产品架构 |
| 产品 `src/**` | — | ✅ | **未新增/未改** — 符合「无新产品架构」 |

### 命名规范审查

| 文件/符号 | 实际命名 | 应遵循规范 | 判定 |
|-----------|---------|-----------|:--:|
| 回归脚本 | `run-chat-ready-regression.sh` | kebab-case shell | ✅ |
| 矩阵 smoke | `chat-ready-regression.spec.ts` | `tests/` 下 `*.spec.ts` | ✅ |
| Phase id | `phase-6-feature-regression` | DAG JSON `phases[].id` | ✅ |
| 交付文件 | `feature-delivery-summary.md` | slug 根目录约定名 | ✅ |

### Constitution §2 检查

| 条款 | 内容 | 是否违反 | 说明 |
|------|------|:--:|------|
| §2.1 单一职责 | 每个模块做一件事 | ✅ | 脚本=聚合跑测；spec=入口文档 smoke；summary=交接文档 |
| §2.2 依赖方向 | 核心不依赖外围 | ✅ | 未改 `packages/core/*`；harness 只消费既有 vitest 套件与 registry |
| §2.3 接口隔离 | 模块间明确接口 | ✅ | 无新跨包产品 API；包装脚本仅委托 |

## 关键发现

### 🔴 Must-Fix
- （无）

### 🟡 Should-Fix
- （无）

### 🟢 Observations
- 主入口在 `apps/vscode-dsh/test-scripts/`、phase 目录仅薄包装，与 exploration「推荐 phase 脚本为主」略有主从对调，但仍满足 spec「tests 或文档化聚合入口」；职责清晰，不构成设计偏离。
- `chat-ready-regression.spec.ts` 刻意只做入口存在性断言，行为覆盖留在既有 phase 套件——符合「避免重复数百 case」的 exploration 建议，且不引入新产品层。
- 工作区 diff 面仅为 README + test harness + `.specdev` 文档，与 design R3「仅收口门禁」一致。

## 结论

本 Phase 严格落在 **harness / docs 收口**：无新产品架构、未重开 AC-33、未触碰 agent-loop，与 **design.md R3** 及 **phase-plan `phase-6-feature-regression`（AC-R1…R4）** 对齐。**PASS**。
