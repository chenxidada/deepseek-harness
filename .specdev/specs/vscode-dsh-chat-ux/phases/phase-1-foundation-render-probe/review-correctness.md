# Correctness Review — Phase 1 (phase-1-foundation-render-probe)

## 视角
**Implementation Correctness** — 代码是否正确工作

## 判决
**PASS**

## 逐条 AC 验证
| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-1 | 决策态保留在 Host；Webview 不得单独裁决 mode/sessionId/能否发送/Continue/变更权威 | `sync-chrome.ts:syncComposerDisabled`；`chat-panel-provider.ts` `syncComposer`/`panel/state`；`protocol-decision-smoke.spec.ts` | ✅ | `syncComposerDisabled` 仅用 Host 镜像的 `mode`+`connectionPhase` 算 `live`；空发送 → Host `ui/reject-send` reason `empty`，`tab.mode` 仍为 `live`；FakeWebview 不本地改 mode |
| AC-2 | 允许 Webview 持有呈现态 | `follow-state.ts`；`probes.ts`；`sync-chrome.ts:applyStreamingStatus` | ✅ | 层 A 可写 `data-follow-state`、`expanded`、streaming chrome；产品 HTML 嵌入同一算法源 |
| AC-3 | 呈现态探针：streaming / 活动项 / 展开 / follow-state；E2 位预留；无假 optimistic | `probes.ts:createChatUxProbeStore`；`foundation-render-probe.spec.ts` | ✅ | `get()` 恒含 `streaming`/`followState`/`expanded`；`setActivity` + `activity?` 座位；`mirrorHostDecisions` 写 `parentReadonly`/`continueSealed`；`'optimistic' in snapshot === false` |
| AC-4 | optimistic 须收敛；无实现则文档化 | `probes.ts` 头注释 + store 实现；`implementation.md` 偏差 3 | ✅ | 无 `optimistic` 字段/setter；注释与 AC 条件分支一致，未造假探针 |
| AC-5 | 本 Phase 含层 A 证据；层 B 契约冒烟即可 | `tests/layer-a/*.spec.ts` | ✅ | Node **22.14.0** 下 `vitest run apps/vscode-dsh/tests/layer-a/` → **2 files / 10 tests passed**；根 `vitest.config.ts` include `apps/*/tests/**/*.spec.ts` 覆盖该路径 |
| AC-6 | 抽离 render/sync；jsdom 真实节点；禁 dangerously 主路径；禁仅 toContain | `render/*` + `foundation-render-probe.spec.ts` | ✅ | 测试 `import` `chat-panel/render/*` + `probes`；断言 `querySelector`/`getAttribute`/`classList`/`children.length`；无 `runScripts:'dangerously'`；`toContain` 仅作辅助，非唯一路径 |
| AC-7 | 仅层 C 不得判达标 | 测试清单 / Out of scope | ✅ | 达标证据为层 A + 层 B smoke；无 Electron-only Must |
| AC-8 | 按修订 AD-CU-1；不得拒绝呈现态 | provider/protocol/host/README 注释 | ✅ | 文案改为允许呈现态 + 探针；层 A 断言 HTML 不含 `must not hold presentation` |
| AC-70 | F0 骨架：挂载、`data-follow-state`、消息节点契约 | `message-dom.ts`；`follow-state.ts`；层 A 首两条用例 | ✅ | 空 `mountMessages` → `children.length===0`；`data-follow-state=on`；`data-message-id`/`data-role`/`data-turn` 真实 DOM 可读 |

## Stub Detection（桩代码检测）

### 已注册桩（对照 registry）
| Registry ID | 文件:函数 | 状态 | 说明 |
|-------------|-----------|:--:|------|
| DEBT-CUX-001 | `chat-panel-provider.ts:renderBubble` (change-list/diff) | ⚠️ Known | 文本身份已抽离；change-list 产品 DOM 仍内联 — 🟡非阻塞 → phase-4 |
| GAP-CUX-001 | `probes.ts:activity` / `setActivity` | ⚠️ Known | API/座位真实可写；无活动流产品填充 — 🟡 → phase-3 |
| GAP-CUX-002 | `probes` / `panel/state.probes` parentReadonly | ⚠️ Known | `mirrorHostDecisions` + protocol 位已就绪；Host 产品路径尚未推送 — 🟡 → phase-5 |

### 新发现的未注册桩
| 文件:函数:行号 | 当前行为 | 严重性 | 处理建议 |
|---------------|---------|:--:|---------|
| — | — | — | 无。关键函数均含真实逻辑（`decideFollowState` 分支、`applyFollowState` setAttribute、`renderTextBubble`/`mountMessages`/`patchMessageDom` DOM 操作、`createChatUxProbeStore` 可变状态、`applyStreamingStatus`/`syncComposerDisabled`） |

## 关键发现
### 🔴 Must-Fix
- 无

### 🟡 Should-Fix
- 无（未发现导致 AC 失败或未注册空壳的问题）

### 🟢 Observations
- **产品路径 follow 属性与探针未原子同步**：`syncFollowPresentation` 仅在 TS 模块存在，**未**进入 `syncChromeBrowserSource()`；Webview 仅 `applyFollowState(chassisEl,'off')` 初始化，后续若只改属性不调 `__dshProbes.setFollowState` 会漂移。本 Phase follow 接线在 Out of scope（phase-2），层 A 测试两侧均手写同步 — 建议 phase-2 接线时强制走 `syncFollowPresentation`（或把该助手嵌入 browser source）。
- **内联 `escapeHtml` 遮蔽抽离版**：`messageDomBrowserSource()` 已注入 `escapeHtml`，provider HTML 随后又定义同名函数（算法相同）。属微双维护，可并入 DEBT-CUX-001 清理时删掉本地副本。
- **Node 版本**：本机默认 Node 20 下 jsdom@29 因 `html-encoding-sniffer` → `@exodus/bytes` ESM/`require` 冲突无法启动层 A；**Node 22.14.0** 下 10/10 绿（与 implementer 声明一致）。CI/本地须用 engines 对齐的 Node 22+。
- **`patchMessageDom` text⊕appendText**：同时传入时故意不改 DOM（协议错误）；层 A 未单测该边界，逻辑体已存在，可后续补一条。
- **change-list 未抽离**：与 implementation 偏差 1 / DEBT-CUX-001 一致，不构成本 Phase AC 失败。

## 独立验证命令

```bash
# 需 Node ≥ 22（验证时：v22.14.0）
./node_modules/.bin/vitest run apps/vscode-dsh/tests/layer-a/
# → Test Files  2 passed | Tests  10 passed
```

## 函数体抽样结论
| 符号 | 空壳？ | 说明 |
|------|:--:|------|
| `decideFollowState` | 否 | resume / atBottom / takeover / 保持原态 四分支 |
| `applyFollowState` | 否 | `setAttribute('data-follow-state', …)` |
| `renderTextBubble` / `mountMessages` / `appendMessage` | 否 | 创建节点 + identity attrs + 清空/追加 |
| `patchMessageDom` | 否 | query + text/appendText + incomplete attr；XOR 冲突 early-return |
| `applyStreamingStatus` | 否 | generating ↔ idle DOM class/text + `setStreaming` |
| `syncComposerDisabled` | 否 | `live && phase!=='connecting'` 才启用 |
| `createChatUxProbeStore` | 否 | 可变 snapshot；无 optimistic；Host mirror / activity setter 真实写入 |
