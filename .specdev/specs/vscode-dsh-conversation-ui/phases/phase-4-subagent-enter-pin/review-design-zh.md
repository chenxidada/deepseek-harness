# 设计一致性审查 — phase-4-subagent-enter-pin（债务清扫复审）

## 视角
**设计一致性** — 代码是否遵循架构设计（聚焦 DEBT-007…013）

## 判决
**PASS**

## 架构决策对照

| design.md 决策 | 实现是否遵循 | 证据 | 判定 |
|:---|:---|------|:--:|
| **AD-CU-8**：顶栏 Continue 四态；仅有效 replay 启用；与列表暗示解耦 | 是 | `continueChromeForTab` 用 `effectiveContinueMode`（context 子结束→replay）+ `continueChromeFor`；`pushFullState`/`panelSnapshot` 始终委托同一 chrome（DEBT-007），不再 `mode==='live'` 才解析 | ✅ |
| **AD-CU-8**：优先同 sessionId 续写；同打开期 `replay→live` | 是 | `effectiveContinueSessionId` = `contextSessionId ?? sessionId`；Continue resume 子 id；有 context 时提升/激活子 live Tab 并清 context（DEBT-008） | ✅ |
| **AD-CU-11**：钉态持久化在 `OpenTabRecord.pinnedSubagent` | 是 | `persistOpenTabs` 写出；`restoreOpenTabSetBody` / `restoreMoreTabs` 成功后 `setPinnedSubagent`（DEBT-010） | ✅ |
| **AD-CU-11 / AC-75**：父已删 → 面包屑禁用返回 | 是 | `buildBreadcrumb`：`parentDeleted` 或父 Tab 未打开 → `parentDeleted` 标志 + 禁用文案；与 `navBack` `disabled` 对齐（DEBT-011） | ✅ |
| **AD-CU-11 / AC-74**：子已删 → 父卡片不可进入文案 | 是 | 删子前取 parent；`markSubagentCardDeleted` 立即 patch/append「子会话已删除」（DEBT-009） | ✅ |
| **AD-CU-2 / 回放读缝**：权威日志冷读 | 是 | L2 无 events 注入走 `host.readSessionLog`；live upsert → `clearLocal` → activate 冷读（DEBT-012） | ✅ |
| **AD-CU-4 / AD-CU-10**：openTabSet 立即持久化；恢复不丢索引 | 是 | `restoreMoreTabs` 全程 `openTabPersistSuspended`，批末一次 `persistOpenTabs`（DEBT-013） | ✅ |
| **AD-CU-11**：默认 context 进入 / 钉 Tab / 父子已删 | 是（基线未回退） | 既有 `openSubagentContext` / `pinSubagent` / 删除路径仍在；债务清扫未改 agent-loop | ✅ |
| **AD-CU-12**：不改 agent-loop | 是 | 变更限于 `apps/vscode-dsh/**` + specs registry | ✅ |

## 债务项设计符合性（DEBT-007…013）

| ID | 设计锚点 | 修复形态 | 判定 |
|----|---------|---------|:--:|
| DEBT-007 | AD-CU-8 顶栏与 Host chrome 同源 | 投影路径始终 `resolveContinueChrome` → `continueChromeForTab` | ✅ |
| DEBT-008 | AD-CU-8 + AD-CU-11 子上下文续写 | context Continue 绑子 session；提升为 live（钉）Tab | ✅ |
| DEBT-009 | AC-74 卡片文案即时 | 删子后立即 `markSubagentCardDeleted` | ✅ |
| DEBT-010 | `OpenTabRecord.pinnedSubagent` 读写对称 | restore / restoreMore 消费钉标志 | ✅ |
| DEBT-011 | AC-75 + Host/Webview 导航契约一致 | 面包屑禁用态对齐 `navBack`（含父 Tab 未打开） | ✅ |
| DEBT-012 | 权威日志冷读（非注入假路径） | `readSessionLog` + unbind 后再 listHistory | ✅ |
| DEBT-013 | AD-CU-4/10 恢复批处理不缩水 openTabSet | suspend persist 至批末 | ✅ |

## 模块/命名/结构审查

### 目录合理性
| 新文件 / 改动面 | 所在目录 | 是否合理 | 说明 |
|--------|---------|:--:|------|
| `chat-panel-host.ts` | `apps/vscode-dsh/src/chat-panel/` | ✅ | Continue chrome 投影属薄 Host 推送 |
| `conversation-controller.ts` | `apps/vscode-dsh/src/` | ✅ | Continue/钉/删/面包屑/restore 策略仍集中于控制器 |
| phase2/3/4 `*.spec.ts` | `apps/vscode-dsh/tests/` | ✅ | 债务回归落在既有 L2 套件，未另立平行模块 |

### 命名规范审查
| 文件/符号 | 实际命名 | 应遵循规范 | 判定 |
|-----------|---------|-----------|:--:|
| `effectiveContinueSessionId` / `effectiveContinueMode` | 私有 helper | 表达「投影有效会话/模式」 | ✅ |
| `parentDeleted` 兼表「父 Tab 未打开」 | 协议字段复用 | AC-75 字面仅「已删除」；label 区分「未打开/已删除」 | ⚠️ 语义略宽，见观察项 |
| `setPinnedSubagent` / `pinnedSubagent` | Registry + Index | design `OpenTabRecord` | ✅ |

### Constitution §2 检查
| 条款 | 内容 | 是否违反 | 说明 |
|------|------|:--:|------|
| §2.1 单一职责 | 每个模块做一件事 | ✅ | Host 推送 / Controller 策略 / Index 持久化分层未混 |
| §2.2 依赖方向 | 核心不依赖外围 | ✅ | 仍仅 `apps/vscode-dsh`；未反向依赖 agent-loop |
| §2.3 接口隔离 | 经明确接口交互 | ✅ | `resolveContinueChrome` deps 注入；Webview 只消费 `panel/state.continue` |

## 关键发现

### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
（无）

### 🟢 观察项
- **DEBT-011 字段语义**：`breadcrumb.parentDeleted === true` 在「父未删但 Tab 已关」时也为 true，与 AC-75 字面「已删除」略宽；`label` 已区分「父会话未打开」/「父会话已删除」，且与 `navBack` 一致，属可接受的协议字段复用，非架构违规。
- **DEBT-008 与 AD-CU-8「同 tabId」**：纯 context 无子 Tab 时 Continue 会 mint/激活子 live Tab——续写目标仍是子 `sessionId`；composer 需要 Tab 身份，与 AD-CU-11「钉/提升」一致，不构成同 session 双开（`getBySessionId` 优先）。
- **活跃债务表为空**：registry 已将 DEBT-007…013 移入已解决，与实现摘要一致。
