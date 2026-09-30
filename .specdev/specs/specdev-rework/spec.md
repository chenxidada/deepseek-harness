# SpecDev 重构 Spec（待确认）

工作流：`specdev-rework`
状态：需求与蓝图已与用户逐条确认，等待确认本文件后开工。
说明：本文件是新系统的第一份产物；新机制落地后拆分为 `requirements.md` / `design.md`。

---

## 1. 背景与问题

现有 SpecDev（`packages/specdev/**`，5 个包）把 `.cursor` 的 spec 驱动开发搬进了 dsh，但实现方式是「提示词 + shell 脚本 + 自己解析 JSON」，没有用 harness 原语，导致三类问题：

1. **权限与访问范围缺失**：只有「orchestrator 工具白名单」「禁写 `current-status.json`」「角色前置门禁」三层，没有路径范围、没有审批介入、没有分阶段沙箱；读侧完全不受限。信任建立在「谁都能写文件」之上。
2. **冗余**：`rolePresetId`（2 份）、分支名 `impl-<phase>`（2 份）、git 分支读取（2 套实现，超时不同）、gate id（3 份）、role 词表（3 份）、流程指令（4 份拷贝：preset persona / dispatch / guidance / 命令返回文本）；constitution 模板代码版与磁盘版已分叉；`ui-spec-template.md` 零引用；`command` 与 `initiating_command` 字段漂移；三份状态源（per-slug json、`workflows.json`、会话投影）并存并靠补丁式合并。
3. **hook 未结合 dsh 特性**：`.cursor` 的 6 个 shell hook 中，只有「拦派发/拦写入」的职责被部分继承，且散落在工具 guard 与 IDE 侧；dsh 原生的拦截点（`agent/pre-step`、`tools/pre-execute`、`subagent/end`、`ctx.approval`）、hook 协议、系统提示段、结构化子代理验收都没有用起来。

同时暴露出**权威源错误**：工作流状态由可变 JSON 文件充当权威，`implementation.md` / `review.md` / `verification.md` 谁都能写 → 调度者可以伪造产物通过 HG-3（`.cursor` 版 CHANGELOG 自陈同类问题）。

## 2. 需求

| 编号 | 需求 |
|---|---|
| R1 | 保留流程语义：阶段（需求 → 设计 → 逐阶段实施 → 收尾）、人工门（HG-1、HG-1.5、HG-2、原型确认、Phase Entry Gate、HG-3）、角色与产物契约 |
| R2 | 命令收敛为 5 个：`/feature`、`/bugfix`、`/spec`、`/implement`、`/status`；门禁确认**只在面板**（提供命令为兜底，不再作为主要入口）；砍掉 `/brief`；`/wiki` 保持现状不在本次范围 |
| R3 | 补全 UI 线：HG-1.5 视觉基准、原型确认门禁、reviewer-visual 角色 |
| R4 | 状态权威 = 追加型工作流日志；多会话共享同一条工作流；`current-status.json` 降级为自动导出的只读镜像 |
| R5 | 权限模型：默认最小范围；**越界不是一刀砍，而是「说清想访问什么 + 为什么 → 用户在面板批准 → 按批准范围生效」**；申请与决定全部留痕 |
| R5.1 | 范围判定覆盖**命令**：任何命令（`find`、`grep -r`、`rg`、`ls`、`cat`、`du`、重定向写……）解析出的路径落在工作区外即申请；递归遍历类命令额外提示「整盘/递归扫描」风险；凭据黑名单直接拒绝 |
| R6 | IDE 面：面板内门禁确认卡（**必须支持自由文本输入**）、加厚的 phase 状态卡、产物清单与打开跳转、消息内 `路径:行号` 可点、越界申请卡 |
| R7 | 挂载：独立 bundle `dsh-specdev-app`，仅 ide profile 引用；sdk-app 摘除 specdev；`packages/sdk/server` 对 specdev 的硬依赖降级为可选 |

## 3. 非目标

- 不重构 wiki 线（`docs/wiki`、`.wiki-work`、wiki agent）。
- 不迁移 `.specdev/specs/` 下已存在的历史 slug（无日志者显示「未纳管（只读）」）。
- 不做多人协作、不做远端同步。
- 不兼容 `.cursor/hooks.json` 的 shell hook 运行方式（规则保留，机制换成原生插件）。

## 4. 设计

### 4.1 包结构（5 → 4）

| 包 | 职责 |
|---|---|
| `dsh-specdev` | 状态机 + 工作流日志 + 投影 + 门禁规则 + 5 个命令 + 角色派发（吸收原 `specdev-gate`、`specdev-advance`、`command-specdev`） |
| `dsh-specdev-guard`（新） | 权限范围：路径范围判定（读写两侧 + 命令参数）、越界申请、批准范围生效、审计 |
| `dsh-specdev-presets` | 角色 preset：persona + 工具视图 + 范围矩阵元数据 |
| `dsh-specdev-app`（bundle，新） | 组合上述三个包与 IDE 侧能力；仅被 ide profile 引用 |

规则、推进逻辑、命令文本各只有一份来源。

### 4.2 权威状态：工作流日志

- 路径：`<workspace>/.specdev/specs/<slug>/workflow.jsonl`，只追加。
- 行格式：`{v, seq, at, kind, payload, prev}`；`prev` 为上一行哈希 → 手改/删除可被检测（哈希链断裂即拒绝信任，并在面板显示）。
- 事件（12 类）：`workflow/init`、`gate/pending`、`gate/decided`、`phase/planned`、`phase/entered`、`dispatch`、`artifact/written`、`review/verdict`、`advance`、`scope/requested`、`scope/decided`、`export`。
- 唯一写入者是插件；`current-status.json` 由插件自动导出（文件头标注 generated），不再被读取为权威。
- 产物有效性由日志登记决定：未被 `artifact/written` 登记的 `implementation.md` / `review.md` / `verification.md` 不作为门禁证据。
- 投影 `specdev/status` 从日志折叠，任意会话一致；IDE 继续使用 `specdev/snapshot` 帧。
- 多会话：日志按工作区共享，任意会话执行 `/implement` 都作用于同一条工作流；并发写用文件锁 + `seq` 冲突检测；冲突时提示而不是覆盖。

### 4.3 门禁

保留规则：阶段前置产物、角色前置条件（plan-generator 需 HG-1、reviewer/verifier 需 HG-2、implementer 需 `impl-<phase>` 分支与 `loop_count<2`）、三视角审查合并（MUST-FIX 不推进）、Phase Entry Gate 债务、原型确认。

实现形态：`agent/pre-step` 拒绝非法派发 + `tools/pre-execute` 拒绝写权威文件/产物伪造 + 状态机推进。

留痕：每次判定写 `gate/decided{gate, decision, note}`；拒绝时返回原文原因。

### 4.4 权限模型

| 层 | 默认 | 越界 |
|---|---|---|
| 读（工具与命令解析出的路径） | 工作区 | 申请 |
| 写 | 按角色矩阵（implementer=工作区源码 + 本阶段产物；reviewer/verifier=仅自己产物；orchestrator=仅门禁记录） | 申请 |
| 执行 | 沙盒档位（read-only / workspace-write / danger-full-access） | 申请升档（仅本次有效） |

- 角色矩阵：orchestrator（read-only，仅写门禁记录）、explorer / reviewer / verifier（read-only，仅写自己产物与 `test-scripts/`）、implementer（workspace-write，限工作区源码 + 本阶段产物）；合并/提交/放行需审批。
- 命令路径判定：解析 bash 命令的路径参数（绝对路径、相对路径、`~`、`..`、`-C`、重定向、`-exec`、管道分段），得到「想访问的路径集合」后按上表判定；递归遍历类（`find`、`grep -r`、`rg`、`ls -R`、`du`、`tree`）越界时在卡片标注「整盘/递归扫描」。
- 直接拒绝（不提供申请）：`~/.ssh`、`~/.aws`、`~/.config/gh`、`.env` 等凭据类路径；清单后续可扩充。
- 申请粒度：仅这一次 / 该目录（本会话内）/ 整个会话（本会话内）；会话结束失效；状态卡显示当前生效的放行范围。
- 全部申请与决定写 `scope/requested` / `scope/decided`。
- 已知边界（明确接受）：`sh -c`、变量拼接、脚本内路径、解释器一行式等不可见的读写无法在命令层判定；写由沙盒兜底，读依靠「命中即问 + 留痕」降低概率，提示词同时声明软约束。

### 4.5 hook 收敛

只保留一个 hook 插件（`dsh-specdev-guard`：门禁拦截 + 权限范围 + 申请），其余职责收敛到状态机、提示段、结构化验收与 UI。

| `.cursor` hook | 去向 |
|---|---|
| `pipeline-gate.sh` | `agent/pre-step` + `tools/pre-execute`（并入门禁规则一份） |
| `shell-guard.sh` | 并入 `specdev-guard` 的范围判定（黑名单 deny、越界申请） |
| `context-snapshot.sh` | 砍掉（状态在日志与投影中，压缩不影响；需要留痕时用 telemetry） |
| `session-recovery.sh` | 换成**系统提示段**：每次请求注入当前工作流状态摘要 |
| `drift-reminder.sh` | 换成**结构化验收**：派发带验收条件，`subagent/end` 校验不通过则追加提醒（不自动续跑） |
| `status-health.sh` | 归 UI：状态卡 + `/status`，不做 hook |

### 4.6 IDE 面

- **门禁确认卡**：面板内联卡片，含工作流、阶段、就绪产物、判定依据、风险提示、**多行自由文本备注**（通过时可选、打回时必填、延后时可选）与三个按钮（通过并推进 / 打回修改 / 延后）。决策与备注写日志；取消现有「卡片只发意图、决策在 QuickPick」的做法。
- **phase 状态卡**：阶段进度（DAG 位置）、HG 状态、当前角色、债数、下一动作按钮、最近放行范围。
- **产物清单与跳转**：按阶段列出产物，点击在编辑器打开（带行号即跳行）。
- **文本路径可点**：消息正文中的 `路径:行号` 自动成为可点链接（与 `@` 引用卡同行为）。
- **越界申请卡**：复用审批卡容器 + 详情区（角色、动作、目标路径/命令、理由、风险、范围选项）。

### 4.7 挂载

- 新增 bundle `dsh-specdev-app`；`packages/boot/app-boot` 的 ide profile 引用它；`sdk-app` 摘除 specdev 各行（`/plan` 冲突问题随之消失）。
- `packages/sdk/server` 去掉对 `dsh-specdev` 的硬依赖（改为可选服务）。
- 同步更新：bundle `dependencies`（`verify-cordis-config` 要求）、`docs/config-catalog.md`（生成物）、`packages/specdev/*/README.md`、`docs/subsystems/specdev.md`。

## 5. 阶段计划

| 阶段 | 内容 | 验收 |
|---|---|---|
| 0 骨架 | 4 个包拆分；工作流日志 + 投影 + 导出；5 个命令；门禁规则搬入核心，**行为与今天等价** | 现有 specdev 测试等价通过；ide profile 能跑通一条完整流程 |
| 1 权限 | `specdev-guard`：角色矩阵、命令路径判定、申请/批准（含自由文本）、审计、申请卡 | 越界读写与 `find /` 触发申请；批准后放行；黑名单拒绝；决定入日志 |
| 2 UI 线 | HG-1.5 视觉基准、原型确认门禁、reviewer-visual | 流程涵盖 UI 需求；缺口补齐并可验证 |
| 3 IDE 面与收尾 | 门禁卡（含自由文本）、状态卡加厚、产物跳转、文本链接；sdk-app 摘除；文档与快照 | 面板闭环；`test:docs` 与相关快照通过 |

## 6. 测试与文档策略

- 门禁穿透测试：伪造 JSON/产物不生效；越界读写被拒或转申请；批准范围与会话绑定；哈希链断裂被识别。
- 每个阶段带真实组合测试（Loader + cordis.yml），不只手搭 `ctx.plugin`。
- 模型可见的新输入必须有会话事件；SDK 双份期望输出在改动当次同步。
- 非平凡改动附 Agent Note；README 与 JSDoc 与代码同步。

## 7. 遗留与已知边界

- 凭据黑名单待用户补充（当前 `~/.ssh`、`~/.aws`、`~/.config/gh`、`.env`）。
- 命令层判定的不可见路径（`sh -c`、脚本、解释器一行式）为已知限制。
- Windows 沙盒仅 partial，范围判定在该平台以工具层为主。
- 工作流日志的哈希链**无法校验最后一行**（没有后继行与之矛盾）；缓解：最后一行声明的状态同时由导出的 `current-status.json` 镜像与会话事件交叉比对，阶段 1 的守卫在追加时把尾哈希写入会话事件作为锚点。
