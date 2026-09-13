# Tech Debt Registry

> 这是本工作流中所有已知技术债的 **唯一定义来源**。
> 所有 Phase 的 agent 共写共读。写入新债，读取已有债，解决后更新状态。

---

## Phase Entry Gate 记录

| Phase | 日期 | 用户决策 | 说明 |
|-------|------|----------|------|
| phase-2-stream-capabilities-full-history | 2026-09-13 | **a) 本 Phase 优先解决** | GAP-ECP-001…007 + DEBT-ECP-001 全部留在目标Phase=本 Phase，实施时优先消化 |

---

## 活跃债务

<!-- 本 Phase 结束时无活跃条目；新债在此追加 -->

| ID | 源Phase | 模块 | 文件:函数:行号 | 当前行为 | 预期行为 | 类型 | 标签 | 依赖它的模块 | 目标Phase | 阻塞 | 来源 | 注册日期 |
|----|:------:|------|---------------|---------|---------|------|------|-------------|:--------:|:---:|------|---------|
| — | — | — | — | — | — | — | — | — | — | — | — | — |

## 已解决

| ID | 源Phase | 描述 | 解决Phase | 解决日期 | 验证方式 |
|----|:------:|------|:--------:|---------|---------|
| GAP-ECP-001 | phase-1-shell-tabs-basic-history | Composer 四态 + 禁用原因位 + AC-23a 失败文案；Continue CTA | phase-2-stream-capabilities-full-history | 2026-09-13 | RTL editor-chat-phase2（四态 / disabled-reason / reject-send 文案） |
| GAP-ECP-002 | phase-1-shell-tabs-basic-history | `btn-stop` + 停止中 DOM（R7：非第五态） | phase-2-stream-capabilities-full-history | 2026-09-13 | RTL：btn-stop[disabled] + status「正在停止…」 |
| GAP-ECP-003 | phase-1-shell-tabs-basic-history | 面板内档1+2 搜索（search-panel + action/search-sessions） | phase-2-stream-capabilities-full-history | 2026-09-13 | RTL：search-panel / search-hit；非 ui/search-open QuickPick |
| GAP-ECP-004 | phase-1-shell-tabs-basic-history | 历史 Continue / 删除 modal / 父子「分支自 …」 | phase-2-stream-capabilities-full-history | 2026-09-13 | RTL history + Host parentTitle 投影 |
| GAP-ECP-005 | phase-1-shell-tabs-basic-history | Markdown settle + sanitize + 弱描边；btn-copy / code copy | phase-2-stream-capabilities-full-history | 2026-09-13 | RTL msg-md + containsUnsafeHtml 路径 |
| GAP-ECP-006 | phase-1-shell-tabs-basic-history | tokens：focus/hover、≥8px、prefers-reduced-motion | phase-2-stream-capabilities-full-history | 2026-09-13 | tokens.css + RTL 间接覆盖 |
| DEBT-ECP-001 | phase-1-shell-tabs-basic-history | `buildThinChatHtml` 退出生产路径；仅 fixture/legacy 保留 | phase-2-stream-capabilities-full-history | 2026-09-13 | Panel=SPA；JSDoc fixture-only；feature PASS=RTL |
| GAP-ECP-007 | phase-1-shell-tabs-basic-history | 层 V checklist + 诚实环境记录（无 DISPLAY 不伪 PASS） | phase-2-stream-capabilities-full-history | 2026-09-13 | `layer-v-checklist.md`；DISPLAY unset → 不宣称 V PASS |
| GAP-ECP-008 | phase-2-stream-capabilities-full-history | Q-6 Tab 右键「删除会话」与溢出并存（曾仅溢出满足 AC-13c「或」） | phase-2-stream-capabilities-full-history | 2026-09-13 | RTL：`tab-context-menu` → `DeleteConfirmModal` → `ui/delete-request`；Host `panel/tabs.sessionId` |

---

## 维护规则

### 谁写入
- **implementer**：创建 `@STUB(phase-N)` 后立即注册到「活跃债务」。编码完成后检查是否有未注册的桩。
- **reviewer**：发现 implementer 未标注的桩/缺陷 → 新增条目到「活跃债务」
- **verifier**：独立验证发现疑似桩或已知缺陷 → 新增条目到「活跃债务」
- **Cursor Agent**（Phase Closure）：从 scope-gap-report.md 中同步推迟项到注册表

### 谁读取
- **code-explorer**（Phase 准备阶段）：读注册表，交叉验证代码中的桩 → 输出到 `repo-exploration.md` §9
- **plan-generator**：设计时检查 registry，确认依赖接口是否已有 stubs
- **implementer**：编码前读 registry，不把桩当真实现
- **reviewer**：审查时对照 registry，已知桩不误报为「发现」
- **verifier**：验证时对照 registry，已知桩跳过行为验证

### 谁更新状态
- **implementer**：实现之前注册的桩 → 从「活跃债务」移到「已解决」
- **reviewer**：确认桩已填实 → 可标记为已解决
- **verifier**：验证通过 → 确认可关闭
- **Cursor Agent**（Phase Closure）：标记不再适用的过时项 → ⚠️ 标记

### 字段规范

| 字段 | 说明 | 必须在 |
|------|------|:--:|
| **ID** | `STUB-N`(桩) / `GAP-N`(功能缺失) / `DEBT-N`(其他) | ✅ |
| **源Phase** | 产生该债的 Phase | ✅ |
| **模块** | 所属模块名 | ✅ |
| **文件:函数:行号** | 精确代码定位 | ✅ |
| **当前行为** | 代码实际做什么，不是意图 | ✅ |
| **预期行为** | 完整实现应该怎么做 | ✅ |
| **类型** | `空实现` / `假返回值` / `流程骨架` / `条件桩` / `类型占位` / `功能缺失` / `已知缺陷` / `性能问题` | ✅ |
| **标签** | `module:<name>`, `type:<stub\|gap\|debt>`, `concern:<topic>`, `bind:<binding>` | ✅ |
| **依赖它的模块** | 哪些模块依赖这个接口 | 🟡 尽量填 |
| **目标Phase** | 计划在哪个 Phase 解决 | ✅ |
| **阻塞** | 🔴阻塞 / 🟡非阻塞 | ✅ |
| **来源** | 谁发现的（implementation.md / review.md / verification.md / scope-gap-report.md） | ✅ |
| **注册日期** | ISO 日期 | ✅ |

### 标签规范
- 每个条目必须有 `module:` 和 `type:` 标签
- `concern:` 和 `bind:` 可选，尽可能填写以提高查询精度
- 标签使用英文小写，多词用连字符连接
- 例：`module:auth-service, type:stub, concern:password-reset, bind:email`

### 查询指引（各 agent 如何精确查询）

| Agent | 查询方式 | 示例 |
|-------|---------|------|
| **plan-generator** | 查目标Phase=N AND 阻塞=🔴 → 按标签分组 | "下一 Phase 继承了哪些阻塞债务" |
| **implementer** | 查文件:函数精确匹配 → 已知桩不当真实现 | "我依赖的这个接口是桩吗" |
| **reviewer** | 查文件含当前目录前缀 → 已知桩不重复发现 | "我审查的代码里哪些函数是已知桩" |
| **verifier** | 查阻塞=🔴 且不在已解决表中 → 跳过验证 | "哪些已知问题不需要现在验证" |
| **code-explorer** | 逐行按文件:函数:行号验证代码是否匹配 | "registry 里的桩还在代码里吗" |

### 去重与清理
- 写入前搜索标签和文件:函数避免重复
- Phase Closure 时检查文件路径/函数名是否变化 → 标记 ⚠️ 或更新
- Phase 间传递的债务不重复注册

### Phase Entry Gate 联动
- 进入新 Phase 前，Cursor Agent 读取本文件
- 筛选「目标Phase = 当前Phase」且「阻塞 = 🔴」的条目
- 向用户呈现继承的债务清单，用户确认后正式开始 Phase
- 用户可选：(a) 本 Phase 优先解决 (b) 推迟 (c) 取消
- 根据决策更新 registry 中的目标Phase
