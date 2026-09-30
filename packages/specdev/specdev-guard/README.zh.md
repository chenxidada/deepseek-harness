---
description: "SpecDev 失败关闭式守卫：以 Cordis pre-step / pre-execute / tools.guard 强制 Human Gate、角色调度、git 分支、状态镜像与工作区范围。"
kind: "package-reference"
---

# @deepseek-ai/dsh-specdev-guard

[English](README.md) | 中文

## 概述

`dsh-specdev-guard` 把 Cursor shell hook 的 pipeline-gate 意图落地为原生 Cordis 强制：包装 `ctx.specdev.dispatchRole`、在 `agent/pre-step` 拒绝未就绪角色，并通过 `tools/pre-execute` + `tools.guard` 拒绝对导出的 `current-status.json` 镜像的工具写入。Human Gate 权威来自工作流日志：`confirmGate` 追加状态事件、投影折叠出状态，手改镜像只会被报为偏离，绝不被当作通过（AC-28）。

同一个 `tools/pre-execute` 监听器也是工作区范围检查。它读取一次调用涉及的所有路径——工具参数与 shell 命令行——对落在会话工作区之外的路径通过 `ctx.userQuestions` 向用户提问，卡片包含路径、角色与工具、递归扫描提示以及自由文本备注位。申请提供 `Allow once`、`Allow this directory`、`Allow for this session` 与 `Refuse` 四个选项；获批的目录或会话范围在运行时持有期间覆盖同一会话树中的后续调用。凭据类路径（`~/.ssh`、`~/.aws`、`~/.config/gh` 目录与 `.env` 文件）直接拒绝，不提供申请。每次申请与决定都以 `specdev/scope-requested` / `specdev/scope-decided` 追加到拥有该调用树的会话。

工作区内的写入按调用角色的写入范围判定：implementer 可写整个工作区与其阶段产物，需求分析、代码探索、审查与验证角色只能写自己工作流目录与任意 `test-scripts/` 目录，wiki 角色可写 `docs/wiki/` 与 `.wiki-work/`。写出该范围时同样提问，卡片上写明角色与其可写位置。Orchestrator 不在此判定：它的 preset 已经收窄了工具（AC-22）。

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
- id: specdev-guard
  name: '@deepseek-ai/dsh-specdev-guard'
  inject: [specdev, tools, sessionProjections]
```

| 检查 | 行为 |
|---|---|
| HG / 阶段就绪 | gates 或 stage 未就绪时拒绝 implementer / reviewer* / verifier |
| UI 链就绪 | 计划声明 `ui: true` 的阶段原型未确认时拒绝 implementer / reviewer* / verifier；计划未把该阶段声明为 UI 时拒绝 `reviewer-visual` |
| Git 分支（implementer） | 分支 ≠ `impl-<current_phase>` 时拒绝（不创建分支） |
| 回炉上限 | `loop_count >= 2` 时拒绝并带 `escalate:user` |
| 状态镜像写入 | 禁止 write/edit `current-status.json`：该文件由工作流日志生成 |
| 工作区范围 | 任何路径越出工作区的调用先申请；没有可交互会话可应答时直接拒绝 |
| 角色写入范围 | `write` / `edit` / `str_replace_editor` 写出调用角色的范围时先申请（implementer：整个工作区；分析 / 探索 / 审查 / 验证：自己的工作流目录与 `test-scripts/`；wiki：`docs/wiki/` 与 `.wiki-work/`） |
| 凭据路径 | 拒绝 `~/.ssh`、`~/.aws`、`~/.config/gh` 下的读写与 `.env*` 文件，不提供申请 |
| 已批范围 | 目录或会话级批准在运行时持有期间覆盖同一会话树中的后续调用 |

配置项：`gitBranchReader`（分支读取器的测试钩子）与 `home`（范围判定使用的账号主目录，默认取宿主主目录）。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件：包装 dispatchRole、pre-step、pre-execute、guard |
| [`src/authority.ts`](src/authority.ts) | 日志折叠 / 失败关闭权威状态，镜像偏离检测（AC-28） |
| [`src/check.ts`](src/check.ts) | 纯函数角色矩阵判定 |
| [`src/git-branch.ts`](src/git-branch.ts) | `git branch --show-current` 读取 |
| [`src/scope.ts`](src/scope.ts) | 纯函数：路径提取、工作区包含判定、凭据清单、角色写入范围、放行 / 拒绝 / 申请 |
| [`src/enforce.ts`](src/enforce.ts) | 范围授权表、工作区与角色范围提问、决定事件 |
| [`src/events.ts`](src/events.ts) | `specdev/scope-requested` / `specdev/scope-decided` 载荷 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [SpecDev 运行时](../specdev/README.zh.md) — `confirmGate` 唯一 HG 写入路径、工作流日志权威、推进引导。
- [Tools](../../core/tools/README.zh.md) — `pre-execute` / `guard`。
- [用户提问](../../interaction/user-questions/README.zh.md) — 范围卡所依托的应答 seam。

-----

<a id="model-experience"></a>
## 模型体验

### Gate 拒绝

#### 模型看到什么

被拒绝的工具调用返回带 gate 原因的错误内容块。被拒绝的 `agent/pre-step` 使该步无法进入模型回合。`dispatchRole` 抛出的 `SpecdevGateDeniedError` 面向 Orchestrator（除非写入对话，否则不计入模型 token）。

#### Token 影响

在工具体执行前拒绝时无直接 token；若 Orchestrator/工具环在后续回合上报拒绝结果，则可能出现在后续模型上下文中。

#### KV Cache 影响

与模型缓存无关；gate 记账不改写对话前缀。

### 范围申请与拒绝

#### 模型看到什么

涉及工作区外路径的调用会阻塞到用户作答为止。获批的调用照常执行并返回自身结果：模型不会被告知批的是什么范围。被拒绝——或没有应答方可处理——的申请返回列出路径的错误块；被拒绝时错误块还带有用户备注，让模型可以改道而不是重试。写在工作区内但写出角色范围的调用同样提问，卡片上写明该角色与其可写位置。

#### Token 影响

每次被拒绝的调用以一个错误块代替工具输出；获批调用不额外消耗 token。

#### KV Cache 影响

与模型缓存无关：提问在带外完成，对话前缀不变。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- **分支创建/合并** — 本包只拒绝错误/缺失分支；`ensurePhaseBranch` / HG-3 git 合并属于 Phase 4。
- **产物预检** — Cursor gate 会检查 `repo-exploration.md` / `implementation.md` / `review.md`；当前矩阵覆盖阶段/gates/分支/回炉，更深产物校验随守卫范围工作落地。
- **不可见路径** — 在脚本、解释器一行式或 shell 变量中拼出的路径不会出现在守卫读取的命令行上；写仍由沙盒兜底，提示词也声明了这一限制。
- **范围授权是运行时状态** — 目录或会话级批准只存在于内存，随运行时进程结束失效，UI 目前没有撤销入口。
- **Orchestrator 的写入** — 根 agent 的写限制仍由 orchestrator preset 执行（AC-22）；本包的角色矩阵管辖派发出去的角色，角色没有写入范围时跳过。
- **凭据清单是固定的** — `~/.ssh`、`~/.aws`、`~/.config/gh` 目录与 `.env*` 名称是安全不变量而不是配置项，扩充只能改本包。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

**运行时不变式：** 不发布伴生入口。本包只对工具调用与角色调度做拒绝/放行/申请判定；门禁次序、产物前置条件与持久追加属于 `specdev` 运行时，范围授权是会话树内存而非持久状态。`tests/specdev-guard.spec.ts` 覆盖各条 gate 拒绝路径，`tests/scope.spec.ts` 覆盖纯路径提取、判定与角色写入范围，`tests/scope-enforce.spec.ts` 覆盖申请、批准、拒绝、取消、失败关闭与角色范围路径，`tests/loader-composition.spec.ts` 覆盖同一批检查经真实 Loader 从 `cordis.yml` 启动的情形。

</details>
