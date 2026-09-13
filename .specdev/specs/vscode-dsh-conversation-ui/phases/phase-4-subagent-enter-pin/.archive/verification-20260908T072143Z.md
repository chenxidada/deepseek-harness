# Phase 4 验证报告

## 判决：PASS

Must AC（进入/不占 Tab/面包屑/readonly-live→replay/父子已删/钉 Tab/L2+L3）均有真实执行证据；独立 V-IND-1..5 + `run-phase4-l2-l3.sh` 通过。Reviewer Should-Fix（Continue chrome 反转等）未修，登记为 DEBT-007..010（🟡非阻塞）；AC-40 Must「结束后只读回放」已满足，Continue 顶栏属 Should。

## 测试执行矩阵

| 场景 | 来源 | 命令 | 结果 | 证据 |
|------|:--:|------|:--:|------|
| AC-35/37 进入子不占 Tab | spec VP-4-sub | `bash .../run-phase4-l2-l3.sh` | ✅ | vitest 12/12；`contextSessionId` + Tab 数不变 |
| AC-36 nav/back | spec | L2/L3 phase4.spec | ✅ | 清 context；`panel/state` 回父 |
| AC-39 banner + 卡片已结束 | spec | L2/L3 | ✅ | 「子代理运行中」→ clear；卡片「已结束，可进入回放」 |
| AC-40/71 只读实时→回放 | spec | L2/L3 + **V-IND-5** | ✅ | `readonly-live` + reject；结束→`replay`；live append |
| AC-38/78/79 钉 Tab | spec | L2/L3 + **V-IND-1** | ✅ | pin +1 Tab；AC-78 激活已有；AC-79 恢复父 |
| AC-74 子已删不可入 | spec | L2/L3 + **V-IND-2** | ✅ | `outcome:'deleted'`；文案「子会话已删除」 |
| AC-75 父已删面包屑禁用 | spec | L2/L3 | ✅ | `parentDeleted:true`；nav/back disabled；子 Tab 保留 |
| AC-54/84 L2+L3 门禁 | spec | `run-phase4-l2-l3.sh` | ✅ | FakeWebview；exit 0；tsc 0 |
| 回归 vitest | verifier | `vitest run apps/vscode-dsh/tests` | ✅ | 20 files / **92 tests** |
| tsc | build | `tsc -p apps/vscode-dsh --noEmit` | ✅ | exit 0 |

## 独立验证场景（你自己设计的）

| 场景 | 命令 | 结果 |
|------|------|:--:|
| **V-IND-1** 进入子（不占 Tab）→ hydrate → **钉 Tab** 连续路径（Tab+1、清 context、父 active、`pinnedSubagent`） | `tsx .../verifier-independent-phase4.mts` | ✅ |
| **V-IND-2** 先进入再 back，**之后** markDeleted，再 open 拒入（implementer 仅测删前拒入） | 同上 | ✅ |
| **V-IND-3** Continue chrome 反转探针：Host `enabled` vs `panel/state.continue=hidden`（DEBT-007） | 同上 | ✅（债确认） |
| **V-IND-4** 参数变化 open(A)/open(B) → 不同 `contextSessionId`（桩探测） | 同上 | ✅ |
| **V-IND-5** `readonly-live` 下子 `session.event` → FakeWebview `messages/append`（无子 Tab） | 同上 | ✅ failed=0 |

独立脚本：`.specdev/specs/vscode-dsh-conversation-ui/phases/phase-4-subagent-enter-pin/test-scripts/verifier-independent-phase4.mts`

## Reviewer 建议的验证场景

| 场景 | 命令 | 结果 |
|------|------|:--:|
| 复跑 `run-phase4-l2-l3.sh` | L2/L3 | ✅ 12/12 + tsc |
| Continue chrome 反转独立探针 | V-IND-3 | ✅ 复现并记债 DEBT-007 |
| 扩展 vitest 回归 | vitest apps/vscode-dsh/tests | ✅ 92/92 |
| Should-Fix 其余项 | 对照 review + 代码 | 📋 记债 DEBT-008..010（未强制修） |

## 端到端验证

| 数据路径 | 结果 | 证据 |
|----------|:--:|------|
| `subagent.started` → 父卡片 → `nav/open-subagent` → `contextSessionId` + `messages/replace`（Tab 不变） | ✅ | V-IND-1 / L2 |
| `action/pin-subagent` → 子 Tab + `pinnedSubagent` + 父视图恢复 | ✅ | V-IND-1 |
| 运行中 context → 子 `session.event` → `messages/append` + composer reject | ✅ | V-IND-5 |
| 结束后 context → `mode:replay`；删子后再入拒入 | ✅ | L2 + V-IND-2 |
| 父删 → 子 Tab 保留 + `breadcrumb.parentDeleted` | ✅ | phase4.spec AC-75 |

## 残余风险

| 风险 | 严重性 | 说明 |
|------|:--:|------|
| DEBT-007 Continue chrome 反转：父/已钉子 **replay** 顶栏 Continue 被 hidden | 🟢 LOW | AC-40 Should / Phase 3 顶栏 UX；Host `continueChromeForTab` 仍 enabled；非 Must「只读回放」失败 |
| DEBT-008 context 子 Continue 未绑子 session | 🟢 LOW | 可用「先钉再 Continue」规避 |
| DEBT-009 删子卡片文案延迟 | 🟢 LOW | 门禁拒入已验证 |
| DEBT-010 `pinnedSubagent` 只写不读 | 🟢 LOW | 运行期靠 getBySessionId；重启钉态语义缺口 |

无 CRITICAL / MEDIUM 残余风险（Should 项已登记非阻塞债）。

## 为什么不是 PARTIAL / FAIL

- Must 进入、不占 Tab、面包屑、readonly-live→replay、父子已删、钉 Tab、L2+L3 均有执行证据 ✅
- Continue chrome 属 AC-40 **Should**，已记 DEBT-007，不降级 Must 验收
- 无端到端断裂、无 CRITICAL

## Pipeline 合规检查

- 当前分支：`impl-phase-4-subagent-enter-pin`
- `packages/core/agent-loop` 无改动
- Phase 产品改动均在该 `impl-*` 工作区（未提交，符合「implementer 不自行 commit」）
- Pipeline compliance: ✅ 所有变更在 impl-* 分支

## 验证脚本

| 脚本 | 用途 |
|------|------|
| `test-scripts/run-phase4-l2-l3.sh` | AC-54/84 门禁（implementer） |
| `test-scripts/verifier-independent-phase4.mts` | V-IND-1..5 |
| `test-scripts/run-verifier-phase4.sh` | 聚合：L2/L3 + V-IND + 全量 vitest + tsc |

### 复跑命令

```bash
bash .specdev/specs/vscode-dsh-conversation-ui/phases/phase-4-subagent-enter-pin/test-scripts/run-verifier-phase4.sh
# 或分步：
bash .specdev/specs/vscode-dsh-conversation-ui/phases/phase-4-subagent-enter-pin/test-scripts/run-phase4-l2-l3.sh
PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" ./node_modules/.bin/tsx \
  .specdev/specs/vscode-dsh-conversation-ui/phases/phase-4-subagent-enter-pin/test-scripts/verifier-independent-phase4.mts
```
