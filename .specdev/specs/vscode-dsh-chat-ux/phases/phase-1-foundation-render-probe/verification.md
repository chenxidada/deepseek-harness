# Phase 1 验证报告 — phase-1-foundation-render-probe

## 判决：PASS

独立验证确认本 Phase 全部验收标准可达：层 A jsdom 真 DOM 路径绿、Host 决策冒烟绿、verifier 自建端到端链（mount→stream→patch→follow）绿。合并审查 Should-Fix（`escapeHtml` 阴影）经算法对拍与双定义计数确认存在，但**不构成行为失败**（抽离版与本地重定义输出一致）。

## 测试执行矩阵

| 场景 | 来源 | 命令 | 结果 | 证据 |
|------|:--:|------|:--:|------|
| AC-1: 决策态留 Host；空 send → `ui/reject-send` | spec | `vitest run apps/vscode-dsh/tests/layer-a/`（protocol-decision-smoke） | ✅ | 1/1；`reason: empty`；`tab.mode` 仍 `live`；probes 协议位可构造 |
| AC-2: 呈现态可写 follow/expand/streaming | spec | layer-a foundation | ✅ | `data-follow-state` / `expanded` / streaming chrome 可读 |
| AC-3: 探针最小集；无假 optimistic | spec | layer-a + independent | ✅ | `streaming`/`followState`/`expanded`；`'optimistic' in snapshot === false`；`setActivity` 参数变化真实写入 |
| AC-4: 无 optimistic 时不造假 | spec | layer-a + independent | ✅ | 无 optimistic 字段；implementation 文档化一致 |
| AC-5: 层 A 证据进 CI 路径 | spec | `vitest run apps/vscode-dsh/tests/layer-a/` | ✅ | **2 files / 10 tests passed**（Node 22.14.0） |
| AC-6: 抽离 render + jsdom；禁 dangerously 主路径 | spec | layer-a + independent + grep | ✅ | `import` `chat-panel/render/*`；`querySelector`/`getAttribute`；仅注释/否定断言提及 dangerously |
| AC-7: 仅层 C 不得达标 | spec | 静态 | ✅ | 达标证据为层 A + 层 B smoke；无 Electron-only Must |
| AC-8: 修订 AD-CU-1 允许呈现态 | spec | layer-a HTML 断言 | ✅ | HTML 不含 `must not hold presentation` |
| AC-70: 空挂载 + follow + 消息节点契约 | spec | layer-a | ✅ | `children.length===0`；`data-follow-state=on`；`data-message-id`/`data-role` |
| 回归 chassis / protocol / change-list | reviewer/impl | `vitest run phase3-chat-ui-chassis panel-l2-l3-protocol phase2-change-list-display` | ✅ | **3 files / 41 tests passed** |
| Should-Fix: escapeHtml 阴影行为影响 | review | independent | ✅ 非行为失败 | ≥2 个 `function escapeHtml(`；TS vs 本地算法对拍一致 |
| E2E 独立链 | verifier | independent vitest | ✅ | mount→generating→appendText→takeover off→incomplete clear→idle |

## 独立验证场景（你自己设计的）

| 场景 | 命令 | 结果 |
|------|------|:--:|
| E2E：mount→stream→patch→follow takeover→incomplete clear | `vitest run --config …/test-scripts/vitest.config.ts` | ✅ |
| `patchMessageDom` text⊕appendText 不改 DOM（implementer 未测） | 同上 | ✅ |
| escapeHtml 双定义计数 + 算法对拍（XSS 向量） | 同上 | ✅ |
| user bubble `textContent` 不解析 markup | 同上 | ✅ |
| `decideFollowState` / `setActivity` / `syncComposerDisabled` 参数变化 | 同上 | ✅ |
| 产品 HTML 不含 dangerously 路径广告 | 同上 | ✅ |

**独立套件合计：8 passed / 8**

## Reviewer 建议的验证场景

| 场景 | 命令 | 结果 |
|------|------|:--:|
| 层 A 全套（correctness 建议） | `./node_modules/.bin/vitest run apps/vscode-dsh/tests/layer-a/` | ✅ 10/10 |
| escapeHtml 阴影是否导致错误转义（design Should-Fix） | independent 对拍 | ✅ 行为一致，仅维护债 |
| `syncFollowPresentation` 产品未嵌入（connectivity 观察） | 代码对照 + Out of scope | ✅ 属 phase-2；非本 Phase 断链 |

## 端到端验证

| 数据路径 | 结果 | 证据 |
|---------|:--:|------|
| 层 A：`mountMessages` → `applyStreamingStatus` → `patchMessageDom(appendText)` → `decideFollowState(takeover)` → `applyFollowState` + probes → idle | ✅ | independent E2E；同一 `data-message-id` 节点不被替换；`data-follow-state=off`；`streaming` false |
| 层 B：FakeWebview `composer/send` 空白 → Host `ui/reject-send` | ✅ | protocol-decision-smoke；prompts 空；mode 不由 Webview 发明 |
| 产品嵌入：`buildThinChatHtml` 含 `decideFollowState` / `__dshProbes` / `applyMessageIdentity` | ✅ | layer-a + independent 字符串契约 |

## 残余风险

| 风险 | 严重性 | 说明 |
|------|:-----:|------|
| 产品 HTML `escapeHtml` 本地重定义阴影抽离版（Should-Fix） | 🟢 LOW | 算法相同，无转义行为差异；建议删本地重定义或薄委托；可并入 DEBT-CUX-001 清理 |
| change-list / diff 仍内联（DEBT-CUX-001） | 🟢 LOW* | 已登记 → phase-4；本 Phase AC-70 不依赖完整抽离 |
| activity / parentReadonly Host 推送未填充（GAP-CUX-001/002） | 🟢 LOW* | 座位真实可写；产品填充属 phase-3/5 |
| `syncFollowPresentation` 未进 browser source | 🟢 LOW | phase-2 跟滚接线时需双写 DOM+probe，避免漂移 |
| Node 20 下 jsdom 层 A 不可跑 | 🟢 LOW | 需 Node 22+（engines）；本验证用 22.14.0 |

\*已登记非阻塞债，对照 registry 跳过产品行为强制；座位经参数变化验证非空壳。

## AC 映射结论

| AC | 独立证据 | 判定 |
|----|---------|:--:|
| AC-1 | 层 B smoke + `syncComposerDisabled` 矩阵 | ✅ |
| AC-2 | follow/expand/streaming DOM+probe | ✅ |
| AC-3 | 探针最小集 + setActivity 变化 + 无 optimistic | ✅ |
| AC-4 | 无 optimistic 字段 | ✅ |
| AC-5 | layer-a 10/10 执行证据 | ✅ |
| AC-6 | 抽离 import + 真 DOM + 无 dangerously 主路径 | ✅ |
| AC-7 | 无仅层 C Must | ✅ |
| AC-8 | HTML/注释对齐修订 AD-CU-1 | ✅ |
| AC-70 | 空挂载 + follow + message identity | ✅ |

## Stub 感知

| 符号 | 参数变化？ | 结论 |
|------|:--------:|------|
| `decideFollowState` | ✅ 多输入不同输出 | 真实逻辑 |
| `setActivity` | ✅ a1/a2/delete | 真实逻辑（座位；GAP-CUX-001 仅缺产品填充） |
| `mirrorHostDecisions` | ✅ parentReadonly / continueSealed | 真实逻辑 |
| `syncComposerDisabled` | ✅ mode×phase 矩阵 | 真实逻辑 |
| `escapeHtml`（TS vs 本地） | ✅ 对拍一致 | 非桩；双维护 |

无新增未注册疑似桩。

## Pipeline 合规检查

- 当前分支：`impl-phase-1-foundation-render-probe`
- 非 specs 改动均在该 `impl-*` 工作区（`chat-panel/*`、`tests/layer-a/` 等）
- Pipeline compliance: ✅ 所有变更在 `impl-*` 分支

## 验证脚本

| 文件 | 用途 |
|------|------|
| `test-scripts/run-verifier-phase1.sh` | 一键：layer-a + 回归 + independent |
| `test-scripts/vitest.config.ts` | 隔离 include verifier specs |
| `test-scripts/verifier-independent-phase1.spec.ts` | 8 个独立场景 |

复跑：

```bash
# Node ≥ 22（验证时 v22.14.0）
bash .specdev/specs/vscode-dsh-chat-ux/phases/phase-1-foundation-render-probe/test-scripts/run-verifier-phase1.sh
```

## 跑过的命令（摘要）

```text
./node_modules/.bin/vitest run apps/vscode-dsh/tests/layer-a/
  → Test Files 2 passed | Tests 10 passed

./node_modules/.bin/vitest run \
  apps/vscode-dsh/tests/phase3-chat-ui-chassis.spec.ts \
  apps/vscode-dsh/tests/panel-l2-l3-protocol.spec.ts \
  apps/vscode-dsh/tests/phase2-change-list-display.spec.ts
  → Test Files 3 passed | Tests 41 passed

./node_modules/.bin/vitest run \
  --config .specdev/specs/vscode-dsh-chat-ux/phases/phase-1-foundation-render-probe/test-scripts/vitest.config.ts
  → Test Files 1 passed | Tests 8 passed
```

## 为什么不是 PARTIAL / FAIL

- 全部 Phase-1 AC 有执行证据；端到端独立路径通过。
- Should-Fix（escapeHtml 阴影）仅双维护，无错误转义 → 不升格失败。
- 登记债均为后续 Phase 范围的 🟡 非阻塞座位/抽离债，不阻断本 Phase 达标。
