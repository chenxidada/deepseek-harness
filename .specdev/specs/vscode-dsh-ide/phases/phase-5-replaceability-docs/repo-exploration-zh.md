# 代码库调研报告 — phase-5-replaceability-docs

## 1. 任务背景

Phase `phase-5-replaceability-docs` 负责文档化并轻量证明 AD-8 可替换性：（1）Host bridge **传输适配器**；（2）VS Code **UI 呈现**（`InteractionUi`）；（3）经 permission-presets 的 **auto-allow** —— 且不得修改 `packages/core/agent-loop`（AC-27），新行为落在 `ide-bridge` / Extension（AC-28），交付替换契约文档 + ≥1 条可验证替换路径（AC-29），以及 ≥1 集成 + ≥1 独立 e2e/可脚本场景（AC-33）。Spec/hooks 产品包不在范围。Phase Entry Gate：GAP-010/011 为 Phase-4 polish，**不**阻塞本 Phase。

## 2. 仓库概览

| 维度 | 现状 |
|------|------|
| 语言 / 运行时 | TypeScript ESM，Node `^22.19 \|\| >=24`，pnpm workspaces |
| IDE 面 | `apps/vscode-dsh` — VS Code Extension Host（窗口级） |
| 运行时 profile | `packages/bundle/ide` → `dsh --profile ide` = `dsh-base` + `sdk-app` + `ide-bridge` |
| Bridge 包 | `packages/ide/ide-bridge` — NDJSON Host bridge（UDS / named pipe） |
| 核心循环 | `packages/core/agent-loop` — **不是** vscode-dsh / ide-bridge 的依赖 |
| 包管理 | pnpm；各包 / `apps/vscode-dsh/tests` 下 vitest |
| 文档分层 | 包 README = 包契约之家；跨包 howto 走 cookbook/subsystems（`docs/AGENTS.md`） |

双通道（不变）：SDK **stdout** = 仅 JSON-RPC；Host **bridge** = 非 stdout 的 NDJSON（审批 / 提问 / 权限 / session dispose）。

## 3. 最相关区域

| 路径 | 相关性 | 来源 |
|------|--------|:----:|
| `packages/ide/ide-bridge/src/types.ts` | `BridgeFrame` 闭包联合 — 线协议契约 | 👁 |
| `packages/ide/ide-bridge/src/validate.ts` | `validateBridgeFrame` / 结局校验（AC-31） | 👁 |
| `packages/ide/ide-bridge/src/ndjson.ts` | 任意 `Duplex` 上的 `NdjsonSocket`；`parseBridgeFrame` | 👁 |
| `packages/ide/ide-bridge/src/host.ts` | 生产 Host 监听（`IdeBridgeHostServer`） | 👁 |
| `packages/ide/ide-bridge/src/client.ts` | 运行时客户端（`IdeBridgeClient` → `node:net.connect`） | 👁 |
| `packages/ide/ide-bridge/src/index.ts` | Cordis answerer；fail-closed；permission RPC | 👁 |
| `packages/ide/ide-bridge/README.md` | 既有 bridge 文档（尚无 AD-8 替换专节） | 👁 |
| `packages/ide/ide-bridge/tests/ide-bridge.spec.ts` | 帧校验 + UDS 往返 + permission | 👁 |
| `apps/vscode-dsh/src/session-host.ts` | 硬编码 `new IdeBridgeHostServer()`；`setInteractionUi` | 👁 |
| `apps/vscode-dsh/src/interaction-coordinator.ts` | `InteractionUi` 缝 + fail-closed | 👁 |
| `apps/vscode-dsh/src/interaction-ui.ts` | 默认 QuickPick/InputBox 呈现（注释标明 AD-8） | 👁 |
| `apps/vscode-dsh/src/extension.ts` | 安装 `createVscodeInteractionUi`；权限选择器 | 👁 |
| `apps/vscode-dsh/README.md` | 双通道 +「不重实现 agent-loop」（AC-15）；无可替换专章 | 👁 |
| `apps/vscode-dsh/tests/interaction-fail-closed.*.spec.ts` | 测试中已用假 `InteractionUi` 作第二呈现器 | 👁 |
| `packages/interaction/permission-presets/` | Auto-allow = `approval: 'never'` 的 preset（`danger-full-access`） | 👁 |
| `packages/bundle/ide/README.md` | Profile 挂载说明；Known Limitations **过期**（仍写 stubs） | 👁 |
| `packages/core/agent-loop/` | AC-27「未改动」证据的 grep 目标 | 👁 |
| `.specdev/.../design.md` AD-8 + `IdeBridgeTransport` 示意 | 本 Phase 设计权威 | 👁 |
| `.specdev/.../tech-debt-registry.md` | 仅 GAP-010/011 活跃；非阻塞 | 👁 |

`code2prompt` 不在 PATH；清单为手动探索（👁）。

## 4. 关键入口 / 调用路径

### 路径 A — 生产 UDS 传输 + 审批（现状）

```
Extension activate
  → createVscodeInteractionUi(vscode.window)
  → IdeSessionHost.setInteractionUi(ui)
  → IdeSessionHost.start()
       → new IdeBridgeHostServer().listen(sockPath)   // 具体 UDS
       → spawn dsh --profile ide + DSH_IDE_BRIDGE_SOCK
       → SDK initialize（stdout JSON-RPC）
ide-bridge apply()
  → IdeBridgeClient.connect(sockPath)
  → ctx.on('approval/request') → awaitHostApproval → send approval/request
Host IdeSessionHost.onBridgeFrame
  → InteractionCoordinator.handleApproval
  → InteractionUi.presentApproval → 合法 ApprovalOutcome
  → send approval/response
ide-bridge settleInboundResponse → 瀑布解除（失败路径从不 next()）
```

### 路径 B — UI 可替换缝（测试已覆盖）

```
IdeSessionHost.setInteractionUi / InteractionCoordinator.setUi
  → 任意实现 InteractionUi 的对象
       presentApproval(request, signal?) → ApprovalOutcome
       presentQuestions(request, signal?) → AskUserQuestionAnswer
默认：createVscodeInteractionUi
测试：内联假呈现器（allowed-once / 挂起直到 abort）
```

### 路径 C — 不碰 agent-loop 的 auto-allow（permission-presets）

```
Extension dsh.selectPermissionPreset
  → pickPermissionPreset → Host permission/list + permission/select 帧
ide-bridge handlePermissionSelect
  → ctx.get('permissionPresets').set(session, preset)
  → dsh-permission-presets 写入 sandbox + approval policy
       'danger-full-access' → approval policy 'never'  // 工具 auto-allow
agent-loop 不变；approval 服务仍读会话策略
```

### 路径 D — 候选 memory/loopback 传输证明（尚未交付）

```
PassThrough / 成对 Duplex
  → new NdjsonSocket(duplexA)  // Host 侧
  → new NdjsonSocket(duplexB)  // Runtime 侧
  → 同一 validateBridgeFrame / BridgeFrame kinds
  → hello ping 或一次 approval/request↔response
  → 断言 packages/core/agent-loop 未被触及（无 import / 无文件改动）
```

## 5. 可能影响面

| 区域 | 变更类型 | 风险 | 说明 |
|------|----------|:----:|------|
| `packages/ide/ide-bridge/README.md`（+ zh） | 文档：可替换 / 帧契约 | 🟢 低 | 传输 + fail-closed + stdout 纯度的自然归属 |
| `apps/vscode-dsh/README.md` | 文档：UI + auto-allow 可替换 | 🟢 低 | 链到 ide-bridge README；避免第二权威源 |
| `packages/bundle/ide/README.md` | 修正过期 Known Limitations | 🟡 中 | 仍声称 Phase-3 stubs / UI 延后 |
| 可选：`docs/cookbook/` 或 ide 子系统页 | 仅当跨包叙述需要独立页 | 🟡 中 | Spec 允许 docs/；优先包 README |
| `packages/ide/ide-bridge/tests/*` | 新增 memory/loopback 契约测试 | 🟢 低 | 最佳 AC-29+AC-33 传输证明 |
| `apps/vscode-dsh/tests/*` | 显式「第二 InteractionUi」证明测试 | 🟢 低 | 模式已有；命名/断言为可替换证明 |
| 抽出 `IdeBridgeTransport` 接口 | 可选重构 | 🟡 中 | design 有示意；Phase 1 review 已推迟；若测试能证明 Duplex/NDJSON 互换则**非必须** |
| `IdeSessionHost` 对 host server 做 DI | 可选 | 🟡 中 | 当前 `new IdeBridgeHostServer()`；仅当要在进程内证明 Host 侧替换才需 |
| `packages/core/agent-loop/**` | **禁止改动** | 🔴 触及即违规 | AC-27；verification 应 grep/diff |
| GAP-010 / GAP-011 代码 | 不在范围 | — | 勿「写文档顺便修」 |

## 6. 既有约束 / 惯例

- **注册即 effect**；ide-bridge answerer 为终端（`_next` 未用）—— fail-closed 从不 `next()`（AD-4）。
- **入站校验**丢弃非法帧（`validateBridgeFrame` → `undefined`）；禁止静默放行（AC-31）。
- **闭包审批结局**：`allowed-once` \| `rejected` \| `cancelled` \| `unavailable` —— 无 `allow-all`。
- **权限权威**：仅经 Host RPC 的 `dsh-permission-presets`（AD-6 / AC-21/22）；Extension 不得另起策略库。
- **stdout 纯度**：bridge 永不写 SDK stdout；任何可替换文档须写明（Phase 5 约束）。
- **包 README 归属**：耐久契约进包 README；包文档需双语对。
- **显式优于隐式**：若抽出 `IdeBridgeTransport`，resolve/start 留在拥有方 —— 勿在 `send()` 里藏默认。
- **测试描述行为**：证明第二适配器/呈现器经**同一帧校验器**跑通一次审批或 hello。
- **vscode-dsh 依赖**：仅 `dsh-ide-bridge`、`dsh-sdk-client`、`dsh-subprocess` —— 无 core loop 包（AC-15/28）。
- **ide-bridge 依赖**：schemastery + peer approval/questions/cordis —— 无 agent-loop。

## 7. 风险 / 未知

| 条目 | 确认度 | 细节 |
|------|:------:|------|
| AD-8 三缝对应真实代码位置 | ✅ CONFIRMED | 传输 = HostServer/Client/Ndjson；UI = InteractionUi；auto-allow = permission-presets `never` |
| 仓库中无 `IdeBridgeTransport` TS 接口 | ✅ CONFIRMED | 仅 design.md 示意；Host/Client 为具体类 |
| UI 缝已可在不改 agent-loop 下替换 | ✅ CONFIRMED | `setInteractionUi` + 测试假对象；coordinator 只要求合法结局 |
| 缺少专用可替换性文档 | ✅ CONFIRMED | README 覆盖双通道/fail-closed，但无 AD-8 替换配方 |
| Memory 传输可复用 `NdjsonSocket(Duplex)` | ⚠️ HYPOTHESIS | 类接受 `Duplex`；PassThrough 成对尚未实测 |
| AC-29 是否必须抽出 transport 接口 | ⚠️ HYPOTHESIS | Spec 接受「第二 transport **或** 第二 UI presenter」；文档 + 一条证明即可 |
| Auto-allow「策略插件」= permission-presets / cordis 覆盖 | ⚠️ HYPOTHESIS | vscode 侧无独立 auto-allow 插件；preset 表 / `approval: never` 即现货旋钮 |
| `IdeSessionHost` 硬编码 UDS server → Host DI 证明更难 | ✅ CONFIRMED | 今日替换：同类 listen API 的新 HostServer，或测里绕过 Host 直用 NdjsonSocket |
| bundle/ide README 相对 Phase 3+ 过期 | ✅ CONFIRMED | 「UI 延后 / answerer stubs」已过时 |
| GAP-010/011 仍在 | ✅ CONFIRMED | 见 §9；本 Phase 不当作阻塞 |
| 文档落 `docs/` 还是仅 README | ❓ UNKNOWN | Spec 两者皆可；docs AGENTS 倾向包 README 作契约之家 |

## 8. 未核实 / 勿假设

| 符号 | 状态 | 对下游建议 |
|------|------|------------|
| `NdjsonSocket` 跑在成对 `stream.PassThrough` 上 | 签名存在；双向 NDJSON **行为未核实** | implementer 必须写证明测试；勿假设编码/背压在未跑通前可用 |
| 未来 Webview `InteractionUi` | 未实现 | 超出「文档化接口」即可；现货呈现仍是 QuickPick |
| 与 Web `/permission` 的 live `approval.setPolicy` 旁白对齐 | ide-bridge README 已记限制 | Bridge 走 `presets.set` / 会话日志写入；勿扩进 agent-loop |
| 以 Windows named-pipe 作「第二传输」证明 | Host 支持 pipe 路径；覆盖偏 UDS | 无密钥 CI 优先进程内 Duplex |
| `IdeBridgeClient.connect` 是否可注入自定义 connect | **不存在** | Client 固定 `net.connect(path)`；memory 证明应落在 NdjsonSocket / 测试替身层，除非重构 Client |

## 9. 桩检测与 Registry 交叉校验

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:-------------:|------------|:----:|
| GAP-010 | `apps/vscode-dsh/src/timeline-store.ts` `applySessionEvent(tool/result)` / `narrowDiffs` | 🟡非阻塞 — 仅消费 `meta.diffs`；无 call-args 回退 | ✅ 仍是：`metaDiffs = narrowDiffs(data.meta)`；空 diffs → 无合成 hunk | ✅ 匹配 |
| GAP-011 | `apps/vscode-dsh/src/diff-entry.ts` `openTimelineDiff` / `looksAbsolute` | 🟡非阻塞 — 相对路径 → `dsh-diff:new-…` 虚拟右半侧 | ✅ 仍是：相对 → `Uri.parse('dsh-diff:new-…')`；无 `workspaceFolders` join | ✅ 匹配 |
| —（Phase 5 目标路径） | ide-bridge / InteractionUi / permission | — | 主路径无 `@STUB`、空实现或硬编码假返回；`unavailable` 为真实 fail-closed | ✅ 无新桩 |

### Stub Detection Summary

- ✅ 与 registry 匹配的已知缺口：**2**（GAP-010、GAP-011）— Phase-4 polish；**不阻塞** Phase 5
- ⚠️ Registry 不一致：**0**
- 🔴 Phase-5 关键路径上的未注册桩：**0**
- 说明：Phase Entry Gate **无** 目标 Phase=`phase-5-replaceability-docs` 的 🔴阻塞债

## 10. 建议优先阅读

1. ⭐ MUST READ — `.specdev/specs/vscode-dsh-ide/phases/phase-5-replaceability-docs/spec.md`（AC-27/28/29/33）
2. ⭐ MUST READ — `.specdev/specs/vscode-dsh-ide/design.md` §AD-8 + `IdeBridgeTransport` / `BridgeFrame` 示意
3. ⭐ MUST READ — `packages/ide/ide-bridge/src/types.ts` + `validate.ts` + `ndjson.ts`（帧契约）
4. ⭐ MUST READ — `apps/vscode-dsh/src/interaction-coordinator.ts`（`InteractionUi`）+ `interaction-ui.ts`
5. ⭐ MUST READ — `apps/vscode-dsh/src/session-host.ts`（bridge listen 接线；`setInteractionUi`）
6. 🔷 SHOULD READ — `packages/ide/ide-bridge/README.md` + `apps/vscode-dsh/README.md`（扩展，勿另起权威）
7. 🔷 SHOULD READ — `packages/ide/ide-bridge/tests/ide-bridge.spec.ts` + `apps/vscode-dsh/tests/interaction-fail-closed.integration.spec.ts`（证明模式）
8. 🔷 SHOULD READ — `packages/interaction/permission-presets/src/index.ts`（默认 preset / `never` auto-allow）
9. 🔷 SHOULD READ — Phase 3 归档 `implementation-20260907T030712Z.md`（AD-8 QuickPick 偏差）+ Phase 1 review 中推迟 `IdeBridgeTransport` 的备注
10. 🔹 OPTIONAL — `packages/bundle/ide/README.md`（写文档时可顺手修正过期限制）
11. 🔹 OPTIONAL — `packages/core/agent-loop/README.md`（仅用于引用「未改动 / 未导入」）
12. 🔹 OPTIONAL — `docs/AGENTS.md` 分层规则（决定契约页落点）

### Implementer 清单（推导）

- [ ] 文档化三个可替换面 + 不变量（stdout 独占；fail-closed；帧校验；不改 agent-loop）。
- [ ] 优先包 README 专节 + 交叉链接（避免重复权威源）。
- [ ] 交付 ≥1 条证明：memory/loopback NDJSON **或** 命名的第二 `InteractionUi` 集成测试。
- [ ] 交付 ≥1 条 e2e/可脚本场景（可复用假 UI / 假 runtime 的 Host 审批路径）。
- [ ] verification 留证：`git`/`rg` 显示无 `packages/core/agent-loop` 改动；vscode-dsh/ide-bridge 仍不导入它。
- [ ] 除非用户改债策略，否则不动 GAP-010/011。
