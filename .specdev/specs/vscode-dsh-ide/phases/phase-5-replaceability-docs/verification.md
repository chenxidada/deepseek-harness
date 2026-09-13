# Phase 5 验证报告 — phase-5-replaceability-docs

## 判决：PASS

## 测试执行矩阵

| 场景 | 来源 | 命令 | 结果 | 证据 |
|------|:--:|------|:--:|------|
| AC-27: 无 `packages/core/agent-loop` 改动 | spec | `prove-replaceability.sh` + `run-verifier.sh` V4 | ✅ | `OK: no agent-loop path changes (base=master)`；工作区 `git status --porcelain -- packages/core/agent-loop` 为空；Phase 5 文件无 `packages/core/` |
| AC-27: src 无 agent-loop import | spec / reviewer | `rg` ide-bridge/src + vscode-dsh/src；V-U3 | ✅ | V-U3d clean；package.json 无 `@deepseek-ai/dsh-agent-loop` |
| AC-28: 新行为在 ide-bridge / vscode-dsh | spec | 工作区文件清单 + V-U2/U3 | ✅ | 变更仅 README + 两套证明测试 + prove 脚本；无新 core 包；复用 `NdjsonSocket` / `setInteractionUi` |
| AC-29: README 替换契约存在且与缝一致 | spec | V-U4 + README 读证 | ✅ | ide-bridge § Replaceability contract (AD-8) + fail-closed/stdout；vscode-dsh § Replaceability 回链权威源；bundle 过期 stub 文案已删（严格 `!includes`） |
| AC-33: 集成 — memory transport | spec / implementer | vitest `replaceability-memory-transport.spec.ts` | ✅ | hello + approval/`allowed-once`；非法 `allow-all` → undefined |
| AC-33: e2e — 第二 InteractionUi | spec / implementer | vitest `replaceability-interaction-ui.spec.ts` | ✅ | `setInteractionUi` → Host bridge → `outcome=rejected` |
| AC-33: 可脚本 prove | spec | `prove-replaceability.sh` | ✅ | `ALL PHASE-5 PROVE STEPS OK`（vitest 4/4 + AC-27/28/29 门禁） |
| GAP-010/011 故意未修 | task / registry | V-U5 + porcelain | ✅ Known | 源文件未在本 Phase 修改；🟡非阻塞 — **不因此 FAIL** |

## 独立验证场景（verifier 自设计）

| 场景 | 命令 | 结果 |
|------|------|:--:|
| V-U1 参数变化：合法/非法 `approval/response` outcome | `tsx verifier-independent-unit.mts` | ✅ 23/23（合法三值通过；`allow-all`/`always`/`yes`/`""` 拒绝；输出随输入变） |
| V-U2 README 文档缝 ↔ 导出/方法存在 | 同上 | ✅ `NdjsonSocket`/`validateBridgeFrame`/`parseBridgeFrame`；`setInteractionUi`；无 `runAgentLoop` |
| V-U3 包依赖与 import 图 | 同上 | ✅ vscode-dsh→ide-bridge；两侧无 agent-loop |
| V-U4 文档锚点 + 严格缺席检查（修 `grep -qv` 弱点） | 同上 | ✅ EN/ZH 契约存在；bundle 过期句 absent |
| V-E2E-1 **第二 UI 返回 `allowed-once`**（implementer 只证 `rejected`） | `tsx verifier-independent-e2e.mts` | ✅ Host 日志 `outcome=allowed-once`；证明缝非恒 `rejected` 桩 |
| V-E2E-2 **memory `permission/select` 帧**（implementer 内存套件未覆盖） | 同上 | ✅ select + response 过 Duplex；缺 preset fail-closed |

## Reviewer 建议的验证场景

| 场景 | 命令 | 结果 |
|------|------|:--:|
| 重跑 vitest 两文件 | `prove-replaceability.sh` 内嵌 | ✅ 2 files / 4 tests |
| 重跑 prove 脚本 | `bash …/prove-replaceability.sh` | ✅ ALL PHASE-5 PROVE STEPS OK |
| agent-loop diff / rg | prove + V4 | ✅ |
| 文档锚点存在 | prove + V-U4 | ✅（另用严格缺席检查强化 reviewer Observation） |

## 端到端验证

| 数据路径 | 结果 | 证据 |
|----------|:--:|------|
| PassThrough Duplex → `NdjsonSocket` → `validateBridgeFrame` → hello + approval | ✅ | implementer vitest + prove |
| 第二 `InteractionUi(allowed-once)` → `IdeSessionHost.setInteractionUi` → bridge `approval/response` → fake runtime log | ✅ | V-E2E-1（独立；≠ implementer `rejected`） |
| memory Duplex → `permission/select` ↔ `permission/select/response`（文档 auto-allow 面帧契约） | ✅ | V-E2E-2 |
| 文档 AD-8 三面 → 代码缝（Transport / UI / permission） | ✅ | V-U2/U4 + connectivity review 交叉 |

## 残余风险

| 风险 | 严重性 | 说明 |
|------|:--:|------|
| GAP-010 / GAP-011（Phase 4 polish） | 🟢 LOW（已知 🟡非阻塞） | 本 Phase 故意未修；已登记 registry；不影响 AC-27–29/33 |
| `prove-replaceability.sh` 对 stale 文案用 `grep -qv` | 🟢 LOW | reviewer Observation；verifier 已用严格 `!includes` 复核通过，产物正确 |
| 未落地生产 `IdeBridgeTransport` 接口 | 🟢 LOW | 与 design 偏差已记；spec 接受 Duplex/`NdjsonSocket` 证明 |

无 CRITICAL / MEDIUM 残余风险（端到端路径已独立跑通）。

## Pipeline 合规检查

- 当前分支：`impl-phase-5-replaceability-docs`
- Pipeline compliance: ✅ 所有本 Phase 非 specs 变更在 `impl-*` 分支工作区（未提交；无 `packages/core/agent-loop` 触碰）
- `master...HEAD` 尚无 Phase 5 commit（改动仍为 working tree）— 符合「implementer 不自行 commit、HG-3 统一提交」约定

## 验证脚本

落盘于 `test-scripts/`：

| 脚本 | 用途 |
|------|------|
| `run-verifier.sh` | 编排：独立 unit → 独立 e2e → prove → AC-27/GAP 探针 |
| `verifier-independent-unit.mts` | V-U1..U5（参数变化、文档缝、依赖图、GAP 探针） |
| `verifier-independent-e2e.mts` | V-E2E-1 `allowed-once` UI；V-E2E-2 permission 内存帧 |
| `prove-replaceability.sh` | implementer 可脚本证明（本轮由 verifier 重跑） |

```text
$ bash .specdev/specs/vscode-dsh-ide/phases/phase-5-replaceability-docs/test-scripts/run-verifier.sh
… V-U summary: 23 passed, 0 failed
… V-E2E summary: 8 passed, 0 failed
… Tests 4 passed (4)
… ALL PHASE-5 PROVE STEPS OK
… ALL VERIFIER STEPS OK
```
