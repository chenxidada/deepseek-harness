# 代码库探索报告 — phase-6-feature-regression

## 1. 任务上下文

`vscode-dsh-chat-ready` 的 Phase 6 是 phase-1…5 Must 全部交付（phase-5 HG-3 已通过）后的 **Feature 收口回归门禁**。目标：(1) **AC-R1** — 在 `apps/vscode-dsh/tests`（或文档化的聚合入口）提供一条可编程 L2/L3 回归命令，覆盖 phase-1…5 主证据路径（AC-1a 反向、视图可见自动就绪、Chat UI 底盘 L3、新建 chrome L2、phase-5 六条抛光 AC-28…32+AC-34）；(2) **AC-R2** — phase-1…4 既有 smoke / phase* 套件在 phase-5 之后仍全绿；(3) **AC-R3** — `tech-debt-registry.md` 活跃表为空，或仅含已文档化 Out-of-Scope（AC-33）；(4) **AC-R4** — 为本 slug 编写/更新 `feature-delivery-summary.md`。**禁止新产品架构**；仅允许修复回归中发现的缺陷。可选 L4 截图清单。`code2prompt` CLI 不可用 — 通过 Glob/Grep/Read 建图（👁）。本报告为 **Phase 6 新建**（本 Phase 无既有 exploration）。

## 2. 仓库概览

| 项 | 现状 |
|----|------|
| 包 | `apps/vscode-dsh` — `@deepseek-ai/dsh-vscode-dsh` |
| 语言 | TypeScript ESM；Node Vitest 下 duck-typed `vscode` 做 L1/L2/L3 |
| 单测入口 | 根 `vitest.config.ts` 包含 `apps/*/tests/**/*.spec.ts`；仓库根执行 `./node_modules/.bin/vitest run <paths>` |
| Extension package.json | **无** `scripts` 块 — 可不改 packaging，用 shell 聚合 + 文档声明入口即可 |
| Phase 套件 | `phase1-auto-start`、`auto-start-orchestrator`、`phase2-auto-ready`、`phase3-chat-ui-chassis`、`phase3-restart-continue`、`phase4-new-conversation-chrome`、`phase5-should-polish` |
| 前序 Feature 套件 | multitab / close / panel protocol / spikes（AC-27 抽测面） |
| Verifier 模式 | 各 Phase `phases/*/test-scripts/run-verifier-phaseN.sh` + 可选 `verifier-independent-phaseN.mts` |
| 分支 | `impl-phase-6-feature-regression`（已创建；勿改） |
| 交付摘要 | **本 slug 缺失**；模板见 `vscode-dsh-conversation-ui/feature-delivery-summary.md` |
| 统一回归入口 | **尚无** `chat-ready-regression.spec.ts` / package script / phase-6 runner |
| 债务 | 活跃表 **空**；已关闭 STUB-001、DEBT-001…003 |

## 3. 最相关区域

| 路径 | 对本 Phase 的意义 | 来源 |
|------|-------------------|------|
| `apps/vscode-dsh/tests/phase1-auto-start.spec.ts` | AC-1a 反向 + AC-1b/c/e、AC-2、AC-13；矩阵「自动建连」 | 👁 |
| `apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts` | L1 FSM：合并、retry-once、启动中 Stop | 👁 |
| `apps/vscode-dsh/tests/phase2-auto-ready.spec.ts` | AC-3/4/4a/4b/6/7 视图可见主路径 | 👁 |
| `apps/vscode-dsh/tests/phase3-chat-ui-chassis.spec.ts` | AC-8…12、16/16a、17、19、20/27 smoke、底盘 L3 | 👁 |
| `apps/vscode-dsh/tests/phase4-new-conversation-chrome.spec.ts` | AC-15/22/23/24/6 chrome L2；DEBT-003 Continue ensureHost | 👁 |
| `apps/vscode-dsh/tests/phase5-should-polish.spec.ts` | AC-28…32、AC-34（六条抛光 Must） | 👁 |
| `apps/vscode-dsh/tests/phase3-restart-continue.spec.ts` | AC-27 抽测：restore / Continue / Diff | 👁 |
| `apps/vscode-dsh/tests/phase2-multitab-history-replay.spec.ts` | AC-27 抽测：multitab / 未读 / 历史 | 👁 |
| `apps/vscode-dsh/tests/panel-close-delete.e2e.spec.ts` | AC-27 抽测：可恢复关闭 / 删除 | 👁 |
| `apps/vscode-dsh/tests/panel-l2-l3-protocol.spec.ts` | phase-4 verifier AC-27 包中使用 | 👁 |
| `apps/vscode-dsh/tests/fixtures/screenshots/README.md` | 既有 L4 辅助路径（B1–B3）；可扩展 phase-6 可选 L4 | 👁 |
| `phases/*/test-scripts/run-verifier-phase{1..5}.sh` | 可复用的聚合 runner 模式 | 👁 |
| `.specdev/.../tech-debt-registry.md` | AC-R3 静态证据（活跃空） | 👁 |
| `.specdev/.../should-ac-retrospective.md` | AC-33 Out-of-Scope 理由（写入交付摘要） | 👁 |
| `vscode-dsh-conversation-ui/feature-delivery-summary.md` | AC-R4 模板 | 👁 |
| **建议新增** `apps/vscode-dsh/tests/chat-ready-regression.spec.ts` | 薄聚合 / 矩阵说明；或仅用 shell 文档入口 | 👁 缺口 |
| **建议新增** `phases/phase-6…/test-scripts/run-chat-ready-regression.sh` | AC-R1/R2 一键命令 | 👁 缺口 |
| **AC-R4 必需** `.specdev/specs/vscode-dsh-chat-ready/feature-delivery-summary.md` | Must 清单、OOS、回归命令与结果 | 👁 缺口 |

### 相对 AC-R1…R4 的缺口图

| AC | 既有证据 | Phase 6 缺口 |
|----|----------|--------------|
| **AC-R1** | 各 Phase 套件已覆盖规格要求路径（见 §4） | **缺少统一、可文档化的一条命令**；phase-6 尚未落盘矩阵勾选表 |
| **AC-R2** | phase1–4 文件存在；phase-5 verifier 已复跑 phase3/4（53 测） | 须 **显式复跑** phase1+2+3+4 并记录全绿 |
| **AC-R3** | 活跃债 = `（无）`；AC-33 在复盘与 phase-5 验证中标 OOS | 确认仍空；在交付摘要中文档化 AC-33（禁止静默 Should） |
| **AC-R4** | 仅有 conversation-ui 交付摘要可作模板 | **新建** 本 slug 的 `feature-delivery-summary.md` |

## 4. 关键入口 / 调用路径

### 路径 A — 建议的一键回归（AC-R1 / AC-R2）⚠️ HYPOTHESIS（待实现）

```
run-chat-ready-regression.sh  （新建于 phase-6/test-scripts/）
  │
  ├─ vitest run \
  │    auto-start-orchestrator.spec.ts
  │    phase1-auto-start.spec.ts
  │    phase2-auto-ready.spec.ts
  │    phase3-chat-ui-chassis.spec.ts
  │    phase4-new-conversation-chrome.spec.ts
  │    phase5-should-polish.spec.ts
  │    [可选 AC-27 抽测:]
  │    phase3-restart-continue.spec.ts
  │    phase2-multitab-history-replay.spec.ts
  │    panel-close-delete.e2e.spec.ts
  │
  ├─ 静态：tech-debt 活跃空 + AC-33 OOS 注记
  └─ 可选：tsc -p apps/vscode-dsh --noEmit
       → 退出码 0 = AC-R1/R2 可编程全绿
```

等价一句话命令（写入 README / 交付摘要）：

```bash
./node_modules/.bin/vitest run \
  apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts \
  apps/vscode-dsh/tests/phase1-auto-start.spec.ts \
  apps/vscode-dsh/tests/phase2-auto-ready.spec.ts \
  apps/vscode-dsh/tests/phase3-chat-ui-chassis.spec.ts \
  apps/vscode-dsh/tests/phase4-new-conversation-chrome.spec.ts \
  apps/vscode-dsh/tests/phase5-should-polish.spec.ts
```

规格中的 `-t` 过滤方案更弱（依赖命名）；**优先显式文件列表**。

### 路径 B — 既有 Must 证据（已落地）✅ CONFIRMED

```
AC-1a 反向     → phase1-auto-start.spec.ts "AC-1a reverse…"
视图可见主路径 → phase2-auto-ready.spec.ts "AC-7 + AC-1a…" / AC-3/4/6
底盘 L3        → phase3-chat-ui-chassis.spec.ts（主题、Enter、MD、复制、IA）
chrome L2      → phase4-new-conversation-chrome.spec.ts（AC-15/22/23/24/6）
抛光 ×6        → phase5-should-polish.spec.ts（AC-28…32、AC-34）
```

### 路径 C — AC-27 前序行为抽测 ✅ CONFIRMED

```
phase2-multitab-history-replay.spec.ts  → multitab / 历史 / 未读基线
phase3-restart-continue.spec.ts         → restore / Continue / Diff
panel-close-delete.e2e.spec.ts          → 关 Tab ≠ dispose；删除才 dispose
```

## 5. 可能影响面

| 面 | 变更类型 | 风险 | 说明 |
|----|----------|:----:|------|
| `apps/vscode-dsh/tests/chat-ready-regression.spec.ts`（可选） | **新增** | 🟢 低 | 薄元套件：注释矩阵 + 少量跨 Phase smoke；避免整份复制各 phase 用例 |
| `phases/phase-6…/test-scripts/run-chat-ready-regression.sh` | **新增** | 🟢 低 | AC-R1 主聚合；对齐 phase-5 runner 风格 |
| `.specdev/.../feature-delivery-summary.md` | **新增** | 🟢 低 | AC-R4 必需 |
| `phases/phase-6…/verification.md` | **新增**（verifier） | 🟢 低 | 矩阵勾选 + 命令退出码 |
| `tests/fixtures/screenshots/README.md` | 可选扩展 | 🟢 低 | L4：浅/深色 + 未读 glyph + 新建 chrome（仅辅助） |
| `apps/vscode-dsh/README.md` | 可选注记 | 🟢 低 | 文档化回归一句话命令 |
| 产品 `apps/vscode-dsh/src/**` | **仅回归失败时** | 🟡 中 | 禁止新架构；最小修复 + 补测 |
| `packages/core/agent-loop` | **禁止** | 🔴 | 约束 |

**风险摘要：** Phase 6 以 **回归 harness + 文档** 为主；仅在红灯时触碰产品代码。

## 6. 既有约束 / 约定

- AC-R1 必须是 **可编程** L2/L3 证据；禁止以「人工点一遍」作为唯一证据。
- Vitest 发现规则：`apps/*/tests/**/*.spec.ts` — 新 `*.spec.ts` 会自动进入全量套件。
- Verifier 脚本放在 `.specdev/.../phases/<id>/test-scripts/`；产品回归套件放在 `apps/vscode-dsh/tests/`。
- Fake vscode / FakeWebviewPort 模式沿用 phase1–5。
- UI 文案走 locale；Phase 6 除非修回归，不新增产品文案。
- 宪法 §5.1：禁止 Should/Could 跳过；AC-33 为 Out of Scope（文档化，不实现）。
- 禁止重开 AC-33 动画；禁止扩大 Cursor / Remote / 多窗口范围。
- `package.json` 无 scripts — shell + 文档入口即可满足 AC-R1。

## 7. 风险 / 未知项

| 项 | 确认度 | 说明 |
|----|:------:|------|
| phase1–5 vitest 文件存在且 `it` 标题含 AC | ✅ CONFIRMED | Grep describe/it |
| 活跃技术债表为空 | ✅ CONFIRMED | 已读 registry |
| 本 slug 无 feature-delivery-summary | ✅ CONFIRMED | Glob 仅 conversation-ui |
| 尚无统一 chat-ready 回归入口 | ✅ CONFIRMED | 无匹配文件/脚本 |
| 当前分支六文件 vitest 列表仍全绿 | ⚠️ HYPOTHESIS | phase-5 仅记 4 文件 / 53 测；phase1+2 未在该次跑 — **Phase 6 必须复验** |
| 全量 `vitest run apps/vscode-dsh/tests` 耗时/抖动 | ❓ UNKNOWN | AC-R1 主证据优先显式 Must 文件列表；全树可选 |
| 是否必须加 package.json scripts | ⚠️ HYPOTHESIS | 规格允许「文档化聚合入口」；shell 即可 |
| L4 PNG 目前缺失（仅 README） | ✅ CONFIRMED | 可选清单即可 |

## 8. 未核验 / 不确定

| 符号 | 状态 | 下游指引 |
|------|------|----------|
| 聚合 phase1–5 后的精确用例数 | 本回合未跑 | implementer/verifier 须执行并粘贴退出码与计数 |
| phase4 套件在 phase-5 翻转 keybindings 后是否仍绿 | 大概率 OK | AC-R2 下复跑 phase4 文件 |
| phase1–5 独立 V-IND 脚本 | 存在但非 AC-R1 唯一证据 | 可选次要；Feature 回归优先产品 vitest 列表 |
| `conversation-tab-bar` 的 `return []` | 空态守卫逻辑，非桩 | 勿标 STUB |

## 9. 桩检测与 Registry 交叉校验

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| （活跃无） | — | 空 | 活跃表仅「（无）」 | ✅ 匹配 |
| STUB-001 | AutoReady latch → coordinator | 已解决 | registry 已关闭（phase-2） | ✅ 匹配 |
| DEBT-001…003 | Start restore / 活动栏 / Continue ensureHost | 已解决 | 已关闭 | ✅ 匹配 |
| AC-33 | 底盘动画 | Out of Scope（非债行） | 有意未实现 | ✅ 文档化 OOS（非静默 Should） |
| — | `apps/vscode-dsh/src` 中 `@STUB` | 未注册 | Grep：**无** `@STUB` | ✅ 无未注册桩 |
| — | `conversationTreeItems` `return []` | — | AC-19 空态守卫 | ✅ 非桩 |

### 桩检测摘要

- ✅ 已确认活跃桩：**0**（registry 空）
- ⚠️ Registry 不一致：**0**
- 🔴 未注册桩：**0**
- 📝 AC-R4 须文档化 Out-of-Scope：**AC-33**（底盘抛光动画）

## 10. 建议优先阅读

1. ⭐ 必读 — `phases/phase-6-feature-regression/spec.md`（AC-R1…R4 + 矩阵骨架）
2. ⭐ 必读 — `apps/vscode-dsh/tests/phase{1,2,3,4,5}*.spec.ts` + `auto-start-orchestrator.spec.ts`（聚合输入）
3. ⭐ 必读 — `tech-debt-registry.md` + `should-ac-retrospective.md`（AC-R3/R4 OOS 文案）
4. ⭐ 必读 — `vscode-dsh-conversation-ui/feature-delivery-summary.md`（AC-R4 模板）
5. 🔷 应读 — `phases/phase-5-should-polish/test-scripts/run-verifier-phase5.sh`（runner 风格）
6. 🔷 应读 — `phases/phase-{1..4}/verification.md` 矩阵（迁入 phase-6 矩阵）
7. 🔷 应读 — `design.md` VP-CR-R1…R4 行（约 570+）
8. 🔹 可选 — `tests/fixtures/screenshots/README.md`（L4 清单扩展）
9. 🔹 可选 — `phase3-restart-continue` / `phase2-multitab` / `panel-close-delete`（AC-27 抽测）

### 给 implementer 的具体建议

| 产出 | 建议命名 / 动作 |
|------|-----------------|
| 一键 runner | `phases/phase-6-feature-regression/test-scripts/run-chat-ready-regression.sh` — 显式 vitest 文件列表（+ 可选 AC-27 三件套）+ 债务静态检查 |
| 可选 vitest 元文件 | `apps/vscode-dsh/tests/chat-ready-regression.spec.ts` — 注释矩阵 + 1–2 个跨 Phase smoke；若 shell 已文档化为入口可省略 |
| 矩阵表 | 写入 `verification.md`（和/或交付摘要）；跑通后勾绿 |
| 交付摘要 | 新建 `.specdev/specs/vscode-dsh-chat-ready/feature-delivery-summary.md`：已交付 Must、AC-33 OOS、回归命令与结果 |
| **禁止** | 新 UI 功能；AC-33 动画；改 agent-loop；自编 Phase ID |
