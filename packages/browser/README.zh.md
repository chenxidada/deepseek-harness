---
description: "浏览器自动化能力家族的包映射：ctx.browser seam、其 Playwright 后端，以及面向模型的浏览器工具。"
kind: "package-group"
---

# browser/：浏览器自动化能力家族

[English](README.md) | 中文

## 概述

`browser/` 组为 harness 提供真实浏览器：打开页面、读取其无障碍树、对树中列出的元素执行操作、读取控制台与网络历史、把截图保存为图片附件，以及记录可回放的 trace。部署挂载一个后端，seam 在会话打开时挑选可用的提供方，因此面向模型的工具保持稳定，而后端可以更换。该组只拥有浏览器自动化——页面抓取与文本提取仍归 web 能力，提供方的 origin 白名单决定会话可以加载什么。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

三个包分别承担 browser 角色；子系统参考文档拥有穷尽式词汇与约定。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`browser/`](browser/README.zh.md) | 浏览器自动化服务：提供方注册表、执行期提供方选择、按对话拥有会话 | `ctx.browser` |
| [`browser-playwright/`](browser-playwright/README.zh.md) | 通过 Playwright 驱动自启浏览器或已运行的浏览器 | 注册到 `ctx.browser` |
| [`tool-browser/`](tool-browser/README.zh.md) | 向模型公开十一个 `browser_*` 工具 | 注册到 `ctx.tools` |

-----

<a id="related-documentation"></a>
## 相关文档

先从子系统参考文档了解共享词汇，再看后端与挂载在其上的工具。

- [browser 子系统](../../docs/subsystems/browser.zh.md)——会话请求与 spec、闭集的动作与观测联合类型、提供方可用性，以及 `BrowserError` 错误码分类体系。
- [Browser use](../../docs/subsystems/browser-use.zh.md)——另一套浏览器集成：只做注册的服务，其实验性提供方各自拥有自己的工具名。
- [dsh-browser-playwright](browser-playwright/README.zh.md)——随包交付的后端、其 launch 与 attach 模式，以及 origin 白名单。
- [dsh-tool-browser](tool-browser/README.zh.md)——启用方式、十一个工具，以及模型看到的内容。

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
