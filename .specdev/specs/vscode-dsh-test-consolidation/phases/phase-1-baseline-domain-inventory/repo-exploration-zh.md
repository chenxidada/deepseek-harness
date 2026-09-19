# Repository Exploration Report — Phase 1 基线冻结与能力域清单

> 模式：**phase 级**（`current_phase = phase-1-baseline-domain-inventory`）。
> 本报告是 `implementer` 实施 Phase 1 的范围依据，回答「整合前基线文件集 / 10 域映射 / test-scripts 结构 / 基线采集命令可行性」四类事实问题。
> 确认度约定：✅ CONFIRMED（已读代码/实测）· ⚠️ HYPOTHESIS（签名存在未读体）· ❓ UNKNOWN（未验证）。

## 1. Task Context

本 Phase 只做「**冻结整合前基线 + 产出能力域清单骨架**」，**不搬动 / 不归并任何 spec 文件**（后续 Phase 2/3 才动写面）。implementer 需要产出：

1. `implementation.md` 中的**冻结基线快照**：整合前 spec 文件集清单（`find` 采集，非 `git ls-tree`）、用例声明集计数命令、`run-layer-v-smoke.sh` / `run-layer-v-capabilities.sh` 退出码、Node 24.3.0 下 `vitest run apps/vscode-dsh/tests` 基线、oxlint 现状与 glob 化后 error 数（复测留档）。
2. `apps/vscode-dsh/tests/capability-domains.json`：`groupMapping` + 10 域条目（`id`/`spec`/`scripts`/`absorbed`/`entryAssertions` 骨架 / `verifierSources`），`absorbed` 与冻结文件集双向差集为空（AC-2）。
3. `apps/vscode-dsh/tests/assertion-map.md`：台账骨架（表头 + 全量整合前用例声明行，处置列待 Phase 2 填）。
4. 把**未入库 spec 文件**纳入版本控制。

本调研为上述 4 项产出提供：① 精确的文件集与 untracked 判定；② 10 域 → 61 文件的完整映射；③ test-scripts 四类归类；④ AC-23/AC-16/AC-14 三条基线采集命令的可行性核验。

## 2. Repository Overview

- **语言/框架**：TypeScript（`strict: true`）+ React 18（webview 侧）。`apps/vscode-dsh` 是 VS Code 扩展 host，`"type": "module"`（ESM）。
- **测试框架**：Vitest `^4.1.8`（`apps/vscode-dsh/package.json:237`）；webview `.tsx` 断言用 `@testing-library/react` + jsdom（根 `vitest.config.ts:154` 注释：`.tsx` 经 per-file `@vitest-environment jsdom` pragma）。
- **包管理**：pnpm workspaces；根 `vitest.config.ts` 是唯一 vitest 配置，`include` 含 `apps/*/tests/**/*.spec.{ts,tsx}`（`vitest.config.ts:113-117`），用 `projects`（`thread-safe` + `process-bound` 两个项目，`pool: 'forks'`）。
- **集成分支**：仓库无 `main`，当前分支为 `new/vscode-dsh`（实测 `git branch --show-current`），与 design.md 现状依据一致。
- **本 Phase 触及面**：`apps/vscode-dsh/tests/`（61 spec + 3 helper + 2 fixture + tsconfig）与 `apps/vscode-dsh/test-scripts/`（16 文件）。`src/**`、`webview/**`、`packages/**`、`scripts/**`、`.oxlintrc*.json` 一律不动（AC-24/AC-5）。

## 3. Most Relevant Areas

### 3.1 整合前 spec 文件集（`find` 实测，61 个）与 untracked 判定

采集命令（`apps/vscode-dsh/tests/` 下全部 `.spec.ts` / `.spec.tsx`，共 **61** 个 = **57 `.spec.ts` + 4 `.spec.tsx`**）：

```bash
find apps/vscode-dsh/tests -type f \( -name '*.spec.ts' -o -name '*.spec.tsx' \) | sort
```

> ⚠️ **重要纠偏**：workflow 级调研报告 §2 声称「`.spec.ts` 54 + `.spec.tsx` 7」。本次实测为 **57 + 4 = 61**（`.tsx` 仅 4 个，全部在 `webview` 域）。Phase 1 冻结基线以**本报告的 57+4 为准**，workflow 报告的「54+7」是过期/笔误。

**未入库（untracked）判定**（`git status --porcelain apps/vscode-dsh/tests/` 实测）：仅 1 个 ——

| 文件 | 状态 | 归属域 |
|---|---|---|
| `apps/vscode-dsh/tests/layer-v-capabilities-phase3.spec.ts` | 🔴 **未入库** | `test-harness` |

其余 60 个 spec 均已入库。3 个 helper（`spike-attribution-helpers.ts`、`spike-t0a-replay-hydrator.ts`、`spike-t0b-continue-helpers.ts`）、2 个 fixture（`fixtures/fake-sdk-runtime.mjs`、`fixtures/screenshots/README.md`）、`tsconfig.json` 均已入库（`git ls-files` 确认）。

**非 spec 残留（不计数入基线，但需知晓）**：
- 2 个 `.tsbuildinfo` 残留（`_probe-tsconfig.tsbuildinfo`、`.tsconfig.probe-base.tsbuildinfo`）——**被 `.gitignore:5`（`*.tsbuildinfo`）忽略**，既非 tracked 也非 untracked，是构建残留，**不得计入 61**。

### 3.2 10 域 → 61 文件完整映射（`absorbed` 事实来源）

下表即 `capability-domains.json` 各域 `absorbed` 字段的精确内容。已与 design.md 定稿清单核对一致，**双向差集为空**（61 = 10+11+8+5+1+3+1+8+4+10，无遗漏、无重复、无「暂无法归属」文件）。

| 域 id | 大写编号段 | absorbed 文件数 | 文件清单 |
|---|---|:--:|---|
| `session-host` | `SESSION-HOST` | 10 | `session-host.spec.ts`、`session-host-preflight.spec.ts`、`node-env-guard.spec.ts`、`host-diagnostics.spec.ts`、`layer-v-inject-disconnect.spec.ts`、`auto-start-orchestrator.spec.ts`、`phase1-auto-start.spec.ts`、`phase2-auto-ready.spec.ts`、`verifier-phase1/layer-b-lifecycle.spec.ts`、`verifier-phase2/layer-b-host.spec.ts` |
| `conversation` | `CONVERSATION` | 11 | `conversation-registry.spec.ts`、`multi-tab-session.integration.spec.ts`、`multi-tab-dispose.e2e.spec.ts`、`panel-close-delete.e2e.spec.ts`、`message-store-index.spec.ts`、`panel-l2-l3-protocol.spec.ts`、`editor-chat-panel.lifecycle.spec.ts`、`phase2-multitab-history-replay.spec.ts`、`phase4-subagent-enter-pin.spec.ts`、`phase4-new-conversation-chrome.spec.ts`、`gap-003-004-debt-fix.spec.ts` |
| `timeline` | `TIMELINE` | 8 | `timeline-projector.spec.ts`、`timeline-diff.e2e.spec.ts`、`timeline-diff.integration.spec.ts`、`spike-attribution-snapshot.spec.ts`、`phase2-history-delete-host.spec.ts`、`phase3-restart-continue.spec.ts`、`phase3-review-revert-replay.spec.ts`、`chat-ux-fork-retry-branch.spec.ts` |
| `interaction` | `INTERACTION` | 5 | `interaction-approval-resolution.spec.ts`、`interaction-fail-closed.e2e.spec.ts`、`interaction-fail-closed.integration.spec.ts`、`replaceability-interaction-ui.spec.ts`、`gap-005-009-debt-fix.spec.ts` |
| `code-context` | `CODE-CONTEXT` | 1 | `phase1-code-context.spec.ts` |
| `change-list` | `CHANGE-LIST` | 3 | `phase2-change-list-display.spec.ts`、`chat-ux-refs-changes-diff.spec.ts`、`layer-a/refs-changes-diff.spec.ts` |
| `search` | `SEARCH` | 1 | `chat-ux-session-search.spec.ts` |
| `chat-panel` | `CHAT-PANEL` | 8 | `chat-ux-activity-stream.spec.ts`、`chat-ux-streaming-cancel-follow.spec.ts`、`phase3-chat-ui-chassis.spec.ts`、`phase5-should-polish.spec.ts`、`layer-a/activity-stream.spec.ts`、`layer-a/streaming-cancel-follow.spec.ts`、`layer-a/foundation-render-probe.spec.ts`、`layer-a/protocol-decision-smoke.spec.ts` |
| `webview` | `WEBVIEW` | 4（全 `.tsx`） | `layer-a-rtl/editor-chat-shell.spec.tsx`、`layer-a-rtl/editor-chat-phase2.spec.tsx`、`verifier-phase1/layer-a-rtl.spec.tsx`、`verifier-phase2/layer-a-rtl.spec.tsx` |
| `test-harness` | `TEST-HARNESS` | 10 | `artifact-index.spec.ts`、`display-evidence.spec.ts`、`display-evidence-shell.spec.ts`、`build-freshness.spec.ts`、`sandbox-clean-state.spec.ts`、`chat-ready-regression.spec.ts`、`layer-v-capabilities-phase3.spec.ts`（🔴未入库）、`layer-v-capability-runner.spec.ts`、`spike-t0a-replay-rebuild.spec.ts`、`spike-t0b-continue-capability.spec.ts` |

**3 个 helper 与 fixtures 的归属**（design.md §能力域清单已定，非独立 spec，不计入 61）：`spike-attribution-helpers.ts` → `timeline`；`spike-t0a-replay-hydrator.ts`、`spike-t0b-continue-helpers.ts` → `test-harness`；`fixtures/` 随主 spec 归对应域。

### 3.3 `src/` 模块边界（域 → 模块，供 `entryAssertions` 骨架参考）

域 ↔ `src/` 模块映射已在 design.md 定稿，无需 Phase 1 重做。仅记录与 `entryAssertions` 骨架相关的入口线索（Phase 2 回填 `caps`）：

- `session-host` → `session-host.ts`、`auto-start-orchestrator.ts`、`auto-ready-coordinator.ts`、`host-diagnostics.ts`、`node-env-guard.ts`、`extension.ts`、`extension-index.ts`（入口：`extension.ts` 的 `activate`、`dsh.*` 命令注册）。
- `conversation` → `conversation-controller.ts`、`conversation-registry.ts`、`message-store.ts`、`replay-hydrator.ts`。
- `webview` → `webview/src/{App,bridge/message-bridge,store/chat-ui-store,probes}`（入口：`message-bridge` 的 IPC 消息）。
- `test-harness` → SUT 是 `test-scripts/**` 资产本身（自身 tester）。

### 3.4 test-scripts 完整目录树（16 文件）与四类归类

```
apps/vscode-dsh/test-scripts/
├── run-layer-v-smoke.sh                      ① 入口编排（119947 字节，极长行）
├── run-layer-v-capabilities.sh               ① 入口编排
├── run-chat-ready-regression.sh              ① 入口编排
├── layer-v-capabilities.json                 ③ 能力清单数据（41 capability / 12 group）
├── layer-v-shadow-preset.sh                  ④ 支撑资源（shadow preset，被 smoke 引用）
├── layer-v-support/
│   ├── layer-v-runtime.sh                    ② 共享原语（被两个 run 脚本 source）
│   ├── artifact-index.cjs                    ② 共享原语
│   ├── build-freshness.cjs                   ② 共享原语
│   ├── display-evidence.cjs                  ② 共享原语
│   └── display-evidence-shell.sh             ② 共享原语
├── layer-v-driver/
│   ├── extension.cjs                         ② 共享原语（smoke 的 in-host 半，2441 行，自带 19 项原语）
│   ├── sandbox-clean-state.cjs               ② 共享原语
│   └── package.json                          ④ 支撑资源（使 driver 目录可被 VS Code 加载为扩展）
└── layer-v-capability-driver/
    ├── extension.cjs                         ② 共享原语（capability 的薄 binder，226 行）
    ├── capability-runner.cjs                 ② 共享原语（纯编排，911 行，自带 19 项镜像原语）
    └── package.json                          ④ 支撑资源
```

四类归类（Phase 1 只**记录**，Phase 3 才实际落地分层）：

| 类别 | 文件 | 说明 |
|---|---|:--:|
| ① 入口编排 | `run-layer-v-smoke.sh`、`run-layer-v-capabilities.sh`、`run-chat-ready-regression.sh` | 顶层 shell，拥有 PATH/凭证/显示/沙箱 HOME/进程回收 |
| ② 共享原语 | `layer-v-support/*`（5）、`layer-v-driver/extension.cjs`、`layer-v-driver/sandbox-clean-state.cjs`、`layer-v-capability-driver/extension.cjs`、`layer-v-capability-driver/capability-runner.cjs` | DEBT-1 载体：两个 driver 各持一份镜像原语 |
| ③ 能力清单数据 | `layer-v-capabilities.json` | 41 capability / 12 group，AC-19 映射对象 |
| ④ 支撑资源 | `layer-v-shadow-preset.sh`、两个 `package.json` | 不被直接执行，被其余资产引用 |

> 归类为**调研建议**，Phase 1 落盘 `capability-domains.json` 的 `scripts` 字段时以本表为事实来源；四类的**实际文件移动**是 Phase 3 的写面，不在本 Phase。

### 3.5 两个 driver 的当前关系（DEBT-1 载体，Phase 1 只记录不处理）

- `layer-v-driver/extension.cjs`（2441 行）：`run-layer-v-smoke.sh` 的 **in-host 半**，读 `layer-v-plan.json`，驱动 `dsh.*` 命令，写 `layer-v-status.json`。**自带完整原语集**（`captureScreenshot` 为 2 参，用模块级 `ARTIFACT_DIR`，`extension.cjs:809`）。
- `layer-v-capability-driver/extension.cjs`（226 行，薄 binder）+ `capability-runner.cjs`（911 行，纯编排）：`run-layer-v-capabilities.sh` 的 in-host 半，**require** `capability-runner.cjs`（纯模块无 vscode 依赖），后者**自带另一份镜像原语集**（`captureScreenshot` 为 3 参显式传 `artifactDir`，`capability-runner.cjs:563`）。
- 关系：两者**未共享**原语，19 项镜像原语双拷贝（DEBT-1），`captureScreenshot` 签名漂移（2 vs 3 参）。Phase 3 抽 `layer-v-support/primitives.cjs` 消除。**Phase 1 只记录，不做任何抽取。**

## 4. Key Entry Points / Call Paths

**路径 1：vitest 单元/集成（AC-14 基线的执行面）**

```
env PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" ./node_modules/.bin/vitest run apps/vscode-dsh/tests
  └─ 根 vitest.config.ts（projects: thread-safe + process-bound，pool: forks）
       └─ include: apps/*/tests/**/*.spec.{ts,tsx}
            ├─ .spec.ts  → node 环境，import ../src/<module>.ts
            └─ .spec.tsx → jsdom 环境（per-file @vitest-environment pragma）
```

**路径 2：smoke 链路（AC-23 基线，退出码采集面）**

```
bash apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh
  └─ source layer-v-support/layer-v-runtime.sh → 解析 Node（不信任 PATH）
       └─ 启动 Extension Development Host（--extensionDevelopmentPath = layer-v-driver）
            └─ require layer-v-driver/extension.cjs → 驱动 dsh.* → 写 layer-v-status.json
                 └─ shell 读回 → 判定退出码（0 PASS / 1 LINK_FAILURE / 2 SKIPPED_NO_DISPLAY / 3 SKIPPED_NO_CREDENTIALS / 4 HARNESS_ERROR）
```

**路径 3：capability 编排链路（AC-23 基线）**

```
bash apps/vscode-dsh/test-scripts/run-layer-v-capabilities.sh
  └─ write_plan → Host 加载 layer-v-capability-driver/extension.cjs（薄）
       └─ require capability-runner.cjs → 读 layer-v-capabilities.json → runManifest
            └─ 写 layer-v-capabilities-status.json → shell 判定退出码（同 5 档）
```

## 5. Likely Impact Surface

| 面 | 内容 | 风险 |
|---|---|---|
| `apps/vscode-dsh/tests/capability-domains.json`（新增） | 10 域 + `groupMapping` + `absorbed` + `entryAssertions` 骨架 | 中：AC-2 双向差集必须为空 |
| `apps/vscode-dsh/tests/assertion-map.md`（新增） | 台账骨架（表头 + 全量整合前用例声明行） | 中：行集与冻结用例声明集双向差集（AC-9，Phase 2 才收口） |
| `apps/vscode-dsh/tests/layer-v-capabilities-phase3.spec.ts` | **git add 纳入版本控制** | 低：Phase 1 输出项之一 |
| `implementation.md` | 冻结基线快照（文件集/退出码/oxlint/Node 基线） | 高：后续 AC-2/9/23/16 全部以此为判据 |
| **不改** `src/**`、`webview/**`、`packages/**`、`test-scripts/**`、`.oxlintrc*.json`、`scripts/**` | Phase 1 零写面（除上述新增 JSON/md + git add） | 高：误改即违反 AC-24 |

> Phase 1 是**纯记录 + 纯新增**：只新增 `capability-domains.json`、`assertion-map.md` 两个文件，`git add` 一个未入库 spec，其余全部只读。不移动、不归并、不改任何既有 spec 或 script。

## 6. Existing Constraints / Conventions

1. **基线采集必须用 `find`，禁 `git ls-tree`**（`requirements.md:69` AC-2）——`git ls-tree` 会漏未入库文件，`find` 已实测采到 61（含 1 untracked）。
2. **权威解释器铁律**：所有 Node 判定命令必须写 `env PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" <cmd>`（`requirements.md:163`）。实测默认 `node` 为 **v20.16.0**（`/home/chendc/.nvm/versions/node/v20.16.0/bin/node`），不满足 `engines`，是环境陷阱。
3. **tests/tsconfig.json 现状**（`apps/vscode-dsh/tests/tsconfig.json`）：
   - 头部注释（`:1-26`）声明「目录不可作为 program」，`include` 是 **12 文件逐文件白名单**（`:36-49`），**非 glob**。
   - 注释记录：12 文件 `tsc --noEmit` = **171** error，全目录 probe = **460** error（`:9-12`）；未匹配文件落仓库级债务 DEBT-019（`:14`）。
   - Phase 1 只**记录现状**，glob 化是 Phase 4 写面（AC-15）。
4. **ESM + `.cjs`**：spec 是 ESM（相对导入带 `.ts` 后缀）；test-scripts `.cjs` 是纯 CommonJS 无 npm 依赖（VS Code 唯一能 `require` 的形状）。
5. **oxlint 入口**：`lint:contracts-ready` = `tsx scripts/run-oxlint.ts .`（`package.json:32`），`run-oxlint.ts:5` 指向 `node_modules/oxlint/bin/oxlint`。tests 目录当前**无独立 lint gate**。
6. **shell 语法门禁**：`check:test-scripts-syntax` = `bash scripts/check-test-scripts-syntax.sh`（`package.json:67`），挂 `ciSharedStaticGates()`。

## 7. Risks / Unknowns

| # | 风险/未知 | 确认度 | 说明 / 证据 |
|---|---|---|---|
| R-1 | **workflow 报告「54+7」计数过期** | ✅ CONFIRMED（实测） | workflow 报告 §2 称 54 `.ts` + 7 `.tsx`；实测 **57 + 4 = 61**。Phase 1 冻结以 57+4 为准。 |
| R-2 | **oxlint「1184→203」基线未独立复测** | ❓ UNKNOWN | design.md 已标注（`:39`）；Phase 1 须用 `npx tsx scripts/run-oxlint.ts apps/vscode-dsh/tests` 复测留档，不把 203 当已确认值。 |
| R-3 | **AC-23 脚本退出码依赖无凭证/无显示环境** | ✅ CONFIRMED（机制） | 本机无 `DEEPSEEK_API_KEY`，`PASS`(0) 分支不可达；smoke 大概率退出 `3 SKIPPED_NO_CREDENTIALS` 或 `2 SKIPPED_NO_DISPLAY`（取决于 Xvfb 可用性）。基线采集须同命令跑两次留档，且**不得**把 skip 当「真机链路已验证」。 |
| R-4 | **`run-layer-v-smoke.sh` 体量巨大（119947 字节）** | ✅ CONFIRMED | 含极长行（嵌入 JSON/base64），采集退出码基线可能耗时较长；基线采集命令应设合理超时。 |
| R-5 | **Node 默认解释器陷阱** | ✅ CONFIRMED | `which node` → `/home/chendc/.nvm/versions/node/v20.16.0/bin/node`（v20.16.0）。任何漏写 `env PATH=...24.3.0` 的命令都会误用 Node 20 产生 `ERR_REQUIRE_ESM`。 |
| R-6 | **`vitest run apps/vscode-dsh/tests` 与 projects 配置的过滤语义** | ⚠️ HYPOTHESIS | 根 `vitest.config.ts` 用 `projects`（workspace 风格），位置参数过滤在 projects 下可正常缩小到该目录，但未实测；基线采集时若过滤失效会误跑全仓。 |
| R-7 | **`.tsx`(jsdom) 与 `.ts`(node) 分文件约束** | ✅ CONFIRMED（事实） | `.tsx` 仅 4 个，全在 `webview` 域；jsdom 经 per-file pragma 生效，跨文件混环境不可行（Phase 2 归并时 webview 必须独立 `.spec.tsx`）。Phase 1 无需处理，仅记录域边界。 |
| R-8 | **2 个 `.tsbuildinfo` 残留被 gitignore** | ✅ CONFIRMED | `_probe-tsconfig.tsbuildinfo`、`.tsconfig.probe-base.tsbuildinfo` 被 `.gitignore:5`（`*.tsbuildinfo`）忽略，不属基线文件集。 |

## 8. Uncertain / Unverified

| 资产 | 位置 | 说明 | 确认度 |
|---|---|---|---|
| `captureScreenshot`（两版签名） | `layer-v-driver/extension.cjs:809`（2 参）/ `capability-runner.cjs:563`（3 参） | 签名漂移已确认；函数体是否语义等价未逐行比对（Phase 3 处理） | ⚠️ HYPOTHESIS |
| 19 项镜像原语逐字节一致性 | 两 driver 各 19 处 | design.md §DEBT-1 已列清单；「逐字节一致」除 `OVERSIZED_CAPTURE_AREA` 常量与 `safeJson` 外均未逐行核 | ⚠️ HYPOTHESIS |
| `run-layer-v-smoke.sh` / `run-layer-v-capabilities.sh` 真实退出码 | 两个 shell | 未实际运行（本调研只读）；基线由 implementer 在 Phase 1 实际采集 | ❓ UNKNOWN |
| `vitest run apps/vscode-dsh/tests` 在 Node 24.3.0 下的失败数 | — | 未实际运行；requirements AC-14 称基线「全绿（failed=0）」，待 Phase 1 复现留档 | ❓ UNKNOWN |

## 9. Stub Detection & Registry Cross-Validation

本工作流 registry（`vscode-dsh-test-consolidation/tech-debt-registry.md`）**活跃债务为空**（`:26` 仅 `—` 占位）、**已解决为空**。跨工作流引用 `vscode-dsh-e2e-closure/tech-debt-registry.md` 有 `DEBT-1`~`DEBT-5`。

### Registry 校验结果

| Registry ID | 文件:符号 | Registry 状态 | 代码实际状态 | 判定 |
|---|---|---|---|---|
| `DEBT-1@vscode-dsh-e2e-closure` | `capability-runner.cjs` vs `layer-v-driver/extension.cjs`（镜像原语） | 活跃 🟡非阻塞 | 镜像原语**仍在**，两 driver 各持一份，`captureScreenshot` 签名漂移 | ✅ 匹配 |
| `DEBT-4@…` | `layer-v-capabilities.json`（change-list 3 项） | 活跃 🔴阻塞 | 从未真机执行 | ✅ 匹配（本工作流不关闭，AC 范围外） |
| `DEBT-5@…` | `layer-v-capabilities.json`（code-context 3 + interaction 2 项） | 活跃 🔴阻塞 | 从未真机执行 | ✅ 匹配（本工作流不关闭，AC 范围外） |

### Stub Detection Summary

- ✅ **Confirmed stubs**：0 个（tests/test-scripts 范围内未发现 `(void)`/空壳/`return []` 型桩；`it.skip` 属已声明跳过）。
- ⚠️ **Registry mismatch**：1 处——`DEBT-1` 描述「语义逐字节一致」与实际「语义镜像 + `captureScreenshot` 签名漂移」不符（design.md 已校正，Phase 3 处理）。
- 🔴 **Unregistered stubs**：0 个。

> Phase 1 无新债务登记义务（无写面、无桩）。但 implementer 需在 `implementation.md` 记录「oxlint 基线复测值」与「AC-23 退出码基线」，后续 Phase 引用时以本 Phase 实测值为准。

## 10. Recommended Next Reads

1. ⭐ **MUST READ** — `.specdev/specs/vscode-dsh-test-consolidation/design.md`（10 域定稿 + DEBT-1 方案 + oxlint 基线口径，Phase 1 产出 JSON 的事实框架）。
2. ⭐ **MUST READ** — `.specdev/specs/vscode-dsh-test-consolidation/requirements.md`（AC-2/14/16/23 的精确判定命令）。
3. ⭐ **MUST READ** — `apps/vscode-dsh/tests/tsconfig.json`（现状白名单 12 文件 + DEBT-019 注释，Phase 1 记录现状、Phase 4 才改）。
4. 🔷 **SHOULD READ** — `apps/vscode-dsh/test-scripts/layer-v-capabilities.json`（12 group → 10 域映射锚点，`groupMapping` 字段来源）。
5. 🔷 **SHOULD READ** — `apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh`（头 40 行退出码契约）与 `run-layer-v-capabilities.sh`（退出码契约）。
6. 🔷 **SHOULD READ** — `scripts/run-oxlint.ts`（oxlint CLI 包装，AC-16 基线的执行入口）。
7. 🔹 **OPTIONAL** — `vitest.config.ts`（projects/forks/jsdom pragma，AC-14 基线的执行语义）。
