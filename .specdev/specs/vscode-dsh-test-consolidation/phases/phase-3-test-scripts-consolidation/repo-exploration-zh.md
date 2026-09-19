# 仓库探索报告 — Phase 3 test-scripts 整合与去重（中文版）

## 1. 任务上下文

本 Phase 目标：把 `apps/vscode-dsh/test-scripts/` 的 16 个文件按四类分层（入口编排 / 共享原语 / 能力清单数据 / 支撑资源），抽取 `layer-v-support/primitives.cjs` 共享 19 项镜像原语消除 `DEBT-1`，并更新本工作流 registry（`DEBT-1` 已解决、`DEBT-4/5` 显式不关闭）。

验收标准：AC-19（四类分层 + group→domain 映射落盘）、AC-20（19 项原语定义处数各为 1，两 driver 经共享模块引用）、AC-21（registry 已解决表含 DEBT-1，DEBT-4/5 不关闭）、AC-22（`pnpm run check:test-scripts-syntax` 退出码 0）、AC-23（Node 24.3.0 无凭证下两脚本退出码与 Phase 1 基线一致）。

写面仅限 `apps/vscode-dsh/test-scripts/**` 与 `.specdev/specs/vscode-dsh-test-consolidation/tech-debt-registry.md`。本调研聚焦：目录现状、19 项原语逐项核对、两 driver 模块结构、manifest group 结构、AC-22 前置、AC-23 基线、stub 交叉验证、抽取风险。

## 2. 仓库概览

- **语言/运行时**：test-scripts 为纯 shell（`.sh`）+ 纯 CommonJS（`.cjs`）+ JSON。权威 Node 解释器 `^22.19 || >=24`（`package.json:9`），实测路径 `/usr/local/n/versions/node/24.3.0/bin/node`（v24.3.0）。
- **框架**：无 npm 依赖的测试资产；`.cjs` 仅 `require('node:...')` 与 `require('vscode')`（host 内驱动）。app 包是 `"type": "module"`，因此 CJS 是 VS Code 可从该目录树 `require` 的唯一形状（`layer-v-driver/extension.cjs:27-28`）。
- **目录结构**（16 文件）：

```
apps/vscode-dsh/test-scripts/
├── run-layer-v-smoke.sh                 # smoke 入口编排（host 外半）
├── run-layer-v-capabilities.sh          # capabilities 入口编排（host 外半）
├── run-chat-ready-regression.sh         # chat-ready 回归入口
├── layer-v-shadow-preset.sh             # shadow preset 数据（编排资源）
├── layer-v-capabilities.json            # 41 能力清单数据
├── layer-v-driver/
│   ├── extension.cjs                    # smoke host 内驱动（2 参 captureScreenshot）
│   ├── package.json                     # VS Code 扩展 manifest
│   └── sandbox-clean-state.cjs          # 支撑资源（沙箱洁净谓词）
├── layer-v-capability-driver/
│   ├── extension.cjs                    # capabilities host 内驱动（绑定 vscode + capture）
│   ├── capability-runner.cjs            # 纯编排 runner（3 参 captureScreenshot，19 原语镜像侧）
│   └── package.json                     # VS Code 扩展 manifest
└── layer-v-support/
    ├── layer-v-runtime.sh               # 共享 shell 运行时（display/node/sandbox/host/结论）
    ├── artifact-index.cjs               # 支撑资源（run 行落索引）
    ├── build-freshness.cjs              # 支撑资源（构建产物新鲜度）
    ├── display-evidence.cjs             # 支撑资源（五帧去重判定）
    └── display-evidence-shell.sh        # 支撑资源（shell 侧五帧去重）
```

## 3. 最相关区域

| 文件 | 角色 | 来源 |
|------|------|------|
| `layer-v-driver/extension.cjs`（2441 行） | DEBT-1 镜像侧 A：19 项原语定义 + `captureScreenshot` 2 参 + 仅导出 `{ activate }` | 👁 逐行 |
| `layer-v-capability-driver/capability-runner.cjs`（911 行） | DEBT-1 镜像侧 B：19 项原语定义 + `pollForStream` 单侧 + 全量导出 | 👁 逐行 |
| `layer-v-capability-driver/extension.cjs`（226 行） | host 绑定层：`require('./capability-runner.cjs')`，注入 `vscode` 与 capture | 👁 逐行 |
| `layer-v-capabilities.json`（724 行） | 41 能力、12 group 数据 | 👁 逐行 |
| `layer-v-support/layer-v-runtime.sh`（729 行） | 两入口脚本共享的 shell 原语（AD-1 已有先例） | 👁 头部 |
| `scripts/check-test-scripts-syntax.sh`（62 行） | AC-22 门禁实现 | 👁 逐行 |
| `tests/capability-domains.json` | AC-19 的 `groupMapping` 已落盘 + 既有 `scripts` 域归属 | 👁 |
| `phase-1-baseline-domain-inventory/implementation.md` | AC-23 退出码基线 | 👁 |

## 4. 关键入口点 / 调用路径

### 4.1 smoke 链路（AC-23 对象 1）

```
run-layer-v-smoke.sh  (host 外：node/display/sandbox/launch/收进程)
  └─ sources layer-v-support/layer-v-runtime.sh
  └─ launches EDH with --extensionDevelopmentPath layer-v-driver/
        └─ layer-v-driver/extension.cjs activate()
              ├─ reads plan → walks 5-step link
              ├─ captureScreenshot(capture, fileName)   ← 2 参，内部用模块级 ARTIFACT_DIR
              └─ writes layer-v-status.json (结论→shell 映射退出码)
```

### 4.2 capabilities 链路（AC-23 对象 2）

```
run-layer-v-capabilities.sh  (host 外)
  └─ sources layer-v-support/layer-v-runtime.sh
  └─ writes layer-v-capabilities-plan.json（含 artifactDir）
  └─ launches EDH with --extensionDevelopmentPath layer-v-capability-driver/
        └─ layer-v-capability-driver/extension.cjs activate()
              ├─ require('./capability-runner.cjs')  ← 纯 runner
              ├─ capture: fileName => captureScreenshot(capture, fileName, artifactDir)  ← 3 参
              └─ runManifest(manifest, host, ...) → 结论→shell 映射退出码
```

### 4.3 DEBT-1 抽取后的目标形态

```
layer-v-driver/extension.cjs ──require('../layer-v-support/primitives.cjs')──▶ primitives.cjs (19 项)
layer-v-capability-driver/capability-runner.cjs ──require('../layer-v-support/primitives.cjs')──▶ 同上
```

## 5. 可能影响面

| 区域 | 变更 | 风险 |
|------|------|:--:|
| `layer-v-support/primitives.cjs` | 新增：19 项镜像原语（纯搬移） | 低 |
| `layer-v-driver/extension.cjs` | 删除 19 项本地定义 → `require('../layer-v-support/primitives.cjs')`；`captureScreenshot` 调用点改 3 参传 `ARTIFACT_DIR`（调用点 `:2328`） | 中（签名统一触碰调用点） |
| `layer-v-capability-driver/capability-runner.cjs` | 删除 19 项本地定义 → `require('../layer-v-support/primitives.cjs')`；保留 `pollForStream`（单侧）与 orchestration/AD-4 断言原语 | 低（纯搬移，无签名变化） |
| `.specdev/specs/vscode-dsh-test-consolidation/tech-debt-registry.md` | 写入 DEBT-1 已解决 + DEBT-4/5 不关闭 | 低 |
| `capability-domains.json`（或独立清单） | AC-19 四类归类 + group→domain 映射（`groupMapping` 已存在，需核对） | 低 |

**不改**：`apps/vscode-dsh/src/**`、`packages/**`、`scripts/**`、`.oxlintrc*.json`、`scripts/run-gates.ts`（spec.md 约束）。

## 6. 既有约束 / 编码约定（抽取共享 CJS 模块必须遵守）

1. **纯 CommonJS，`module.exports` 而非 ESM**：app 包是 `"type": "module"`，CJS 是 VS Code 从该目录树 `require` 的唯一形状（`layer-v-driver/extension.cjs:27-28`、`layer-v-capability-driver/extension.cjs:25-26`）。
2. **零 npm 依赖**：`.cjs` 只 `require('node:child_process'|'crypto'|'fs'|'os'|'path')`，host 内驱动另 `require('vscode')`。共享 `primitives.cjs` 不得引入第三方包（design.md §核心实体 3：「无 npm 依赖，纯 CommonJS」）。
3. **导出形状分层**：
   - host 内扩展入口只导出 `module.exports = { activate }`（`layer-v-driver/extension.cjs:2441`、`layer-v-capability-driver/extension.cjs:226`）——这是 VS Code 扩展契约，不可改。
   - 纯 runner 全量导出（`capability-runner.cjs:881-911`），供 `tests/layer-v-capability-runner.spec.ts` 与 host 绑定层消费。
   - 新 `primitives.cjs` 应导出 19 项原语；`CONCLUSION_PRECEDENCE`（仅 runner 侧 `:66`）非镜像项，不属 19 项去重范围。
4. **`'use strict'` + 顶部文件头注释**：两个 `.cjs` 都以 `'use strict'` 开头（`extension.cjs:31`、`capability-runner.cjs:47`），并带 JSDoc 说明契约。
5. **纯搬移，不改函数体语义**（spec.md 约束 + AC-23）：抽取是逐字节等价搬移；函数体语义、注释、错误分类词汇（`PASS/LINK_FAILURE/SKIPPED_NO_DISPLAY/SKIPPED_NO_CREDENTIALS/HARNESS_ERROR` = `0/1/2/3/4`）都不得变。
6. **结论词汇唯一真相**：退出码契约由 `capability-runner.cjs:19-23` 与 `run-layer-v-smoke.sh:32-37` 共同声明，抽取后必须保持三处（两 driver + `layer-v-runtime.sh`）一致。
7. **既有共享模块先例**：`layer-v-support/layer-v-runtime.sh`（AD-1）已是「两个入口脚本 source 同一份 shell 原语」的先例；`layer-v-support/*.cjs` 是「可独立执行的支撑 .cjs 模块」先例——`primitives.cjs` 落同一目录与二者一致。
8. **相对路径**：两个 driver 分处 `layer-v-driver/` 与 `layer-v-capability-driver/`，`layer-v-support/` 是二者共同父目录下的兄弟目录，因此统一用 `require('../layer-v-support/primitives.cjs')` 即可解析（design.md §DEBT-1 落地位置注明的 `'./../layer-v-support/primitives.cjs'` 为等价形式）。

## 7. 风险 / 未知

| # | 风险 | 确认度 | 说明 |
|---|------|:--:|------|
| R-1 | **`captureScreenshot` 签名统一破坏 AC-23** | ✅ CONFIRMED（风险点） | driver 侧 2 参（`extension.cjs:809`，内部 `path.join(ARTIFACT_DIR, fileName)`），唯一调用点 `:2328` 传 2 参。统一为 3 参后调用点须显式传模块级 `ARTIFACT_DIR`（`:46` 定义）。若抽取时误改函数体（如改 `ARTIFACT_DIR` 解析方式）或漏改调用点，smoke 截图路径会变，可能影响 exit 4 或截图判定。 |
| R-2 | **镜像并非逐字节一致（存在已确认语义漂移）** | ✅ CONFIRMED | `assistantText` 拼接符不同（`'\n'` vs `''`）、`probeScreenSize` 临时文件名前缀不同、`resolveCaptureTool` 临时文件名前缀不同（见 §9）。抽取时**必须选一侧为真身**，否则「纯搬移」会引入或放大漂移——这是 DEBT-1 想消除的根本问题。 |
| R-3 | **单侧原语 `pollForStream` 的去向** | ✅ CONFIRMED | 仅 `capability-runner.cjs:187` 定义（流式增量），spec.md 明确「非 AC-20 判定对象，可随共享模块抽取但非强制」。抽与不抽 AC-20 `grep` 计数均安全；implementer 需二选一并保持一致。 |
| R-4 | **`CONCLUSION_PRECEDENCE` 非镜像项** | ✅ CONFIRMED | 仅 `capability-runner.cjs:66` 定义，driver 侧无。不属 19 项，不得从 runner 侧删除（`overallConclusion` 依赖它）。 |
| R-5 | **AC-19 group→domain 映射已在 Phase 1 落盘** | ✅ CONFIRMED | `tests/capability-domains.json:3-16` 已含 12 group → 10 域映射，与 design.md §140-157 完全一致。Phase 3 只需核对/复用，无需重写；AC-19 的四类归类清单是新增产物。 |
| R-6 | **AC-22 前置已满足** | ✅ CONFIRMED | `check:test-scripts-syntax` 脚本已存在（`package.json:67`），实现 `scripts/check-test-scripts-syntax.sh`。Phase 3 无需新增该脚本，只需保证抽取后它仍退出码 0。 |
| R-7 | **`.cjs` 不在 `check:test-scripts-syntax` 覆盖内** | ✅ CONFIRMED | 该门禁只 `find ... -name '*.sh'`（`check-test-scripts-syntax.sh:53`），不检查 `.cjs` 语法。`primitives.cjs` 语法正确性靠 `node --check` 或宿主运行兜底。 |

## 8. 不确定 / 未验证

| 项 | 状态 | 影响 |
|----|:--:|------|
| driver 侧 19 项之外的函数（`directoryDigest`、`awaitProbeVerdict`、`projectActivity` 等）是否有 runner 对等 | ❓ UNKNOWN（不影响本 Phase） | smoke 驱动专属逻辑，不在 design.md 19 项清单内，抽取范围不涉及。 |
| `capability-domains.json` 的 `scripts` 字段与 AC-19 四类归类的最终落盘形式 | ⚠️ HYPOTHESIS | Phase 1 已按域填 `scripts`（session-host 4 + test-harness 12），但「四类」是 Phase 3 新增维度。spec.md 允许「落盘于 `capability-domains.json` 或独立清单文件，位置由实现定」。 |
| 抽取后 `node --check` / `bash -n` 是否足以覆盖两 driver 的 require 解析 | ⚠️ HYPOTHESIS | `check:test-scripts-syntax` 只覆盖 `.sh`；`.cjs` 的 require 解析正确性最终由 AC-23 真实 host 运行兜底。 |

## 9. Stub 检测与 registry 交叉验证

### Registry 校验结果（`vscode-dsh-e2e-closure/tech-debt-registry.md` 权威定义）

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| DEBT-1 | `extension.cjs`/`capability-runner.cjs` 的 13+ 镜像原语 | 活跃（🟡非阻塞，目标 phase-5） | 19 项镜像原语仍在两侧，`captureScreenshot` 签名漂移确凿（`:809` vs `:563`） | ✅ CONFIRMED（待本 Phase 解决） |
| DEBT-2 | `packages/sdk/server/src/server.ts` `createForkedSession` + `src/conversation-controller.ts` `forkFromClosedTurn` | 活跃（🟡非阻塞） | 不在 test-scripts 写面内 | ✅ CONFIRMED（不在范围） |
| DEBT-3 | `layer-v-capabilities.json` #18 `stream` 步 `requireIncrement:true, intervalMs:150` | 活跃（🟡非阻塞） | manifest `:267` 确认 | ✅ CONFIRMED（数据仍在） |
| DEBT-4 | `layer-v-capabilities.json` 的 `cap-change-index-store`/`cap-snapshot-revert`/`cap-change-diff-render` 从未真机执行 | 活跃（🔴阻塞） | manifest `:416`/`:440`/`:466`（group `change-list`） | ✅ CONFIRMED（缺口未补） |
| DEBT-5 | `layer-v-capabilities.json` 的 `cap-at-path-token`/`cap-workspace-path-resolve`/`cap-selection-ask`/`cap-interaction-coordinator`/`cap-interaction-ui` 从未真机执行 | 活跃（🔴阻塞） | manifest `:370`/`:383`/`:396`/`:671`/`:691` | ✅ CONFIRMED（缺口未补） |

### 19 项镜像原语逐项核对（实测行号，Phase 2 后代码现状）

| # | 原语 | extension.cjs 实测 | capability-runner.cjs 实测 | design.md 声称 | 语义比对 |
|:--:|------|:--:|:--:|:--:|:--:|
| 1 | `OVERSIZED_CAPTURE_AREA`（常量） | `:59` | `:57` | 59/57 ✅ | 值均为 `'4096x2160'`，一致 |
| 2 | `StageError`（class） | `:97` | `:69` | 97/69 ✅ | 逐行一致 |
| 3 | `linkFailure` | `:111` | `:83` | 111/83 ✅ | 一致 |
| 4 | `harnessError` | `:112` | `:84` | 112/84 ✅ | 一致 |
| 5 | `skipNoCredentials` | `:114` | `:85` | 114/85 ✅ | 一致 |
| 6 | `sleep` | `:116` | `:87` | 116/87 ✅ | 一致 |
| 7 | `nowIso` | `:120` | `:91` | 120/91 ✅ | 一致 |
| 8 | `truncate` | `:124` | `:95` | 124/95 ✅ | 一致 |
| 9 | `safeJson` | `:139` | `:105` | 139/105 ✅ | 一致 |
| 10 | `unwrap` | `:173` | `:136` | 173/136 ✅ | 一致 |
| 11 | `poll` | `:245` | `:151` | 245/151 ✅ | 一致 |
| 12 | `assistantText` | `:519` | `:256` | 519/256 ✅ | ⚠️ 漂移：`.join('\n')` vs `+= ''` 空串拼接 |
| 13 | `pngVerdict` | `:550` | `:418` | 550/418 ✅ | 一致 |
| 14 | `sha256Of` | `:564` | `:432` | 564/432 ✅ | 一致 |
| 15 | `runCapture` | `:695` | `:440` | 695/440 ✅ | 一致 |
| 16 | `outputFreeTemplateViolation` | `:688` | `:455` | 688/455 ✅ | 一致 |
| 17 | `probeScreenSize` | `:660` | `:463` | 660/463 ✅ | ⚠️ 漂移：临时文件名前缀不同 |
| 18 | `resolveCaptureTool` | `:727` | `:490` | 727/490 ✅ | ⚠️ 漂移：临时文件名前缀不同 |
| 19 | `captureScreenshot` | `:809` | `:563` | 809/563 ✅ | 🔴 签名漂移：2 参 vs 3 参 |

**关键确认**：
- **`captureScreenshot` 两侧签名现状**：driver 侧 2 参（`extension.cjs:809`，内部用模块级 `ARTIFACT_DIR` `:46`、`:811`），runner 侧 3 参（`capability-runner.cjs:563`）。driver 唯一调用点 `:2328` 现传 2 参；runner 调用点经 `capability-driver/extension.cjs:149` 传 3 参。design.md §DEBT-1 判定正确。
- **`StageError` 两侧定义**：逐行一致，无漂移。
- **`pollForStream`**：仅 `capability-runner.cjs:187` 定义（单侧原语），调用点 `:685`，导出 `:892`；driver 侧无。与 design.md 一致。

### Stub 检测小结

- ✅ 已确认桩（匹配 registry，待本 Phase 解决）：DEBT-1（19 项镜像，含 1 项签名漂移 + 3 项轻微语义漂移）。
- ⚠️ Registry 不一致：无（DEBT-1 声称「13+ 原语」为低估，实际 19 项，design.md 已修正为 19）。
- 🔴 未注册桩：无（未发现 registry 之外的新桩代码）。

## 10. 建议下一步阅读

1. ⭐ 必读 — `apps/vscode-dsh/test-scripts/layer-v-driver/extension.cjs`（19 项原语真身 + `captureScreenshot` 2 参调用点 `:2328`）。
2. ⭐ 必读 — `apps/vscode-dsh/test-scripts/layer-v-capability-driver/capability-runner.cjs`（19 项原语镜像侧 + `pollForStream` + `CONCLUSION_PRECEDENCE` + 全量导出 `:881-911`）。
3. ⭐ 必读 — `apps/vscode-dsh/test-scripts/layer-v-capability-driver/extension.cjs`（host 绑定层，3 参 `captureScreenshot` 调用 `:149`，require 形状范本）。
4. 🔷 应读 — `.specdev/specs/vscode-dsh-test-consolidation/design.md` §DEBT-1 去重方案（229-260 行）。
5. 🔷 应读 — `.specdev/specs/vscode-dsh-test-consolidation/phases/phase-1-baseline-domain-inventory/implementation.md` §3（AC-23 退出码基线：smoke=4, capabilities=0）。
6. 🔹 可选 — `apps/vscode-dsh/tests/layer-v-capability-runner.spec.ts`（runner 消费方，抽取后须仍可 `require` 到全部导出）。
