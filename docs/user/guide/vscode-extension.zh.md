# VS Code 扩展

[English](vscode-extension.md) | 中文

## 概述

`deepseek-ai.dsh-vscode-dsh` 扩展在 VS Code 内承载 `dsh --profile ide` 运行时：每个窗口启动一个 DSH 进程，经由 stdout 上的 SDK JSON-RPC 驱动它，并通过 Host bridge socket 提供 Conversation 面板、Timeline、History 和 Todo。扩展自身不携带运行时，因此一个可用的窗口 = 扩展 + `dsh` CLI + Node.js + 模型凭据；模型拿到的能力取决于该 CLI 启动的 profile。

## 目录

- [前置条件](#prerequisites)
- [加载扩展](#load-the-extension)
- [启动与停止](#starting-and-stopping)
- [运行时解析](#runtime-resolution)
- [Profile](#profiles)
- [在新设备上首次运行](#first-run-on-a-new-machine)
- [浏览器工具](#browser-tools)
- [故障排查](#troubleshooting)
- [延伸阅读](#further-exploration)

<a id="prerequisites"></a>
## 前置条件

| 要求 | 说明 |
|---|---|
| VS Code | `^1.90.0` |
| Node.js | `^22.19.0 || >=24.0.0`；扩展在启动前校验 `zlib.createZstdDecompress` 与 `Promise.withResolvers` |
| 一个 `dsh` 运行时 | 携带 `ide` profile 的 CLI 构建；扩展在每次启动时解析一个 |
| 模型凭据 | 环境变量或工作区 `.env` 中的 `DEEPSEEK_API_KEY` |

`ide` profile、其组合包与这个扩展来自同一分支，而不是某个已发布的 `@deepseek-ai/dsh` 发行版；部署必须由该 checkout 提供运行时。

<a id="load-the-extension"></a>
## 加载扩展

先构建再加载——host 半与 Webview 产物是两个独立输出：

```bash
pnpm install
pnpm run build
pnpm --filter dsh-vscode-dsh run build:webview
```

### 开发宿主

运行 `.vscode/launch.json` 中的 `Run dsh Extension (Cursor/VS Code)` 启动配置；它以 `--extensionDevelopmentPath=apps/vscode-dsh` 打开 Extension Development Host，并传入仓库的 `.env`。该配置在 `PATH` 与 `DSH_NODE_BIN` 中写死了一个 Node.js 路径；checkout 迁移到另一台设备时，请修改或删除这两个值。

### VSIX

```bash
pnpm --filter dsh-vscode-dsh run vscode:prepublish
cd apps/vscode-dsh
npx @vscode/vsce package
code --install-extension dsh-vscode-dsh-*.vsix
```

`vscode:prepublish` 会依次运行两个构建，因此打包出的 VSIX 携带 Webview 产物。只跑到 `pnpm run build` 的构建会因缺少 Webview 产物而让面板打开后空白。

<a id="starting-and-stopping"></a>
## 启动与停止

运行时生命周期由扩展掌管：激活本身只注册命令、视图与状态栏；第一个启动原因会为该窗口拉起一个 `dsh --profile ide` 子进程，之后的原因复用该子进程。

| 启动原因 | 触发方式 |
|---|---|
| `command-start` | `dsh.startSession` 命令 |
| `command-send` | 发送提示词、`dsh.newConversation`、`dsh.continueConversation`、`dsh.insertFileReference`，以及面板的「新建」/「继续」操作 |
| `status-bar` | 点击状态栏入口 |
| Conversation 可见性 | 显示 Conversation 面板（打开活动栏容器或 `dsh.showPanel`） |

扩展在 spawn 之前先监听 Host bridge socket，并把 `DSH_IDE_BRIDGE_SOCK` 传给子进程——审批、用户提问与 bridge RPC 都靠它承载。因此在终端里手工运行 `dsh --profile ide` 虽然能启动运行时，但审批请求会因没有 Host 监听而 fail-closed 为 `unavailable`；交互式会话请通过扩展启动。

用 `dsh.stopSession` 命令停止运行时；窗口 deactivate 时也会关闭该子进程。**DeepSeek Harness** 输出通道记录激活与启动事实，`dsh.showHostDiagnostics` 展示启动失败的结构化记录。

<a id="runtime-resolution"></a>
## 运行时解析

每个窗口在两个时机解析两个输入：激活时，以及每次启动时。

- Node.js：`DSH_NODE_BIN`，其次 `dsh.nodeBin` 设置，再次 Extension Host 自带的 Node.js。
- dsh CLI 入口：`DSH_BIN`，其次 `dsh.cliPath` 设置，再次工作区自己的 `@deepseek-ai/dsh` 依赖，再次工作区之上的 dsh checkout，再次 `PATH` 上的 `dsh`，最后是扩展自身的安装。

已配置但实际不存在的路径会让启动失败，而不是回退到自动来源。当没有任何来源提供运行时，激活会向 **DeepSeek Harness** 输出通道打印一行、逐一列出探测过的来源，启动则以 `dsh-entry` 失败，且不会打开任何 bridge socket。

<a id="profiles"></a>
## Profile

`dsh --profile ide` 启动一个 profile：位于 `$DSH_HOME/profiles/ide` 的目录（`$DSH_HOME` 默认为 `~/.dsh`）。

随附的 `ide` 模板依次叠加 `@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-sdk-app`、`@deepseek-ai/dsh-ide` 与 `@deepseek-ai/dsh-specdev-app`；Agent Teams、语音输入、自动评审与定时任务等可选组合包按 profile 添加。

| 文件 | 作用 |
|---|---|
| `package.json` | `dsh.profile.bundles`，该 profile 启动的有序组合包列表 |
| `cordis.yml` | Loader 根文件；启动器在每次启动时把它重写为 `[]`——不要编辑它 |
| `cordis.patch.yml` | 该 profile 的覆盖层 |
| `pnpm-workspace.yaml` | `dsh plugin` 安装树外插件所用的 pnpm 设置 |
| `compatibility.json` | 精确版本豁免：用于 DSH peer 范围不匹配的插件 |
| `node_modules/` | 用 `dsh plugin` 安装的包；组合包本身优先从安装解析 |

各层的应用顺序：按 `dsh.profile.bundles` 顺序应用每个组合包的 patch 文件，然后是 profile 的 `cordis.patch.yml`，然后是 home 级 `$DSH_HOME/cordis.patch.yml`（机器本地偏好，因此优先级高于 profile 层），最后是 `--patch` 覆盖文件。

三条 patch 规则在实践中最重要：按 id 的 patch 会整块替换该行的 `config`，因此必须重述你要保留的字段；空的或只有注释的 `cordis.patch.yml` 会导致启动失败，要禁用该层请写 `[]`；`!!js` 表达式只允许出现在 `config` 与 `disabled` 下。

Profile 初始化与组合包解析：

- 首次 `dsh --profile ide` 会按随附的 `ide` 模板创建 profile；已存在的 profile 永不改写，因此由旧模板创建的 profile 会保留它记录的组合包列表。
- 组合包优先从正在运行的 dsh 安装解析，其次才从 profile 目录解析，因此组合始终与启动它的 CLI 一致。
- `@deepseek-ai/dsh` peer 范围不匹配的组合包在该次启动中被跳过，并在 stderr 报告 `skipping profile bundle ...`；用 `dsh plugin --profile ide allow-version <package@version> --dsh-version <version> --accept-risk` 授予豁免。
- `dsh plugin --profile ide add <package>` 把参数转发给 profile 目录内的 pnpm，并自动启用声明了 bundle 的包；安装已经自带的组合包只需把它的名字写进 `dsh.profile.bundles`。

不启动应用即可查看组合：

```bash
dsh --profile ide --dump-config
dsh --profile ide --dump-default-config
```

`--dump-config` 按来源文件与 patch 层分组打印组合后的行；`--dump-default-config` 只打印组合包层，从而把"用户 patch 坏了"与"组合本身坏了"区分开。

<a id="first-run-on-a-new-machine"></a>
## 在新设备上首次运行

1. 检出本分支并依次运行 `pnpm install` 与 `pnpm run build`。
2. 把扩展指向运行时：将 `dsh.cliPath` 设为该 checkout 的 `apps/cli/lib/bin.js`，或把该入口链接到 `PATH`；将 `dsh.nodeBin` 设为一个受支持的 Node.js。
3. 在环境变量或工作区 `.env` 中提供 `DEEPSEEK_API_KEY`。
4. 加载扩展：从仓库 F5 启动，或安装打包出的 VSIX。
5. 让首次启动按随附模板创建 `~/.dsh/profiles/ide`。不要从其他设备拷贝 profile 目录——已存在的 profile 会保留它记录的组合包列表。
6. 用 `dsh --profile ide --dump-config` 验证：每个组合包的行都出现，且 stderr 没有 `skipping profile bundle` 行。

<a id="browser-tools"></a>
## 浏览器工具

本分支携带两套彼此独立的浏览器栈。

| 栈 | 包 | 面向模型的工具 | 启用方式 |
|---|---|---|---|
| 浏览器 seam + Playwright 提供方 | `dsh-browser`、`dsh-browser-playwright`、`dsh-tool-browser` | 11 个 `browser_*` 工具：导航、快照、点击、输入、按键、console、network、截图、trace 录制与关闭 | `ide` 组合默认启用并配好回环白名单；其它部署在自己的层里重述 `tool-browser` 与 `browser-playwright` 两行 |
| browser-use 提供方 | `dsh-browser-use` 加一个实验性提供方 | 上游 MCP 工具名，如 `mcp__playwright-mcp__browser_*`、`mcp__chrome-devtools-mcp__*`，或 Stagehand 的 `stagehand_*` 工具 | 在 profile 中挂载该服务与恰好一个提供方行 |

`ide` 组合默认启用面向模型的行，白名单只放行本机回环地址（`localhost`、`127.0.0.1`、`0.0.0.0`，含 http 与 https），因此新设备开箱即可驱动本地 dev server；导航只接受绝对 http(s) URL，无论白名单怎么写，`file://` 及其它协议都不可达。要放宽 origin、打开可见窗口或为 trace 归档补 `traceDir`，在部署自己的 patch 层里重述 `browser-playwright`——按 id 的 patch 会整块替换该行的 `config`。公网页面用 `web_fetch` 读取（只允许公网目的地）。browser-use 栈不被任何随附组合挂载：使用它需要把实验性提供方包装进 profile 并添加一个提供方行，且共享服务拒绝第二个提供方。

<a id="troubleshooting"></a>
## 故障排查

| 现象 | 原因 | 处理 |
|---|---|---|
| 启动以 `dsh-entry` 失败并报 `dsh runtime check failed — source: none` | 没有解析到任何 CLI 来源 | 把 `dsh.cliPath` 或 `DSH_BIN` 设为本分支的 `apps/cli/lib/bin.js` |
| 启动报 `profile "ide" does not exist` | 解析到的 CLI 是不含 `ide` 模板的发行构建 | 换用本分支的构建 |
| 面板打开后空白 | Webview 产物从未构建 | 运行 `pnpm --filter dsh-vscode-dsh run build:webview` |
| 启动在 Node.js 校验处失败 | 解析到的 Node.js 低于 22.19 或缺少所需 API | 把 `dsh.nodeBin` 或 `DSH_NODE_BIN` 指向受支持的 Node.js |
| stderr 出现 `skipping profile bundle ...` | 组合包的 DSH peer 范围与该运行时不一致 | 授予豁免，或换用匹配的构建 |
| 浏览器调用报 `BROWSER_PROVIDER_UNAVAILABLE` | `browser-playwright` 的白名单解析为空，或该行加载失败 | 在 `dsh --profile ide --dump-config` 中检查该行的 `allowedOrigins` |

<a id="further-exploration"></a>
## 延伸阅读

- [扩展 host README](../../../apps/vscode-dsh/README.zh.md)——命令、视图、bridge 传输与测试钩子。
- [IDE profile 组合包](../../../packages/bundle/ide/README.zh.md)——`ide` profile 在 `base` 与 `sdk-app` 之上叠加了什么。
- [Profile](../../../packages/boot/app-boot/README.zh.md#profiles)——组合包组合、运行时解析与 patch 语义。
- [浏览器 seam 工具](../../../packages/browser/tool-browser/README.zh.md)与[browser use](../../subsystems/browser-use.zh.md)——两套浏览器栈。
- [配置模型](providers.zh.md)——模型提供商、路由与凭据。
