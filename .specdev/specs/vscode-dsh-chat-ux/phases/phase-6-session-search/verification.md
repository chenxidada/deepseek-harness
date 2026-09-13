# Phase 6 验证报告 — phase-6-session-search

## 判决：PASS

## 测试执行矩阵

| 场景 | 来源 | 命令 | 结果 | 证据 |
|------|:--:|------|:--:|------|
| AC-50 档 1 title/preview 命中；body-only 否定；无 MessageStore 读 | spec | vitest `chat-ux-session-search` AC-50 ×2 + independent title-wins / body-only / helper | ✅ | `matchField=title\|firstUserPreview`；body token `[]`；`messages.get` spy=0 |
| AC-51 path→session 反查；persist/delete 同步 | spec | layer-B mark-reviewed + deleteSession；independent replace/query 参数变化 + deleteConversation + tombstone | ✅ | 双 session 同 path；delete/replace 后反查更新；后缀/子串匹配分叉输出 |
| AC-52 openSearchHit → openFromHistory / 激活 Tab；无 auto Start | spec | layer-B openSearchHit + 协议；independent spy identity + protocol；phase1 AC-1c 回归 | ✅ | `opened`→`activated`；`historySpy` 1 次；`Host.start` 未调用；mode=`replay` |
| AC-53 无档 3 / 正文扫描 | spec | layer-B TIER3；static 无全文导出；independent helper | ✅ | `TIER3_FULL_TEXT_SEARCH_API=null`；无 `searchFullText`/`scanJsonlBodies`；search/ 无 MessageStore/JSONL 读 |
| 约束：未改 agent-loop | spec | static-checks.sh | ✅ | HEAD / untracked / main...HEAD 均无 `packages/core/agent-loop` |
| 活跃债务为空 | registry | static + 读 registry | ✅ | 活跃表仅 `—` 占位；无 DEBT/GAP/STUB 行 |
| phase-5 fork 回归 | regression | `chat-ux-fork-retry-branch` | ✅ | 12 passed |
| Query/browse ≠ Start 回归 | regression | `phase1-auto-start -t AC-1c\|openHistory` | ✅ | 1 passed / 8 skipped |

## 独立验证场景（你自己设计的）

| 场景 | 命令 | 结果 |
|------|------|:--:|
| `normalizeSearchPath` 参数变化（`./`、反斜杠、空白 → 不同输出不坍塌） | vitest independent | ✅ |
| `PathSessionIndex` query 后缀/子串 + `replaceSessionPaths` 丢弃旧 path | vitest independent | ✅ |
| workspaceState `dsh.pathSessionIndex` 持久化往返 | vitest independent | ✅ |
| title 与 preview 同时命中 → `matchField=title`；空查询 `[]` | vitest independent | ✅ |
| text+path 合并 `matchTiers=[1,2]`；body-only 仍空 | vitest independent | ✅ |
| `deleteConversation`（开 Tab）清 path 索引（implementer 仅测 deleteSession） | vitest independent | ✅ |
| `markDeleted` tombstone 过滤 path 命中（无 removeSession） | vitest independent | ✅ |
| `openSearchHit` spy≡`openFromHistory`；协议打开不 Start | vitest independent | ✅ |
| 纯 helper + TIER3 null + 无 MessageStore | vitest independent | ✅ |

## Reviewer 建议的验证场景

| 场景 | 命令 | 结果 |
|------|------|:--:|
| layer-B AC-50–53 全套 | `vitest run apps/vscode-dsh/tests/chat-ux-session-search.spec.ts` | ✅ 6/6 |
| 静态：无 agent-loop / 无档 3 / 协议与命令接线 | `static-checks.sh` | ✅ |
| 打开不 Start / Query/browse | independent + phase1 AC-1c | ✅ |

## 端到端验证

| 数据路径 | 结果 | 证据 |
|----------|:--:|------|
| ExtensionIndex upsert → `searchSessions({text})` → `matchField` title/preview（不经 MessageStore） | ✅ | independent + layer-B；`get` spy=0 |
| Change upsert → `markChangeReviewed` → `persistChangeIndex` → `replaceSessionPaths` → `searchSessions({path})` | ✅ | layer-B 双 session；independent deleteConversation 清索引 |
| Webview `action/search-sessions` → Host `search/results` → `action/open-search-hit` → `openFromHistory`（replay，无 Start） | ✅ | layer-B + independent FakeWebviewPort |
| PathSessionIndex → workspaceState → 新实例 `queryByPath` | ✅ | independent round-trip |

## 残余风险

| 风险 | 严重性 | 说明 |
|------|:--:|------|
| 真 VS Code 命令面板 QuickPick 未在本机 IDE 手工点按 | 🟢 LOW | 层 B / Host 协议与 `dsh.searchSessions` 注册 + README Query/browse 已用执行证据覆盖；非行为缺口 |
| 冷启动未全量扫各 session `index.json` 重建 path 索引 | 🟢 LOW | implementation 已文档化；spec 要求写入/删除同步，独立测已覆盖 persist/delete；非 AC 失败 |

## Pipeline 合规检查

- Pipeline compliance: ✅ 所有产品改动在工作区位于 `impl-phase-6-session-search`（未 commit，符合「implementer 不自行 commit / HG-3 统一提交」）
- `packages/core/agent-loop`：无改动
- specs 仅验证产物写入本 Phase 目录；verifier 未将 specs 作为产品提交（亦不 commit）
- `tech-debt-registry.md` 活跃债务：空（仅占位行）

## 问题清单（为何不是 FAIL / 为何是 PASS）

本判决为 **PASS**：AC-50–53 均有独立执行证据；端到端路径（索引查询 → path 同步 → 打开不 Start）跑通；无 CRITICAL/MEDIUM 残余风险；无未解决 Known Gaps / 活跃桩。

## 验证脚本

落盘目录：`.specdev/specs/vscode-dsh-chat-ux/phases/phase-6-session-search/test-scripts/`

| 文件 | 用途 |
|------|------|
| `static-checks.sh` | agent-loop / 档 3 否定 / persist·delete 同步 / 协议·命令 / 活跃债空 |
| `verifier-independent-phase6.spec.ts` | 9 个独立场景 |
| `vitest.config.ts` | 隔离 vitest 配置 |
| `run-verifier-phase6.sh` | 一键：static + layer-B + 回归 + independent |

### 一键复跑

```bash
bash .specdev/specs/vscode-dsh-chat-ux/phases/phase-6-session-search/test-scripts/run-verifier-phase6.sh
```

### 执行摘要（本次）

```
static-checks PASSED
chat-ux-session-search.spec.ts     6 passed
chat-ux-fork-retry-branch.spec.ts 12 passed
phase1-auto-start (AC-1c)           1 passed
verifier-independent-phase6         9 passed
```
