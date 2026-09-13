# Design Consistency Review — Phase 3 (phase-3-activity-stream)

## 视角
**Design Consistency** — 代码是否遵循架构设计

## 判决
**PASS**

## 架构决策对照

| design.md 决策 | 实现是否遵循 | 证据 | 判定 |
|:---|:---|------|:--:|
| AD-CUX-1 呈现态下放 + 探针；决策态留 Host | 是 | 展开/折叠在 Webview 本地 + `probes.setActivity`；`action/toggle-activity` Host **ack no-op**（不写入 MessageStore / 不改 mode）；`mode`/send 仍 Host；未触碰 `parentReadonly`/`continueSealed`（GAP-CUX-002 → phase-5） | ✅ |
| AD-CUX-2 层 A = 抽离 render/sync + jsdom | 是 | 新增 `render/activity-dom.ts` + `activityDomBrowserSource()`；provider 嵌入后 `renderBubble` 调 `renderActivityBubble`；`tests/layer-a/activity-stream.spec.ts` 直接 import 模块，非整页 `runScripts` 主路径 | ✅ |
| AD-CUX-3 I-真 cancel（phase-2）+ 本 Phase AC-13c | 是 | 复用既有 cancel 路径；`abortRunningActivities` 挂在 `markTurnIncomplete`；层 B 断言无 auto-revert；未改 agent-loop | ✅ |
| 活动模型 `ActivityItem` / `ActivityStatus` | 是 | `activity-types.ts` 字段与 design 实体一致（id/sessionId/turn/ordinal/toolName/callId/status/expanded/summary）；状态机 `running → done\|failed\|aborted` | ✅ |
| `ChatMessage.kind` 含 `'activity'` | 是 | `message-store.ts` 扩展 kind + `activity?` + `MessagePatch.activityStatus` | ✅ |
| W→H `action/toggle-activity`（呈现态可本地） | 是 | protocol 已声明；Webview postMessage；Host 仅 ack——与 design「呈现态可本地，同步探针」语义一致（探针在 Webview 侧同步） | ✅ |
| 抽离清单 `activity-dom.ts`（层 A 入口） | 是 | 路径与命名符合 design「抽离渲染模块」树；barrel `render/index.ts` 导出 | ✅ |
| AD-CUX-7 T6 锁定 B | 是 | 本 Phase 未引入 thinking/reasoning UI；既有 `reasoning-delta` ignore 保留 | ✅ |
| AD-CUX-8 / phase-4 diff 抽离 | 是（未越界） | 无 `change-diff-dom.ts`；change-list / diff-summary 仍 provider 内联；DEBT-CUX-001 仍活跃指向 phase-4 | ✅ |
| AD-CUX-5 / phase-5 fork | 是（未越界） | 无 `fork-orchestrator` / `forkFromClosedTurn` 产品路径；GAP-CUX-002 仍活跃 | ✅ |
| AD-CUX-11 ref-cards | 是（未越界） | 无 `ref-cards.ts`；未新写 @ 文法产品化 | ✅ |
| Timeline 弱化、不作主阅读面 | 是 | 活动主路径走 MessageStore `kind:'activity'`；Timeline 未改作主面 | ✅ |
| Constitution §7.1 可脚本渲染 Must | 是 | 层 A 折叠/状态/归组用例绿；抽离模块为断言入口 | ✅ |
| Constitution §7.2 决策/呈现边界 | 是 | 见 AD-CUX-1 行 | ✅ |
| Constitution §7.3 无中断自动 revert；无 thinking | 是 | cancel→aborted 不调 revert；无 thinking UI | ✅ |
| GAP-CUX-001 关闭 | 是 | 产品路径 `renderActivityBubble` / `applyActivityStatus` / `applyActivityExpanded` 调用 `setActivity`；registry 移入「已解决」 | ✅ |

## 模块/命名/结构审查

### 目录合理性

| 新文件 | 所在目录 | 是否合理 | 说明 |
|--------|---------|:--:|------|
| `activity-dom.ts` | `chat-panel/render/` | ✅ | 与 design 层 A 树一致 |
| `activity-types.ts` | `chat-panel/` | ✅ | 共享实体供 store/controller/hydrator/dom；非仅 DOM 职责 |
| `activity-stream.spec.ts` | `tests/layer-a/` | ✅ | 层 A 约定路径 |
| `chat-ux-activity-stream.spec.ts` | `tests/` | ✅ | 层 B Host 路径 |

### 命名规范审查

| 文件/符号 | 实际命名 | 应遵循规范 | 判定 |
|-----------|---------|-----------|:--:|
| 模块文件 | `activity-dom.ts` / `activity-types.ts` | kebab-case | ✅ |
| 状态类型 | `ActivityStatus` / `ActivityItem` | design PascalCase 实体 | ✅ |
| DOM 契约 | `data-kind=activity` / `data-status` / `data-expanded` / `data-turn` / `data-ordinal` | 与既有 `applyMessageIdentity` + AC 契约 | ✅ |
| 协议帧 | `action/toggle-activity` / `messages/patch.activityStatus` | design 帧名；`activityStatus` 为 phase-3 对 patch 的合理增量（不破坏 AD-CUX-10 text XOR） | ✅ |
| 稳定 id | `activity:${sessionId}:t${turn}:${callId\|ordN}` | 设计要求稳定节点身份；callId 优先 join | ✅ |

### Constitution §2 检查

| 条款 | 内容 | 是否违反 | 说明 |
|------|------|:--:|------|
| §2.1 单一职责 | 模块做一件事 | ✅ | types / DOM / Host 投影 / hydrate fold 分层清晰 |
| §2.2 依赖方向 | 核心不依赖外围 | ✅ | 投影在 `conversation-controller`；DOM 在 chat-panel/render；未反向拉 core/agent-loop |
| §2.3 接口隔离 | 明确接口 | ✅ | MessageStore patch + protocol + probes 边界清楚 |

## 检查重点结论

### 1. 呈现态 vs 决策态
- **展开**：Webview 本地 DOM + probes；Host 不权威改写 → 符合 §7.2 / AD-CUX-1。
- **状态机终态**：由 Host 投影 `tool/result` + `turn/end` fail-closed abort → 生命周期权威在 Host，探针为可观测呈现镜像 → 符合「活动项状态」探针要求且未把 mode/send 下放。
- **implementation 偏差说明**（toggle Host ack）与 design 表注「呈现态可本地」一致，不构成架构偏离。

### 2. activity-dom 抽离与层 A
- 抽离位置、browser dual-source 嵌入模式与 phase-1 `message-dom` 惯例一致。
- 层 A 直接 import 抽离模块断言默认折叠/展开/状态/同 turn 归组。

### 3. 状态机与 cancel 语义
- 映射：`ABORTED` / `ABORTED_BEFORE_DISPATCH` → `aborted`；`isError` → `failed`；else → `done`。
- cancel：`markTurnIncomplete` → `abortRunningActivities`；不自动 revert；回放 `foldActivities` 对 residual running 同样 abort。

### 4. 未越界 phase-4 / phase-5
- 无 `ref-cards` / `change-diff-dom` / fork 编排落地；DEBT-CUX-001、GAP-CUX-002 仍按目标 Phase 挂起。
- 本 Phase 仅用 `data-turn` 完成活动↔change-list 同组契约（AC-25），符合 spec Out of scope。

### 5. GAP-CUX-001
- 关闭方式与设计一致：产品渲染/patch 路径填实 `probes.activity`，而非仅保留座位 API；registry 记录与代码路径一致。

## 关键发现

### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
（无）

### 🟢 Observations
- `messages/patch` 的 design API 表未显式列出 `activityStatus`；实现增量为活动状态同步所必需，且不破坏 AD-CUX-10。可在后续修订 design 协议表时补一行（非本 Phase 阻塞）。
- `activity-dom` 维持 TS 模块 + `activityDomBrowserSource()` 字符串双份（与 `message-dom` 同模式）；provider 已调用抽离函数，未新增 change-list 式 DEBT。
- Host 对 `action/toggle-activity` 为 ack no-op：符合呈现态边界；MessageStore 中 `activity.expanded` 保持默认 false、展开以 probes/DOM 为准——与「呈现态可本地」一致。

## 详细报告路径
- `.specdev/specs/vscode-dsh-chat-ux/phases/phase-3-activity-stream/review-design.md`
