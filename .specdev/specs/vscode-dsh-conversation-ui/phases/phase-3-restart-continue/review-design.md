# Design Consistency Review — phase-3-restart-continue（MUST-FIX loop2 复审）

## 视角
**Design Consistency** — 代码是否遵循架构设计

## 判决
**PASS**

## 本轮焦点：`restoreMoreTabs` 失败回填 × AD-CU-10

| 检查项 | 设计要求 | 实现是否遵循 | 证据 | 判定 |
|:---|:---|:---|------|:--:|
| **AD-CU-10 / AC-70** 索引永久保留；未进 UI ≠ 丢索引 | 「查看更多」读失败后，session 仍须留在耐久 `openTabSet` | 是 | `restoreMoreTabs`：`shift`/`splice` 取出后，非 `opened`/`activated` 时 `deferredRestore.push({ ...record })`，再 `persistOpenTabs()` | ✅ |
| **AD-CU-10** 与 `persistOpenTabs` 合并 | 耐久索引 = UI registry（有内容）∪ deferred | 是 | `persistOpenTabs` 仍按 `sessionId` 去重合并 `deferredRestore`；失败回填后该行重新进入合并集 | ✅ |
| **AD-CU-4** 立即持久化 | 变更后立刻写 `workspaceState` | 是 | 回填后调用 `persistOpenTabs()` → `index.setOpenTabs`；回归断言读失败后 index 仍含两行 | ✅ |
| **AD-CU-3** 空剔边界 | 瞬时读失败 ≠ 空 Tab 剔除 | 是 | `error` / `host-not-ready` / `missing` 走回填，不因失败空剔；与 restore 主路径 `loadFailed` 语义一致 | ✅ |
| **回归覆盖** | 查看更多 + 读失败 → 二次冷启动仍见 session | 是 | `phase3-restart-continue.spec.ts`：`failMoreReads` → `deferredSessionIds===['sess-more']` → 新 controller 仍见 `sess-more` | ✅ |

上一轮 MUST-FIX（`restoreMoreTabs` 消费 deferred 后失败不回队 → `persistOpenTabs` 缩水 `openTabSet`）已闭合。

## 架构决策对照（本 Phase 仍有效）

| design.md 决策 | 实现是否遵循 | 证据 | 判定 |
|:---|:---|------|:--:|
| **AD-CU-1**：极薄 Webview；跟 Host `panel/state` | 是（本轮未改） | Continue / 查看更多仅 `postMessage`；chrome 跟 Host | ✅ |
| **AD-CU-3/10**：空剔；UI 限 N；活动优先；索引全保留 | 是 | planner + deferred 合并 + **restoreMoreTabs 失败回填** | ✅ |
| **AD-CU-4**：每次变更立即写 | 是 | 回填后立即 `persistOpenTabs` | ✅ |
| **AD-CU-5**：冷恢复新 `tabId`；Continue 同打开期同 `tabId` | 是（本轮未改语义） | registry `replay`；continue → `live` | ✅ |
| **AD-CU-6**：Diff 仅权威 `meta.diffs` | 是（本轮未改） | 既有 hydrator / dsh-diff | ✅ |
| **AD-CU-8**：Continue 四态 | 是（本轮未改） | `continueChromeFor` / Host chrome | ✅ |
| **AD-CU-12**：不改 `agent-loop` | 是 | 仅 `conversation-controller.ts` + 测试 + registry 说明 | ✅ |

## 模块/命名/结构审查

### 目录合理性
| 新/改文件 | 所在目录 | 是否合理 | 说明 |
|--------|---------|:--:|------|
| `conversation-controller.ts` | `apps/vscode-dsh/src/` | ✅ | 恢复编排与 deferred 生命周期属产品 Host |
| `phase3-restart-continue.spec.ts` | `apps/vscode-dsh/tests/` | ✅ | 与既有 VP / DEBT 回归同文件 |

### 命名规范审查
| 文件/符号 | 实际命名 | 应遵循规范 | 判定 |
|-----------|---------|-----------|:--:|
| 失败回填 | `deferredRestore.push({ ...record })` | 语义对齐「未进 UI ≠ 丢索引」 | ✅ |
| 方法注释 | 标明 DEBT-006 / restore-more path | 与 tech-debt-registry 一致 | ✅ |

### Constitution §2 检查
| 条款 | 内容 | 是否违反 | 说明 |
|------|------|:--:|------|
| §2.1 单一职责 | 每模块做一件事 | ✅ | 回填仍在 controller 恢复路径内，未扩散职责 |
| §2.2 依赖方向 | 核心不依赖外围 | ✅ | 未改核心；扩展仍 → bridge |
| §2.3 接口隔离 | 经明确接口交互 | ✅ | 未改 Webview/Host 协议面 |

## 关键发现

### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
（无）

### 🟢 Observations
- **`missing` 也回填**：与上一轮 MUST-FIX 文案一致（非成功 outcome 一律回队）。若 session 已墓碑删除，长期留在 deferred/`openTabSet` 属 AD-CU-3 删除语义的边缘；当前保守保留符合「不丢索引」优先，非本轮 AD-CU-10 违规。
- **成功路径双重 persist**：`openFromHistory` 内部已 `persistOpenTabs`，`restoreMoreTabs` 末尾再调一次——对 AD-CU-4 无害，保证失败回填后也落盘。
- **DEBT-003..005**：本轮未回退；`persistOpenTabs` 合并 deferred、薄 Webview chrome、Host 就绪自触发恢复仍在。

## 详细证据索引
- `apps/vscode-dsh/src/conversation-controller.ts` — `restoreMoreTabs`（失败 `push` 回 `deferredRestore`）+ `persistOpenTabs`
- `apps/vscode-dsh/tests/phase3-restart-continue.spec.ts` — `restoreMoreTabs: read failure requeues deferred…`
- design.md — AD-CU-10 / AC-70；AD-CU-3 / AD-CU-4
