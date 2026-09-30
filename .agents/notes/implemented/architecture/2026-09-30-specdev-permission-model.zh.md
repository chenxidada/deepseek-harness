# Agent Note: SpecDev 权限模型——工作区范围检查、角色写入范围与申请卡

Status: implemented

[English](2026-09-30-specdev-permission-model.md) | 中文

## 问题

SpecDev 守卫管辖角色派发与 Human Gate，却不管文件系统。角色 agent 可以读取 `/etc/hosts`、`~/.ssh/id_rsa` 或宿主机上任意路径，`find /` 只差一次工具调用；而且没有任何记录。写入只对 Orchestrator 收窄——靠它 preset 的工具白名单（AC-22）：派发出去的 implementer、reviewer 或 verifier 可以写工作区内任意文件，包括别的工作流的产物。

Cursor 时代的 hook 带路径黑名单，却没有申请通道：项目之外的路径直接被拒，用户只能从模型读到的拒绝里事后得知。「看见 agent 想访问什么、由用户决定、并让这个决定约束其后的会话」在 harness 中没有归宿。

## 决策

### 两重判定，一张卡片

`dsh-specdev-guard` 在 `tools/pre-execute` 上装一个范围执行器。它读取一次调用涉及的所有路径——工具路径参数与 shell 命令行——并做两重判定：

- **工作区范围**（读与写）：落在会话工作区之外的路径，需要用户批准后才执行。
- **角色写入范围**（写工具）：`write` / `edit` / `str_replace_editor` 写在工作区内、但写出调用角色写入范围的调用，同样需要批准。

两种判定都通过 `ctx.userQuestions` 汇成同一个提问——即 ask-user 工具已经在用的卡片，因此面板无需新的 IDE 协议就能渲染路径、角色、工具、递归提示与自由文本备注。卡片提供 `Allow once`、`Allow this directory`、`Allow for this session` 与 `Refuse` 四个选项。

### 角色写入范围

| 角色 | 免申请可写 |
|---|---|
| `implementer` | 整个工作区（源码与本阶段产物） |
| `requirement-analyst`、`plan-generator` | `.specdev/specs/<slug>/` |
| `code-explorer`、`reviewer`、`reviewer-*`、`verifier` | `.specdev/specs/<slug>/` 与任意 `test-scripts/` 目录 |
| `wiki` | `docs/wiki/`、`.wiki-work/`、`.specdev/specs/<slug>/` |
| `orchestrator` | 不在此判定——它的 preset 已收窄工具（AC-22） |

没有角色元数据的 agent 交给沙盒。

### 授权随会话树存活

调用属于拥有它的会话树，授权同样如此：执行器通过该树的根 agent 提问（提问 seam 只应答存活的运行时根），并把获批的目录或会话范围记在该根会话 id 下。运行时持有期间，该范围覆盖根之下的所有会话，并随进程结束失效。

### 凭据路径直接拒绝，不提供申请

`~/.ssh`、`~/.aws`、`~/.config/gh` 与 `.env*` 文件无论在工作区内外都直接拒绝，拒绝文本让模型改去请人提供该值。这份清单是代码里的安全不变量，不是配置项。

### 每次申请与决定都留痕

两种判定都以 `specdev/scope-requested` 与 `specdev/scope-decided` 追加到该树的根会话，与它所管辖的调用树事件同处一处。工作流日志仍是工作流的权威：范围授权是有会话作用域的运行时事实，重启即失效，不属于工作流状态。

## 考虑过的替代方案

**复用 `ctx.approval.request` 而不走提问 seam。** 审批 seam 本就在把关「这次工具调用能不能跑」。否决：它只带一句原因字符串，返回 allowed-once 或 rejected，没有路径、选项与备注位，而这里的决定是「放开哪个范围」。

**改为给审批 seam 加详情字段与自由文本。** 一种卡片覆盖两种场景。否决：为一个消费者扩大一个只回答「这次能不能跑」的 seam，而提问 seam 已经能渲染详情、选项与自由文本。

**像 Cursor hook 那样直接拒绝工作区外访问。** 最简单也最安全。否决：排查环境问题本来就要读项目之外的文件，一刀切会把「我需要 `/etc/hosts`」变成死路，而不是一个用户可以做的决定。

**直接向调用的角色子代理提问。** 否决：提问 seam 只应答存活的运行时根，派发出去的子代理会得到 `CALLER_NOT_LIVE`；根也是授权天然的归属处，因为那正是用户所在的会话。

**把范围决定写进工作流日志。** 每个工作区一份持久记录。否决：日志是工作流权威，被该工作区上的所有会话共享，而授权应当随批准它的运行时失效。

**把角色写入范围做成 `Config` 字段。** 各部署可以自带矩阵。否决：矩阵是产品的角色契约——角色提示词与产物契约都是照着它写的——无人校验的配置面只会与它们漂移。凭据清单出于同样的理由遵循同一条规则。

**把范围强制放进第二个插件。** 一个插件管一件事。否决：两种判定产出同一张卡、共用一份授权表、写同样两个事件；门禁插件本来就已改名为 `specdev-guard`，指向它接下来拥有的这个面。

## 后果

越出工作区的读现在会阻塞到用户作答。在没有应答方的组合里——headless 运行、SDK——调用被拒绝而不是默认放行，拒绝文本里带错误码。

授权覆盖根会话之下的所有 agent，包括之后才派发的角色；`Allow this directory` 打开的是该目录下的任意路径，而不只是提问的那个角色。目前没有撤销入口；状态卡的当前生效范围一行就是撤销将来出现的位置。

矩阵管辖的是参数里带路径的写工具。由 shell 命令完成的写（`echo x > file`、`sed -i`）根本不会被判定为写：shell 路径都是读主体，这类命令写什么仍由沙盒兜底。守卫把这个限制明确告诉模型，而不是假装覆盖了它。

守卫现在会过问 agent 的每次工具调用，因此挂载了它却没有用户提问服务的组合，对工作区外访问会以 `SPECDEV_SCOPE_...` 拒绝，并记录一条 `unavailable` 决定。

## 测试

`packages/specdev/specdev-guard/tests/scope.spec.ts` 钉住纯判定：从命令行与参数提取路径、工作区包含判定、凭据拒绝、每个角色的写入范围以及三种判定结果。`packages/specdev/specdev-guard/tests/scope-enforce.spec.ts` 钉住强制执行：工作区外的读与写先申请并留痕、角色写出自身范围时卡片带该角色的限制、获批目录与会话授权覆盖后续调用、拒绝时把用户备注带回模型、凭据不经卡片直接拒绝，以及没有应答方、没有根 agent 或缺用户提问服务时失败关闭。`packages/specdev/specdev-guard/tests/loader-composition.spec.ts` 让守卫经真实 Loader 从 `cordis.yml` 启动，在其中重跑申请、拒绝留痕、工作区内放行与凭据拒绝。

## 相关

面向用户的工作流全貌见 [SpecDev 子系统](../../../../docs/subsystems/specdev.zh.md)；[工作流权威 Agent Note](2026-09-29-specdev-workflow-authority.zh.md) 拥有本权限模型所依托的门禁、日志与挂载决策；申请卡所依托的 seam 属[用户提问包](../../../../packages/interaction/user-questions/README.zh.md)；已执行的检查清单见[守卫 README](../../../../packages/specdev/specdev-guard/README.zh.md)。
