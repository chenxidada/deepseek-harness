# Design Consistency Review — Phase 4 (phase-4-refs-changes-diff)

## 视角
**Design Consistency** — 代码是否遵循架构设计

## 判决
**PASS**

## 架构决策对照

| design.md 决策 | 实现是否遵循 | 证据 | 判定 |
|:---|:---|------|:--:|
| **AD-CUX-11** 引用解析复用 `at-path` / AD-CCD-11；`ref-cards` 只渲染 | 是 | `ref-cards.ts` 仅 `import { extractAtPathTokens }` + DOM；`atPathExtractBrowserSource()` 嵌入 Webview；provider 删除本地 `@` 正则；composer/sent/replay 经 `syncComposerRefCards` / `fillUserBubbleWithRefCards` / 同一 `segmentTextWithRefs` | ✅ |
| **AD-CUX-8 / T8** 默认内联 + 显式原生；diff 数据复用 `change/get-diff`\|`diff-content`；`change-diff-dom` 只渲染壳 | 是 | 展开 → `change/get-diff` → `fillChangeDiffPane`（`textContent`，无本地 diff 引擎）；显式 → `change/open-native-diff` → Host → `openChangeSnapshotDiff`（`vscode.diff` / SnapshotStore） | ✅ |
| **DEBT-CUX-001** change-list/diff 抽离到 `change-diff-dom.ts`，消除 provider 双路径 | 是 | 新增 `change-diff-dom.ts` + `changeDiffDomBrowserSource()`；`renderBubble` 调 `renderChangeListBubble` / `renderDiffSummaryBubble`；registry 已移入「已解决」 | ✅ |
| **R5** 共享解析，禁止三处分叉正则 | 是 | Host/`segmentTextWithRefs`/`syncComposerRefCards` 同源 `extractAtPathTokens`；Webview 嵌入 `atPathExtractBrowserSource`（同文件镜像）；层 A 断言 Host token ≡ segment 路径 | ✅ |
| **§7.2 / 修订 AD-CU-1** 呈现态可下放；决策态留 Host | 是 | 内联展开/折叠、composer chips 为 Webview 呈现；`change/mark-reviewed`/`revert`/`open-native-diff`/`get-diff` 均 postMessage→Host；send/`mode` 未下放；发送仍纯 `@path` 文本 + Host `validateComposerAtPaths` | ✅ |
| **§7.1** 层 A = 抽离模块 + jsdom Must | 是 | `tests/layer-a/refs-changes-diff.spec.ts` 直接 import `ref-cards` / `change-diff-dom` / `at-path`；非整页 `runScripts` 主路径 | ✅ |
| **§7.3** 无 thinking；无档 3；不改 agent-loop | 是 | 本 Phase 未引入 thinking UI / 搜索正文库 / agent-loop | ✅ |
| **AD-CUX-5 / phase-5 fork** 未越界 | 是 | 无 `forkFromClosedTurn` / P-接续 / P-标明 产品落地；**GAP-CUX-002 仍活跃** → phase-5 | ✅ |
| **AD-CUX-9 / phase-6 搜索** 未越界 | 是 | 无 path→session 索引 / `searchSessions` 档 2 产品改动 | ✅ |
| Timeline 弱化（AC-44） | 是 | 未把助手长文主投影迁 Timeline；层 B 回归保护既有 truncate | ✅ |

## 模块/命名/结构审查

### 目录合理性

| 新文件 | 所在目录 | 是否合理 | 说明 |
|--------|---------|:--:|------|
| `ref-cards.ts` | `chat-panel/render/` | ✅ | 与 design 抽离树一致；只渲染 |
| `change-diff-dom.ts` | `chat-panel/render/` | ✅ | DEBT-CUX-001 / AD-CUX-8 目标路径 |
| `atPathExtractBrowserSource` | `code-context/at-path.ts` | ✅ | 权威文法所在模块导出 browser mirror，符合 AD-CUX-11「不新写文法」 |
| `openChangeSnapshotDiff` | `diff-entry.ts` | ✅ | 复用既有 virtual `dsh-diff` 模式，非第二套引擎 |
| `refs-changes-diff.spec.ts` | `tests/layer-a/` | ✅ | 层 A 约定 |
| `chat-ux-refs-changes-diff.spec.ts` | `tests/` | ✅ | 层 B |

### 命名规范审查

| 文件/符号 | 实际命名 | 应遵循规范 | 判定 |
|-----------|---------|-----------|:--:|
| 模块 | `ref-cards.ts` / `change-diff-dom.ts` | kebab-case + design 示意名 | ✅ |
| BrowserSource | `refCardsBrowserSource` / `changeDiffDomBrowserSource` / `atPathExtractBrowserSource` | 与 `activityDomBrowserSource` 姊妹模式 | ✅ |
| DOM 契约 | `data-testid=ref-card` / `change-list-expand` / `change-list-open-native-diff` / `change-diff-pane` | 既有 change-list + AC 可断言 | ✅ |
| 协议帧 | `change/get-diff`、`change/open-native-diff` | AD-CUX-8 要求复用 `change/*`；与 design 表「`action/open-*`」示意名有字面差，但落在既有 change 命名空间更贴合 AD 正文 | ✅（见表注） |
| 归属 | `applyMessageIdentity` → `data-turn` | phase-3 同组契约延续 | ✅ |

> **表注**：design「API 域」表写 `action/open-inline-diff` / `action/open-native-diff`，而 AD-CUX-8 正文要求复用 `change/get-diff`｜`diff-content`。实现按 AD 正文 + 既有 CCD `change/*` 落地（原生帧为 `change/open-native-diff`）。属设计表与 AD 示意命名软差，**实现选择正确**，不构成违反架构决策。

### Constitution §2 检查

| 条款 | 内容 | 是否违反 | 说明 |
|------|------|:--:|------|
| §2.1 单一职责 | 模块做一件事 | ✅ | `at-path`=解析；`ref-cards`=卡 DOM；`change-diff-dom`=变更/diff 壳；Host/extension=权威数据与原生打开 |
| §2.2 依赖方向 | 核心不依赖外围 | ✅ | render → code-context；未反向拉 core/agent-loop；未改 `packages/core` |
| §2.3 接口隔离 | 明确接口 | ✅ | Webview 只 post `change/*` / `action/open-reference`；diff 正文来自 Host `change/diff-content` |

## 检查重点结论

### 1. DEBT-CUX-001 抽离是否符合 AD
- 目标文件、`*BrowserSource` 嵌入、provider `renderBubble` 调用 extracts 的模式与 phase-1/3（`message-dom` / `activity-dom`）一致。
- 内联 change-list / diff-summary / inline-pane HTML 双路径已消除；CSS 留在 provider 合理（呈现壳）。
- Registry 关闭记录与代码一致；**未误关 GAP-CUX-002**。

### 2. 共享解析（AD-CUX-11 / R5）
- 权威文法仍在 `code-context/at-path.ts`；`ref-cards` 不发明第二套 `@` 正则。
- 三处呈现入口：composer chips、已发 user bubble、回放（同 `fillUserBubbleWithRefCards` 路径）共用解析。
- Composer 为 textarea 上方 chip 条（非 contenteditable）属 **documented presentation choice**，与 exploration「presentation-owned chips、send 仍纯文本」假设一致；Host 门禁不变 → 不违反 AD。

### 3. 呈现 / 决策边界（§7.2）
- 展开折叠、chip 同步 = 呈现态。
- 审阅/撤销/取 diff/开原生 Diff/开引用 = Host 决策或权威数据通道。
- Webview 不裁决 `mode`/能否发送；AC-45 回放 reject 路径未改坏。

### 4. 未越界 phase-5 / phase-6
- 无 fork 编排、无 P-接续/P-标明、无 path→session 搜索索引。
- `parentReadonly` / `continueSealed` 仅既有探针镜像座位，产品推送仍属 GAP-CUX-002。

## 关键发现

### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
（无）

### 🟢 Observations
- **Composer chip 呈现**：textarea + `#composer-ref-cards` 条，非 contenteditable 内嵌卡；implementation 已记偏差，与 AD-CUX-11「只渲染 + 共享解析」兼容。
- **原生 Diff 按钮位置**：行级 `change-list-open-native-diff`（非仅 pane 内）；exploration R10 未钉死，AD-CUX-8 只要求显式入口存在。
- **BrowserSource `/u` 旗标**：TS `extractAtPathTokens` 用 `/gu`，`atPathExtractBrowserSource` 嵌入为 `/g`。同模块同源镜像惯例下对常见 `@path` 无产品影响；若追求注释「byte-identical」可后续对齐旗标（非本 Phase 架构违反）。
- **design 协议表示意名**：`action/open-*` vs 落地 `change/open-native-diff` — 以实现服从 AD-CUX-8 正文为准（见上表注）。

## 产出路径
`.specdev/specs/vscode-dsh-chat-ux/phases/phase-4-refs-changes-diff/review-design.md`
