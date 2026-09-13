# Correctness Review — phase-3-restart-continue（MUST-FIX loop2 复审）

## 视角
**Implementation Correctness** — 代码是否正确工作

## 判决
**PASS**

## 独立验证

| 命令 | 结果 |
|------|------|
| `vitest …/phase3-restart-continue.spec.ts -t "restoreMoreTabs: read failure"` | **1 passed** / 12 skipped |
| `vitest …/phase3-restart-continue.spec.ts -t "DEBT-006\|restoreMoreTabs"` | **2 passed** / 11 skipped |
| `vitest …/phase3-restart-continue.spec.ts` | **13 passed** (13) |
| `bash …/test-scripts/run-phase3-l2-l3.sh` | **29 passed** (3 files) |

## Must-Fix 关闭核验（loop2 焦点）

| 项 | 代码证据 | 测试证据 | 关闭？ |
|----|---------|---------|:-----:|
| `restoreMoreTabs` 读失败回填 deferred | `conversation-controller.ts:484-505`：`shift`/`splice` 取出后，非 `opened`/`activated` 则 `deferredRestore.push({ ...record })`，再 `persistOpenTabs()` | 回归：`failMoreReads` → `deferredSessionIds===['sess-more']`、`openTabSet` 仍含两行 → 新 controller 冷启动仍见 `sess-more` | ✅ |
| `persistOpenTabs` 合并 deferred 不抹索引 | `938-942` 遍历 `deferredRestore` 写入 `openTabSet` | 同上断言 `index.read().openTabSet` 排序含 `sess-more` | ✅ |
| DEBT-006 主路径（restore 读失败不空剔） | `346-381` `loadFailed`→deferred；二次 `restoreOpenTabSet` | DEBT-006 用例仍绿 | ✅ |

## 逐条 AC 验证

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-33 | 恢复未关 Tab；一律 replay；无自动 prompt；空 Tab 剔除 | `restoreOpenTabSetBody` + `planRestoreOpenTabs` | ✅ | 强制 replay；空 content → stripped；无自动 prompt |
| AC-69 | 未就绪 waiting-host；就绪后自动重建 | latch + `onStatusChange` / `startSession` | ✅ | waiting-host → connected 自触发 restore；L3 有 messages/replace |
| AC-70 | UI 限 N；索引全保留；查看更多 | planner + `persistOpenTabs` 合并 deferred + `restoreMoreTabs` 失败回填 | ✅ | 限 N 时 deferred 保留；**查看更多读失败不再丢 openTabSet**（loop2） |
| AC-34 | 活动 Tab 优先入 UI 并聚焦 | planner active-first；hydrate 后 `switchTo` | ✅ | hydrated 活动优先 |
| AD-CU-4 立即持久化 | 变更立即写 workspaceState | `setOpenTabs` / `persistOpenTabs` | ✅ | 非仅 deactivate |
| AC-76 / AD-CU-6 | Diff 门禁；禁工作区冒充 | `recoverableDiffsFromMeta`；`openTimelineDiff` | ✅ | patch-only→不可用；无磁盘冒充 |
| AC-77 | 不完整「已停止/未完成」 | hydrator `incomplete` | ✅ | L2 夹具覆盖 |
| AC-68 / AD-CU-8 | Continue 四态 | `continueChromeForTab` + Webview | ✅ | Gate same-id；FAIL→hidden |
| AC-32/66/67 | 同 tabId 升级；不改前缀；derive banner | `continueConversation` + resume | ✅ | L3 FakeWebview |
| AC-54 / AC-84 | L2+L3 门禁 | `run-phase3-l2-l3.sh` | ✅ | 29 tests pass |

## Stub Detection（桩代码检测）

### 已注册桩（对照 registry）
| Registry ID | 文件:函数 | 状态 | 说明 |
|-------------|-----------|:--:|------|
| （无活跃 STUB） | — | — | 活跃表空；DEBT-003..006 / GAP-001 均在「已解决」 |

### 新发现的未注册桩
| 文件:函数:行号 | 当前行为 | 严重性 | 处理建议 |
|---------------|---------|:--:|---------|
| （无） | — | — | `restoreMoreTabs` 失败分支为真实回填逻辑，非空壳 |

## 关键发现

### 🔴 Must-Fix
- （无）— 上一轮 Should-Fix / connectivity Must-Fix（`restoreMoreTabs` 读失败丢 deferred）已用真实 `push` 回队 + 回归闭合；独立复跑绿。

### 🟡 Should-Fix
- （无）

### 🟢 Observations
- 非成功 outcome（`error` / `host-not-ready` / `missing`）统一回填；对瞬时读失败与 Host 未就绪路径正确。`missing`（已删会话）也会回队，属偏保守，不违反 AC-70「未进 UI ≠ 丢索引」。
- `all=true` 时对 `take` 中每一失败行分别 `push`，多行失败不会只丢一部分。
- 已在 registry 的 session（`getBySessionId` 命中）直接 `continue`，不回填，避免重复 deferred。
