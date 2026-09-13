# Phase 3 验证报告

## 判决：PARTIAL

## 测试执行矩阵

| 场景 | 来源 | 命令 | 结果 | 证据 |
|------|:--:|------|:--:|------|
| AC-33/34/70 restore（空剔/活动优先/N） | spec VP-3-restore | `bash .../run-phase3-l2-l3.sh` | ✅ | 3 files / **24 tests** exit 0 |
| AC-69 waiting-host → replay | spec | 同上 + V-IND（L3 FakeWebview） | ✅ | `panel/state` waiting-host→replay；`messages/replace` |
| AD-CU-4 立即持久化 | spec | implementer + L2 | ✅ | `getWriteCount()` / `writeImmediate` 路径 |
| AC-76 / Diff before 禁工作区 | spec VP-3-diff | L2/L3 + **V-IND-2** | ✅ | 双侧 `dsh-diff`；`Uri.file` 调用=0；patch-only→[] |
| AC-77 已停止/未完成 | spec | L2 + V-IND-2 | ✅ | `incomplete` + notice「已停止/未完成」 |
| AC-68/32/66 Continue same-id | spec VP-3-continue | L2/L3 + **V-IND-1** | ✅ | Gate=`same-id`；同 tabId `replay→live`；resume(sessionId) |
| GAP-001 bridge resume | impl/registry | ide-bridge.spec + V-IND-1 | ✅ | `session/resume`→`sdkSessionResume`；registry 已解决 |
| AC-54/84 L2+L3 门禁 | spec | `run-phase3-l2-l3.sh` | ✅ | restore / Diff / Continue 均有 L2 hooks + FakeWebview L3 |
| AC-70 索引永久保留（跨持久化） | design AD-CU-10 | **V-IND-3** | ❌ | restore 后 `persistOpenTabs` 把 `openTabSet` 缩成仅 UI 集（见问题清单） |
| tsc | build | `tsc -p apps/vscode-dsh --noEmit` | ✅ | exit 0 |
| 扩展 vitest | reviewer | `vitest run apps/vscode-dsh/tests packages/ide/ide-bridge/tests/ide-bridge.spec.ts` | ✅ | 20 files / **90 tests** |

## 独立验证场景（你自己设计的）

| 场景 | 命令 | 结果 |
|------|------|:--:|
| **V-IND-1** restoreOpenTabSet（空剔+活动优先+N）→ Continue 同 tabId live + resume(active) | `tsx .../verifier-independent-phase3.mts` | ✅ |
| **V-IND-2** Diff before 双 hunk 参数变化；禁 `Uri.file`；open-turn incomplete | 同上 | ✅ |
| **V-IND-3** restoreMoreTabs after N=1；sessions 索引全保留；探测 openTabSet 缩水 | 同上 | ✅（行为探测）/ AC-70 持久化 ❌ |
| **V-IND-4** planRestore / continueChrome / recoverableDiffs 参数变化（桩探测） | 同上 | ✅ failed=0 |

独立脚本：`.specdev/specs/vscode-dsh-conversation-ui/phases/phase-3-restart-continue/test-scripts/verifier-independent-phase3.mts`

## Reviewer 建议的验证场景

| 场景 | 命令 | 结果 |
|------|------|:--:|
| 复跑 `run-phase3-l2-l3.sh` | L2/L3 | ✅ 24/24 |
| 扩展 vitest 90 | vitest | ✅ 90/90 |
| Webview 顶栏 Continue / 查看更多 | 静态 + HTML grep | 🟡 Should-Fix 确认：真 Webview 未消费 `panel/state.continue` / `deferredRestoreCount`（spec 标 L4；Host/L2/L3 已就绪） |
| waiting-host latch 自触发 | 代码路径 | 🟡 产品 `startSession` 连接后调 restore；latch 本身无 status 订阅 |
| readSessionLog 失败当空剔 | 代码 `catch → []` | 🟡 瞬时失败可永久剔除 openTabSet 行 |

## 端到端验证

| 数据路径 | 结果 | 证据 |
|----------|:--:|------|
| openTabSet → planRestore → hydrate replay → FakeWebview `messages/replace` | ✅ | L2+L3 + V-IND-1 |
| waiting-host → connected → restore → `panel/state` replay | ✅ | phase3 spec + FakeWebview |
| tool meta.diffs → recoverable → `openTimelineDiff` 双侧 dsh-diff（无 file） | ✅ | V-IND-2 |
| Continue → `resumeSession(sessionId)` → 同 tabId live → follow-up 同 sessionId | ✅ | V-IND-1（冷恢复后 Continue，非 implementer 的 openFromHistory 路径） |
| bridge `session/resume` → sdkSessionResume → agents.resume | ✅ | ide-bridge 24 套件内 + GAP-001 关闭 |
| N 限 UI → deferred → restoreMoreTabs(all) → registry 全量 | ✅ 进程内 | V-IND-3 |
| N 限 UI 后 `openTabSet` 持久化仍全 | ❌ | V-IND-3：`openTabSet.length=1` 而 deferred=2 |

## 为什么不是 PASS（问题清单）

1. **AC-70 / AD-CU-10 持久化索引缩水（MEDIUM）** — `restoreOpenTabSet` 先 `setOpenTabs(plan.indexSet)`，随后 `persistOpenTabs()` 仅按 registry（已 hydrate 的 UI 集）回写，未进 UI 的 deferred 行从持久化 `openTabSet` 消失。同进程内 `deferredRestore` +「查看更多」仍可用；**再次重启**会丢未 hydrate 的未关 Tab。V-IND-3 实测 `openTabSet.length=1`（N=1）。已登记 **DEBT-003**。
2. **真 Webview 未绑 Continue / 查看更多（LOW→产品文案；Should-Fix）** — Host 协议与命令可用；spec 将真渲染标 L4。登记 **DEBT-004**。
3. **`pendingRestoreLatch` 不自触发（LOW；产品 startSession 覆盖）** — 登记 **DEBT-005**。
4. **`readSessionLog` 失败当空 Tab 剔除（MEDIUM 边界）** — 登记 **DEBT-006**。

主路径（重启恢复 UI、Diff before、Continue same-id、GAP-001、L2+L3）均有独立执行证据；因 AC-70 持久化语义未完全满足 → **PARTIAL**（非 FAIL）。

## 残余风险

| 风险 | 严重性 | 说明 |
|------|:--:|------|
| 恢复后 openTabSet 被缩成 UI 集，二次重启丢 deferred | 🟡 MEDIUM | DEBT-003；修法：persist 时应合并 `deferredRestore` 或禁止 restore 末尾用 registry-only 覆盖 indexSet |
| readSessionLog 瞬时失败 → 误剔 | 🟡 MEDIUM | DEBT-006 |
| 真 Webview 无 Continue/查看更多按钮 | 🟢 LOW | L4；命令/L2 可用；DEBT-004 |
| waiting-host latch 依赖编排二次调用 | 🟢 LOW | DEBT-005；`dsh.startSession` 主路径覆盖 |

## Pipeline 合规检查

- 当前分支：`impl-phase-3-restart-continue`
- Phase 产品改动均在该 `impl-*` 工作区（未提交，符合「implementer 不自行 commit」）
- Pipeline compliance: ✅ 所有变更在 impl-* 分支

## 验证脚本

| 脚本 | 用途 |
|------|------|
| `test-scripts/run-phase3-l2-l3.sh` | implementer L2/L3（必跑） |
| `test-scripts/verifier-independent-phase3.mts` | verifier 独立 V-IND-1..4 |
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
```
