# Visual Consistency Review — Phase 3

> Phase ID: `phase-3-layer-v-smoke-loop`
> Workflow: `vscode-dsh-usable-loop`
> Reviewer: `reviewer-visual`（四视角并行之一）
> 轮次：第 3 轮复审
> 审查时间：2026-09-17

## 视角

**Visual Consistency** — 界面是否符合冻结的视觉基准。

## 适用性

- DAG `ui` 字段：**`false`**
- 本 Phase 不涉及界面 → 判决 **`N/A`**，理由见下。

## 判决：N/A

`N/A` = **本视角不适用**。它**不参与合并加权**：既不否决其它视角的判决，也不冲抵其它视角的 must-fix。
**`N/A` 不等于 `PASS`** —— 它不表示「界面已验证通过」，只表示「本 Phase 的交付物不含视觉设计内容，本视角没有可审查对象」。

---

## 1. 适用性门禁判定（启动第 0 步）

### 1.1 DAG `ui` 字段（唯一真相源）

读取 `.specdev/specs/vscode-dsh-usable-loop/phase-plan.md` 的 DAG JSON，`phases[].id == "phase-3-layer-v-smoke-loop"` 条目：

```88:92:.specdev/specs/vscode-dsh-usable-loop/phase-plan.md
      "id": "phase-3-layer-v-smoke-loop",
      "ui": false,
      "name": "真机脚本化冒烟闭环",
      "dependencies": ["phase-2-host-fail-loud-diagnostics"],
      "acceptance_criteria": ["AC-11", "AC-12", "AC-23", "AC-24", "AC-25", "AC-26", "AC-27", "AC-28", "AC-29", "AC-30", "AC-31", "AC-32", "AC-33"],
```

- **`ui: false`** 已核实（`phase-plan.md:89`）。**字段存在且为 false**（非「缺失时保守按 true」的情形）。
- 参考：本工作流 4 个 Phase 全部为 `ui: false`（`phase-plan.md:57` / `:74` / `:89` / `:104`）—— 视觉美化在本工作流中**整体不在范围内**，不是本 Phase 的个别取舍。

### 1.2 Phase spec 层面的二次确认

`spec.md` 把 `ui: false` 列为**不变式 / 锁定项**，与 AC 语义同级，不可在实施阶段变更：

```322:322:.specdev/specs/vscode-dsh-usable-loop/phases/phase-3-layer-v-smoke-loop/spec.md
AC-26 的 (a)–(d) 子项（张数 / 稳定命名 / 合法 PNG / 仓库根 ignore）；AC-28 的 `apt`/`sudo` 禁令与 `SKIPPED_NO_DISPLAY` 语义；退出码 / 结论分类契约；13 条 AC 的归属；`ui: false`。
```

### 1.3 视觉基准类文件存在性（缺一不可，实测）

| 期望文件 | 存在性 | 说明 |
|---|:--:|---|
| `<spec_dir>/ui-spec.md` | ❌ 不存在 | 本工作流无界面契约 |
| `<spec_dir>/visual-baseline.md` | ❌ 不存在 | 无冻结 token 表 |
| `design-system/vscode-dsh-usable-loop/MASTER.md` | ❌ 不存在 | 未生成设计系统 |

与 `ui: false` 一致：**不存在「基准缺失」问题**（§Stop & Escalate A 只针对 `ui: true` 而基准缺失），因此**不升级**。

### 1.4 工作流定位佐证

`current-status.json` 的 `description` 明确记载：

> 「建立层 V（VS Code 真机 Extension Development Host）脚本化冒烟闭环（Xvfb + code CLI，产出截图）。**UI 视觉美化明确不在本工作流范围，留待下一个工作流。**」

---

## 2. 明确不纳入本视角的事项（防止范围串味）

以下内容**属于其它视角 / 证据有效性判据**，本视角**不审查、不计入判决**：

| 事项 | 归属 | 本视角处置 |
|---|---|---|
| `MIN_DISTINCT_MD5 = 3`（截图去重阈值） | **证据有效性**判据（AC-26(e) / AC-28 R2）—— 验证「截图是否真的反映了不同界面状态」 | 不审查。它不涉及「界面是否偏离冻结 token / 布局骨架」，无基准可比对 |
| 「截图不得为五张相同桌面壁纸」 | 同上（防伪证据判据） | 不审查。本 Phase 无 `visual-baseline.md`，本视角没有可判定的 ground truth |
| 截图文件张数 / 命名 / PNG 合法性 / ignore 规则 | `reviewer-correctness` / `verifier` | 不审查 |
| 层 V 五步链路的连通性 | `reviewer-connectivity` | 不审查 |

> 这些事项均为**交付物证据的真实性与充分性**问题，**不是**「界面是否符合视觉基准」问题。把它们塞进视觉判决会让 `N/A` 失去意义，也会污染三分支合并结果。

---

## 3. 启动自清理记录

- 启动时检测到直接路径存在旧 `review-visual.md`（第 2 轮，14:29）→ 已归档到
  `.archive/review-visual-20260917T090345Z.md`（仅 `mv`，未删除）。
- 未运行任何 git 命令；未修改 `current-status.json`；未触碰其它 reviewer 的产物。

---

## 关键发现

### 🔴 Must-Fix
- 无（本视角无适用对象）

### 🟡 Should-Fix
- 无

### 🟢 Observations
- 本 Phase 交付物为**脚本化冒烟工具链**（shell 脚本 / 退出码契约 / 截图取证），不含任何 UI 设计产物。视觉维度**无审查对象**，判决 `N/A` 是唯一正确结论。
