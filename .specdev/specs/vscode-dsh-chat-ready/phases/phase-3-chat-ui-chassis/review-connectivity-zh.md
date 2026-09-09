# 连通性审查 — phase-3-chat-ui-chassis

## 视角
**Integration Connectivity** — 模块间是否真正连通

## 判决
**PASS**

## 复审上下文

本轮为 **仅测试层 Should-Fix 加固后的连通性复审**（`implementation.md`：无产品行为变更）。先前 `review-connectivity.md` / `review-connectivity-zh.md` 已归档至 `.archive/`。复审重点：确认端到端接线仍完整，并记录 phase3 suite 新增的 **AC-20** 显式证据。

## 端到端路径追踪

### 路径 1：主题刷新（AC-8a）
```
入口: onDidChangeActiveColorTheme / activate / onViewResolved
  → pushActiveTheme → panelHost.pushThemeKind → ui/theme     ✅
  → Webview applyThemeKind → theme-* class                   ✅
  原生 --vscode-* CSS 仍为主路径（AD-CR-7）                  ✅
出口: Webview 主题 class + CSS 变量刷新
```
**判定**: ✅ 完整。首屏经 `onViewResolved` 补推；本轮产品接线未改。

### 路径 2：Composer Enter → 发送（AC-12）+ live 冒烟（AC-27）
```
#input keydown → resolveComposerKeydown → composer/send
  → ChatPanelHost.sendPrompt → acceptSend → promptActive     ✅
Shift+Enter → newline，不发 send                             ✅
```
**判定**: ✅ 接通；phase3 suite 保留 live Tab 发送冒烟。

### 路径 3：MD → Copy → dsh.copyToClipboard（AC-16/17）
```
messages/* → renderSafeMarkdown → action/copy-code
  → requestCopyCode → dsh.copyToClipboard → clipboard        ✅
```
**判定**: ✅ 全链连通。SF#1 仅为 HTML/TS 同源测试断言。

### 路径 4：Conversations 空态标题（AC-19）
```
EMPTY_LIVE_TITLE「新对话」→ tab-bar / auto-ready / controller ✅
空 registry → []（无命令标题堆砌）                            ✅
```
**判定**: ✅ 同源接通。

### 路径 5：History 过滤 → 打开 → replay 门禁（AC-19a / AC-20）
```
listHistorySessions → isHistoryEligibleSession
  → dsh.openHistory → openFromHistory → mode=replay          ✅
  → panel/state mode=replay                                  ✅
  → composer/send → ui/reject-send reason=replay             ✅
```
**判定**: ✅ 端到端连通。**本轮新增证据（SF#2）**：`phase3-chat-ui-chassis.spec.ts` 用例  
`openFromHistory non-empty → mode=replay and rejects composer/send`：
- `openFromHistory` → `mode=replay`，`messageCount=2`
- FakeWebview 收到 `panel/state` `mode=replay`
- `composer/send` → `ui/reject-send` `reason=replay`

此前 AC-20 主要依赖 phase2 suite；现已在 **本 Phase 套件** 有独立回归锚点。

### 路径 6：生成中指示（AC-10）+ 连接态呈现
```
status/set generating →「Generating…」                       ✅
ConnectionUi → applyConnectionState（phase-1 缝，仅呈现）     ✅
```
**判定**: ✅ 既有缝未拆。

### 路径 7：AC-25 Host 权威
```
Webview 仅跟随 panel/state；发送门禁在 Host                  ✅
```
**判定**: ✅ 未引入 Webview 权威。

## 上下游连接检查

| 新函数/组件 | 上游 | 状态 | 下游 | 状态 |
|------------|------|:--:|------|:--:|
| `pushThemeKind` | `pushActiveTheme` | ✅ | `ui/theme` → Webview | ✅ |
| `resolveComposerKeydown` | Webview keydown | ✅ | `composer/send` / newline | ✅ |
| `renderSafeMarkdown` | HTML embed / renderBubble | ✅ | DOM / Copy | ✅ |
| `requestCopyCode` | `action/copy-code` | ✅ | `dsh.copyToClipboard` | ✅ |
| `EMPTY_LIVE_TITLE` | controller / auto-ready / tab-bar | ✅ | TreeView | ✅ |
| `isHistoryEligibleSession` | `listHistorySessions` | ✅ | History 行 | ✅ |
| `openFromHistory` | `dsh.openHistory` / AC-20 测试 | ✅ | replay + `pushFullState` | ✅ |
| `sendPrompt` replay 门 | `composer/send` | ✅ | `ui/reject-send` | ✅ |

## 跨模块契约验证

| 模块间 | 一致？ |
|--------|:--:|
| Webview ↔ Host：`action/copy-code` / `ui/theme` / `ui/reject-send` | ✅ |
| Host ↔ `dsh.copyToClipboard`（register + package.json） | ✅ |
| History → `openFromHistory` → `mode=replay` | ✅ |
| MD TS ↔ Webview embed（SF#1 同源断言） | ✅ |

## 跨 Phase 依赖检查

| 依赖 | 来源 | 连接 |
|------|------|:--:|
| ChatPanelHost / panel/state / reject-send | 前序 | ✅ 未改语义 |
| AutoStart / ConnectionUi | phase-1 | ✅ 仅呈现 |
| AutoReady + 标题常量 | phase-2 | ✅ 无 API 破坏 |
| History replay | 前序 AC-20 | ✅ phase3 补显式证据 |
| DEBT-003 Continue | → phase-4 | ✅ 未触碰 |

## AC-20 证据备注（本轮）

| 来源 | 覆盖 |
|------|------|
| phase2 History replay suite | 前序回归 |
| **phase3-chat-ui-chassis.spec.ts（SF#2）** | **本 Phase** `openFromHistory`→replay + reject-send |

## 关键发现

### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
（无）

### 🟢 Observations
- 本轮仅测试变更；产品接线与上轮 PASS 一致。
- AC-20 现有 phase2 + phase3 双锚点。
- DEBT-003 仍属 phase-4。
