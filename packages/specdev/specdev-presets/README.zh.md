---
description: "SpecDev Orchestrator 与角色 agent presets（方案 A），含收窄的 Orchestrator 工具面，用于 sdk SpecDev 组合。"
kind: "package-reference"
---

# @deepseek-ai/dsh-specdev-presets

[English](README.md) | 中文

## 概述

`dsh-specdev-presets` 提供 SpecDev **方案 A** agent presets：主会话收窄工具面的 Orchestrator，以及角色 presets（`requirement-analyst`、`plan-generator`、`code-explorer`、`implementer`、`reviewer-*`、`reviewer`、`verifier`、`wiki`）。它发布 `ctx.specdevPresets.presetRoot`，供 sdk-app 将 `agent-presets` 挂到该根并以 `specdev-orchestrator` 为默认。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

```yaml
- id: specdev-presets
  name: '@deepseek-ai/dsh-specdev-presets'
- id: agent-presets
  name: '@deepseek-ai/dsh-agent-presets'
  inject: [specdevPresets]
  config:
    default: specdev-orchestrator
    includeShippedRoot: false
    includeUserRoot: false
    roots:
      - path: !!js specdevPresets.presetRoot
        trust: system
```

Orchestrator 组合不含 `tool-fs` 写工具，并挂载 `@deepseek-ai/dsh-specdev-presets/orchestrator-tool-policy`（`restrict({ allow })` + 写工具 `guard`，AC-22）。角色 presets 含读写文件系统工具。派生时附加 `specdev.role` / `specdev.slug` / `specdev.phaseId?`（AC-24）。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

| 路径 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | `SpecdevPresetsService` + `SPECDEV_PRESET_ROOT` |
| [`src/orchestrator-tool-policy.ts`](src/orchestrator-tool-policy.ts) | Standing mount 工具收窄插件 |
| [`presets/*/`](presets/) | `preset.yml` + `agent.cordis.yml` 资产 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Agent presets](../../preset/agent-presets/README.zh.md) — roster 挂载契约。
- [SpecDev 命令](../command-specdev/README.zh.md) — 斜杠命令面。
- [Tools](../../core/tools/README.zh.md) — `restrict` / `guard`。

-----

<a id="model-experience"></a>
## 模型体验

### Orchestrator / 角色 personas

#### 模型看到什么

每个 preset 的 `@deepseek-ai/dsh-persona` `text` 成为该 agent 的系统提示（Orchestrator 与角色均为 `complete: true`）。Orchestrator 文案禁止改业务源码，并拒绝模糊过门。

#### Token 影响

Persona 文本在该 agent 的每次模型请求中保留；长度按 preset 固定。

#### KV Cache 影响

persona 配置不变时前缀稳定；修改 `agent.cordis.yml` persona 会从首个系统提示 token 起失效复用。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- **SDK 会话默认挂载** — sdk-app 配置 `agent-presets` 且 `default: specdev-orchestrator`。`HarnessSdkJsonRpcServer.createSession` 在存在该服务时通过 `agentPresets.mount` 加入默认 preset；若已加载 `ctx.specdev` 则附着 orchestrator 元数据。
- **bash 深路径拒绝** — Phase 2 在宿主存在时 allow-list 含 `bash`（并排除 `write`/`edit`/`str_replace_editor`）；Phase 3 gate 可扩展路径感知的 bash 拒绝。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

不发布 companion invariant。本包声明角色 preset 与其工具策略；roster 挂载契约属于 `agent-presets`，`tests/specdev-presets.spec.ts` 覆盖 preset 装配与工具限制。

</details>
