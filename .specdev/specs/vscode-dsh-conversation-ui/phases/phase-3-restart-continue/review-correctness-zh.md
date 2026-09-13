# 正确性审查 — phase-3-restart-continue（MUST-FIX loop2 复审）

## 视角
**实现正确性** — 代码是否正确工作

## 判决
**PASS**

## 独立验证

| 命令 | 结果 |
|------|------|
| `vitest …/phase3-restart-continue.spec.ts -t "restoreMoreTabs: read failure"` | **1 passed** / 12 skipped |
| `vitest …/phase3-restart-continue.spec.ts -t "DEBT-006\|restoreMoreTabs"` | **2 passed** / 11 skipped |
| `vitest …/phase3-restart-continue.spec.ts` | **13 passed**（13） |
| `bash …/test-scripts/run-phase3-l2-l3.sh` | **29 passed**（3 files） |

## Must-Fix 关闭核验（loop2 焦点）

| 项 | 代码证据 | 测试证据 | 关闭？ |
|----|---------|---------|:-----:|
| `restoreMoreTabs` 读失败回填 deferred | `conversation-controller.ts:484-505`：取出后非 `opened`/`activated` 则 `deferredRestore.push({ ...record })`，再 `persistOpenTabs()` | 回归：`failMoreReads` → deferred 仍为 `sess-more`，openTabSet 两行保留 → 二次冷启动仍见该 session | ✅ |
| `persistOpenTabs` 合并 deferred 不抹索引 | `938-942` 合并 `deferredRestore` | 同上 | ✅ |
| DEBT-006 主路径 | `346-381` loadFailed→deferred | DEBT-006 用例仍绿 | ✅ |

## 逐条 AC 验证

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-33 | 恢复未关 Tab；一律 replay；空 Tab 剔除 | restore + planner | ✅ | 强制 replay；空剔 |
| AC-69 | waiting-host → 就绪自动重建 | latch + status | ✅ | 自触发 restore |
| AC-70 | UI 限 N；索引全；查看更多 | planner + persist 合并 + **restoreMoreTabs 失败回填** | ✅ | loop2 焦点已闭合 |
| AC-34 | 活动优先 hydrate/聚焦 | planner + switchTo | ✅ | 活动优先 |
| AD-CU-4 | 立即持久化 | setOpenTabs / persist | ✅ | 即时写 |
| AC-76 / AD-CU-6 | Diff 门禁 | hydrator + diff-entry | ✅ | 禁磁盘冒充 |
| AC-77 | 不完整标记 | hydrator incomplete | ✅ | L2 |
| AC-68 / AD-CU-8 | Continue 四态 | chrome + Webview | ✅ | Gate 一致 |
| AC-32/66/67 | 原位升级 / 前缀 / derive | continue + resume | ✅ | L3 |
| AC-54 / AC-84 | L2+L3 | run-phase3-l2-l3.sh | ✅ | 29 绿 |

## Stub Detection（桩代码检测）

### 已注册桩（对照 registry）
| Registry ID | 文件:函数 | 状态 | 说明 |
|-------------|-----------|:--:|------|
| （无活跃 STUB） | — | — | DEBT-003..006 / GAP-001 均已解决 |

### 新发现的未注册桩
| 文件:函数:行号 | 当前行为 | 严重性 | 处理建议 |
|---------------|---------|:--:|---------|
| （无） | — | — | 失败回填为真实逻辑 |

## 关键发现

### 🔴 Must-Fix
- （无）— loop2 焦点（查看更多读失败丢索引）已修复并独立复跑通过。

### 🟡 Should-Fix
- （无）

### 🟢 Observations
- `error` / `host-not-ready` / `missing` 统一回填；瞬时失败与 Host 未就绪正确。已删会话 `missing` 也会回队，偏保守，符合「未进 UI ≠ 丢索引」。
- `all=true` 多行失败各自回填；已在 registry 的 session 不重复入 deferred。
