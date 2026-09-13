# Design Consistency Review — Phase 5 (phase-5-replaceability-docs)

## 视角
**Design Consistency** — 代码是否遵循架构设计

## 判决
**PASS**

## 架构决策对照

| design.md 决策 | 实现是否遵循 | 证据 | 判定 |
|:---|:---|------|:--:|
| **AD-8** 三可替换面：传输适配器 / UI 呈现 / auto-allow；均不得改 `agent-loop` | 是 | `ide-bridge` README § Replaceability 三面表；`vscode-dsh` README § Replaceability；`prove-replaceability.sh` 拒 `packages/core/agent-loop` 变更与导入 | ✅ |
| **AD-8 / AC-29** 替换契约文档 + ≥1 可验证替换路径 | 是 | 权威文档在 `packages/ide/ide-bridge/README.md`；UI/permission 面在 `apps/vscode-dsh/README.md` 并链回；证明：`replaceability-memory-transport.spec.ts` + `replaceability-interaction-ui.spec.ts` | ✅ |
| **AD-2** 双通道：stdout = SDK JSON-RPC；bridge = 非 stdout NDJSON；fail-closed | 是 | 两处 README Dual channel / 不变量表写明 stdout 纯度与 fail-closed；spec 约束「stdout 仍属 SDK；bridge 仍须 fail-closed」已落文档 | ✅ |
| **AD-4** 终端 answerer / fail-closed 语义不因替换面改写 | 是 | 替换文档指向既有 answerer；内存传输证明仍走 `validateBridgeFrame`（非法 `allow-all` → `undefined`） | ✅ |
| **AD-6** 权限档位只走 `permission-presets` | 是 | Auto-allow 面文档：`permission/select` → `dsh-permission-presets`；禁止 Extension 第二套策略库 | ✅ |
| **AD-3 / 包落点** 新行为在 `ide-bridge` / Extension；不扩 core | 是 | 仅 README + 测试 + prove 脚本；无新 core 包；`bundle/ide` 仅清理过期文案并指向 replaceability | ✅ |
| design 示意 `IdeBridgeTransport` 接口 | 未落地类型（有文档偏差说明） | `implementation.md` 偏差记录：以 `NdjsonSocket(Duplex)` 为可替换面；与 Phase 1 推迟一致；spec 接受 memory transport **或** 第二 UI | 🟢 Observation |
| 禁止改 `packages/core/**/agent-loop*` | 是 | 变更清单刻意排除；脚本 + 测试静态断言无依赖 | ✅ |
| Spec/hooks 不进替换面（Out） | 是 | ide-bridge README「Out of replaceability scope: Spec panels and hooks」；bundle Known Limitations 同述 | ✅ |

## 模块/命名/结构审查

### 目录合理性

| 新文件 | 所在目录 | 是否合理 | 说明 |
|--------|---------|:--:|------|
| `packages/ide/ide-bridge/README.md` § AD-8 | 包 README | ✅ | 传输 + 帧契约权威源，符合 design 包落点与「避免重复权威」 |
| `apps/vscode-dsh/README.md` § Replaceability | Extension README | ✅ | 只拥有 UI / permission picker，链到 ide-bridge |
| `packages/bundle/ide/README.md` | profile 包 | ✅ | 删除过期 Phase-3 stub 文案，指向 replaceability |
| `tests/replaceability-memory-transport.spec.ts` | `packages/ide/ide-bridge/tests/` | ✅ | 传输证明属 bridge 包 |
| `tests/replaceability-interaction-ui.spec.ts` | `apps/vscode-dsh/tests/` | ✅ | UI 注入证明属 Extension |
| `test-scripts/prove-replaceability.sh` | phase-5 `test-scripts/` | ✅ | 可脚本验证场景（AC-33） |
| `.cursor/skills/project-{build,test}/SKILL.md` | skills | ✅ | 工作流知识沉淀，非产品架构面 |

### 命名规范审查

| 文件/符号 | 实际命名 | 应遵循规范 | 判定 |
|-----------|---------|-----------|:--:|
| 传输证明测试 | `replaceability-memory-transport.spec.ts` | kebab + `replaceability-*` 语义 | ✅ |
| UI 证明测试 | `replaceability-interaction-ui.spec.ts` | 对齐既有 `InteractionUi` 名 | ✅ |
| README 锚点 | `Replaceability contract (AD-8)` / 中文对侧 | 双语包文档惯例 | ✅ |
| 证明用 presenter | `createRejectOncePresenter` | 测试局部，Pascal/camel 一致 | ✅ |
| 未导出 `IdeBridgeTransport` | N/A（文档描述 Duplex 缝） | design 示意未强制生产导出；packages AGENTS「require a current owner」 | 🟢 |

### Constitution §2 检查

| 条款 | 内容 | 是否违反 | 说明 |
|------|------|:--:|------|
| §2.1 单一职责 | 每个模块做一件事 | ✅ | 文档/证明按包边界拆分：bridge 管传输契约，Extension 管 UI/preset 入口 |
| §2.2 依赖方向 | 核心不依赖外围 | ✅ | Extension / ide-bridge 仍不依赖 `agent-loop`；替换证明不引入反向依赖 |
| §2.3 接口隔离 | 经明确接口交互 | ✅ | UI 经 `InteractionUi`；传输经 `NdjsonSocket`+`BridgeFrame`/`validateBridgeFrame`；auto-allow 经既有 permission 帧 |

## AD-8 三缝专项

| 缝 | 文档落点 | 可验证证明 | 与 design 对齐 |
|----|---------|-----------|:-------------:|
| (1) Host bridge **传输适配器** | ide-bridge README Replaceable faces → Duplex/`NdjsonSocket` | PassThrough 双工 + hello + approval 往返 | ✅ |
| (2) VS Code **UI 呈现策略** | vscode-dsh README → `setInteractionUi` | 第二 presenter（非 QuickPick）→ `rejected` Host 审批 | ✅ |
| (3) **auto-allow** 策略 | 两处 README → `permission/select` / presets（`danger-full-access` → `never`） | 文档契约（AC-29 仅要求 ≥1 证明路径；本 Phase 已交付传输+UI 两条） | ✅ |

## 关键发现

### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
（无）

### 🟢 Observations
- **`IdeBridgeTransport` 未抽为生产 TypeScript 接口**：design.md §核心实体仅示意；实现以 `NdjsonSocket(Duplex)` + README 描述可替换传输面，并在 `implementation.md` 偏差章节说明原因（无当前生产 DI 消费者 / packages AGENTS owner 规则）。与 Phase 1 design review 推迟及本 Phase spec「第二 transport **或** 第二 UI」一致，**不构成设计违反**。
- **auto-allow 面以文档为主、无独立第三证明测试**：AD-8 / AC-29 要求三缝文档化 + 至少一个可验证路径；既有 `permission-presets` + Host RPC 即为生产缝，符合 AD-6，无需本 Phase 新建策略插件。
- **权威源分层正确**：传输/帧/fail-closed/stdout 纯度在 `ide-bridge`；UI/picker 在 `vscode-dsh`；`bundle/ide` 仅交叉引用，避免第二权威。

## 结论

本 Phase 交付物与 **AD-8** 及双通道/权限相关决策一致：替换边界清晰、落在 `ide-bridge` / Extension、文档写明 stdout 与 fail-closed，且有可脚本验证的轻量证明。未提取 `IdeBridgeTransport` 已记录偏差，按任务指引记为 Observation。**判决 PASS。**
