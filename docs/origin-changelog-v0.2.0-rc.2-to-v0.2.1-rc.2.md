# origin 变更清单（dsh-v0.2.0-rc.2 → dsh-v0.2.1-rc.2）

**结论：对 IDE 插件无实质性影响，无需同步。**

- 时间跨度：2026-10-04 ~ 2026-10-15
- 总 commit 数：1925
- 中间版本：5 alpha + 2 rc
- 文件变更：4292 files, +160,608 / -40,643
- 新增包：30+
- BREAKING CHANGES：无
- SESSION_FORMAT_VERSION：不变（4）
- SCHEMA_VERSION（SQLite）：不变（8）

---

## dsh-v0.2.1-alpha.1（2026-10-04）— 266 commits

| 类别 | 主要内容 | IDE 相关 |
|---|---|---|
| 重构 | 移除 runtime invariant plugins | 无影响 |
| SDK | 工作目录集中化（centralize working directories） | 低，与本地 path-guard 改动方向一致 |
| SDK | 嵌套 subagent task 跨 SDK/ACP await 修复 | 无影响（runtime 内部） |
| Subagent | Codex hook partial_answer 支持 | 无影响 |
| LLM | pi-ai reasoning levels 读取 | 低，IDE 透传 string |
| CUA | 初始框架和 MCP/Native 两个 provider | 无影响（实验性，不启用） |

## dsh-v0.2.1-alpha.2（2026-10-07）— 669 commits

| 类别 | 主要内容 | IDE 相关 |
|---|---|---|
| SDK | 显式 session resume（`session/resume` wire 方法） | 无影响（IDE 走 bridge 不走 SDK stdio） |
| SDK | Native DeepSeek Flash 翻译（后被移除） | 无 |
| CUA | 坐标映射、截图格式、系统指针 hover | 无影响 |
| Web | provider-aware model label、终端发现共享 | 无影响（Web 专有） |
| Desktop | Windows 签名打包、Task Scheduler 监管 | 无影响 |
| 插件系统 | HMR 热替换（package 文件变更时替换插件） | 无影响（runtime 内部） |
| UI/Chat | 单帧折叠动画 | 无影响（Web 专有） |

## dsh-v0.2.1-alpha.3（2026-10-10）— 852 commits

| 类别 | 主要内容 | IDE 相关 |
|---|---|---|
| CUA | hover UI、剪贴板消费、macOS 面板修复 | 无影响 |
| Web | 插件市场 Discover tab、Custom markets bundle | 无影响 |
| 远程访问 | RBAC policies、non-owner gate、资源过滤 | 无影响 |
| Desktop | COS 发布工作流、更新频道分离 | 无影响 |
| LLM | 提供方元数据生成、凭据检测状态 | 低，本地已做了对应的 UI 支持 |
| LLM | 响应转换空文本和旧会话重放修复 | runtime 内部修复 |
| 账号 | 通知层叠、头像加载恢复 | 无影响（Web/Desktop 专有） |

## dsh-v0.2.1-alpha.4（2026-10-12）— 89 commits

| 类别 | 主要内容 | IDE 相关 |
|---|---|---|
| 插件系统 | 内建预览标准化、双语 SVG、badge skill | 无影响 |
| subprocess | Linux native containment systemd 兼容 | 无影响（IDE 走 terminal exec） |
| 凭据 | credentials-local 外键处理和 reload 警告 | runtime 内部 |

## dsh-v0.2.1-alpha.5（2026-10-13）— 36 commits

| 类别 | 主要内容 | IDE 相关 |
|---|---|---|
| CUA | screenshot reference、持久系统指针 | 无影响 |
| prompts | PTC guidance 和 SDK persona 恢复 | runtime 内部 |
| minimal | 工具配置和 image offload 恢复 | 无影响 |

## dsh-v0.2.1-rc.1（2026-10-14）— 4 commits

| 类别 | 主要内容 | IDE 相关 |
|---|---|---|
| release | 版本号 bump | 无 |

## dsh-v0.2.1-rc.2（2026-10-15）— 9 commits

| 类别 | 主要内容 | IDE 相关 |
|---|---|---|
| Web | DeepSeek Search/Fetch API（设置开关） | 无影响 |
| Web | DeepSeek Flash 1017 临时 badge | 无影响 |
| LLM | Flash display name 加 1017 后缀 | 无影响 |
| release | 版本号 bump | 无 |

---

## 破坏性评估

| 风险点 | 影响 | 说明 |
|---|---|---|
| SDK Resume API | 无 | IDE 走 bridge 帧协议，不走 SDK stdio，两条独立通道 |
| Runtime Invariant 移除 | 无 | ide profile 未挂载任何 invariant 插件 |
| 工作目录集中化 | 低 | 与本地 path-guard 改动方向一致，合并时需关注 |
| 30+ 新增包 | 低 | pnpm glob 自动发现，ide profile 未引用 |
| Pi-AI Reasoning Levels | 低 | IDE 以 string 透传，新增 level 透明 |

## 新增包清单（30+）

主要新增包均为实验性功能或与 IDE 无关的领域：

- `remote-access` — 远程访问 RBAC
- `plugin-market` / `plugin-market-generator` — 插件市场
- `cua` / `cua-macos` — Computer Use Agent
- `hooks-claude-code` / `hooks-codex` — Claude Code/Codex 桥接
- `session-inspector` / `session-search` — 会话检查与搜索
- `cot-translation-bundle` — 思维链翻译（已移除）
- `badge-skill-bundle` / `skill-badge` — 技能徽章
- `tool-terminal` / `terminal-bundle` — 终端工具
- `ui-deepseek-model-label-1017` — Flash 1017 临时标签
- `ui-plugin-market` / `ui-secret-mask` — 插件市场 UI / 密钥遮罩
- `harness-dev-context` — 开发上下文
- `ralph-bundle` / `tool-ralph` — Ralph 工具
- `tool-worktree` / `tool-session-query` — 工作树和会话查询工具

**总计 1925 commits，对 IDE 插件有实质影响的：0 个。**
