# Phase 1 实现摘要 — phase-1-closure-foundation

> 工作流：`vscode-dsh-e2e-closure`
> 本 Phase 落地「真闭环判定」机器可读结论模型与 per-run 证据隔离，不改共享 runtime / primitives、不改退出码契约、不改产品代码。

## 变更清单

| 文件 | 变更 |
|------|------|
| `apps/vscode-dsh/test-scripts/layer-v-capability-driver/capability-runner.cjs` | 新增 `classifyPredicate` / `classifyAssertionStrength` / `assessClosedLoop` / `unclosedLoop`；`runCapability` 与 `runManifest` 返回值携带 `closedLoop`；导出 `classifyAssertionStrength` / `assessClosedLoop` |
| `apps/vscode-dsh/test-scripts/run-layer-v-capabilities.sh` | flat `ARTIFACT_DIR` 拆为稳定 plan 路径（base）+ `RUN_DIR=runs/<runId>/`；`STATUS_PATH`/`SUMMARY_PATH`/`JOURNAL_PATH` 指向 per-run 目录；`write_plan` 的 `artifactDir` 改传 `RUN_DIR`；`finish` 写 `closureSummary`；per-run 目录初始化 |
| `apps/vscode-dsh/test-scripts/layer-v-capability-driver/extension.cjs` | 仅 1 行：`driver.planPath` 改指稳定 base 路径（见偏差 1） |
| `.specdev/specs/vscode-dsh-e2e-closure/artifact-index.md` | 新增模板（表头 + `_(no runs yet)_` 占位行） |
| `.specdev/specs/vscode-dsh-e2e-closure/tech-debt-registry.md` | DEBT-1 移至「已解决」（registry 交叉校验发现的事实性 mismatch，见偏差 2） |

## 对每个验收标准的实现说明

### AC-1（三元闭环判定）
`assessClosedLoop(cap, records)` 实现三元判定：① `actualTrigger`（存在非 UI-preparation 命令的 `assert`/`wait`/`stream` 步骤且断言通过）② `concreteAssertion`（存在 `expect` 分类为 `concrete` 的步骤且通过）③ `realScreenshot`（存在 `screenshot` 步骤且 `ok:true`）。三者齐备才 `closed:true`，缺任一 → `closed:false` 且 `missing` 数组含对应维度。`runCapability`（PASS 路径）与 `runManifest` 每项能力均携带该对象；skip/error 分支通过 `unclosedLoop()` 给出全 false + 三缺项。

fixture dry-run（`node` 直接 `require`，临时目录脚本、验证后删除）验证：三条齐备 → `closed:true`；缺 screenshot / 缺具体断言 / 仅 UI-prep 命令触发 → 分别 `closed:false` 且 `missing` 正确。

### AC-2（弱证据不得记「验证通过」）
`classifyAssertionStrength(step)` 分类：`{expect:{panelOpen:true}}` / `{expect:{viewId:'x'}}` → `weak`；`{expect:'$assistantContains:…'}` / `{expect:{hits:[{$contains:'x'}]}}` → `concrete`；未知形态 → `unknown` 且 `reason` 显式记录。分类依据：`$contains:`/`$assistantContains:`/`$assistantClosed:`/`$array:N` 为 concrete；`$string`/`$number`/`$boolean`/`$object`/`$array`/`$present` 及 `panelOpen`/`viewId`/`registered`/`ok:true` 为 weak；`ok:false`（负向）及其他字面量字段为 concrete。

fixture dry-run 验证 weak/concrete/unknown 三态分类正确，不误判。

### AC-5（复用，不重造）
改动仅落在三个脚本 + 一个模板，`layer-v-support/primitives.cjs` 与 `layer-v-support/layer-v-runtime.sh` 的既有函数体**零改动**（`git diff --stat` 确认这两文件不在 diff 中）。显示/Node/沙箱/凭证/进程逻辑仍由 `layer-v-runtime.sh` 提供（`ARTIFACT_DIR` 变量名保留，`prepare_sandbox` 的 `META_PATH`/`mkdir` 依赖它）。`MATCHERS` / `resolveMatcher` / `matchesExpect` 未改。

### AC-7（逐步追加 journal，崩溃可定位）
journal 仍由 `extension.cjs` 的 `appendJournal` 逐行追加（每 step success/failure 均写）。本 Phase 未改 `appendJournal` / `capability-runner.cjs` 的 journal 回调契约，仅把 journal 落点由 flat 目录迁到 `runs/<runId>/layer-v-capabilities-journal.jsonl`（经 `plan.artifactDir` → `resolveArtifactDir`），逐步追加语义不变。shell 侧新增 `JOURNAL_PATH` 变量用于 per-run 目录初始化清理。

### AC-8（退出码契约不变）
`capability-runner.cjs` 的结论词汇与聚合逻辑未改；`run-layer-v-capabilities.sh` 的 `case` 映射（0/1/2/3/4）未改。`closedLoop` 是 per-capability 正交维度，不新增退出码。mock host dry-run 验证：无 key 选 `requiresModel` → `SKIPPED_NO_CREDENTIALS`；空选择 → `HARNESS_ERROR`；全 PASS → `PASS`，均与改造前一致。

## 测试结果

全部为 `node` 直接 `require` 的 fixture dry-run（临时目录 `mktemp -d` 脚本，验证后删除，不落 `tests/`）：

1. **`classifyAssertionStrength` 分类**（9 断言全过）：`panelOpen:true`→weak、`viewId:'x'`→weak、`$assistantContains:`→concrete、`hits:[{$contains}]`→concrete、`$string`→weak、`$bogus:`→unknown、`ok:false`→concrete、`ok:true`→weak、无 expect→unknown。
2. **`assessClosedLoop` 三元判定**（6 断言全过）：完整闭环 `closed:true`；仅 weak 断言 `closed:false`+缺 concreteAssertion；仅 UI-prep 命令触发 `closed:false`+缺 actualTrigger；缺截图 `closed:false`+缺 realScreenshot。
3. **AC-8 退出码映射**（11 断言全过）：mock host 下 `SKIPPED_NO_CREDENTIALS`/`PASS`/`HARNESS_ERROR` 聚合与 skip 项的 `closedLoop`（全 false + 三缺项）均正确。
4. **`closureSummary` 汇总**（1 断言过）：`total/closed/notClosed/skipped/byGroup/notClosedDetails` 计算正确。
5. **`artifact-index.md` 模板**（经 `artifact-index.cjs` `planRowWrite` 验证）：占位行被正确替换、header 计数为 1、row 落在首个 table block。

补充：`bash -n` 与 `node --check` 语法检查通过；`ReadLints` 无错误。既有 `cap-test-harness.spec.ts` 未能加载（环境原生 `zstd` 绑定缺失，`promisify(undefined)`，与本次改动无关），故未运行——AC-8 已改用 mock host fixture dry-run 覆盖。

## 偏差记录

### 偏差 1：`extension.cjs` 非零改动（spec.md §产出清单 / design.md §API 域）
- **偏差描述**：`resolveArtifactDir` 确已支持 `plan.artifactDir`（复核通过），但 `driver.planPath` 字段原为 `path.join(artifactDir, 'layer-v-capabilities-plan.json')`。per-run 改造后 `artifactDir` 指向 `runs/<runId>/`，该字段会错误指向不存在的 per-run plan（plan 实为稳定 base 路径），故改为 `path.join(FALLBACK_ARTIFACT_DIR, 'layer-v-capabilities-plan.json')`。
- **影响范围**：spec.md §产出清单（「extension.cjs 仅复核，若已支持则零改动」）；design.md §API 域 `readPlan/resolveArtifactDir` 行。
- **原因**：per-run 隔离后 plan 稳定路径与 artifact 目录分离，`driver.planPath` 需反映真实读取位置，避免 status.json 记录一条指向不存在文件的机器可读元数据。
- **影响**：`driver.planPath` 元数据恢复准确；该字段仅作 status 记录、无下游消费者，无行为影响。

### 偏差 2：`classifyAssertionStrength` 返回对象而非 design.md 骨架的裸字符串（design.md §实现方案）
- **偏差描述**：design.md 骨架代码返回裸 `'weak'/'concrete'/'unknown'`；实现返回 `{ strength, reason }`，`assessClosedLoop` 用 `.strength === 'concrete'` 判定。
- **影响范围**：design.md §实现方案「关键骨架代码」`classifyAssertionStrength`；spec.md AC-2。
- **原因**：spec.md AC-2 与任务硬约束要求「未知 → `unknown` + reason 显式记录」，裸字符串无法承载 reason；返回 `{strength, reason}` 是满足该约束的最小结构。
- **影响**：verifier 需按对象字段断言（`.strength === 'weak'` 等）而非裸值相等；语义（三态分类 + reason）与 AC-2 一致。

### 偏差 3：`finish()` 的 `closureSummary` 读取 status 而非独立文件（design.md §核心实体/数据模型 #3）
- **偏差描述**：design.md 提到「status.json 扩展 + 独立 closure 表」，本 Phase 将 `closureSummary` 写入 `summary.json`（由 `finish()` 从 `status.json` 的 `capabilities[].closedLoop` 汇总），未新增独立 closure 文件。
- **影响范围**：design.md §核心实体/数据模型 #3。
- **原因**：`status.json` 的 `capabilities[]` 已承载每项 `closedLoop`，`summary.json` 是 run 层汇总的自然落点；独立 closure 文件可由 Phase 4 全链入口按需引入，非本 Phase 硬要求。
- **影响**：`summary.json` 现含 `closureSummary`（total/closed/notClosed/skipped/byGroup/notClosedDetails），下游（Phase 4 全链入口）可直接消费。

### 偏差 4：DEBT-1 注册表条目移至「已解决」（tech-debt-registry.md）
- **偏差描述**：repo-exploration §9 交叉校验发现 DEBT-1（`capability-runner.cjs` 13+ 原语镜像拷贝）已随 `layer-v-support/primitives.cjs` 落盘事实解决（`capability-runner.cjs:49-65` 已 `require`），但注册表仍列「活跃」；本 Phase 将其移至「已解决」。
- **影响范围**：tech-debt-registry.md（非 spec/design 章节，属 registry 事实校正）。
- **原因**：错误的「活跃」条目会误导下游 agent；「修正优于累积」原则要求纠正已解决项。
- **影响**：DEBT-1 不再被下游误读为待处理；无代码行为影响。

## 桩与债务

- 本 Phase **未引入任何 `@STUB` 桩**；无空实现 / 假返回 / 占位。
- 未注册新债务（除偏差 4 的 DEBT-1 事实校正外，registry 无新增条目）。
