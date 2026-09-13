# Correctness Review — phase-4-refs-changes-diff

## 视角
**Implementation Correctness** — 代码是否正确工作

## 判决
**PASS**

## 逐条 AC 验证

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-40 | 输入框结构化引用以引用卡呈现 | `ref-cards.ts:syncComposerRefCards`；provider `#composer-ref-cards` + `input`/`prefill`/`syncComposer` 调用 | ✅ | 真实 DOM chip（`button.ref-card[data-testid=ref-card]`）；层 A 断言 2 卡路径；非纯 `@path` 文本条 |
| AC-41 | 输入/已发/回放同一确定性解析；已发保持卡 | Host/`segmentTextWithRefs`→`extractAtPathTokens`；Webview 嵌入 `atPathExtractBrowserSource` + `fillUserBubbleWithRefCards`；provider **无**本地 `@` 正则 | ✅ | 三处均委托同一文法；层 A 比对 Host tokens ≡ segments；`buildThinChatHtml` 含 extract + 不含第三套 re |
| AC-42 | 变更列表与回合/活动组可判定归属 | `renderChangeListBubble`→`applyMessageIdentity` 写 `data-turn`；与 activity 同 turn | ✅ | 层 A：`[data-turn="4"]` 同时含 change-list + activity |
| AC-43 | T8：默认内联 + 显式原生 | expand→`change/get-diff`→`fillChangeDiffPane`；native→`change/open-native-diff`→Host→`openChangedNativeDiff`→`openChangeSnapshotDiff`→`vscode.diff` | ✅ | 层 A 双路径 postMessage；层 B `commands[0]==='vscode.diff'`；SnapshotStore fail-closed 有真实 warning |
| AC-44 | Timeline 弱化，无完整助手长文 | `timeline-store.ts` `truncate(text, 40)` | ✅ | 层 B：label ≤40 且 UNIQUE_TAIL 不进 store JSON |
| AC-45 | 回放呈现 refs/变更/活动不误导 live 发送 | 同 render helpers + Host `mode=replay`→`ui/reject-send reason=replay` | ✅ | 层 B：hydrate+挂载 refs/activity/change-list 后 send 仍 reject |

## Stub Detection（桩代码检测）

### 已注册桩（对照 registry）

| Registry ID | 文件:函数 | 状态 | 说明 |
|-------------|-----------|:--:|------|
| DEBT-CUX-001 | change-list/diff DOM → `change-diff-dom.ts` | ✅ Resolved | 已迁入「已解决」；provider `renderBubble` 调用 `renderChangeListBubble` / `fillChangeDiffPane`，无内联双路径 |
| GAP-CUX-002 | `probes.ts` parentReadonly / continueSealed | ⚠️ Known | 仍活跃 → phase-5；本 Phase 未误关、未当桩实现 |
| GAP-CUX-001 | probes.activity | ✅ Resolved | phase-3 已关；本 Phase 未回退 |

### 新发现的未注册桩

| 文件:函数:行号 | 当前行为 | 严重性 | 处理建议 |
|---------------|---------|:--:|---------|
| — | 无 | — | `ref-cards` / `change-diff-dom` / `openChangeSnapshotDiff` / `openChangedNativeDiff` 均有真实逻辑；扫描无 `@STUB` / 空壳 return |

## 约束交叉检查

| 约束 | 结果 | 证据 |
|------|:--:|------|
| AD-CUX-11 / R5 无双正则 | ✅ | provider 内无本地 `@` re；仅嵌入 `atPathExtractBrowserSource`（与 TS `extractAtPathTokens` 同算法） |
| AD-CUX-8 / T8 内联+原生 | ✅ | expand 默认内联；行级「在编辑器中打开 Diff」显式原生（位置偏差已记 implementation，AC 未钉死控件位） |
| DEBT-CUX-001 关闭 | ✅ | registry 已解决 + extract 被产品路径调用 |
| 未改 agent-loop | ✅ | 工作区 status 无 `packages/core/agent-loop` 改动 |
| XSS 内联 diff | ✅ | `fillChangeDiffPane` 仅 `textContent` |

## 测试实证（审查侧复跑）

```
vitest run .../refs-changes-diff.spec.ts .../chat-ux-refs-changes-diff.spec.ts
→ 2 files / 7 tests passed (Node 22.14.0)

vitest run .../phase2-change-list-display.spec.ts
→ 16 passed
```

## 关键发现

### 🔴 Must-Fix
- 无

### 🟡 Should-Fix
- 无（边界：`available:false` / `oldText===null` 新文件 / 无 snapshot 原生打开 fail-closed / 空 change-list `emptyNotice` 均有真实分支）

### 🟢 Observations
- Composer 引用卡为 textarea 上方 chip（非 contenteditable）；发送仍为纯 `@path` 文本 — implementation 已记偏差，与 exploration R11 / Host `validateComposerAtPaths` 一致，不构成 AC 失败。
- `atPathExtractBrowserSource` 正则缺 `u` flag（TS 为 `/gu`）；ASCII `@path` 产品路径无差；若未来要严守「byte-identical」可对齐 flag（非本 Phase AC 阻断）。
- 原生 Diff 按钮在 change-list 行上（非仅 pane 内）— 与 R10 允许的 implementer 选择一致，层 A 可断言。

## 产出路径
`.specdev/specs/vscode-dsh-chat-ux/phases/phase-4-refs-changes-diff/review-correctness.md`
