# 架构设计 — vscode-dsh 完整能力链真机端到端闭环验证

> 工作流 slug：`vscode-dsh-e2e-closure`
> 本文件由 plan-generator 产出，是 HG-2 方案确认与后续 Phase 实施的架构依据。

## 范围覆盖

本设计覆盖整个工作流（5 个 Phase，见 `phase-plan.md` DAG）。交付物为三类，全部落在 `apps/vscode-dsh/` 与 `.specdev/specs/*/`：

1. **层 V 真机驱动代码**：复用 `run-layer-v-smoke.sh` 基座，新增多能力驱动编排框架，把真机 EDH 覆盖从 usable-loop 扩展到 repo-exploration §12 的 41 项真实功能能力。
2. **清除 mock/过时测试/过时验证产物**：按 repo-exploration §14 清单驱动，留痕删除。
3. **修复审计遗留偏差 5（lib 陈旧 chunk）与偏差 6（`const enum FiberState`）**。

`ui_relevant: false`：本工作流不新增/修改任何产品 UI 视图文件；截图是**验证证据**（由 verifier 断言「真机是否跑通」），不是「被设计的界面」。

## 现状依据

| 事实（本设计依赖的现状） | 证据 |
|------|------|
| 层 V 冒烟闭环基座 `run-layer-v-smoke.sh` 已存在（约 3149 行），其 `main` 为单一入口 | `apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh:3090` |
| 层 V 退出码/结论契约：0=PASS / 1=LINK_FAILURE / 2=SKIPPED_NO_DISPLAY / 3=SKIPPED_NO_CREDENTIALS / 4=HARNESS_ERROR，且「never merged/downgraded/guessed」 | `apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh:32` |
| 基座声明 installs nothing、不写真实 `~/.dsh`（route A 所有写落在沙箱 HOME）、不用 UI 自动化/回放 | `apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh:39` |
| 基座关键函数可被复用：`set_conclusion` / `cleanup` / `launch_host`，但 `main "$@"` 在文件底部**无守卫地立即执行**（不可简单 `source`） | `apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh:217`、`:306`、`:1413`、`:3149` |
| 层 V 驱动扩展 `extension.cjs`（约 2441 行）实现五步范式 runStep1-5 | `apps/vscode-dsh/test-scripts/layer-v-driver/extension.cjs:928`、`:1050`、`:1090`、`:1188`、`:1607` |
| React SPA 唯一生产呈现入口是编辑器单例 Panel 控制器（模块级 `panel` 变量） | `apps/vscode-dsh/src/chat-panel/editor-chat-panel.ts:161` |
| React SPA 的 `webview.html` 由编辑器 Panel 控制器注入 | `apps/vscode-dsh/src/chat-panel/editor-chat-panel.ts:218` |
| 会话主链路发起提示 `promptActive` | `apps/vscode-dsh/src/conversation-controller.ts:1617` |
| 消息存储流式 patch `patchMessage` | `apps/vscode-dsh/src/message-store.ts:69` |
| 全量状态推送 `pushFullState` | `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts:392` |
| `messages/append` 与 `messages/patch` 协议类型 | `apps/vscode-dsh/src/chat-panel/protocol.ts:114`、`:123` |
| thin HTML 面板 `buildThinChatHtml` 已 `@deprecated`、fixture-only、生产不调用 | `apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts:190` |
| Tier-3 全文搜索有意缺席（`TIER3_FULL_TEXT_SEARCH_API = null`） | `apps/vscode-dsh/src/search/session-search.ts:136` |
| 偏差 5：tsdown `clean: false`，导致 lib 陈旧 chunk 不清理 | `apps/vscode-dsh/tsdown.config.ts:18` |
| 偏差 5：`package.json#files` 用 `lib/*.js` 通配，囊括全部 19 个 chunk | `apps/vscode-dsh/package.json:24` |
| 偏差 6：`const enum FiberState` 定义（无运行时对象） | `vendor/cordis/src/fiber.ts:147` |
| 偏差 6：`agent-loop` 顶层 `new Set([FiberState.UNLOADING, ...])` 运行时读值，source-plane 下崩溃 | `packages/core/agent-loop/src/index.ts:39` |
| vendor 本地修改记录已把 `fiber.ts` 登记为第 6 条「lifecycle hardening」；同步流程要求重放本地修改 + 更新 manifest + 跑 test/build | `vendor/README.md:38`、`:53` |
| 层 V 基座已有 machine-readable 产物机制（`layer-v-support/artifact-index.cjs` 是 `main` 的必需输入，artifact-index/journal/status 由基座与驱动协同产出） | `apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh:3095` |

> 说明：以上证据全部来自 workflow 级 `repo-exploration.md` 并已逐条核对（文件存在 + 行号不越界）。影响架构决策的现状断言均为 ✅ CONFIRMED。

## 架构摘要

复用 usable-loop 已建立的层 V 冒烟闭环（Xvfb + `code` CLI + 驱动扩展 + 退出码契约），把覆盖从「usable-loop 自身功能」扩展到「当前代码真实实现的 41 项能力」。做法是：**提取共享运行时库**（从 `run-layer-v-smoke.sh` 抽出显示/Node/沙箱/凭证/进程回收原语）+ **新增能力编排层**（`run-layer-v-capabilities.sh` + 独立 `layer-v-capability-driver/extension.cjs` + 机器可读能力清单 JSON），用 editor-chat-panel 主呈现路径打样范式后，按能力清单分批驱动、截图、断言。偏差 5/6 与 mock 清除作为独立可验收 Phase，最后用一条全链编排命令串起闭环并跑回归护栏。

## 核心实体 / 数据模型

### 能力清单 manifest（新增，JSON）

```jsonc
{
  "capabilities": [
    {
      "id": "cap-editor-panel-singleton",
      "group": "react-spa-main",
      "ac": ["AC-7"],
      "requiresModel": false,
      "steps": [ { "kind": "command", "command": "dsh.startSession" }, { "kind": "assert", "selector": "[data-testid=editor-chat-root]" } ]
    }
  ]
}
```

- `id`：能力唯一标识（与 §12 清单编号一一对应，可追溯）。
- `group`：能力分组（对应 §12.1–§12.12）。
- `ac`：该能力覆盖的验收标准。
- `requiresModel`：是否涉及真实 LLM 往返（true → 强制 `DEEPSEEK_API_KEY`，AC-9）。
- `steps`：EDH 操作序列（command / inject / wait / assert / screenshot）。

### journal 行（沿用既有 JSONL 结构）

```jsonc
{ "ts": "...", "capability": "cap-editor-panel-singleton", "step": "assert-root", "verdict": "PASS", "evidence": ["step-N.png"], "detail": "..." }
```

沿用 `test-artifacts/layer-v/layer-v-journal.jsonl` 的逐步追加语义（AC-3），新增 `capability` 字段定位失败点。

### 运行状态记录（run-status）

```jsonc
{ "capabilities": { "cap-<id>": { "conclusion": "PASS|FAIL|SKIPPED", "evidence": [...], "failedStep": null } }, "exitCode": 0 }
```

AC-17 的机器可读产物；AC-18 要求任一能力 FAIL → 非 0 退出码 + 标注失败步骤。

## API 域

本工作流不新增/修改任何产品 API 端点。涉及的能力面：

- **复用驱动宿主 API**：`extension.cjs` 的 `StageError` 分类（`extension.cjs:97-114`）与五步 `runStepN` 断言原语，被新驱动扩展复用（require/import 形态）。
- **复用产品测试钩子**：`dsh.test.*` 命令（`src/extension.ts:1011-1264`，仅测试模式注册）可作为驱动注入/观察点；但 **AC-9 明确禁止**以 `dsh.test.answerApproval` / session 回放等注入/模拟作为「模型往返」闭环的等价验收 —— 涉及模型往返的能力必须走真实 `DEEPSEEK_API_KEY`。

## 实现方案

### 总体文件产出计划

**新增（层 V 能力编排 + 驱动）：**

```
apps/vscode-dsh/test-scripts/
├── layer-v-capabilities.json              # 41 项能力清单（唯一覆盖依据，机器可读）
├── run-layer-v-capabilities.sh            # 全链能力编排脚本（复用运行时库）
├── layer-v-support/layer-v-runtime.sh     # 共享运行时库（从 smoke.sh 提取，见 AD-1）
└── layer-v-capability-driver/
    ├── extension.cjs                      # 多能力驱动扩展（复用 base driver 原语）
    ├── package.json
    └── capability-runner.cjs              # 按 manifest 驱动 runStep
```

**修改（偏差修复 + 清理）：**

```
apps/vscode-dsh/tsdown.config.ts           # 偏差 5：clean: false → true（或等效）
apps/vscode-dsh/package.json               # 偏差 5：files 收窄（去掉 lib/*.js 通配陈旧面）
vendor/cordis/src/fiber.ts                 # 偏差 6：const enum → enum
vendor/README.md                           # 偏差 6：追加本地修改记录条目
.specdev/specs/vscode-dsh-e2e-closure/tech-debt-registry.md  # 偏差 6 登记
```

**删除（mock/过时产物，清单驱动 + 留痕）：** repo-exploration §14.2 / §14.3 / §14.4 清单。

### 关键架构决策（AD）

**AD-1 复用方式：提取共享运行时库，而非整体 `source` 或复制。**

`run-layer-v-smoke.sh` 底部 `main "$@"`（`:3149`）无守卫地立即执行，整体 `source` 会触发 main；复制函数体则违反 AC-1「不得从零重建」。故将显示解析/Xvfb、Node 解析、沙箱 HOME、凭证门控、`launch_host`、进程回收、`set_conclusion`/`fail_*` 等原语**原样提取**到 `layer-v-support/layer-v-runtime.sh`，`run-layer-v-smoke.sh` 改为 `source` 该库（行为保持，由 AC-19 回归 + 重跑基座验证），新编排脚本也 `source` 同一库。这是「改正确的地基」而非兼容补丁（与 AGENTS.md pre-release 立场一致）。

**AD-2 驱动扩展方式：新增独立 `layer-v-capability-driver/`，不修改既有 `extension.cjs`。**

既有 `extension.cjs`（2441 行）是 usable-loop 已验证交付物。41 项能力直接叠加到其五步 runStep 上会把「已验证闭环」与「新能力」耦合在单一文件。故新驱动复用其 `StageError` 退出码分类与断言原语（require 复用），按 manifest 的 `steps` 泛化执行，保持五步范式的「操作序列 + 截图 + 断言」骨架。

**AD-3 覆盖清单落地为机器可读 manifest（`layer-v-capabilities.json`）。**

AC-6 要求「真实功能能力清单是闭环唯一依据」。把 §12 的 41 项能力编码为 JSON manifest（含 `id`/`group`/`ac`/`requiresModel`/`steps`），使「清单 → 驱动 → journal → 状态记录 → artifact-index」全链可追溯，且可单项复验（S-2）。

**AD-4 断言与证据策略：关键区域存在 + 非退化，不逐像素比对。**

风险 R2（真机截图易抖动）：断言以「`data-testid`/selector 关键区域存在 + 截图 md5 非退化 + 日志/状态证据」为主；AC-4 的「不得全部共享同一 md5」已由基座 `display-evidence` 机制承接。AC-10 禁止以「DOM 存在 / HTTP 200」代替行为断言，故每条能力断言覆盖「操作 → 产品响应 → 截图/日志证据」完整数据路径。

**AD-5 偏差 5 修复：`clean: true` + `files` 精确收窄。**

根因是 `tsdown.config.ts:18` 的 `clean: false` 使陈旧 chunk 残留，叠加 `package.json#files` 的 `lib/*.js` 通配把全部 19 个 chunk 打入 `.vsix`。修复为：`clean: true`（构建时清空 lib 旧产物）并把 `files` 从 `lib/*.js` 收窄为精确入口文件名（`lib/extension.js`、`lib/index.js` + `lib/types/**` + `media/**` + `webview/dist/**`）。仓库内无 vsce 脚本（✅ CONFIRMED），`.vsix` 由外部 `vsce package` 读取 `files` + `.vscodeignore` 生成，故「不再包含陈旧 chunk」通过「构建后 `lib/` 仅含当前 chunk + `files` 收窄」达成，验证用构建后文件清点 + 打包清单静态核对。

**AD-6 偏差 6 修复：`const enum FiberState` → `enum FiberState` + vendor 同步记录。**

`const enum` 无运行时对象，esbuild/vitest source-plane 不做跨文件内联 → 运行时 `FiberState` 为 `undefined` → `agent-loop` 顶层 `new Set` 崩溃。修复为移除 `const`（普通 `enum` 保留运行时对象），并在 `vendor/README.md` 本地修改记录追加条目、遵循 `:53-61` 同步流程；同步登记进 `tech-debt-registry.md`（当前为空）。**开放问题**：偏差 6 的「受影响包完整集合」在 repo-exploration 中标 ⚠️ HYPOTHESIS（未逐一重跑），Phase 4 以「修复后对已知受影响包跑 source-plane vitest + 全仓 `pnpm run test`」实测收敛，不做先验断言。

**AD-7 清除策略：清单驱动 + 逐项读体确认 + 留痕。**

清除清单来自 repo-exploration §14，但 §14.2 中「`layer-a/` 5 个用例是否仅测 thin HTML」有 ⚠️ HYPOTHESIS（R3：仅 2 个直接 import `buildThinChatHtml`，其余 3 个可能测共享算法）。故删除前**逐项读体确认**，明确保留 §14.1（`fake-sdk-runtime.mjs`、`run-layer-v-smoke.sh`、`layer-v-driver/`、`layer-v-support/`），删除动作在 `implementation.md` 留痕（列出被清除项 + 判定依据），AC-19 回归护栏兜底防误删。

## Phase DAG 依赖

```
phase-1-driver-framework-pilot (无依赖)
 ├─→ phase-2-session-main-path-llm
 ├─→ phase-3-remaining-capabilities
 ├─→ phase-4-audit-debt-fixes (依赖 phase-1：偏差 4 的截图证据由打样产出)
 └─→ (phase-2、phase-3、phase-4 并行)
        └─→ phase-5-cleanup-orchestration-regression (依赖 2/3/4)
```

详见 `phase-plan.md` DAG JSON（程序化权威）。

## 外部依赖

- 无新增 npm 依赖。
- 真机运行依赖（已就绪，假设 A1）：Xvfb、`code` CLI（`--extensionDevelopmentPath`）、真实 `DEEPSEEK_API_KEY`（AC-9 强制，本环境已提供）。
- 偏差 6 修复需 `pnpm run test`（source-plane vitest）+ `pnpm run build` 全仓验证。

## 高风险子系统

| 子系统 | 风险 | 缓解 |
|---|---|---|
| `run-layer-v-smoke.sh` 运行时库提取（AD-1） | 提取/重构可能破坏已验证基座行为 | 行为保持重构 + AC-19 回归 + 重跑基座冒烟逐条比对 |
| 真机闭环时长（R1） | 单次可达 25 分钟，41 项能力全量耗时巨大 | 能力分批（Phase 2/3）+ manifest 支持单项复验（S-2）+ 按组复用 EDH 进程 |
| 真实 LLM 往返（AC-9） | 模型往返不确定/耗时长，注入/模拟不可等价 | 明确「模型往返类能力必须真实 key」；无 key fail-closed（exit 3）；能力 `requiresModel` 分组隔离 |
| 偏差 6 vendor 改动（R3） | 改 `vendor/cordis/src/fiber.ts` 影响多包 source-plane | 遵循 `vendor/README.md` 同步流程 + 本地修改记录 + 全仓 test/build 验证 |
| 清除误删（R4） | 误删仍在用的测试/夹具破坏回归 | §14.1 白名单 + 逐项读体确认 + implementation 留痕 + AC-19 回归护栏 |

## 权衡/替代方案

| 决策 | 备选 | 取舍 |
|---|---|---|
| AD-1 提取共享运行时库 | (a) 新脚本整体 `source` smoke.sh；(b) 新脚本复制原语 | (a) 因 `main "$@"` 无守卫（`:3149`）会触发 main 不可行；(b) 违反 AC-1「不得从零重建」 |
| AD-2 新独立驱动扩展 | 在既有 `extension.cjs` 上叠加 41 项能力 | 叠加会耦合「已验证闭环」与「新能力」，重跑/回归风险更高；独立驱动隔离 blast radius |
| AD-4 非逐像素断言 | 逐像素比对 | 真机截图受窗口/字体/显示差异影响（R2），逐像素易误报；关键区域 + 非退化更稳 |
| AD-5 `clean:true` | 仅删 18 个陈旧 chunk 不改 `clean` | 只删不改会复发（下次构建再积累陈旧 chunk）；改 `clean:true` 治本 |

## 验收标准验证方案

| AC | Phase | 验证类型 | 优先级 |
|----|------|---------|:------:|
| AC-1 ~ AC-5 | 1 | 运行时验证（真机闭环 + 退出码断言） | must |
| AC-6 | 1 | 静态检查（manifest 与 §12 清单一一对应，附 `路径:行号`） | must |
| AC-7 / AC-8 / AC-9 / AC-10 | 2、3 | 运行时验证（真机 EDH + 真实 LLM 往返 + 截图断言） | must |
| AC-11 / AC-12 / AC-13 | 4 | 编译验证（tsc/vitest）+ 运行时验证 + 静态检查（vendor 记录） | must |
| AC-14 ~ AC-19 | 5 | 静态检查（清除留痕）+ 运行时验证（回归护栏 + 全链编排） | must |

> 每条 AC 的详细、可执行验证方案见各 `phases/<phase-id>/spec.md` 的「验证策略」章节。

## 设计修订记录

| # | 日期 | 原设计章节 | 修改为 | 批准人 | 偏差来源 |
|---|------|-----------|--------|--------|---------|
| — | — | — | — | — | — |

## 建议的下一步

进入 HG-2 方案确认：向用户展示本设计 + Phase 拆分计划，用户确认后创建 `impl-phase-1-driver-framework-pilot` 分支并委托 `implementer`。
