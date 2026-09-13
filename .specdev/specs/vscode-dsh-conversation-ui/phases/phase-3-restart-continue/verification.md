# Phase 3 验证报告

## 判决：PASS

（MUST-FIX loop2 后重验：上次 PARTIAL 因 DEBT-003 openTabSet 缩水；本次独立 V-IND-3/V-IND-5 证实 `persistOpenTabs` 合并 deferred，且 `restoreMoreTabs` 读失败回填后二次冷启动仍见 session。DEBT-003..006 均已关闭，无活跃债务。）

## 测试执行矩阵

| 场景 | 来源 | 命令 | 结果 | 证据 |
|------|:--:|------|:--:|------|
| AC-33/34/70 restore（空剔/活动优先/N） | spec VP-3-restore | `bash .../run-phase3-l2-l3.sh` | ✅ | 3 files / **29 tests** exit 0 |
| AC-69 waiting-host → replay | spec | L2/L3 + phase3.spec | ✅ | Host 未就绪 latch；connected 后 restore |
| AD-CU-4 立即持久化 | spec | L2 + controller `persistOpenTabs` | ✅ | deferred 合并进 `openTabSet` |
| AC-70 索引永久保留（跨持久化） | design AD-CU-10 / **DEBT-003** | **V-IND-3** | ✅ | `openTabSet.length===3`（N=1 后仍全量） |
| AC-76 / Diff before 禁工作区 | spec VP-3-diff | L2/L3 + **V-IND-2** | ✅ | 双侧 `dsh-diff`；`Uri.file`=0；patch-only→[] |
| AC-77 已停止/未完成 | spec | L2 + V-IND-2 | ✅ | `incomplete` + notice「已停止/未完成」 |
| AC-68/32/66 Continue same-id | spec VP-3-continue | L2/L3 + **V-IND-1** | ✅ | Gate=`same-id`；同 tabId `replay→live`；resume(active) |
| DEBT-004 Webview Continue/查看更多 | registry | phase3.spec HTML | ✅ | `buildThinChatHtml` 含 continue / deferredRestoreCount |
| DEBT-005 waiting-host latch 自触发 | registry | phase3.spec + `onStatusChange` | ✅ | connected + latch → restore |
| DEBT-006 read 失败不空剔 + restoreMore 回填 | registry / Must-Fix | focused vitest + **V-IND-5** | ✅ | 失败回队；二次冷启动仍见 sess-more/extra |
| GAP-001 bridge resume | registry | ide-bridge.spec | ✅ | `session/resume`→`sdkSessionResume` |
| AC-54/84 L2+L3 门禁 | spec | `run-phase3-l2-l3.sh` | ✅ | restore / Diff / Continue 均覆盖 |
| tsc | build | `tsc -p apps/vscode-dsh --noEmit` | ✅ | exit 0 |
| 扩展 vitest | reviewer | `vitest run apps/vscode-dsh/tests packages/ide/ide-bridge/tests/ide-bridge.spec.ts` | ✅ | 20 files / **95 tests** |

## 独立验证场景（你自己设计的）

| 场景 | 命令 | 结果 |
|------|------|:--:|
| **V-IND-1** restoreOpenTabSet（空剔+活动优先+N）→ Continue 同 tabId live + resume(active) | `tsx .../verifier-independent-phase3.mts` | ✅ |
| **V-IND-2** Diff before 双 hunk 参数变化；禁 `Uri.file`；open-turn incomplete | 同上 | ✅ |
| **V-IND-3** restoreMoreTabs after N=1；openTabSet 持久化全量（DEBT-003 关闭确认） | 同上 | ✅ |
| **V-IND-4** planRestore / continueChrome / recoverableDiffs 参数变化（桩探测） | 同上 | ✅ |
| **V-IND-5** restoreMoreTabs(all) 读失败回填 → 耐久 openTabSet 保留 → **二次冷启动**仍见 deferred → 恢复后 full hydrate | 同上 | ✅ failed=0 |

独立脚本：`.specdev/specs/vscode-dsh-conversation-ui/phases/phase-3-restart-continue/test-scripts/verifier-independent-phase3.mts`

### V-IND-5 证据摘要（相对 implementer 单测的增量）

- N=1 冷恢复后 deferred=2（`sess-more` + `sess-extra`），`openTabSet.length===3`（DEBT-003）
- `restoreMoreTabs(true)` 在两侧 `readSessionLog` 抛错时 hydrated=0，deferred 回队仍为 2
- 耐久 `openTabSet` / `sessions` 仍含三 session（不被 `persistOpenTabs` 抹掉）
- **新 controller 二次冷启动**仍 plan 出 deferred，且 openTabSet 全量
- 读成功后 `restoreMoreTabs(true)` 将两行 hydrate 进 registry（deferred 全量 openTabSet）

## Reviewer 建议的验证场景

| 场景 | 命令 | 结果 |
|------|------|:--:|
| 复跑 `run-phase3-l2-l3.sh` | L2/L3 | ✅ 29/29 |
| 扩展 vitest 95 | vitest | ✅ 95/95 |
| restoreMoreTabs read-failure 聚焦 | `vitest ... -t "restoreMoreTabs: read failure"` | ✅ 1/1 |
| DEBT-003..006 关闭确认 | V-IND-3/5 + 代码路径 | ✅ 无活跃债务 |

## 端到端验证

| 数据路径 | 结果 | 证据 |
|----------|:--:|------|
| openTabSet → planRestore → hydrate replay → FakeWebview `messages/replace` / Continue | ✅ | V-IND-1 |
| tool meta.diffs → recoverable → `openTimelineDiff` 双侧 dsh-diff（无 file） | ✅ | V-IND-2 |
| N 限 UI → deferred → persist 合并 → `openTabSet` 全量 | ✅ | V-IND-3（DEBT-003 已消） |
| restoreMore 读失败 → 回队 → persist → **二次冷启动**仍见 session → 再 all hydrate | ✅ | **V-IND-5** |
| Continue → `resumeSession` → 同 tabId live | ✅ | V-IND-1 |
| bridge `session/resume` → sdkSessionResume | ✅ | ide-bridge 套件 |

## 残余风险

| 风险 | 严重性 | 说明 |
|------|:--:|------|
| `restoreMoreTabs(all=true)` 批中途 persist 可能短暂缩水未处理行 | 🟢 LOW | review Should-Fix 可选；产品默认单行「查看更多」不受影响；非 AC 阻塞 |

无 CRITICAL / MEDIUM 残余风险。无新债务需登记。

## Pipeline 合规检查

- 当前分支：`impl-phase-3-restart-continue`
- `packages/core/agent-loop` 无改动
- Phase 产品改动均在该 `impl-*` 工作区（未提交，符合「implementer 不自行 commit」）
- Pipeline compliance: ✅ 所有变更在 impl-* 分支

## 验证脚本

| 脚本 | 用途 |
|------|------|
| `test-scripts/run-phase3-l2-l3.sh` | implementer L2/L3（必跑；本次 29/29） |
| `test-scripts/verifier-independent-phase3.mts` | verifier 独立 V-IND-1..5 |
| `test-scripts/run-verifier-phase3.sh` | 聚合：L2/L3 + V-IND + tsc |

### 复跑命令

```bash
PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" \
  bash .specdev/specs/vscode-dsh-conversation-ui/phases/phase-3-restart-continue/test-scripts/run-verifier-phase3.sh

# 或分步：
PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" \
  bash .specdev/specs/vscode-dsh-conversation-ui/phases/phase-3-restart-continue/test-scripts/run-phase3-l2-l3.sh
PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" \
  ./node_modules/.bin/tsx .specdev/specs/vscode-dsh-conversation-ui/phases/phase-3-restart-continue/test-scripts/verifier-independent-phase3.mts
PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" \
  ./node_modules/.bin/tsc -p apps/vscode-dsh/tsconfig.json --noEmit
```
