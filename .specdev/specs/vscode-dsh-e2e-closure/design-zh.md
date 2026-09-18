# 架构设计 — vscode-dsh 完整能力链真机端到端闭环验证（中文版）

> 工作流 slug：`vscode-dsh-e2e-closure`
> 本文件是 `design.md` 的中文翻译版。以 `design.md` 为权威，若有不一致以 `design.md` 为准。

## 范围覆盖

本设计覆盖整个工作流（5 个 Phase，见 `phase-plan.md` DAG）。交付物为三类，全部落在 `apps/vscode-dsh/` 与 `.specdev/specs/*/`：

1. **层 V 真机驱动代码**：复用 `run-layer-v-smoke.sh` 基座，新增多能力驱动编排框架，把真机 EDH 覆盖从 usable-loop 扩展到 repo-exploration §12 的 41 项真实功能能力。
2. **清除 mock/过时测试/过时验证产物**：按 repo-exploration §14 清单驱动，留痕删除。
3. **修复审计遗留偏差 5（lib 陈旧 chunk）与偏差 6（`const enum FiberState`）**。

`ui_relevant: false`：本工作流不新增/修改任何产品 UI 视图文件；截图是**验证证据**，不是「被设计的界面」。

## 现状依据

| 事实（本设计依赖的现状） | 证据 |
|------|------|
| 层 V 冒烟闭环基座 `run-layer-v-smoke.sh` 已存在（约 3149 行），其 `main` 为单一入口 | `apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh:3090` |
| 层 V 退出码/结论契约：0=PASS / 1=LINK_FAILURE / 2=SKIPPED_NO_DISPLAY / 3=SKIPPED_NO_CREDENTIALS / 4=HARNESS_ERROR | `apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh:32` |
| 基座声明 installs nothing、不写真实 `~/.dsh`、不用 UI 自动化/回放 | `apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh:39` |
| 基座关键函数 `set_conclusion` / `cleanup` / `launch_host`，但 `main "$@"` 底部无守卫立即执行 | `apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh:217`、`:306`、`:1413`、`:3149` |
| 层 V 驱动扩展 `extension.cjs`（约 2441 行）实现五步范式 runStep1-5 | `apps/vscode-dsh/test-scripts/layer-v-driver/extension.cjs:928`、`:1050`、`:1090`、`:1188`、`:1607` |
| React SPA 唯一生产呈现入口是编辑器单例 Panel 控制器 | `apps/vscode-dsh/src/chat-panel/editor-chat-panel.ts:161` |
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
| vendor 本地修改记录已把 `fiber.ts` 登记为第 6 条；同步流程要求重放 + manifest + test/build | `vendor/README.md:38`、`:53` |
| 层 V 基座已有 machine-readable 产物机制（`layer-v-support/artifact-index.cjs` 是 `main` 的必需输入） | `apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh:3095` |

## 架构摘要

复用 usable-loop 已建立的层 V 冒烟闭环，把覆盖从「usable-loop 自身功能」扩展到「当前代码真实实现的 41 项能力」。做法：**提取共享运行时库** + **新增能力编排层**（`run-layer-v-capabilities.sh` + 独立 `layer-v-capability-driver/extension.cjs` + 机器可读能力清单 JSON），用 editor-chat-panel 主呈现路径打样后分批驱动、截图、断言。偏差 5/6 与 mock 清除作为独立可验收 Phase，最后一条全链编排命令串起闭环并跑回归护栏。

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

- `id`：能力唯一标识（与 §12 清单一一对应）。`group`：能力分组（§12.1–§12.12）。`ac`：覆盖的验收标准。`requiresModel`：是否涉及真实 LLM 往返（true → 强制 `DEEPSEEK_API_KEY`，AC-9）。`steps`：EDH 操作序列。

### journal 行（沿用既有 JSONL 结构）

```jsonc
{ "ts": "...", "capability": "cap-editor-panel-singleton", "step": "assert-root", "verdict": "PASS", "evidence": ["step-N.png"], "detail": "..." }
```

### 运行状态记录（run-status）

```jsonc
{ "capabilities": { "cap-<id>": { "conclusion": "PASS|FAIL|SKIPPED", "evidence": [...], "failedStep": null } }, "exitCode": 0 }
```

## API 域

本工作流不新增/修改任何产品 API 端点。涉及的能力面：

- **复用驱动宿主 API**：`extension.cjs` 的 `StageError` 分类与五步 `runStepN` 断言原语，被新驱动扩展复用。
- **复用产品测试钩子**：`dsh.test.*` 命令可作为驱动注入/观察点；但 AC-9 明确禁止以注入/模拟作为「模型往返」闭环的等价验收。

## 实现方案

### 总体文件产出计划

**新增（层 V 能力编排 + 驱动）：**

```
apps/vscode-dsh/test-scripts/
├── layer-v-capabilities.json
├── run-layer-v-capabilities.sh
├── layer-v-support/layer-v-runtime.sh
└── layer-v-capability-driver/
    ├── extension.cjs
    ├── package.json
    └── capability-runner.cjs
```

**修改（偏差修复 + 清理）：** `tsdown.config.ts`、`package.json`、`vendor/cordis/src/fiber.ts`、`vendor/README.md`、`tech-debt-registry.md`。

**删除（清单驱动 + 留痕）：** repo-exploration §14.2 / §14.3 / §14.4。

### 关键架构决策（AD）

- **AD-1 复用方式**：提取共享运行时库，而非整体 `source` 或复制。`main "$@"` 无守卫（`:3149`），整体 `source` 会触发 main；复制违反 AC-1。
- **AD-2 驱动扩展方式**：新增独立 `layer-v-capability-driver/`，不修改既有 `extension.cjs`，隔离 blast radius。
- **AD-3 覆盖清单落地为机器可读 manifest**（`layer-v-capabilities.json`），全链可追溯 + 单项复验（S-2）。
- **AD-4 断言与证据策略**：关键区域存在 + 非退化，不逐像素比对（R2）。
- **AD-5 偏差 5 修复**：`clean: true` + `files` 精确收窄（治本，防复发）。
- **AD-6 偏差 6 修复**：`const enum` → `enum` + vendor 同步记录 + registry 登记。
- **AD-7 清除策略**：清单驱动 + 逐项读体确认 + 留痕 + 回归护栏。

## Phase DAG 依赖

```
phase-1-driver-framework-pilot (无依赖)
 ├─→ phase-2-session-main-path-llm
 ├─→ phase-3-remaining-capabilities
 ├─→ phase-4-audit-debt-fixes
 └─→ (2/3/4 并行) → phase-5-cleanup-orchestration-regression
```

## 外部依赖

- 无新增 npm 依赖。
- 真机运行依赖：Xvfb、`code` CLI、真实 `DEEPSEEK_API_KEY`（AC-9 强制）。
- 偏差 6 修复需 `pnpm run test` + `pnpm run build` 全仓验证。

## 高风险子系统

| 子系统 | 风险 | 缓解 |
|---|---|---|
| `run-layer-v-smoke.sh` 运行时库提取 | 可能破坏已验证基座行为 | 行为保持重构 + AC-19 回归 + 重跑基座逐条比对 |
| 真机闭环时长（R1） | 单次 25 分钟，41 项全量耗时巨大 | 能力分批 + manifest 单项复验 + 按组复用 EDH |
| 真实 LLM 往返（AC-9） | 不确定/耗时，注入不可等价 | 模型往返类必须真实 key；无 key fail-closed（exit 3） |
| 偏差 6 vendor 改动（R3） | 影响多包 source-plane | 遵循 vendor 同步流程 + 本地修改记录 + 全仓 test/build |
| 清除误删（R4） | 误删仍在用测试破坏回归 | §14.1 白名单 + 逐项读体确认 + 留痕 + AC-19 |

## 权衡/替代方案

| 决策 | 备选 | 取舍 |
|---|---|---|
| AD-1 提取共享运行时库 | 整体 source / 复制原语 | source 触发 main 不可行；复制违反 AC-1 |
| AD-2 新独立驱动 | 在 extension.cjs 上叠加 | 叠加耦合已验证闭环与新能力，回归风险高 |
| AD-4 非逐像素断言 | 逐像素比对 | 真机截图易抖动，逐像素误报（R2） |
| AD-5 clean:true | 仅删陈旧 chunk | 只删不改会复发；改 clean 治本 |

## 验收标准验证方案

| AC | Phase | 验证类型 | 优先级 |
|----|------|---------|:------:|
| AC-1 ~ AC-5 | 1 | 运行时验证（真机闭环 + 退出码断言） | must |
| AC-6 | 1 | 静态检查（manifest 与 §12 清单对应） | must |
| AC-7 / AC-8 / AC-9 / AC-10 | 2、3 | 运行时验证（真机 EDH + 真实 LLM + 截图断言） | must |
| AC-11 / AC-12 / AC-13 | 4 | 编译验证 + 运行时验证 + 静态检查 | must |
| AC-14 ~ AC-19 | 5 | 静态检查 + 运行时验证（回归护栏 + 全链编排） | must |

> 每条 AC 的详细可执行验证方案见各 `phases/<phase-id>/spec.md`。

## 设计修订记录

| # | 日期 | 原设计章节 | 修改为 | 批准人 | 偏差来源 |
|---|------|-----------|--------|--------|---------|
| — | — | — | — | — | — |

## 建议的下一步

进入 HG-2 方案确认，用户确认后创建 `impl-phase-1-driver-framework-pilot` 分支并委托 `implementer`。
