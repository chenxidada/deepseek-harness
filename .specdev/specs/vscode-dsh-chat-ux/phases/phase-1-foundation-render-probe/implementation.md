# Phase 1 实现摘要 — phase-1-foundation-render-probe

## 变更清单（文件列表）

### 新增
| 文件 | 说明 |
|------|------|
| `apps/vscode-dsh/src/chat-panel/render/follow-state.ts` | `decideFollowState` / `applyFollowState` + browser source |
| `apps/vscode-dsh/src/chat-panel/render/message-dom.ts` | 文本气泡身份、`mountMessages`/`appendMessage`/`patchMessageDom` + browser source |
| `apps/vscode-dsh/src/chat-panel/render/sync-chrome.ts` | `applyStreamingStatus` / `syncComposerDisabled` / theme + browser source |
| `apps/vscode-dsh/src/chat-panel/render/index.ts` | render barrel |
| `apps/vscode-dsh/src/chat-panel/probes.ts` | `ChatUxProbes` / `createChatUxProbeStore`（无 fake optimistic）+ browser source |
| `apps/vscode-dsh/tests/layer-a/foundation-render-probe.spec.ts` | 层 A jsdom 套件（真实 DOM 断言） |
| `apps/vscode-dsh/tests/layer-a/protocol-decision-smoke.spec.ts` | 层 B AC-1 协议冒烟 + probes 座位 |

### 修改
| 文件 | 说明 |
|------|------|
| `apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts` | 嵌入抽离 browser sources；`data-follow-state`；`__dshProbes`；`applyStreamingStatus` / `syncComposerDisabled` / `applyMessageIdentity`；修订 AD-CU-1 注释 |
| `apps/vscode-dsh/src/chat-panel/protocol.ts` | 修订 AD-CU-1 注释；`panel/state.probes?`（parentReadonly / continueSealed） |
| `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` | 修订 AD-CU-1 注释 |
| `apps/vscode-dsh/src/chat-panel/index.ts` | 导出 render + probes |
| `apps/vscode-dsh/README.md` | 呈现态允许 + 决策态仍 Host |
| `.specdev/specs/vscode-dsh-chat-ux/tech-debt-registry.md` | DEBT/GAP 非阻塞登记 |
| `.cursor/skills/project-test/SKILL.md` | layer-a 运行命令 |

## 对每个验收标准的实现说明

| AC | 实现 |
|----|------|
| **AC-1** | 决策态仍仅来自 Host `panel/state`；`syncComposerDisabled` 只消费 Host 镜像的 mode/phase；层 B smoke 验证 empty send → `ui/reject-send` |
| **AC-2** | Webview/层 A 可写 `data-follow-state`、expand 探针、streaming chrome |
| **AC-3** | `ChatUxProbeStore`：streaming / followState / expanded；`parentReadonly`/`continueSealed` 经 `mirrorHostDecisions`；**无** `optimistic` 字段 |
| **AC-4** | 本 Phase **无** Webview optimistic UI；契约与注释明示不造假 optimistic 探针 |
| **AC-5** | CI 可跑 `apps/vscode-dsh/tests/layer-a/*.spec.ts`（10 passed） |
| **AC-6** | 测试 `import` `chat-panel/render/*` + jsdom；断言 `querySelector`/`getAttribute`；主路径非 `runScripts: 'dangerously'` |
| **AC-7** | 无仅 Electron Must；层 C 未作为达标依据 |
| **AC-8** | provider / protocol / host / README 注释对齐修订 AD-CU-1（允许呈现态 + 探针） |
| **AC-70** | 空列表挂载 + `data-follow-state=on` + `data-message-id`/`data-role` 消息节点契约 |

## 测试结果（命令 + 输出）

```bash
# Layer A + protocol smoke
./node_modules/.bin/vitest run apps/vscode-dsh/tests/layer-a/
# → Test Files  2 passed | Tests  10 passed

# 回归（chassis / FakeWebview / change-list HTML 契约）
./node_modules/.bin/vitest run \
  apps/vscode-dsh/tests/phase3-chat-ui-chassis.spec.ts \
  apps/vscode-dsh/tests/panel-l2-l3-protocol.spec.ts \
  apps/vscode-dsh/tests/phase2-change-list-display.spec.ts
# → Test Files  3 passed | Tests  41 passed
```

环境：Node 22.14.0，repo root，`./node_modules/.bin/vitest`。

## 同源策略（产品路径 vs 测试）

| 模块 | 层 A 测试 | 产品 Webview |
|------|-----------|--------------|
| follow-state / probes / sync streaming+composer+theme | 直接 `import` TS | `*BrowserSource()` 嵌入 HTML（与 TS 同算法） |
| message-dom 文本身份 / patchMessageDom | 直接 `import` TS | browser source 嵌入；`renderBubble` 调用 `applyMessageIdentity` |
| change-list / diff-summary / ref-card 完整 DOM | 未抽完整产品路径 | **仍主要在 provider 内联**（DEBT-CUX-001 → phase-4） |

这不是「永久两份拷贝」：可测核心决策与探针已单源；change-list 大块有意推迟到 phase-4，已登记非阻塞债。

## 偏差记录

### 偏差 1 — change-list 未完整抽到 `render/`
- **偏差描述**：未把 change-list / diff-summary 整段抽到独立模块；仅文本气泡身份与 patch/list helpers。
- **影响范围**：spec.md 产出清单「message-dom」；design.md 抽离模块表；exploration R3。
- **原因**：exploration 推荐 Phase-1 优先文本契约以满足 AC-70，避免大 diff 回归；change-list 属 phase-4 产品范围。
- **影响**：下游 phase-4 需完成抽离（DEBT-CUX-001）；层 A 本 Phase 仍有可断言消息节点。

### 偏差 2 — 完整跟滚接线 / chunk 流式产品路径未做
- **偏差描述**：`decideFollowState` + `data-follow-state` + probe 骨架已交付；无 scroll listener / 真实 `assistant/chunk` 消费。
- **影响范围**：spec.md Out of scope；design AD-CUX-4「完整跟滚接线可在 phase-2」。
- **原因**：本 Phase Out；属 phase-2。
- **影响**：无；`patchMessageDom` 骨架可供 phase-2 接线。

### 偏差 3 — 无 optimistic 探针
- **偏差描述**：刻意不实现 `optimistic` 字段。
- **影响范围**：spec AC-3/4 条件分支。
- **原因**：AC 禁止无 optimistic 时造假探针。
- **影响**：无。

## 债务

见 `tech-debt-registry.md`：
- **DEBT-CUX-001**（🟡）change-list 双维护 → phase-4
- **GAP-CUX-001**（🟡）activity 探针填充 → phase-3
- **GAP-CUX-002**（🟡）parentReadonly Host 推送 → phase-5

无 🔴 阻塞债；无 `@STUB` 空壳。
