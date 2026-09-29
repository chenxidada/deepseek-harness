# Agent Note: IDE 扩展从环境解析自己的 dsh 运行时

Status: implemented

[English](2026-09-29-ide-runtime-resolution-from-environment.md) | 中文

## 问题

不是 dsh 仓库的窗口无法启动会话。扩展只从工作区往上找 `apps/cli/lib/bin.js`，否则就交给 SDK 客户端从扩展自身目录 `import.meta.resolve('@deepseek-ai/dsh/package.json')` 兜底，而独立 VSIX 对这条路径的回答是 `Cannot find package '@deepseek-ai/dsh'`。没有任何设置、环境变量或诊断说明缺了什么，于是仓库之外的每个项目都以模块解析错误失败。

它旁边的 Node 可执行文件早已有预检：`DSH_NODE_BIN` / `dsh.nodeBin` 两个杠杆与五要素诊断。而 IDE 真正启动的运行时一个都没有。

## 决策

`apps/vscode-dsh/src/dsh-entry-guard.ts` 按窗口解析 dsh CLI 入口 —— 激活时一次、每次启动再一次 —— 顺序为：`dshBin` 启动选项、`DSH_BIN`、`dsh.cliPath` 设置、工作区自己的 `node_modules/@deepseek-ai/dsh`、工作区上方的 dsh 检出、`PATH` 上的 `dsh`，最后是扩展自身的安装。自动来源从最具体到最不具体，最后一环正是自带运行时的 VSIX 会被找到的位置，其余部分无需改动。

显式配置的路径若不存在就让解析失败，而不落到自动来源，因为被静默忽略的 `DSH_BIN` 恰恰是诊断要暴露的那个配置错误。每个失败都点名来源、它检查过的入口或它探查过的来源、实际状态、期望，以及同时点名两个杠杆的修复办法。

`PATH` 安装经全局安装写下的链接、或 shim 旁的 npm/pnpm 布局解析到入口，因此用户终端里本来就能跑的 `dsh` 无需配置即可使用。入口随后用预检校验过的那颗 Node 启动，而不是 shim 会选的那颗，Node 要求因此仍受检查。

激活时向 `DeepSeek Harness` 输出通道写一行：入口、提供它的来源、其包声明的版本，并与扩展自身的版本并列，版本不一致不阻塞。没有任何来源提供运行时的窗口在加载时报出完整诊断，并给出设置页与输出通道两个动作；这类窗口里的启动在任何 bridge socket 打开之前就以新增的 `dsh-entry` 类失败。

## 考虑过的替代方案

**保留检出目录的向上查找，把安装方式写进文档。** 扩展在仓库内本来就能用。否：这让扩展只能在自己的源码所在处使用，而那个缺陷正是本次要修的。

**直接把 `PATH` 上找到的 `dsh` shim 当命令启动。** 这样可以完全跳过包布局的解析。否：shim 会从 `PATH` 里自选 Node，Node 预检就无法再挡在坏 Node 与运行时之间。

**运行时版本与扩展不一致时阻止启动。** SDK 客户端自己的安装路径强制版本相等。否：dsh 与扩展一起开发时，先后重建是常态，因此不一致只在加载期那行里报告，不阻塞。

**把运行时打进 VSIX。** 完全没有环境依赖，解析链也不再需要。否：运行时是一棵带平台相关部分、有自己发布节奏的包树，打包它等于把打包、升级与平台矩阵搬进扩展。

## 后果

运行时从此是扩展的一个配置面：`dsh.cliPath`（machine-overridable）与 `DSH_BIN` 指定它，自动来源覆盖项目依赖、检出目录与用户 `PATH` 上的安装。

`HostFailureKind` 增加 `dsh-entry`，`StartErrorKind` 增加对应成员，`HOST_DIAGNOSTIC_SCHEMA_VERSION` 升到 3；记录字段集不变，入口路径在 `detail`，修复办法在 `hint`。`dsh-entry` 失败还会给出设置页深链，而此前只有缺少凭据才会给。

每次启动现在都需要能解析出入口，因此两次启动之间失去运行时的窗口报的是 `dsh-entry`，而不是子进程退出。

## 测试

`CAP-SESSION-HOST-153`–`162` 覆盖解析顺序、`PATH` 的几种形态、显式路径的失败即报错、被探查来源的报告、相对路径与无版本的入口；`CAP-SESSION-HOST-163` 覆盖 `dsh-entry` 启动失败、其记录，以及不再打开任何 socket；`CAP-SESSION-HOST-164` 与 `CAP-SESSION-HOST-165` 覆盖加载期那一行与加载期失败及其动作。
