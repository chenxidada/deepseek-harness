# Phase 2 验证报告 — phase-2-change-list-display

## 判决：PASS

独立复跑 implementer L2（含 MUST-FIX 后的 AC-12a / AC-19 / AC-30）+ 自建 10 个独立场景全部通过；端到端入账→列表→get-diff / open / reveal 路径有执行证据。无 CRITICAL/MEDIUM 残余风险。

## 测试执行矩阵

| 场景 | 来源 | 命令 | 结果 | 证据 |
|------|:--:|------|:--:|------|
| AC-5/7/20：meta.diffs 入账、同 path 合并、full-file blob（DEBT-001） | spec | `vitest … phase2-change-list-display.spec.ts` | ✅ | implementer suite 16/16；blob ≠ hunk |
| AC-6 / N-1：N=0 emptyNotice + 无 diff-summary；N>0 列表+摘要 | spec | 同上 | ✅ | emptyNotice + `CHANGE_LIST_EMPTY_NOTICE` |
| AC-8：二进制/超大/生成目录/工作区外 | spec | 同上 | ✅ | unit + live ignore |
| AC-9：无 meta.diffs / 用户手动保存不入账 | spec | 同上 | ✅ | ChangeStore 长度 0 |
| GAP-010/011：空 diffs / 无 presentationMeta 宁可漏记 | registry | 同上 | ✅ | emptyNotice；0 records |
| AC-10：unreviewed 文案无「未写入/待批准」 | spec | 同上 | ✅ | `未查看` |
| AC-12：get-diff→diff-content；prune available=false | spec | 同上 | ✅ | 正文来自 SnapshotStore |
| AC-12a：主键单击→`change/open`；expand 分离 | spec / MUST-FIX | 同上 | ✅ | HTML + FakeWebviewPort open hook |
| AC-19：reveal-source→assistant bubble（非 change-list） | spec / MUST-FIX | 同上 | ✅ | `scroll/reveal-source`；无 `scroll/reveal-change-list` |
| AC-21：跨 turn 隔离 + `data-turn` | spec | 同上 | ✅ | 两 turn path/sourceMessageId 分离 |
| AC-23：diff textContent；无 innerHTML | spec | 同上 | ✅ | pane.textContent 路径 |
| AC-30：diff-summary 携带 sourceMessageId；按 id reveal | spec / MUST-FIX | 同上 + `phase5-should-polish.spec.ts` | ✅ | 两 turn 防 reverse().find 误选 |
| Should：multi-assistant re-anchor | review | phase2 suite | ✅ | sourceMessageId 更新 |
| Should：无 before-cache 省略 blob | review | phase2 suite | ✅ | snapshotRef undefined |
| AC-24：快照明文不进 message bodies | implementer | phase2 suite | ✅ | storageRoot/changes only |
| 回归 AC-30 polish | reviewer | phase5-should-polish | ✅ | **28 passed**（phase2+phase5） |

## 独立验证场景（verifier 自建）

| 场景 | 命令 | 结果 |
|------|------|:--:|
| 参数变化：empty/missing/malformed 不出账；recoverable 入账（stub probe） | `vitest --config …/test-scripts/vitest.config.ts` | ✅ |
| 同 batch 混 ignored+valid → 仅 valid | 同上 | ✅ |
| `shouldIgnoreChangePath` 多输入结果分化 | 同上 | ✅ |
| **E2E create**：oldText=null → kind=created + full-file after blob + 列表无全文 | 同上 | ✅ |
| AC-12a `firstChangedLine` 对 mid-file / create 定位 | 同上 + extension.ts 契约核对 | ✅ |
| 无 snapshotRef 时 get-diff → available=false（不伪造） | 同上 | ✅ |
| live wiring：`requestRevealSource`→`pushRevealSource`；主键 click→open | 同上（读 extension/provider） | ✅ |
| AC-19/30 identity：summary.sourceMessageId === list.sourceMessageId === assistant.id | 同上 | ✅ |
| AC-23 textContent + CSP 源码面 | 同上 | ✅ |
| **跨 session 隔离**（implementer 未测） | 同上 | ✅ |

独立套件：**10 passed / 10**。

## Reviewer 建议的验证场景

| 场景 | 命令 | 结果 |
|------|------|:--:|
| phase2 + phase5 合并回归（28） | `./node_modules/.bin/vitest run apps/vscode-dsh/tests/phase2-change-list-display.spec.ts apps/vscode-dsh/tests/phase5-should-polish.spec.ts` | ✅ 28/28 |
| AC-12a / 19 / 30 MUST-FIX 闭环用例 | 含于 phase2 suite | ✅ |

## 端到端验证

| 数据路径 | 结果 | 证据 |
|----------|:--:|------|
| `tool/result.meta.diffs` → ChangeAttributor settle → ChangeRecord + SnapshotStore → `change-list` 消息 | ✅ | create E2E + AC-5/7/20 L2；列表 JSON 不含全文 |
| Webview `change/get-diff` → Host SnapshotStore → `change/diff-content`（含 prune / 无 ref） | ✅ | implementer prune + verifier no-snapshotRef |
| Webview `change/open` → Host open hook；locate 用 full-file firstChangedLine | ✅ | FakeWebviewPort + create line=0 + mid-file line=1 |
| `change/reveal-source` → `scroll/reveal-source` → `[data-message-id]` | ✅ | L2 + extension 接线断言 |
| `action/reveal-change-list` + `sourceMessageId` → 对应 turn 列表 | ✅ | 两 turn identity；N=0 无摘要（AC-6） |
| Prefer-miss：`diffs:[]` / 无 meta.diffs / 畸形 hunk | ✅ | 独立参数变化矩阵 |

## 残余风险

| 风险 | 严重性 | 说明 |
|------|:--:|------|
| 无真实 VS Code Webview DOM 点击（L2 FakeWebviewPort + HTML 源断言） | 🟢 LOW | 与本 Phase 验证策略（L2）一致；协议往返已覆盖 |
| GAP-010/011 永久漏记 create/identical 与 str_replace_editor | 🟢 LOW | 已登记为已解决产品策略「宁可漏记」，非未闭合缺陷 |
| 无 snapshotRef 时 open 不定位行 | 🟢 LOW | 符合 AC-12a「无法定位则至少打开文件」 |

## Pipeline 合规检查

- 当前分支：`impl-phase-2-change-list-display`
- 产品改动（`apps/vscode-dsh/src/change/**`、chat-panel、conversation-controller、extension、message-store、tests）均在该 `impl-*` 工作区分支上
- Pipeline compliance: ✅ 所有变更在 impl-* 分支

## 验证脚本

落盘目录：`.specdev/specs/vscode-dsh-code-context-diff/phases/phase-2-change-list-display/test-scripts/`

| 文件 | 用途 |
|------|------|
| `verifier-independent-phase2.spec.ts` | 10 个独立场景 |
| `vitest.config.ts` | 隔离 include |
| `run-verifier-phase2.sh` | 一键：implementer 28 + independent 10 |

```bash
source "$HOME/.nvm/nvm.sh" && nvm use 22.14.0
./.specdev/specs/vscode-dsh-code-context-diff/phases/phase-2-change-list-display/test-scripts/run-verifier-phase2.sh
```

执行摘要（2026-09-10）：
- implementer+回归：`Test Files 2 passed` / `Tests 28 passed`
- verifier independent：`Test Files 1 passed` / `Tests 10 passed`
