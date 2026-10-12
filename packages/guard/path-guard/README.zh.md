---
description: "面向工具调用的路径审批 guard：识别到的路径参数落在工作区根目录与配置白名单之外时，调用不再执行而转为用户审批提示，供选择、配置或排查此插件的用户与维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-path-guard

[English](README.md) | 中文

## 概述

使用本包让涉及文件的工具调用默认留在工作区内，除非用户另行批准。一个 `tools/pre-execute` 监听器把它识别到的路径参数解析为绝对路径，当每个路径都位于工作区根目录或 `Config.allowedPaths` 之内时放行调用；只要有路径在外，调用就转为审批提示，并指出工具名与第一个越界路径。guard 只询问而不阻止，只检查固定的工具参数名表，并在插件加载时固定工作区根目录。`packages/bundle/ide` profile 以空的 `allowedPaths` 挂载它。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当工具调用只有经用户同意才能触达工作区外的文件时，挂载此插件。检查只是一个监听器加一个配置字段，组合中的其他部分不变。

### 何时选择

当工具读写的文件默认应留在工作区根目录下、`allowedPaths` 能列出保持预批准的目录、且有用户随时回答偶发的提示时，选择它。当部署必须直接禁止外部访问时——guard 只会询问，而没有审批通道的 `ask` 在工具运行时中会变为拒绝——以及当关键路径以 shell 命令内的形式到达 harness 时（因为 guard 从不解析命令文本），避免使用它。

### 设置

用保持预批准的目录挂载插件：

```yaml
- name: '@deepseek-ai/dsh-path-guard'
  config:
    allowedPaths:
      - /absolute/path/to/a/shared/directory
```

`allowedPaths` 默认为 `[]`，`packages/bundle/ide` profile 就以该默认值挂载插件，因此在添加条目之前，工作区根目录是唯一自动批准的位置。条目是按原样比较的目录根；请给出绝对路径，因为相对条目永远不会匹配解析后的目标。

### 你会得到什么

每个被识别的调用都会把其路径参数解析到工作区根目录。当它们全部落在该根目录或某个允许路径之内时，监听器用 `next()` 委派，调用与没有此插件时完全一样地运行。当至少有一个落在外时，监听器返回 `ask` 而不是结果：理由是 `Tool "<name>" accesses path outside workspace: <path>`，先列出第一个越界路径，其余路径追加 `and <n> more`；`displayReason` 为该句提供英文及其中文翻译，用于审批提示。随后工具运行时通过其审批通道解析该决定，调用只在 `allowed-once` 时执行。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释 guard 如何把工具名与其参数映射为解析后的路径，并把越界路径转为 `ask` 决定，并指出实现它的代码位置；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计理念

guard 建立在四项承诺之上：

- **只询问，绝不拒绝。** 监听器要么用 `next()` 委派，要么返回 `ask`；拒绝、取消与审批结果解析都留在工具运行时。
- **固定的已知参数表。** `TOOL_PATH_ARGS` 列出每个被识别工具的路径参数，因此表未列出的工具不会贡献路径，它的参数名也不会被猜测。
- **shell 文本不在范围内。** `bash` 与 `pwsh` 只贡献 `workdir` 和 `cwd`；命令字符串不被解析，因为其中的路径无法可靠读出。
- **两种生命周期。** 工作区根目录在插件加载时从 `process.cwd()` 捕获一次，而 `allowedPaths` 在每次调用时通过 `Volatile` 读取，因此重写白名单的部署在下一次工具调用时生效，而不是在加载时。

### 调用如何被分类

一个 `tools/pre-execute` 监听器看到每一次分发的调用。当 `exec.arguments` 是普通对象时它读取该值，否则视为没有参数；随后按工具名选择路径参数：已知工具取 `TOOL_PATH_ARGS` 条目——`read`、`read_image`、`write`、`edit`、`lsp` 用 `file_path`；`str_replace_editor`、`glob`、`grep` 用 `path`——`bash` 与 `pwsh` 取 `workdir` 和 `cwd`。只有非空字符串才计数。每个路径都相对捕获的工作区根目录解析，因此相对参数解析到那里，而不是解析到某次 shell 调用自己的 `workdir`；绝对参数按原样保留。监听器读取当前的 `allowedPaths` 快照，保留每个既不是工作区根目录、也不是其后代的已解析路径，比较的是规范化字符串，“在内”指相等，或以 `base` 加平台路径分隔符为前缀。没有路径留在外面时它返回 `next()`；否则返回 `ask`，理由见[使用本包](#use-this-package)。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`name`／`inject`／`apply`、`TOOL_PATH_ARGS` 与 shell 参数表、`Config` schema、`tools/pre-execute` 监听器 |
| — | 不发布运行时不变式伴生入口；此 guard 不拥有包级事件历史，也不拥有所拦截 `tools/pre-execute` 阶段之外的可变数据关系。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当本包自身的细节不够用时阅读以下页面。它们从工具 waterfall（瀑布式事件）进入插件配置与 guard 组映射。

- [工具子系统参考](../../../docs/subsystems/tools.zh.md)——`tools/pre-execute` waterfall（瀑布式事件）、`PreToolDecision`，以及 `ask` 到审批通道的路径。
- [生成配置目录](../../../docs/config-catalog.zh.md)——每个可加载插件接受的配置字段。
- [guard 组映射](../README.zh.md)——同组的 guard 包与循环卫生家族。

-----

<a id="model-experience"></a>
## 模型体验

### 提示审批而非直接执行

#### 模型看到什么

此插件不添加提示词段落、工具 schema 或结果内容。被放行的调用产生工具自己的普通结果。当路径落在外时，调用不执行，模型收到的是工具运行时对该 `ask` 的结果：用户批准一次后工具自己的结果，或用户拒绝、取消提示、或没有可用审批通道时的拒绝错误。插件提供的理由与 `displayReason` 面向审批提示，而不是面向模型。

#### Token 影响

被放行的调用不增加 token。越界路径本身不添加内容：获批准的调用贡献其正常结果，被拒绝的调用则以一条简短错误结果取代工具输出。

#### KV Cache 影响

仅追加；新可见内容位于可复用请求前缀之后，不会使现有 KV Cache 条目失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制说明 guard 何时不合适。它们是当前包约束，不是任务积压。

- **整个进程共用一个工作区根目录**——根目录是插件加载时捕获的 `process.cwd()`，因此它不按会话或按 agent 区分，也不会跟随之后的目录切换；希望把另一目录视为工作区的会话需要把该目录加入 `allowedPaths`，或从该目录启动进程。
- **shell 命令文本从不被解析**——`bash` 与 `pwsh` 只贡献其 `workdir`／`cwd` 参数，因此写在命令字符串里的路径不被检查，这类调用只有在工作目录位于工作区根目录之外时才会被发现。
- **只检查已列出的工具名**——guard 从 `TOOL_PATH_ARGS` 读取路径参数，因此任何其他工具的路径、以不同名称挂载的已知工具、以及已知工具新增的路径参数都不被检查。
- **包含判断是字符串包含**——路径在 `node:path` 规范化后比较，因此工作区内指向外部的符号链接会被放行。
- **白名单条目按原样比较**——`allowedPaths` 条目只做规范化、从不解析，因此相对条目匹配不到任何已解析目标，并静默地什么都不允许；请使用绝对目录路径。
- **提示只列出第一个越界路径**——其余越界路径以 `and <n> more` 报告，因此用户在没有看到调用触及的每个路径时就做出了批准。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本开发备注是维护者的工作上下文，明确不具权威性——已交付的行为与限制以上文和包代码为准。

无：本包没有记录的待决维护问题，`src/index.ts` 也没有 `TODO`、`FIXME` 或 `XXX` 标记。

</details>
