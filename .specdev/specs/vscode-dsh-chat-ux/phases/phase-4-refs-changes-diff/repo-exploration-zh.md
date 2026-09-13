# 代码库调研报告 — phase-4-refs-changes-diff

> 工作流：`vscode-dsh-chat-ux` · Phase：`phase-4-refs-changes-diff`  
> 调研时间：2026-09-11T01:47:00Z · 方式：手动（code2prompt 不可用）  
> 来源：phase-4 `spec.md` AC-40–45 自 plan-generator 会话恢复（磁盘根规格缺失 — 见 §7 R0）；design AD-CUX-8 / AD-CUX-11 / T8 来自 HG-2 + phase-3 `review-design.md`；phase-3 后 `tech-debt-registry`（DEBT-CUX-001 / GAP-CUX-002）；constitution §7 来自 phase-3 调研；实码 `apps/vscode-dsh/`；phase-3 `repo-exploration.md` + `implementation.md`  
> Phase Entry：**DEBT-CUX-001 → a) 本 Phase 优先解决**（用户已确认）

## 1. 任务上下文

Phase 4 交付**结构化引用卡**（输入 / 已发 / 回放走同一确定性解析路径 — AD-CUX-11）、变更列表与回合气泡/活动组的**可判定归属**（AC-42，承接 phase-3 `data-turn`），以及 **T8 diff**：默认**内联展开预览** + **显式跳转** VS Code 原生 diff（AC-43 / AD-CUX-8）。同时保持 Timeline 弱化（AC-44），并保证历史/回放中引用/变更/diff/活动呈现不误导为可 live 发送（AC-45）。Phase Entry 债务 **DEBT-CUX-001** 要求把 change-list / diff-summary / 内联 diff DOM 从 `chat-panel-provider.ts` 抽到 `change-diff-dom.ts`（及必要的 `message-dom` / `ref-cards`），让层 A 可 import 真实助手函数，消除双维护。Out：fork/P-接续（phase-5 / GAP-CUX-002）、搜索档 2、agent-loop、thinking UI。

## 2. 仓库概览

| 项 | 现状（相对 phase-3） |
|------|------------------------------|
| 包 | `@deepseek-ai/dsh-vscode-dsh` — `apps/vscode-dsh/` |
| 对话 UI | 薄 Webview HTML + 嵌入 `*BrowserSource()` 抽离模块 |
| 层 A | ✅ `tests/layer-a/` — foundation + streaming + **activity**；**尚无** refs/change-diff 抽离用例 |
| `chat-panel/render/` | ✅ `message-dom`、`activity-dom`、`follow-state`、`sync-chrome` — **无** `change-diff-dom.ts` / `ref-cards.ts` |
| 引用（Host） | ✅ `code-context/at-path.ts` + `open-reference.ts` |
| 引用（Webview） | ⚠️ 重复 `@` 正则 + `ref-card` DOM **仅**在 provider 内联；composer = 纯 `<textarea>` |
| 变更列表 Host | ✅ `settleChangeListProjection` → MessageStore `kind:change-list\|diff-summary` + `turn` |
| 变更列表 Webview | ⚠️ 完整 DOM + 内联 diff 仍在 provider（DEBT-CUX-001） |
| 原生 diff | ✅ Timeline 路径 `diff-entry.ts` → `vscode.diff`；❌ **无**按 change-list 行的「打开原生」动作 |
| 磁盘规格 | ⚠️ 根目录 `design.md` / `current-status.json` / `tech-debt-registry.md` / `phase-4/spec.md` **缺失**（`.specdev/specs/` 已 gitignore）；phase-3 产物仍在 |

本 Phase 目录焦点：

```
apps/vscode-dsh/src/chat-panel/
  render/                   # 新增 change-diff-dom.ts（+ 可选 ref-cards.ts）
  chat-panel-provider.ts    # 内联分支改为调用抽离
  protocol.ts               # 新增 open-native-diff（或等价）W→H
  chat-panel-host.ts        # 原生打开 → extension
apps/vscode-dsh/src/
  code-context/at-path.ts   # 只复用 — 禁止另写 @ 文法（AD-CUX-11）
  …
  diff-entry.ts / extension.ts / timeline-store.ts
apps/vscode-dsh/tests/layer-a/   # AC-40/41/42/43
```

## 3. 最相关区域

| 路径 | 原因 | 来源 |
|------|------|:----:|
| `chat-panel-provider.ts` `renderBubble` change-list / diff-summary / user-refs（~L724–915） | **DEBT-CUX-001** 双路径 — 列表 + 内联 diff + 引用卡产品 DOM | 👁 |
| `chat-panel-provider.ts` `change/diff-content`（~L1147–1165） | 内联填充：仅 `textContent` before/after；无原生跳转 | 👁 |
| `chat-panel/render/message-dom.ts` | 身份/`data-turn` 就绪；用户抽离用 `textContent` **无**引用卡；注释指向 phase-4 | 👁 |
| `chat-panel/render/activity-dom.ts` | `change-diff-dom` / `*BrowserSource()` 的姊妹模板 | 👁 |
| `code-context/at-path.ts` `extractAtPathTokens` | 权威 @ 文法（AD-CCD-11）— AD-CUX-11 要求引用卡复用、禁止再写正则 | 👁 |
| `code-context/open-reference.ts` | Host 打开引用卡 + SelectionMeta 行号 — 已接线 | 👁 |
| `conversation-controller.ts` `settleChangeListProjection` | 为 change-list / diff-summary 写入 `turn` + `sourceMessageId` | 👁 |
| `chat-panel-host.ts` change/* / `action/open-reference` | 内联 diff、打开文件、引用帧已存在 | 👁 |
| `extension.ts` `requestChangeDiff` / `openChangedPath` / `requestOpenReference` | 快照→内联载荷；主键单击打开**文件**而非 `vscode.diff` | 👁 |
| `diff-entry.ts` `openTimelineDiff` | 原生 `vscode.diff`（虚拟 `dsh-diff`）— 今日仅 Timeline | 👁 |
| `protocol.ts` | 有 `change/get-diff`、`change/open`、`action/open-workspace-diffs`；**无**按 change 的 `open-native-diff` | 👁 |
| `timeline-store.ts` 助手分支 | 标签截断 40 字 — AC-44 已满足；防回归 | 👁 |
| `tests/layer-a/activity-stream.spec.ts` AC-23/25 | activity+change-list `data-turn` 同组夹具 — 可扩展 AC-42 | 👁 |
| `tests/phase2-change-list-display.spec.ts` | 旧 HTML 字符串覆盖 — **非**层 A 抽离 import | 👁 |

## 4. 关键入口 / 调用路径

### 路径 A — 引用卡（AC-40 / AC-41 / AD-CUX-11）

```
Composer 现状：纯 textarea → composer/send
  → Host validateComposerAtPaths(extractAtPathTokens)   ✅
  → 已发消息 Webview：provider 本地正则 → ref-card      ⚠️ 非共享模块
  → action/open-reference → planReferenceOpen           ✅

缺 AC-40：输入框内结构化引用卡                              ❌
缺 AC-41/R5：composer/已发/回放同一 parse 模块              ❌
```

✅ **已确认**：已发消息引用卡仅在 provider；打开路径真实。  
✅ **已确认**：`at-path.ts` 是 Host 权威提取/门禁。  
✅ **已确认**：磁盘无 `ref-cards.ts`。

### 路径 B — 变更归属 + DEBT 抽离（AC-42 / DEBT-CUX-001）

```
settleChangeListProjection → kind:change-list { turn, … }
  → applyMessageIdentity → data-turn=N                  ✅
activity 同 turn → data-turn=N                          ✅（phase-3）
Webview change-list DOM 仍 100% provider 内联           ❌ DEBT

抽离目标：render/change-diff-dom.ts + BrowserSource
```

✅ **已确认**：归属钩子已可用；双路径仍在。

### 路径 C — T8 内联 + 原生（AC-43 / AD-CUX-8）

```
内联（已有）：expand → change/get-diff → SnapshotStore → pane textContent
主键单击：change/open → 打开文件（非原生 diff）
工作区/Timeline 原生（已有，非 AC-43 产品入口）：
  action/open-workspace-diffs → dsh.reviewWorkspaceDiffs → vscode.diff

缺：按 changeId「在编辑器打开 Diff」← SnapshotStore before/after
```

✅ **已确认**：内联默认路径存在。  
✅ **已确认**：无按变更行的原生 diff Webview 动作。

### 路径 D — Timeline 弱化 + 回放（AC-44 / AC-45）

```
Timeline 助手 label = truncate(text, 40)                ✅
mode=replay → reject-send reason=replay                 ✅
hydrate 含 change-list + activity                       ✅
```

## 5. 可能影响面

| 区域 | 变更类型 | 风险 | 说明 |
|------|----------|:----:|------|
| `render/change-diff-dom.ts` | **新增**抽离 | 🟡 | DEBT-CUX-001 主交付；AC-43 层 A NEED_EXTRACT |
| `render/ref-cards.ts` | **新增** | 🟡 | AD-CUX-11：只渲染；import `extractAtPathTokens` |
| `chat-panel-provider.ts` | 替换内联分支 | 🔴 | 大段 HTML；须调用抽离并保住 testid |
| `message-dom.ts` | 可选用户+引用钩子 | 🟡 | 层 A 用户气泡与引用卡对齐 |
| `protocol` + host + extension | 原生 diff 动作 | 🟡 | SnapshotStore → `vscode.diff` |
| `diff-entry.ts` | 扩展或姊妹助手 | 🟡 | 优先复用虚拟文档 scheme |
| `tests/layer-a/*` | 新用例 | 🟡 | AC-40/41/42/43 |
| 层 B 测试 | 原生打开 + AC-44/45 | 🟡 | Timeline 快照 + 回放拒绝 |
| controller / attributor | 尽量不动 | 🟢 | `turn` 已写好 |
| timeline / agent-loop | 不为产品改 | — | AC-44 仅回归 |
| GAP-CUX-002 | 留给 phase-5 | 🟢 | 勿实现 P-接续推送 |

## 6. 既有约束 / 约定

1. **宪法 §7.1**：层 A = 抽离模块 + jsdom Must；变更/引用断言须 import 抽离，禁止整页 `runScripts` 当主路径。  
2. **§7.2 / AD-CUX-1**：呈现态可本地；发送/`mode`/撤销权威留 Host。  
3. **§7.3**：中断不自动 revert；无 thinking；Timeline 弱化（AC-44）。  
4. **AD-CUX-11**：复用 `at-path` / `formatFileMention`；`ref-cards` **只渲染**。  
5. **AD-CUX-8 / T8**：内联默认走既有 `change/get-diff`；**必须另有**显式原生跳转。  
6. **R5**：composer / 已发 / 回放单一解析路径，禁止三套正则。  
7. **抽离模式**：对齐 `activity-dom.ts`（TS + BrowserSource；provider **调用**助手）。  
8. **XSS**：内联 diff 只用 `textContent` / 转义。  
9. **指针模型**：发送仍仅指针；打开由 Host resolve + 磁盘。  
10. **禁止改** `packages/core/agent-loop`。  
11. **Phase Entry**：本 Phase 关闭 DEBT-CUX-001；GAP-CUX-002 留给 phase-5。  
12. **phase-3 契约**：保留 activity ↔ change-list `data-turn` 同组。

## 7. 风险 / 未知

| ID | 发现 | 确信度 |
|----|------|:------:|
| R0 | 根规格文件磁盘缺失；AC 自会话恢复；实施前应由调度者恢复 | ✅ 已确认 |
| R1 | DEBT-CUX-001 仍成立：change-list/diff 仅 provider 内联 | ✅ 已确认 |
| R2 | Composer 无结构化引用卡（AC-40） | ✅ 已确认 |
| R3 | Provider `@` 正则与 `extractAtPathTokens` 双份 — 违反 R5/AD-CUX-11 意图 | ✅ 已确认 |
| R4 | `message-dom` 用户路径纯文本 — 层 A 无卡可断言 | ✅ 已确认 |
| R5 | 内联真实；按变更原生 `vscode.diff` **未**接线 | ✅ 已确认 |
| R6 | `open-workspace-diffs` ≠ AC-43 按变更原生入口 | ✅ 已确认 |
| R7 | `data-turn` 归属就绪；AC-42 主为验证 + 抽离覆盖 | ✅ 已确认 |
| R8 | Timeline truncate(40) 今日满足 AC-44 — 防回归 | ✅ 已确认 |
| R9 | 回放 reject-send 就绪；需 refs+changes+activity 组合夹具 | ⚠️ 假设 |
| R10 | 原生入口具体 UI 位置（行按钮 vs 展开面板内）规格未钉死 | ❓ 未知 |
| R11 | Composer 卡交互模型（可编辑 chip vs 只读叠加） | ⚠️ 假设 |

## 8. 未核验 / 不确定

| 符号 | 已有 | 未核验行为 |
|------|------|------------|
| 磁盘完整 `design.md` AD-CUX-8/11 原文 | HG-2 摘要 + review-design 引用 | 原生帧精确 API 名 |
| Composer chip 模型 | 仅 textarea | CSP / AD-CR-7 下是否允许 contenteditable |
| Snapshot → `vscode.diff` | Timeline 用 `dsh-diff` | ChangeRecord 快照是否共用同一 provider map |
| 抽离后旧 change-list 字符串测 | `phase2-change-list-display.spec.ts` | 或需改写为 import 抽离 |

## 9. 桩检测与 Registry 交叉校验

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:-------------:|--------------|:----:|
| DEBT-CUX-001 | `chat-panel-provider.ts:renderBubble` change-list / diff-summary | 🟡非阻塞 → phase-4 抽到 `change-diff-dom.ts` | 仍全内联；无 `change-diff-dom.ts`；`message-dom` 注释仍写 phase-4 | ✅ 匹配（**本 Phase 优先**） |
| GAP-CUX-002 | `probes.ts` parentReadonly / continueSealed | 🟡 → phase-5 | 座位 + mirror 在；Host 产品路径仍未在 P-接续推送 | ✅ 匹配（**留给 phase-5**） |
| GAP-CUX-001 | activity 探针 | 已解决（phase-3） | 产品路径已填实 | ✅ 匹配 |

### 额外扫描（引用 / 变更 / diff）

| 信号 | 位置 | 判定 |
|------|------|------|
| 缺失 `change-diff-dom.ts` | `render/` | 🟡 NEED_EXTRACT（已登记 DEBT-CUX-001） |
| 缺失 `ref-cards.ts` | apps/vscode-dsh | 🟡 功能抽离缺口（AD-CUX-11）— 非空壳桩 |
| 硬编码空 change-list | — | 🔴 无 |
| `@STUB` | chat-panel / change / code-context | 🔴 无 |
| 内联 `available:false` | provider + requestChangeDiff | ✅ 诚实失败 |
| 仅用打开文件冒充原生 diff | `change/open` | 🟡 AC-43 原生半边产品缺口 |
| Timeline 长文 body | timeline-store | ✅ 仍截断 |

### Stub Detection Summary

- ✅ 与 registry 匹配的活跃债/缺口：**2**（DEBT-CUX-001、GAP-CUX-002）+ GAP-CUX-001 已解决  
- ⚠️ Registry 不一致：**0**  
- 🔴 未注册且阻塞主路径的空壳桩：**0**  
- 📌 Phase-4 **必须解决 DEBT-CUX-001**（用户 a）；**不得**关闭 GAP-CUX-002  

**升级**：🟢 FYI — 实施前恢复磁盘根规格（调研已用会话恢复 AC，不阻断本报告）。

## 10. 建议优先阅读

1. ⭐ MUST — phase-4 `spec.md` AC-40–45（若缺失则从 plan-generator 恢复）  
2. ⭐ MUST — `chat-panel-provider.ts`（change-list / diff-summary / user-refs + `change/diff-content`）  
3. ⭐ MUST — `code-context/at-path.ts`（`extractAtPathTokens`）  
4. ⭐ MUST — `render/activity-dom.ts`（抽离模板）  
5. ⭐ MUST — `render/message-dom.ts`  
6. ⭐ MUST — `diff-entry.ts` + `extension.ts` requestChangeDiff / openChangedPath  
7. 🔷 SHOULD — `settleChangeListProjection`  
8. 🔷 SHOULD — host change/* + open-reference  
9. 🔷 SHOULD — `timeline-store.ts` 截断（AC-44）  
10. 🔷 SHOULD — phase-3 `implementation.md` + `activity-stream.spec.ts`  
11. 🔹 OPTIONAL — wiki「消息附属变更列表」「代码引用」  
12. 🔹 OPTIONAL — `phase2-change-list-display.spec.ts` / `phase1-code-context.spec.ts`

---

## 关键缺口表（调度交接）

| 缺口 | AC / 债 | 状态 | 抽离 / 接线目标 |
|------|---------|------|-----------------|
| change-list/diff 双路径 | DEBT-CUX-001 | 开放 | `render/change-diff-dom.ts` + provider 调用 |
| Composer 结构化引用卡 | AC-40 | 缺失 | `ref-cards` + composer 呈现 |
| 共享 @ 解析用于 DOM | AC-41 / AD-CUX-11 / R5 | 双正则 | import `extractAtPathTokens`；删 provider 本地 re |
| 显式原生 diff 入口 | AC-43（T8 半边） | 缺失 | protocol + Host + SnapshotStore → `vscode.diff` |
| 内联默认 | AC-43（T8 半边） | 已有 | 迁入抽离；保持默认展开 |
| 归属 `data-turn` | AC-42 | 基本完成 | 层 A 用抽离覆盖 |
| Timeline 长文 | AC-44 | 今日 OK | 仅回归 |
| 回放不可发 | AC-45 | Host 就绪 | refs+changes+activity 组合夹具 |
| GAP-CUX-002 | phase-5 | 搁置 | 勿实现 |

### 相对 phase-3 调研的增量

| 主题 | 状态 |
|------|------|
| 活动流 / GAP-CUX-001 | **已更新** — phase-3 交付 |
| `data-turn` 同组 | **契约不变** — AC-42 复用 |
| DEBT-CUX-001 | **未变** — 仍开放；现为 Phase Entry **a** |
| T8 原生跳转 | **新确认** — change-list 侧缺失 |
| Composer 引用卡 | **新确认** — AC-40 仍缺 |
| 根规格磁盘 | **新风险 R0** — gitignore 后缺失 |
