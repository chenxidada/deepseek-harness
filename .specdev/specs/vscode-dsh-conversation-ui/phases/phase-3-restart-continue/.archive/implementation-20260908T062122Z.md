# Phase 3 实现摘要（PARTIAL 回炉 — DEBT-003..006）

## 变更清单（文件列表）

| 文件 | 变更 |
|------|------|
| `apps/vscode-dsh/src/conversation-controller.ts` | `persistOpenTabs` 合并 deferred；restore 批 suspend；读失败保留 index/deferred；Host `onStatusChange` 自触发 latch；`restoreInFlight` 去重 |
| `apps/vscode-dsh/src/session-host.ts` | `status` getter/setter + `onStatusChange` |
| `apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts` | 薄 Webview 消费 Continue / 查看更多 chrome，发 `action/continue` / `action/restore-more` |
| `apps/vscode-dsh/tests/phase3-restart-continue.spec.ts` | DEBT-003..006 回归 + stubHost status 通知 |
| `.specdev/.../verifier-independent-phase3.mts` | V-IND-3 断言 `openTabSet` 全量保留 |
| `.specdev/.../tech-debt-registry.md` | DEBT-003..006 → 已解决 |
| `.cursor/skills/project-test/SKILL.md` | Phase 3 回炉验证知识更新 |

## 对每个验收标准的实现说明

| AC / 债 | 实现 |
|---------|------|
| **AC-70 / DEBT-003** | `persistOpenTabs`：registry（有内容）∪ `deferredRestore`（按 sessionId 去重）；restore 期间 `openTabPersistSuspended` 避免中间写缩水；二次冷启动仍恢复 deferred |
| **DEBT-004** | `buildThinChatHtml`：`syncChrome` 读 `continue` / `deferredRestoreCount`；Continue /「查看更多」按钮 postMessage |
| **AC-69 / DEBT-005** | `IdeSessionHost.onStatusChange`；controller 在 `connected && pendingRestoreLatch` 时自动 `restoreOpenTabSet` |
| **DEBT-006** | `readSessionLog` catch → `loadFailed`；planner `hasContent=true` 保留 index；失败行移入 deferred，不空剔；可二次 restore |
| 既有 AC-33/34/68/76/77 / GAP-001 | 未改语义；回归套件仍绿 |

## 测试结果（命令 + 输出）

```text
bash .../run-phase3-l2-l3.sh
→ Test Files 3 passed；Tests 28 passed

PATH=.../node/24.3.0/bin:$PATH tsx .../verifier-independent-phase3.mts
→ SUMMARY: failed=0；ALL V-IND PASS（含 V-IND-3 openTabSet.length===3）

PATH=... vitest run apps/vscode-dsh/tests packages/ide/ide-bridge/tests/ide-bridge.spec.ts
→ Test Files 20 passed；Tests 94 passed

PATH=... tsc -p apps/vscode-dsh/tsconfig.json --noEmit
→ exit 0
```

## 偏差记录

无相对 phase-3 `spec.md` / `design.md` 的新偏差。本轮仅闭合 PARTIAL/Should-Fix 债。

## 债务关闭

| ID | 状态 |
|----|------|
| DEBT-003 | ✅ 已解决 |
| DEBT-004 | ✅ 已解决 |
| DEBT-005 | ✅ 已解决 |
| DEBT-006 | ✅ 已解决 |

**仍未关项**：无（本 Phase 活跃表为空）。未改 agent-loop；未 git commit。
