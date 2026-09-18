# Phase 2: 会话/聊天主链路与模型往返能力真机驱动

## 目标

对「真实功能能力清单」中涉及**模型往返**的核心能力建立真机 EDH 驱动 + 截图 + 断言：§12.3 会话/聊天主链路（建连、就绪、消息往返、流式呈现，清单 #13–#21）、§12.8 分叉（#32–#33）、§12.9 Continue（#34–#36）。本 Phase 是 AC-9「真实 LLM 强制」的核心载体 —— 所有涉及聊天/流式/Continue/分叉的验证必须使用真实 `DEEPSEEK_API_KEY`，不得以注入/模拟作等价验收。

## 前置条件

- 依赖 spec 文件：`../requirements.md`（AC-7~AC-10）、`../design.md`（AD-3/AD-4）、`../repo-exploration.md`（§12.3/§12.8/§12.9、§13 过时清单）。
- 前置 Phase：`phase-1-driver-framework-pilot`（框架 + manifest + 打样范式）。
- 强制前置：真实 `DEEPSEEK_API_KEY`（AC-9）；无 key 时本 Phase 模型往返能力以 `SKIPPED_NO_CREDENTIALS`（exit 3）fail-closed。

## 验收标准（本 Phase 覆盖）

| AC | 内容（摘要） |
|----|------|
| AC-7 | 对清单每项能力执行操作序列 + 截图 + 断言；至少覆盖 React SPA 主呈现路径与会话/聊天主链路（本 Phase 覆盖后者）；不得覆盖已废弃 thin HTML |
| AC-8 | 已废弃/被替代的功能（thin HTML、Tier-3 全文搜索）不得建立闭环覆盖，列入过时功能清单 |
| AC-9 | 聊天/流式/Continue/分叉等模型往返必须真实 `DEEPSEEK_API_KEY`，不得用注入/模拟作等价验收；无 key 以 exit 3 fail-closed |
| AC-10 | 每项能力至少 1 条可独立判定（✅/❌）的端到端断言，验证完整数据路径（操作 → 产品响应 → 截图/日志证据），不得仅以「DOM 存在 / HTTP 200」代替 |

## 验证策略

| AC | 验证类型 | 验证方法 | 预期结果 |
|----|---------|---------|---------|
| AC-7 | 运行时验证 | 带真实 key 跑 `run-layer-v-capabilities.sh`，覆盖 §12.3（建连 `dsh.startSession` → 就绪 → 发送提示 `promptActive` → 流式 `messages/append`+`messages/patch` → 完成）、§12.8 分叉、§12.9 Continue；逐项检查 journal + 截图 | 每项能力有操作序列 + ≥1 张截图 + 断言 verdict PASS；journal 含完整步骤；无 thin HTML 路径覆盖 |
| AC-8 | 静态检查 + 运行时验证 | ① 确认 manifest 不含 `buildThinChatHtml` / Tier-3 全文搜索对应能力；② 确认「过时功能清单」列于 implementation.md（§13 三项） | ① manifest 无废弃功能项；② 过时功能清单完整（thin HTML / 侧栏可写面 / Tier-3） |
| AC-9 | 运行时验证 | ① 带真实 key 跑聊天/流式/Continue/分叉能力，断言响应来自真实模型（日志含真实 token/流式增量，非注入 `dsh.test.answerApproval` 回放）；② 无 key 环境跑同一能力 | ① 模型往返为真实 LLM（非模拟），断言 PASS；② exit 3 + `SKIPPED_NO_CREDENTIALS`，不记为 PASS |
| AC-10 | 运行时验证 | 对「发送提示 → 流式呈现」能力设计端到端断言：操作后检查产品响应证据（流式 patch 增量、最终消息文本、截图关键区域），不依赖 DOM 存在/HTTP 200 | 断言可独立判定 ✅/❌，覆盖完整数据路径（操作 → 响应 → 证据），非弱证据 |

## 约束（来自 design.md）

- **AD-3/AD-4**：能力由 manifest `steps` 驱动；断言用关键区域 + 非退化。
- **AC-9 铁律**：`dsh.test.answerApproval`、session 回放等注入/模拟仅可作辅助，**不得**作为模型往返的等价验收。
- **AC-7 范围**：本 Phase 覆盖 §12.3 + §12.8 + §12.9；§12.4–§12.11 由 Phase 3 覆盖；§12.1/§12.2 由 Phase 1 打样覆盖。
- **过时功能**：thin HTML（`chat-panel-provider.ts:190` `@deprecated`）、Tier-3 全文搜索（`session-search.ts:136`）不覆盖。

## 产出清单

```
apps/vscode-dsh/test-scripts/layer-v-capabilities.json   # 修改：补全 §12.3/§12.8/§12.9 能力的 steps 与断言
apps/vscode-dsh/test-scripts/layer-v-capability-driver/  # 修改：实现本批能力 runStep
apps/vscode-dsh/test-artifacts/layer-v/                  # 运行产物：journal/截图/状态记录（gitignore，不提交）
.specdev/specs/vscode-dsh-e2e-closure/phases/phase-2-session-main-path-llm/implementation.md  # 新增：过时功能清单 + 偏差记录
```
