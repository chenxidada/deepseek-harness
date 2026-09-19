# Design Consistency Review — Phase 1

## 视角
**Design Consistency** — 代码是否遵循架构设计

## 判决
**SHOULD-FIX**

无 MUST-FIX：实现忠实落地了 design.md 的核心架构决策（`closedLoop` 字段结构、三元判定、`UI_PREP_COMMANDS` 白名单、per-run 目录、导出方式、退出码契约不变、primitives/runtime 零改动）。4 处偏差均合理且有据，但其中 2 处（偏差 1/偏差 2）改变了 design.md 自述的契约，尚未回填 design.md 的「设计修订记录」（当前为空表），需补记以消除「spec 说零改动 / design 说默认 weak」与实现的漂移。

## 架构决策对照

| design.md 决策 | 实现是否遵循 | 证据 | 判定 |
|:---|:---|------|:--:|
| 新增正交 `closedLoop` 维度，不改退出码 0/1/2/3/4 | 是 | `assessClosedLoop` 返回 `{closed, actualTrigger, concreteAssertion, realScreenshot, missing, reason, suggestedFeature}`，字段与 design §核心实体 #1 逐一对齐；shell `case` 映射未改 | ✅ |
| 三元判定规则（①非 UI-prep 命令触发 ②concrete 断言 ③真实截图） | 是 | `assessClosedLoop` 三元逻辑与 design 伪代码一致；`UI_PREP_COMMANDS` 4 项与 design 完全一致 | ✅ |
| `classifyAssertionStrength` 返回 `weak`/`concrete`/`unknown` | 部分（见偏差 2） | 返回 `{strength, reason}` 对象，`.strength` 三态；design 骨架为裸字符串 | ⚠️ |
| per-run 目录 `runs/<runId>/`（plan 稳定路径 + `plan.artifactDir` 指 per-run） | 是 | `RUN_DIR="${ARTIFACT_DIR}/runs/${RUN_ID}"`；`write_plan` 第 4 参数改传 `${RUN_DIR}`；`PLAN_PATH` 保持稳定 base 路径 | ✅ |
| closure 汇总写入 summary（`closureSummary` 结构） | 是 | `finish()` 内从 `status.json` 的 `capabilities[].closedLoop` 汇总写 `summary.json`，字段 total/closed/notClosed/skipped/byGroup/notClosedDetails 与 design §核心实体 #3 一致 | ✅ |
| 不改 `MATCHERS`/`resolveMatcher`/`matchesExpect`/`primitives.cjs`/`layer-v-runtime.sh` | 是 | `git diff --stat` 中 `primitives.cjs`/`layer-v-runtime.sh` 不在 diff；`capability-runner.cjs` diff 仅新增 closure 段，未动断言原语 | ✅ |
| 新增导出 `classifyAssertionStrength`/`assessClosedLoop` | 是 | `module.exports` 末尾新增两导出（`classifyPredicate`/`unclosedLoop` 为内部 helper，未导出，符合「最小导出面」） | ✅ |
| `runCapability`/`runManifest` 返回携带 `closedLoop`（含 skip/error 分支） | 是 | 成功路径 `assessClosedLoop`；凭证 skip / 异常分支用 `unclosedLoop()`（closed:false + 三缺项），覆盖 repo-exploration §7.2 提示的三处来源 | ✅ |

## 模块/命名/结构审查

### 目录合理性
| 新文件/改动 | 所在目录 | 是否合理 | 说明 |
|--------|---------|:--:|------|
| `capability-runner.cjs`（+173 行 closure 段） | `test-scripts/layer-v-capability-driver/` | ✅ | 依赖无关编排半，`classifyAssertionStrength`/`assessClosedLoop` 消费 `cap.steps`/records，属该文件职责 |
| `run-layer-v-capabilities.sh`（per-run 隔离 + closureSummary） | `test-scripts/` | ✅ | shell 编排半，路径变量与 `write_plan`/`finish` 属该脚本 |
| `extension.cjs`（仅 `driver.planPath` 1 处） | `test-scripts/layer-v-capability-driver/` | ✅ | in-host 半，`driver` 元数据属该文件 |
| `artifact-index.md`（新增模板） | `.specdev/specs/vscode-dsh-e2e-closure/` | ✅ | design §实现方案明确「Phase 1 建模板」 |

### 命名规范审查
| 文件/符号 | 实际命名 | 应遵循规范 | 判定 |
|-----------|---------|-----------|:--:|
| 函数 `classifyPredicate`/`classifyAssertionStrength`/`assessClosedLoop`/`unclosedLoop` | camelCase | 既有 `matchesExpect`/`resolveMatcher`/`runCapability` 同风格 | ✅ |
| 常量 `UI_PREP_COMMANDS`/`CONCRETE_PREDICATE_PREFIXES`/`TYPE_PREDICATES`/`WEAK_EXISTENCE_FIELDS` | SCREAMING_SNAKE_CASE | 既有 `MATCHERS`/`CONCLUSION_PRECEDENCE` 同风格 | ✅ |
| shell 变量 `RUN_DIR`/`JOURNAL_PATH` | SCREAMING_SNAKE_CASE | 既有 `ARTIFACT_DIR`/`STATUS_PATH`/`PLAN_PATH` 同风格 | ✅ |

### Constitution §2 检查
本工作流无独立 `constitution.md`（对照 `.specdev/specs/vscode-dsh-e2e-closure/` 目录），架构约束以 `design.md` + `AGENTS.md` 约定为准。无跨模块循环依赖、无核心依赖外围的违例——`capability-runner.cjs` 保持「无 `vscode` import、plain Node 可 require」的文件头契约（新增段仅 `require` 既有 `primitives.cjs`，未引入新依赖）。

## 关键发现

### 🔴 Must-Fix
无。

### 🟡 Should-Fix
- **SF-1：design.md §核心实体 #1「分类失败（未知形态）默认 `weak`」与实现三态 `unknown` 漂移，需回填 design.md。** design.md 自身的 §实现方案骨架（`return 'unknown'`）与 spec.md AC-2（「未知形态 → `'unknown'` 且 reason 显式记录」）都要求第三态 `unknown`，唯独 §核心实体 prose 写「默认 weak」。实现选择 `{strength, reason}` 三态返回，正确且必要（裸字符串无法承载 reason；`unknown` 与 `weak` 在 `assessClosedLoop` 中同为「非 concrete」，功能等价，但三态区分对观测更优）。design.md 应将「默认 weak」改为「未知形态判 `unknown`」，消除文件内自相矛盾。
- **SF-2：design.md「设计修订记录」表为空，应补记偏差 1 与偏差 2。** design.md 自述 `extension.cjs`「仅复核、若已支持则零改动」（spec.md §产出清单同理），但实现发现 `driver.planPath` 由 `path.join(artifactDir, …)` 派生，per-run 后指向不存在的 per-run plan，需改为稳定 base 路径——这是真实、正确的偏离，但 design/spec 的「零改动」措辞已失实。设计修订记录正是为这类偏离而生，当前为空。

### 🟢 Observations
- **[文档保真] 偏差 3 并非真偏离。** design.md §核心实体 #3 正文明确写「另在 summary 中追加一份机器可读汇总」，实现把 `closureSummary` 写进 `summary.json` 完全符合正文；仅该节标题「独立 closure 表」措辞易歧义。implementation.md 将之记为「偏差」属自谦，无设计冲突。可顺带在 design.md 把标题改为「closure 汇总（写入 summary）」以彻底消除歧义。
- **偏差 4（DEBT-1 移至已解决）非设计偏离。** 这是 registry 事实校正（repo-exploration §9 已标注「registry mismatch」），符合「修正优于累积」原则，与 design 无涉。
- **`assessClosedLoop` 的 `passedStep` 额外匹配 `r.command === s.command`。** design 骨架仅 `r.step === s.step`；实现加 command 匹配更严格（防同 step 名不同 command 的误匹配），record 与 `cap.steps` 两侧均有 `command` 字段（repo-exploration 附 A 已确认），属合理收紧而非偏离。
- **`closureSummary.byGroup` 无 `skipped` 子字段。** 与 design §核心实体 #3 的 `byGroup: {total, closed, notClosed}` 结构一致；但 skipped 项计入 `total` 却不计入 closed/notClosed，导致「total ≠ closed + notClosed」当组内有 skip 项时。忠实于 design 字段规格，但下游（Phase 4）消费时需知晓此语义，避免误读。
- **`latest -> runs/<runId>` 软链未创建。** design 标注「可选，便利入口」，不创建合规；若 Phase 4 全链入口需要便捷定位最新 run，届时补建即可。

## 结论

实现架构层完全忠实于 design.md 的核心决策，无 MUST-FIX。两处 SHOULD-FIX 均为「design.md 回填」性质（三态 `unknown` 的 prose 修正 + 设计修订记录补记偏差 1/2），不涉及任何代码返工。建议调度者在 HG-3 报告时向用户说明这两处，由用户决定就地修订 design.md 或顺延。
