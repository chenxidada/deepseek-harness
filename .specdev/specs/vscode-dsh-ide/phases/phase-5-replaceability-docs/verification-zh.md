# Phase 5 验证报告 — phase-5-replaceability-docs

## 判决：PASS

## 测试执行矩阵

| 场景 | 来源 | 命令 | 结果 | 证据 |
|------|:--:|------|:--:|------|
| AC-27: 无 `packages/core/agent-loop` 改动 | spec | `prove-replaceability.sh` + `run-verifier.sh` V4 | ✅ | `OK: no agent-loop path changes (base=master)`；工作区 agent-loop porcelain 为空；Phase 5 文件无 `packages/core/` |
| AC-27: src 无 agent-loop import | spec / reviewer | `rg` + V-U3 | ✅ | import 干净；package.json 无 agent-loop 依赖 |
| AC-28: 新行为在 ide-bridge / vscode-dsh | spec | 工作区清单 + V-U2/U3 | ✅ | 仅 README + 证明测试 + prove 脚本；复用既有缝 |
| AC-29: README 替换契约与代码缝一致 | spec | V-U4 | ✅ | AD-8 契约 + fail-closed/stdout；vscode-dsh 回链；bundle 过期文案已删 |
| AC-33: memory transport 集成 | spec | vitest memory 套件 | ✅ | hello + approval；非法 outcome 拒绝 |
| AC-33: 第二 InteractionUi e2e | spec | vitest UI 套件 | ✅ | 注入 presenter → `rejected` |
| AC-33: 可脚本 prove | spec | `prove-replaceability.sh` | ✅ | ALL PHASE-5 PROVE STEPS OK |
| GAP-010/011 故意未修 | 任务 / registry | V-U5 | ✅ Known | 非阻塞；不因此 FAIL |

## 独立验证场景（verifier 自设计）

| 场景 | 命令 | 结果 |
|------|------|:--:|
| V-U1 合法/非法 outcome 参数变化 | `verifier-independent-unit.mts` | ✅ 23/23 |
| V-U2 文档缝符号真实存在 | 同上 | ✅ |
| V-U3 无 agent-loop 依赖/import | 同上 | ✅ |
| V-U4 文档锚点 + 严格缺席检查 | 同上 | ✅ |
| V-E2E-1 第二 UI 返回 `allowed-once`（≠ implementer） | `verifier-independent-e2e.mts` | ✅ |
| V-E2E-2 memory `permission/select` 帧 | 同上 | ✅ 8/8 |

## Reviewer 建议的验证场景

| 场景 | 命令 | 结果 |
|------|------|:--:|
| 重跑 vitest + prove | `prove-replaceability.sh` | ✅ |
| agent-loop / 文档门禁 | prove + V4/V-U4 | ✅ |

## 端到端验证

| 数据路径 | 结果 | 证据 |
|----------|:--:|------|
| PassThrough → NdjsonSocket → 帧校验 → hello/approval | ✅ | vitest + prove |
| 第二 UI(`allowed-once`) → setInteractionUi → Host bridge → fake runtime | ✅ | V-E2E-1 |
| memory permission/select 往返 | ✅ | V-E2E-2 |
| AD-8 文档三面 → 代码缝 | ✅ | V-U2/U4 |

## 残余风险

| 风险 | 严重性 | 说明 |
|------|:--:|------|
| GAP-010 / GAP-011 | 🟢 LOW（已知非阻塞） | 本 Phase 故意未修 |
| prove 脚本 `grep -qv` 写法 | 🟢 LOW | 已用严格检查复核通过 |
| 未提取 `IdeBridgeTransport` 生产接口 | 🟢 LOW | 已记偏差；Duplex 证明合法 |

## Pipeline 合规检查

- 分支：`impl-phase-5-replaceability-docs`
- Pipeline compliance: ✅ 本 Phase 变更在 `impl-*` 分支；无 agent-loop 触碰

## 验证脚本

见 `test-scripts/run-verifier.sh`、`verifier-independent-unit.mts`、`verifier-independent-e2e.mts`、`prove-replaceability.sh`。

```text
$ bash …/test-scripts/run-verifier.sh
… ALL VERIFIER STEPS OK
```
