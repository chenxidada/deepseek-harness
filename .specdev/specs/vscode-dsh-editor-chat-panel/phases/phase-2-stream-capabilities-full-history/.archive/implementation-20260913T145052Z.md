# Phase 2 实现摘要 — phase-2-stream-capabilities-full-history

## 变更清单（文件列表）

### Host / Protocol
| 路径 | 说明 |
|------|------|
| `apps/vscode-dsh/src/chat-panel/protocol.ts` | 新增 `ui/delete-request`、`ui/open-timeline` + parser |
| `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` | 路由确认删除 / Timeline；deps `requestDeleteConfirmed` / `requestOpenTimeline` |
| `apps/vscode-dsh/src/extension.ts` | `listHistoryRows` 映射 `parentTitle`；`runDeleteConfirmed`（跳过原生确认） |
| `apps/vscode-dsh/src/extension-index.ts` | `HistoryListRow.parentTitle`；`listHistorySessions` 父子投影 |
| `apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts` | `buildThinChatHtml` 标注 fixture-only（DEBT-ECP-001） |

### React SPA
| 路径 | 说明 |
|------|------|
| `webview/src/store/chat-ui-store.ts` | continue / kinds / activity / changeList / search / stopping / deleteConfirm |
| `webview/src/bridge/message-bridge.ts` | 扩展 stop/continue/delete/copy/search/change intents |
| `webview/src/App.tsx` | 接线 Search/History/DeleteModal；pending Continue |
| `webview/src/components/MessageList.tsx` | MD settle+sanitize、activity/ref/change、copy |
| `webview/src/components/Composer.tsx` | 四态 + Stop/停止中 + Continue CTA + 禁用原因 |
| `webview/src/components/HistoryPanel.tsx` | Continue / 删除 / 父子 / 档1+2 搜索框 |
| `webview/src/components/TabChrome.tsx` | 溢出菜单（删除/Timeline）+ 面板内搜索 |
| `webview/src/components/DeleteConfirmModal.tsx` | webview modal「不可恢复」→ `ui/delete-request` |
| `webview/src/lib/at-path-tokens.ts` | 浏览器侧 `@path` 抽取 |
| `webview/src/styles/tokens.css` | ≥8px / focus / reduced-motion / MD/code 样式 |
| `webview/vite.config.ts` | fs.allow + markdown alias |
| `webview/dist/**` | SPA 重建产物 |

### 测试 / 层 V
| 路径 | 说明 |
|------|------|
| `tests/layer-a-rtl/editor-chat-phase2.spec.tsx` | Phase 2 DOM 契约（层 A） |
| `tests/phase2-history-delete-host.spec.ts` | parentTitle + delete-request 解析（层 B） |
| `phases/.../layer-v-checklist.md` | 层 V 清单 + 诚实环境状态 |

## 对每个验收标准的实现说明

| ID | 实现 |
|----|------|
| AC-13c / 14a / 60 | 溢出/历史共用 `DeleteConfirmModal` → `ui/delete-request` → `deleteSession({confirmed:true})` |
| AC-14b / 44 | 溢出：删除会话 + 打开 Timeline（`ui/open-timeline`） |
| AC-20 / 20a / 20b | 角色区分；replay readonly + Continue；empty/loading |
| AC-21 / 21a | `renderSafeMarkdown` settle；无 script；代码块 + copy |
| AC-22 / 23 / 23a | streaming 指示；incomplete「已停止」；失败/reject 可读文案 |
| AC-24 | `data-follow-state` 根属性 |
| AC-25 | status/set idle fail-closes streaming + stopping |
| AC-30–32 | activity-row / ref-card / change-list + 审阅/撤销入口 |
| AC-33 / 33a / 33b | 四态 + 禁用原因；Stop；停止中 R7 |
| AC-34–36 | retry 入口；Continue；btn-copy / code copy |
| AC-37–38 / 56 | 面板内 search-panel 档1+2；open-search-hit 只读；不档3 |
| AC-40 | 层 A RTL + 层 B host；层 V 清单（无 DISPLAY 不伪 PASS） |
| AC-41 / 42 | checklist 覆盖；本环境 DISPLAY unset → 不宣称 V PASS |
| AC-53–57 / 59 | 历史只读打开；Continue；删除；父子；registry onChange→pushFullState 刷新 |
| UI-AC-* | tokens + 组件权重；sticky composer；modal；reduced-motion |
| AD-ECP-8 退役 | 生产仍 SPA；thin HTML 仅 fixture |

## 测试结果（命令 + 输出）

```bash
pnpm exec vitest run \
  apps/vscode-dsh/tests/layer-a-rtl \
  apps/vscode-dsh/tests/phase2-history-delete-host.spec.ts \
  apps/vscode-dsh/tests/editor-chat-panel.lifecycle.spec.ts
# → Test Files  4 passed (4)
# → Tests  23 passed (23)

pnpm --filter @deepseek-ai/dsh-vscode-dsh run webview:build
# → dist/assets/index.js + index.css ✓
```

### 层 V 环境（诚实）

```
DISPLAY=<unset>
code CLI=no
cursor CLI=no
```

→ GAP-ECP-007：**已交付 checklist + probes**；**不得**将本机判为层 V PASS（AC-42）。

## 偏差记录

| 偏差 | 影响 | 原因 | 下游影响 |
|------|------|------|----------|
| Timeline 打开用 `workbench.view.extension.dsh` 而非专属 focus 命令 | AC-44 | 扩展无独立 timeline.focus 命令 | 打开活动栏容器即可；可后续加专属命令 |
| 历史档1+2：本地行过滤 + Host `action/search-sessions` 双路径 | AC-56 | Host 搜索结果进 search-panel；历史框同时过滤行 | 可接受；verifier 注意两入口 |
| `buildThinChatHtml` 源码保留为 fixture | DEBT-ECP-001 | 其他 phase* 套件仍依赖夹具 | 非本 feature UI PASS；生产不加载 |

## 债务

Phase Entry Gate (a) 全部关闭：GAP-ECP-001…007 + DEBT-ECP-001 →「已解决」。无新增阻塞 `@STUB`。
