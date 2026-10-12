---
description: "面向部署方与维护者的 IDE 终端 Bash 执行器说明，用于选择、配置或排查在 VS Code 集成终端中运行的模型侧命令。"
kind: "package-reference"
---

# @deepseek-ai/dsh-bash-ide-terminal

[English](README.md) | 中文

## 概述

`dsh-bash-ide-terminal` 通过 IDE 桥接把每条模型侧 Bash 命令放到 VS Code 集成终端中运行，用户可以看着它以自己的 shell 环境执行。它继承隔离栈，只新增一个开关：`terminal: 'ide'`（默认）使用集成终端，`terminal: 'sandbox'` 运行继承的沙箱执行器。集成终端无法隔离任何东西，因此解析模式比 `danger-full-access` 更窄的会话会收到可操作的拒绝，而不是以非隔离方式运行。IDE 部署选它；命令必须在某个沙箱模式下运行时，请组合隔离执行器。

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

当 IDE 部署希望模型侧命令运行在用户看得见的地方时，挂载此执行器。它替代隔离行注册为 `ctx.shell`，要求已连接的 Extension 桥接，并在未连接时显式失败，而不是把命令放到用户看不到的地方运行。

### 何时选择它

当组合挂载了 `@deepseek-ai/dsh-ide-bridge`，并希望每条命令都以用户自己的 shell 环境在其终端中可见地运行时，选择此执行器。会话必须隔离运行时应改选 `dsh-bash-sandbox`：本执行器无法强制任何模式，受限会话只会被拒绝，而不会被限制执行。该执行器仅支持 Bash——随附的 IDE profile 在 Windows 上禁用其行，并保留 `pwsh-sandbox` 行。

### 最小配置

所有继承字段都有默认值，因此只有该条目也能工作；隔离栈（`ctx.sandbox`、`ctx.sandboxPolicy`）必须已经挂载，因为本类继承沙箱执行器及其注入列表。

```yaml
- id: bash-ide-terminal
  name: '@deepseek-ai/dsh-bash-ide-terminal'
  config:
    terminal: ide
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `terminal` | `'ide'` | 由哪个栈运行模型侧命令：`ide` 使用集成终端，`sandbox` 使用继承的隔离执行器 |
| `cwd` | `process.cwd()` | 命令的默认工作目录 |
| `timeoutMs` | `120,000` | 默认前台超时，单位为毫秒 |
| `maxTimeoutMs` | `600,000` | 每次调用超时覆盖值的上限 |
| `maxOutputBytes` | `64,000` | 每流内存输出上限；`ide` 下即保留的终端尾部 |
| `maxSpillBytes` | `67,108,864` | 继承 subprocess 路径上每流完整输出的 spill 上限 |
| `graceMs` | `3,000` | 继承 subprocess 路径上终止升级与退出后管道排空的宽限时间 |

继承字段就是生成式配置目录中为 [`dsh-bash-local`](../../../docs/config-catalog.zh.md#deepseek-aidsh-bash-local) 记录的字段；`terminal` 是唯一新增项。

### 选择执行栈

`terminal: 'ide'` 把每条模型侧命令发送给 IDE 桥接：终端与进程都由 Extension 拥有，命令继承用户的 shell 环境。`terminal: 'sandbox'` 原样运行继承的隔离路径，因此结果会报告沙箱模式、拒绝与执行完整性事实。一个取值为整个部署选定一个栈，单条命令绝不会在两个栈之间拆分。

当选择 IDE 栈而会话解析出的模式不是 `danger-full-access` 时，调用会在任何终端启动之前被拒绝，因为终端无法隔离该命令。模型读到的是 `the IDE terminal runs commands unconfined, so sandbox mode "<mode>" cannot be honored there; switch this session to the danger-full-access permission preset, or switch the execution terminal back to the sandbox in the settings page`。模式取自调用方标记的每次调用 `sandboxPolicy`，否则取部署的 `ctx.sandboxPolicy.defaultMode`。

携带 `stdin` 的 spec 也会保留隔离栈：集成终端无法提供它，而设置它的调用方是进程内 hook 桥接，不是模型侧工具调用。后台命令会占用专用终端，因此绝不会排在会话的前台命令之后。

<a id="adjusting-the-switch-at-runtime"></a>
### 运行时调整开关

`terminal` 是每条命令执行时读取的 volatile Config 字段，因此设置界面无需重启即可为运行中的 Host 切换执行栈；插件页面编辑当前执行器的 profile 条目。完整 Config 验证会在表单写入磁盘前拒绝 `ide` 或 `sandbox` 之外的任何取值。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释执行器的设计并指出实现它的代码位置；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计概念

本执行器是 `ctx.shell` seam 上面向 IDE 的 Service Provider：它继承 `SandboxBashExecutor`，因此命令解析、deadline 融合与原因分类、隔离路径以及 subprocess 机制都来自 `dsh-bash-local` 与 `dsh-bash-sandbox`，本包只新增一个决定——由哪个栈运行命令。选择 `ide` 时命令交给 `ctx.ideTerminals`，由 Extension 拥有的服务持有终端与进程。执行器把终端的原始文本整理成模型可读的形式：删除 ANSI 与 C0 控制序列，把回车覆盖改写为换行，去掉终端回显的命令行，并只保留字节上限内的尾部。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`IdeTerminalBashExecutor`、`Config`、执行栈决策、终端执行路径与输出规范化 |
| — | 不发布运行时不变式伴生入口；执行器把观测委托给终端桥接、沙箱提供方与 subprocess 服务，因此不拥有任何可能发散的独立可观察关系。 |
| `tests/index.spec.ts` | 已演练的行为：拒绝消息、终端输出规范化、命令回显剥离、有界输出缓冲 |

### 主要流程

`execute` 首先读取 `terminal`：`sandbox` 委托给继承的隔离路径，`ide` 则从 spec 的 `sandboxPolicy` 或部署默认值解析模式，并拒绝任何比 `danger-full-access` 更窄的模式。携带 stdin 的 spec 同样委托。否则，命令、工作目录与会话 id 会启动一次 `ctx.ideTerminals.execute()` 调用；后台命令使用专用终端，`onExpiry: 'kill'` 时还会布置一个融合 deadline 信号来驱动终端取消。

终端分块先被规范化，再写入以 `stdoutMaxBytes` 为上限的 `TerminalOutputBuffer`；句柄用终端的退出码、本地的超时与中止分类、作为 `stdout` 的保留尾部、空的 `stderr`，以及 `sandbox: { mode: 'danger-full-access', denied: false }`——即命令实际运行时的模式——投影出 `result()`。启动握手前的桥接失败会拒绝调用；运行期间的失败会作为提示发布在观测到的 stderr 流上，并让 `result()` 以原始错误拒绝。

### 不变式与归属

- 隔离栈保持挂载，`sandboxMode` 保持对外声明，因此在 IDE 栈运行命令期间，权限预设、升级流程以及沙箱执行器贡献的工具 schema 都继续工作。
- 只有 `danger-full-access` 可以在 IDE 栈上运行：终端不具备任何隔离机制，因此更窄的模式会被拒绝，而不是以非隔离方式运行。
- 终端与命令进程由 Extension 拥有；取消只是执行器转发的一个信号，结算仍以终端自身的退出帧为准。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当执行器配置不够用时阅读以下页面。这些页面从 shell 家族讲到拥有终端的桥接。

- [shell 组地图](../README.zh.md) —— 执行器家族，以及组合如何只选择一个实现。
- [bash-local](../bash-local/README.zh.md) —— 本执行器继承的命令解析、预算与结果分类。
- [bash-sandbox](../bash-sandbox/README.zh.md) —— `sandbox` 设置运行的隔离路径，以及拒绝消息引用的模式名称。
- [ide-bridge](../../ide/ide-bridge/README.zh.md) —— 终端能力、其就绪事实，以及由 Extension 拥有的执行。
- [Bash 执行器子系统](../../../docs/subsystems/shell.zh.md) —— 请求/spec 词汇、结果与完整的服务定义。
- [配置目录](../../../docs/config-catalog.zh.md) —— 包配置字段的生成式参考。

-----

<a id="model-experience"></a>
## 模型体验

### 间接的 Bash 工具结果

#### 模型看到的内容

通过 `dsh-tool-bash`，模型读到的是终端输出规范化后的内容：ANSI 转义与 C0 控制序列被删除，回车覆盖被改写为换行，首个分块中终端回显的命令行被去掉。保留的文本是受 `maxOutputBytes` 限制的字节尾部；更早的字节被丢弃时，其 `truncated` 标志会被置位。

#### Token 影响

普通终端输出作为工具结果进入请求，并保留到上下文压缩。命令产出超过 `maxOutputBytes` 时，只发送保留的尾部。

#### KV Cache 影响

仅追加；新可见内容位于可复用的请求前缀之后，不会使现有 KV Cache 条目失效。

### 间接的 Bash 工具错误

#### 模型看到的内容

被执行栈检查拒绝的调用会在任何终端启动之前失败，错误为 `the IDE terminal runs commands unconfined, so sandbox mode "<mode>" cannot be honored there; switch this session to the danger-full-access permission preset, or switch the execution terminal back to the sandbox in the settings page`。桥接未连接时会以 `the IDE terminal is unavailable: the Extension bridge is not connected` 失败。运行期间的失败会在句柄观测到的 stderr 流上发布 `IDE terminal output failed: <error>` 或 `IDE terminal execution failed: <error>`——折入恰好一个 `readOutput()` 增量并置于 `[stderr]` 分段下——并让 `result()` 以原始错误拒绝。

#### Token 影响

拒绝与不可用文本各是一句短句，在当次调用可见，并保留在历史中直到上下文压缩。运行中失败的提示会在承载它的流上增加一句固定说明加错误文本。

#### KV Cache 影响

仅追加；新可见内容位于可复用的请求前缀之后，不会使现有 KV Cache 条目失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制说明本执行器何时不合适。它们是当前包约束，不是路线图。

- **IDE 终端不是沙箱**——模式比 `danger-full-access` 更窄的会话会收到拒绝，而不是受限执行；没有任何设置能让终端强制文件或网络限制。
- **开关是部署级的**——`terminal` 为本执行器服务的每条命令选定一个栈，因此会话无法只为自己选择终端，而让另一个会话保持隔离。
- **输出与取消属于终端桥接**——终端与进程由 Extension 拥有，本执行器只规范化收到的分块并转发一个取消信号，保留的尾部只存在于内存中，因此早于 `maxOutputBytes` 的字节已经丢失，没有 spill 文件可以恢复。
- **仅支持 Bash**——随附的 IDE profile 在 Windows 上禁用本行并保留 `pwsh-sandbox` 行，本执行器也没有 PowerShell 对应实现。
- **携带 stdin 的调用无法使用终端**——它保留继承的隔离路径，因此即使在 `terminal: 'ide'` 下，这类调用也会报告隔离栈的沙箱事实；模型侧调用从不设置 `stdin`。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本备注是工作上下文，不是权威；行为由源码与测试负责。

`src/index.ts` 不含任何 `TODO`、`FIXME` 或 `XXX` 标记，因此本包没有声明自己的延期工作。

</details>
