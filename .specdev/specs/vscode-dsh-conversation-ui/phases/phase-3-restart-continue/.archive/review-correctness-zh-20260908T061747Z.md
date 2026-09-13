# 正确性审查 — phase-3-restart-continue

## 视角
**实现正确性** — 代码是否正确工作

## 判决
**SHOULD-FIX**

## 独立验证

| 命令 | 结果 |
|------|------|
| `bash .../test-scripts/run-phase3-l2-l3.sh` | exit 0；3 个文件 / **24 个测试通过** |
| `vitest run apps/vscode-dsh/tests packages/ide/ide-bridge/tests/ide-bridge.spec.ts` | exit 0；20 个文件 / **90 个测试通过** |

## 逐条 AC 验证

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-33 | 恢复未关 Tab；一律 replay；无自动 prompt；空 Tab 剔除 | `restore-planner.ts:38-89`；`conversation-controller.ts:277-399` | ✅ | `planRestoreOpenTabs` 强制 `mode=replay`；无内容 → `stripped`；写回 sanitized index；测试断言无自动 prompt |
| AC-69 | 未就绪 waiting-host；就绪后重建 | `conversation-controller.ts:294-301,792-800`；`extension.ts:208-219` | ✅ | 断开 → `waiting-host`；`startSession` 在 connect 后 `restoreOpenTabSet` → hydrate + `messages/replace` / `replay` |
| AC-70 | UI 限 N；索引全保留；查看更多 | `restore-planner.ts`；`restoreMoreTabs`；`action/restore-more` | ✅ | `indexSet` 全量、`uiSet≤N`、`deferred`；命令与 Host 协议存在 |
| AC-34 | 活动 Tab 优先入 UI 并聚焦 | `restore-planner.ts:73-79`；`switchTo` | ✅ | active 先入 `uiSet` 并聚焦；测试覆盖 |
| AD-CU-4 立即持久化 | openTabSet/mode/active 立即写 | `writeImmediate` / `persistOpenTabs` | ✅ | 变更即写 workspaceState；测试 writeCount 增加 |
| AC-76 | Diff 门禁；禁工作区冒充 | `recoverableDiffsFromMeta`；`openTimelineDiff` | ✅ | 缺 oldText → 不可用；双侧 `dsh-diff`；无 `Uri.file` |
| Diff before（AD-CU-6） | 仅补丁无法重建 → 不可用 | 同上 | ✅ | patch-only 拒绝；不读磁盘 |
| AC-77 | 不完整回合标「已停止/未完成」 | `detectIncomplete` + hydrate notice | ✅ | open turn / interrupted → `incomplete` + 文案 |
| AC-68 / AD-CU-8 | T-0b PASS 交付；四态 chrome | `continue-capability.ts`；Continue 命令 | ⚠️ | Gate=same-id；四态逻辑与 L2 通过；**Webview 未绑定顶栏 Continue**（见 Should-Fix） |
| AC-32 | 同 tabId replay→live | `continueConversation` | ✅ | resume 后同 tabId `setMode(live)`；L3 FakeWebview 覆盖 |
| AC-66 | 不改写旧权威前缀 | same-id resume + 同 sessionId follow-up | ✅ | 不重写日志；无 create 旁路 |
| AC-67 | 派生 banner | banner 分支 + `continueLinkFromDerive` | ✅ | Gate 主路径 same-id；derive 钩子就绪 |
| AC-54 / AC-84 | L2 + L3 | phase3 脚本 + hooks | ✅ | 24 tests exit 0；Continue 因 T-0b PASS 纳入 |
| GAP-001 | session/resume 全链路 | bridge + sdkSessionResume + Host | ✅ | 已关闭；非空壳；测试 PASS |

## 桩代码检测

### 已注册桩
| Registry ID | 状态 | 说明 |
|-------------|:--:|------|
| （无活跃 STUB） | — | 活跃表为空 |
| GAP-001 | ✅ 已关闭 | 已在「已解决」 |

### 新发现未注册桩
无。

## 关键发现

### 🔴 Must-Fix
无。

### 🟡 Should-Fix
1. **Webview 未消费 Continue / 查看更多 chrome** — HTML 忽略 `panel/state.continue` 与 `deferredRestoreCount`；Host/命令/L2·L3 正确，真实渲染属 L4，但产品称「顶栏 Continue」。建议绑定 UI 或文档标明仅命令入口。
2. **`readSessionLog` 失败当空 Tab 永久剔除** — `catch` 填空 → strip + 写回 openTabSet，瞬时失败会丢恢复索引行。建议保留/重试，勿当 empty。

### 🟢 Observations
- GAP-001：`resumeSession` → bridge → `sdkSessionResume` → `agents.resume` + Map 登记完整。
- AC-69 自动重建由 `startSession` 编排，非 status 监听器。
- patch-only Diff 走「不可用」，符合 AD-CU-6。
