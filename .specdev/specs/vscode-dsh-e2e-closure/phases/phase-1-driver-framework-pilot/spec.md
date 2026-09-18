# Phase 1: 层 V 多能力驱动编排框架 + 主呈现路径打样

## 目标

复用 usable-loop 的层 V 冒烟闭环基座，建立可承载「真实功能能力清单」41 项能力的多能力驱动编排框架，并用 editor-chat-panel 主呈现路径（§12.1 React SPA 主呈现 + §12.2 编辑器单例 Panel）打样出「操作序列 + 截图 + 断言」范式。本 Phase 是后续 Phase 2/3/4 的骨架，也是偏差 4（editor-chat-panel 层 V 视觉证据）的直接产出。

## 前置条件

- 依赖 spec 文件：`../requirements.md`（AC-1~AC-6）、`../design.md`（AD-1~AD-4）、`../repo-exploration.md`（§3/§4/§6/§12.1/§12.2）。
- 无前置 Phase（`dependencies: []`）。
- 真机环境：Xvfb + `code` CLI（假设 A1）；本 Phase 打样不强制真实 LLM（主呈现路径为 host 侧渲染），但需 `DEEPSEEK_API_KEY` 用于后续模型往返能力（AC-9），无 key 时相关能力以 `SKIPPED_NO_CREDENTIALS`（exit 3）fail-closed。

## 验收标准（本 Phase 覆盖）

| AC | 内容（摘要） |
|----|------|
| AC-1 | 复用 `run-layer-v-smoke.sh` 的显示/Node/沙箱/凭证/进程回收逻辑，不得从零重建 |
| AC-2 | 无显示有 Xvfb 自动拉起；既无显示又无 Xvfb 以 `SKIPPED_NO_DISPLAY`（exit 2）退出，不得记为通过 |
| AC-3 | 每步操作序列与断言结果以 JSONL 逐步追加写入 journal（`test-artifacts/layer-v/`），中途崩溃可定位失败点 |
| AC-4 | 每个被验证能力至少 1 张真实 PNG 截图；复用显示上重复捕获不得全部共享同一 md5 |
| AC-5 | 遵循退出码/结论契约 0/1/2/3/4，结论不得合并、降级、猜测 |
| AC-6 | 覆盖清单以 workflow 级 code-explorer 的「真实功能能力清单」为唯一依据（§12，41 项，附 `路径:行号`） |

## 验证策略

> 本 Phase 以运行时验证（真机闭环）为主。涉及基座复用性/清单对应性的 AC 用静态检查辅助。

| AC | 验证类型 | 验证方法 | 预期结果 |
|----|---------|---------|---------|
| AC-1 | 静态检查 + 运行时验证 | ① 检查 `run-layer-v-smoke.sh` 与新编排脚本均 `source` 同一 `layer-v-support/layer-v-runtime.sh`，且该库的显示解析/Xvfb/Node 解析/沙箱 HOME/凭证门控/`launch_host`/进程回收函数体与 smoke.sh 原函数一致（`diff` 无行为改动）；② 跑基座冒烟确认行为不变 | ① 无重复实现（grep 新脚本中无第二份 Xvfb/Node/沙箱逻辑）；② 基座冒烟结论与改动前一致 |
| AC-2 | 运行时验证 | ① 在 `DISPLAY` 为空但有 Xvfb 的环境跑 `run-layer-v-capabilities.sh --capability cap-editor-panel-singleton`；② 在既无显示又强制禁用 Xvfb 的环境跑同一命令 | ① 自动拉起 Xvfb 完成运行，exit 0；② exit 2 且结论 `SKIPPED_NO_DISPLAY`，状态记录不为 PASS |
| AC-3 | 运行时验证 | 跑一次打样闭环，检查 `test-artifacts/layer-v/layer-v-journal.jsonl` 的追加语义 + 注入一次中途崩溃（kill 驱动进程）后重跑 | ① journal 每行含 `capability`/`step`/`verdict` 且按时间顺序追加；② 崩溃后重跑仍能按 `capability`/`step` 定位上次失败点 |
| AC-4 | 运行时验证 | 跑一次打样闭环，收集该能力的全部 PNG，计算 md5；对同一能力触发多次捕获 | ① 每能力 ≥1 张 PNG；② 复用显示上多次捕获的 md5 不全部相同（非退化证据） |
| AC-5 | 运行时验证 | 分别构造：正常跑 / 链接失败 / 无显示 / 无凭证 / harness 缺陷（缺输入文件）五种场景 | 依次 exit 0/1/2/3/4，结论分别为 PASS/LINK_FAILURE/SKIPPED_NO_DISPLAY/SKIPPED_NO_CREDENTIALS/HARNESS_ERROR，无合并/降级 |
| AC-6 | 静态检查 | 解析 `layer-v-capabilities.json`，逐项比对 repo-exploration.md §12 的 41 项编号，检查每项附 `路径:行号` 证据 | manifest 41 项与 §12 一一对应，无缺漏、无引用已废弃功能（thin HTML / Tier-3 全文搜索不在列）；每项证据 `路径:行号` 有效 |

## 约束（来自 design.md）

- **AD-1**：提取共享运行时库，`run-layer-v-smoke.sh` 改为 `source`（行为保持）；不得复制函数体、不得整体 `source`（`main "$@"` 无守卫，`:3149`）。
- **AD-2**：新增独立 `layer-v-capability-driver/extension.cjs`，不改既有 `layer-v-driver/extension.cjs`；复用其 `StageError` 分类与断言原语。
- **AD-3**：覆盖清单落地为 `layer-v-capabilities.json`（`id`/`group`/`ac`/`requiresModel`/`steps`）。
- **AD-4**：断言用关键区域存在 + 非退化，不逐像素比对。
- **层 V 只读产品代码**：不装东西、不写真实 `~/.dsh`、不用 UI 自动化/回放伪造证据（`run-layer-v-smoke.sh:39-41`）。
- **退出码契约**：0/1/2/3/4，结论永不合并/降级/猜测（`run-layer-v-smoke.sh:32-37`）。

## 产出清单

```
apps/vscode-dsh/test-scripts/
├── layer-v-capabilities.json              # 新增：41 项能力清单（本 Phase 至少含 §12.1/§12.2 打样项）
├── run-layer-v-capabilities.sh            # 新增：能力编排脚本（source 共享库）
├── layer-v-support/layer-v-runtime.sh     # 新增：共享运行时库（自 smoke.sh 提取）
└── layer-v-capability-driver/
    ├── extension.cjs                      # 新增：多能力驱动扩展
    ├── package.json                       # 新增
    └── capability-runner.cjs              # 新增：按 manifest 驱动 runStep
apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh  # 修改：source 共享库（行为保持）
```
