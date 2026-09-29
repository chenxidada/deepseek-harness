# Chat UI 骨架 —— L4 截图辅助（AC-7a）

[English](README.md) | 中文

B1–B3 的主要证据是 `phase3-chat-ui-chassis.spec.ts` 里的 **L2/L3**
（`test:theme-tokens`、`test:bubble-layers`、`test:composer-contrast`、`test:visual-evidence-chain`）。

在真实 Extension Host 跑完后，可在此处可选地抓取 L4 截图（不要用像素比色自动化）：

| 文件 | 覆盖内容 |
|------|--------|
| `B1-theme-light.png` | 默认浅色主题；`--vscode-*` 可读 |
| `B1-theme-dark.png` | 切换后的深色主题；不存在长期不可读残留 |
| `B2-bubbles-composer.png` | 用户/助手气泡分层 + 固定底部 Send 栏 |
| `B3-markdown-code.png` | 标题/列表/围栏代码 + Copy 入口 |

把抓到的 PNG 放在本 README 旁边。缺少 PNG **不会**让 L2/L3 门禁失败；验证者可以把它们作为辅助证据附上。
