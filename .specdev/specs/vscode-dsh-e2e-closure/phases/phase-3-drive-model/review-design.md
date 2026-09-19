# Design Consistency Review — Phase 3

## 视角
**Design Consistency** — 代码是否遵循架构设计

## 判决
**SHOULD-FIX**

## 架构决策对照

| design.md 决策 | 实现是否遵循 | 证据 | 判定 |
|:---|:---|------|:--:|
| 23 项 `requiresModel:true` 能力分批（§能力分批表） | 是 | spec.md §覆盖组 = `session-main-path`(8)+`subagent`(2)+`code-context`(1)+`change-list`(3)+`search`(2)+`fork`(2)+`continue`(3)+`history`(2)=23，与 design.md:232-246 完全一致 | ✅ |
| 不改产品代码（`src/`/`webview/src/`） | 是 | git diff 无任何 `src/`/`webview/src/` 改动；仅 manifest 测试数据 + registry + 取证产物 | ✅ |
| 不新增断言原语（§权衡/替代方案「升级 manifest 断言，不改断言原语」） | 是 | 实现复用现有 `$assistantContains`/`$assistantClosed`/`stream` 原语，未编造 `$titleContains`/`$userContains`/`lastChunk` | ✅ |
| manifest 只动本批、不改 `ac`、不重写全量 41 项（§实现方案） | 是 | git diff 仅 2 行（`cap-selection-ask` 探针文件 `package.json`→`src/index.ts`），`ac` 字段零改动 | ✅ |
| 复用 Phase 1 `assessClosedLoop`/`classifyAssertionStrength`（§API 域） | 是 | 本 Phase 未另起判定逻辑，直接消费 Phase 1 交付 | ✅ |
| subagent 组「需逐项核实是否真 model 往返」（design.md:246） | 是（已核实） | 真机结论：`injectSubagent` 是测试注入、非真实模型往返，如实登记 DEBT-10 | ✅（结论未回写，见 🟡-2） |

## 模块/命名/结构审查

### 目录合理性
| 新/改文件 | 所在目录 | 是否合理 | 说明 |
|--------|---------|:--:|------|
| `layer-v-capabilities.json`（改 2 行） | `apps/vscode-dsh/test-scripts/` | ✅ | 验证基础设施，符合 AC-13 落位要求 |
| `tech-debt-registry.md`（增删改） | `.specdev/specs/vscode-dsh-e2e-closure/` | ✅ | registry 是唯一真相源，符合规范 |
| `runs/<runId>/` 取证 | `apps/vscode-dsh/test-artifacts/layer-v-capabilities/` | ✅ | per-run 证据目录，符合 design.md §核心实体 #2 |

### 命名规范审查
| 符号 | 实际命名 | 应遵循规范 | 判定 |
|-----------|---------|-----------|:--:|
| 新债务 ID | `DEBT-9` / `DEBT-10` | 顺序递增、`DEBT-<N>` | ✅ |
| 债务标签 | `type:debt` / `type:gap` + `concern:*` | 小写连字符、`module:`+`type:` 必填 | ✅ |

### Constitution §2 检查
| 条款 | 内容 | 是否违反 | 说明 |
|------|------|:--:|------|
| 单一真相源 | registry 是债务唯一定义来源 | ✅ | DEBT-2/3/8 更新、DEBT-4/5 移已解决、DEBT-9/10 新增均落 registry |
| Phase ID 唯一真相源（DAG JSON） | 目标Phase 必须是 DAG `phases[].id` | ⚠️ | DEBT-2/3 目标Phase=`phase-5-cleanup-orchestration-regression`（DAG 中不存在，见 🟡-4） |
| 范围边界 | 不修改产品业务逻辑 / 不在本 feature 修复产品 bug | ⚠️ | DEBT-9 产品 bug 目标Phase=phase-4，语义与 DEBT-7「后续 feature」约定不一致（见 🟡-3） |

## 关键发现

### 🔴 Must-Fix
无。未发现违反 design.md 明确声明的架构决策或 Constitution §2 硬约束的项。

### 🟡 Should-Fix

- **🟡-1：spec.md §验证策略 AC-11 行残留过期描述。** `spec.md:32` 仍写「React SPA 强制渲染：`react-spa-main` 模型能力必须出现 `$titleContains`（消息标题）+ 末块非空」，与已修正的 `spec.md:7`（「`react-spa-main` 组 8 项全部 `requiresModel:false`，本 Phase 无 react-spa-main 模型项」）自相矛盾；`$titleContains` 匹配器在 `capability-runner.cjs` 中本不存在（repo-exploration §8 CONFIRMED）。实现正确地**未伪造**该匹配器、以 `history` 组（`cap-history-list`/`cap-open-from-history`）+ `stream` 末块（`$assistantContains` + `requireIncrement:true`）落实 AC-11，但 spec 该行应同步修正为实际覆盖（历史窗口 + 流式末块），消除下游 reviewer/verifier 的歧义。

- **🟡-2：design.md 设计修订记录未回写 Phase 3 新增事实/决策。** ① DEBT-10：`design.md:246` 仍保留「步骤用 injectSubagent，需逐项核实是否真 model 往返」的悬置表述，Phase 3 已核实为「非真实模型往返、AC-9 不满足、登记 DEBT-10」，应将「需逐项核实」更新为已核实结论（或追加设计修订记录条目）；② DEBT-9：新增的「`cap-selection-ask` 探针文件变更规避产品 bug 而非修复」这一范围决策，未在 design.md 设计修订记录留痕。两者都是 Phase 4 收尾需要准确设计上下文的信息。

- **🟡-3：DEBT-9 目标Phase 与「不在本 feature 修复产品 bug」范围边界及既有约定不一致。** DEBT-9 是**产品代码** bug（`selection-ask.ts:182` 的 `pointerText.includes(doc.languageId)` 裸子串防泄漏误报），修复需改产品代码，超出本 workflow「不修改产品业务逻辑」范围。其 `目标Phase=phase-4-orchestration-regression`（本 workflow 收尾阶段，不修产品代码）与 DEBT-7 对同类「超范围、需后续 feature」债务使用「后续 feature（…）」的约定不一致。建议改为「后续 feature（修复 selection-ask 防泄漏误报）」或 phase-4 只做「转出决策」。DEBT-10 的 `phase-4` 目标Phase 可辩护（改 manifest 步骤/翻 `requiresModel` 属验证基础设施，phase-4 可收尾），不在此列。

- **🟡-4：DEBT-2/3 目标Phase 指向 DAG 中不存在的 phantom phase ID。** DEBT-2/3 的 `目标Phase=phase-5-cleanup-orchestration-regression`，但 `phase-plan.md` DAG JSON 只有 4 个 Phase（`phase-1/2/3/4`），无 phase-5。这是 Phase 2 遗留，但 Phase 3 更新了这两行的「当前行为」（补 Phase 3 真机复现证据）却未修正目标Phase。按「Phase ID 唯一真相源是 DAG JSON」铁律，应在 Phase 4 前修正为 `phase-4-orchestration-regression` 或「后续 feature」。

### 🟢 Observations

- 🟢 **[文档保真]** `repo-exploration.md:155` §附 note 仍称 spec.md §目标覆盖组「是过期分组」，但 spec.md 覆盖组已在本 Phase 修正为 8 组 → 该 note 现已 stale。此为上游输入（code-explorer 在 spec 修正前产出），非本 Phase 交付物，不影响判决；若需可在 Phase 4 收尾时顺带清理。
- 🟢 实现未新增 `$titleContains`/`$userContains`/`lastChunk` 匹配器，正确复用既有原语，与 design.md §权衡「不改断言原语」决策一致，未引入隐性 churn。
- 🟢 DEBT-4/5 从「活跃债务」移入「已解决」，验证方式列含 runId + 具体断言证据，符合 registry 去重/状态流转规范。
