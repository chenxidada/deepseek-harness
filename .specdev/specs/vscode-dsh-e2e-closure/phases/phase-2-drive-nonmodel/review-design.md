# Design Consistency Review — Phase 2（phase-2-drive-nonmodel）

## 视角
**Design Consistency** — 代码是否遵循架构设计

## 判决
**SHOULD-FIX**

## 架构决策对照

| design.md 决策 | 实现是否遵循 | 证据 | 判定 |
|:---|:---|------|:--:|
| 分批策略：本批 = `react-spa-main`(8)+`editor-panel`(4)+`code-context` 2 项+`interaction` 2 项+`test-hooks` 1 项+`extension-activate` 1 项 = 18 项（design §实现方案「逐项驱动的能力分批」） | 是 | implementation.md 变更清单 + 三组 run 恰好覆盖 18 项（12+4+2），与 design 分批表逐组一致；`extension-activate` 属 design 明示「可并入 Phase 2 打样」 | ✅ |
| 弱证据升级 vs 未闭环登记：host 侧可观测 → 升级闭环；纯 webview 内部 → 登记未闭环（design §实现方案 note） | 部分 | 单例 Panel 升级为 `newConversation`/`panelSnapshot` 具体断言并闭环；9 项 webview 内部组件登记 DEBT-7；但 `cap-history-panel` 被 design 明示为「可升级（listHistory 返回真实会话）」，实现却登记为未闭环（DEBT-8），与 design 显式断言相悖 | ⚠️ |
| 未闭环登记必须含「缺哪条 + 原因 + 建议何种 feature」（AC-15 / registry schema） | 是 | DEBT-7 缺 `concreteAssertion`+`actualTrigger`，建议「后续 feature 补 webview 内 `data-testid` 探测通道」；DEBT-8 缺 `concreteAssertion`，建议「`requiresModel` 改 `true` 交 Phase 3 或补测试钩子」 | ✅ |
| 不改 `ac` 字段（旧编号体系）、不重写全量 41 项、只改本批（design §实现方案 + §现状依据补充说明） | 是 | manifest 中 `ac` 仍为旧编号（`["AC-7","AC-10"]` 等）；41 项能力全部保留；仅本批 4 处 `steps`/`expect` 改动 | ✅ |
| 过时路径（thin HTML 聊天面板）不建立闭环覆盖、列入过时清单（AC-4） | 是 | `obsolete-features.md` 落盘 `buildThinChatHtml`（fixture-only）+`buildSidebarMigrationHtml`，均不在本批驱动选择器内 | ✅ |
| 不改产品代码（`src/`/`webview/src/`）（spec.md §约束） | 是 | implementation.md 完成前自检声明未改 `src/`/`webview/src/`/`tests/`；改动仅 manifest + 文档 | ✅ |

## 模块/命名/结构审查

### 目录合理性
| 新文件 | 所在目录 | 是否合理 | 说明 |
|--------|---------|:--:|------|
| `obsolete-features.md` | `apps/vscode-dsh/test-scripts/` | ✅ | 验证基础设施文档，与 manifest 同处，符合 AC-13「驱动/编排落 `test-scripts/`」 |
| DEBT-7 / DEBT-8 条目 | `.specdev/specs/vscode-dsh-e2e-closure/tech-debt-registry.md` | ✅ | 未闭环登记归位到 registry（唯一定义来源），符合 design 第 3 条「登记进 registry 与 closure 汇总」 |

### 命名规范审查
| 文件/符号 | 实际命名 | 应遵循规范 | 判定 |
|-----------|---------|-----------|:--:|
| DEBT-7 / DEBT-8 ID | `DEBT-7` / `DEBT-8` | `STUB-*`/`GAP-*`/`DEBT-*` 编号递增 | ✅ |
| obsolete-features.md 表头 | 中文 + `文件:函数:行号` | 与 registry 字段规范一致 | ✅ |

### Constitution / Registry Schema 检查
| 条款 | 内容 | 是否违反 | 说明 |
|------|------|:--:|------|
| registry 字段规范（13 字段） | DEBT-7/DEBT-8 需齐备 ID/源Phase/模块/文件:行号/当前行为/预期行为/类型/标签/依赖/目标Phase/阻塞/来源/日期 | ✅ | 两条目字段齐备；DEBT-7 目标Phase=「后续 feature」，DEBT-8 目标Phase=`phase-3-drive-model`，阻塞均 🟡非阻塞 |
| 标签规范 | 每条必须有 `module:`/`type:` | ✅ | 均含 `module:layer-v-capability-driver, type:gap, concern:…` |

## 关键发现
### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
- **[设计修订未回写] `cap-history-panel`（及 `cap-tab-chrome`）与 design.md §实现方案 note 的显式断言相悖，未回写「设计修订记录」**：
  - design.md:248 明示「历史窗口用 `listHistory` 返回真实会话」属 host 侧可观测、应「升级断言并闭环」，并称「单例 Panel / 多 Tab / 历史窗口」经行为驱动可得闭环证据。
  - 实现真机验证发现 `isHistoryEligibleSession`（`extension-index.ts:288-291`）排除空 title 会话，无模型往返时 `listHistory` 恒为 `[]`，无法形成具体断言；`tab-chrome`（多 Tab）为纯 webview 内部组件、无 host 探测 hook。二者均登记为未闭环（DEBT-7/DEBT-8）。
  - 这属**新增设计决策**（把「历史窗口/多 Tab 可闭环」改为「需模型往返 / 需 webview 探测 feature」），实现已在 implementation.md「偏差 2」如实记录，但**未回写 design.md §设计修订记录**（该表当前仅 Phase 1 两条）。
  - 要求：implementer 在 design.md §设计修订记录追加一条，记录「§实现方案 note 中『历史窗口/多 Tab 可得闭环证据』的预测经真机证伪，改为 DEBT-8/DEBT-7 登记」，并注明偏差来源（implementation.md 偏差 2）。

### 🟢 Observations
- **偏差 1（`setCredentialPresence(true)`）属范围内技术手段，无需设计修订**：为 singleton/interaction 四项新增 `setCredentialPresence(true)` 前置步骤，是「只改 manifest steps」范围内的既有测试钩子用法（`extension.ts:1251`），不违反任何显式设计决策（这些项本 `requiresModel:false`，不受凭证门控影响；该钩子仅用于让 host 在无真实 key 下启动）。但 design.md §API 域/§实现方案未提及此技术，若后续 Phase 3 模型批仍需依赖它，建议届时补记。
- **[文档保真] manifest 顶层 `note` 字段（`layer-v-capabilities.json:4`）仍为 Phase 1 陈旧文案**（「this Phase pilots §12.1 and §12.2, the remaining groups are driven in Phase 2/3」），本批未随 Phase 2 更新。底层主张为真（本批确实只驱动部分组）、对交付物零影响，不参与判决。
- **[文档保真] `obsolete-features.md` 引用 `AD-ECP-8`/`AD-ECP-10` 决策编号**，源自 editor-chat-panel 既有代码注释/历史决策，非本工作流设计决策，属交叉引用，不参与判决。

## 结论

本批 18 项能力的分批覆盖、manifest「不改 `ac`/不重写 41 项/只改本批」约束、过时功能清单、DEBT-7/DEBT-8 登记 schema 均严格遵循 design.md 与代码库既有约定。唯一实质偏离是：design.md 对「历史窗口/多 Tab」可闭环的显式预测被真机证伪后，实现未回写「设计修订记录」。属 SHOULD-FIX，需 implementer 补写，不阻断（改动方向本身符合 AC-15 诚实登记原则，且已在 implementation.md 偏差 2 留痕）。
