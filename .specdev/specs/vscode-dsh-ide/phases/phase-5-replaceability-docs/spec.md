# Phase 5: 可替换性文档与轻量证明

## 目标

文档化 Host bridge 传输适配器、UI 呈现策略与 auto-allow 的替换契约；提供至少一个可验证的替换路径；确认更换上述面不要求修改 `packages/core` 中 `agent-loop`，且新行为落在 `ide-bridge` / Extension 边界内。

## 前置条件

- Phase `phase-3-interaction-fail-closed` HG-3 通过（替换证明依赖真实 bridge 契约）
- Phase Entry Gate：读取 registry
- 可读：`design.md` AD-8、`phases/phase-3-*/implementation.md`

## 验收标准

**AC-27:** `[Must]` **普遍型** — 更换 UI 策略、Host bridge 传输适配器或 auto-allow 策略 **必须不** 要求修改 `packages/core` 中 `agent-loop`。

**AC-28:** `[Must]` **普遍型** — 实现 **必须** 复用既有 DSH 包边界；新行为优先落在 `ide-bridge` / VS Code Extension。

**AC-29:** `[Should]` **普遍型** — 系统 **应该** 文档化 Host bridge 与 UI 的替换契约，并有至少一个可验证替换路径。

**AC-33:** 本 Phase ≥1 集成测试（例如替换 transport 的契约测试）+ ≥1 独立 e2e 或可脚本验证场景。

## 约束

- 替换面不含 Spec/hooks 产品包（Out）
- 证明可为：第二 transport 适配器（如 loopback/memory）或第二 UI presenter，通过同一帧契约跑通一次审批或 ping
- 文档须写清：stdout 仍属 SDK；bridge 仍须 fail-closed

## 产出清单

- 替换契约文档（包 README 或 `docs/` 下本 feature 拥有页，避免重复权威源）
- 轻量替换证明（测试或示例适配器）
- 确认无 agent-loop 改动（审查/ grep 证据写入 verification）

## 不在范围内

- 新功能行为（多 Tab/审批/时间线已在前序 Phase）
- Spec/hooks 框架
- 生产级第二 UI 皮肤全集
