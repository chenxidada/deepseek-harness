# Connectivity Review — Phase 4: lint program 与收口

## 视角
**Integration Connectivity** — 模块间是否真正连通

## 判决
**PASS**

---

## 端到端路径追踪

### Path 1: tsconfig glob 化 → 全目录进入 lint program（AC-15/AC-17 + jsx 连锁影响）
```
tests/tsconfig.json "include": ["**/*.ts","**/*.tsx"]
  → 覆盖 12 cap-*.spec.ts|tsx + 3 spike-*.ts = 15 文件 ✅ 双向差集为空（Glob 实测 15 文件全匹配）
  → extends tsconfig.base.json（无 jsx 字段）✅
  → 未被任何 references graph 命名：
     根 tsconfig.json references 仅 tsconfig.host.json + tsconfig.client.json ✅
     apps/vscode-dsh/tsconfig.json include 仅 "src"，references 仅 4 个 packages ✅
  → compilerOptions 覆写 composite:false / incremental:false / noEmit:true → 隔离出构建图 ✅
  → "jsx":"react-jsx" 与上层无冲突（base 无 jsx），且与 webview/tsconfig.json:7 一致 ✅
Exit: tests 仍是「独立私有 lint program」，编译边界成立
```
**判定**: ✅ 连通。`jsx` flag 无上层冲突，独立 program 边界未破坏。

### Path 2: oxlint 门禁 → 真实进入 program 后的 0 error（AC-16）
```
npx tsx scripts/run-oxlint.ts apps/vscode-dsh/tests
  → run-oxlint.ts:59 spawnSync(oxlint) → oxlint v1.76 typeAware:true
  → per-file program 发现：最近 tsconfig.json 的 include 逐文件判定
  → glob 化后 15 文件全部被 tests/tsconfig.json「拥有」→ import 解析为真实类型
  → 修复 145 条真实 error 后归零
Exit: EXIT_CODE=0（本审查独立重跑实测）
```
**判定**: ✅ 连通。独立重跑 `run-oxlint.ts apps/vscode-dsh/tests` 实测 `EXIT_CODE=0`。关键佐证「0 是真实 program 后的 0、非绕过」：本审查独立跑 `tsc -p tests/tsconfig.json --noEmit` 实测 **219 条 error，覆盖 7 个 cap-*.spec.ts（tests 自身 108 条）**——证明 glob program 确实把全目录文件纳入（白名单时代仅 spike-t0a-replay-hydrator.ts 存活，只报 vendor 错误）。1906（无 program 噪声）→ 145（真实）→ 0 的链完整闭合，`no-unsafe-*` 未被「无 program」绕过。

### Path 3: vitest 全绿 → 覆盖全部 12 个 spec 文件（AC-14）
```
vitest run apps/vscode-dsh/tests
  → 12 spec 文件（10 域 cap-*.spec + cap-change-list.dom + cap-chat-panel.dom）
  → Test Files 12 passed (12) / Tests 556 passed (556)
  → 556 == capability-domains.json entryAssertions 总和（144+63+49+20+23+23+6+61+36+131 = 556）✅
Exit: 失败用例数 = 0
```
**判定**: ✅ 连通。`12 passed (12)` 覆盖全部 12 个 spec 文件（非部分运行）。`556` 用例数与工作流自身声明的入口覆盖（entryAssertions 总和 556）**精确一致**，无「删用例却报全绿」。本审查独立计数 12 文件内 `it`/`test` 声明共 559 处（含 `it.each`/`it.skip`/`it.todo`，与 vitest 的 556 差异由 `it.each` 展开与 skip/todo 不计 passed 解释），与 556 量级吻合，排除大规模静默删例。

### Path 4: DEBT-019 tsc 口径登记 → gate 桩校验不误判（AC-18）
```
implementation.md 无任何 @STUB(...) 字面量（全 Phase 目录仅 repo-exploration.md 有「桩必须登记」指引句）
  → pipeline-gate.sh:427-436 只扫 implementation.md/review.md/verification.md 的 @STUB(标签)
  → DEBT-019 为 registry 行条目（类型「类型占位」，非 @STUB 标记）
  → gate 的 grep -oE '@STUB\([^)]+\)' 不匹配 DEBT-019
Exit: gate 桩登记校验正确放行，DEBT-019 不被误判为未登记 @STUB
```
**判定**: ✅ 连通。DEBT-019 以 `DEBT` 类型（非 `STUB`）正确登记于「活跃债务」表，源Phase=phase-4-lint-and-closure、阻塞=🟡非阻塞、来源=implementation.md，语义正确（覆盖口径而非空实现桩）。本 Phase 产物零 `@STUB` 标记，gate 校验真空通过，无假阳性风险。

---

## 上下游连接检查

| 变更/资产 | 上游（谁消费） | 连接状态 | 下游（被谁依赖） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| `tests/tsconfig.json` include glob | oxlint type-aware program 发现 | ✅ | tsc -p --noEmit（私有 program） | ✅ |
| `tests/tsconfig.json` `jsx:react-jsx` | `cap-webview.spec.tsx` 解析 TS17004 | ✅ | tsconfig.base.json（无 jsx，不冲突） | ✅ |
| 12 个 cap-*.spec.ts 的 lint 修复 | oxlint exit 0 | ✅ | vitest（556 全绿，语义未削弱） | ✅ |
| `DEBT-019` registry 行 | gate 桩登记校验（不匹配 @STUB） | ✅ | 后续 Phase 读 registry 承接口径 | ✅ |
| `capability-domains.json` entryAssertions | vitest 用例数对账 | ✅ | 后续 Phase 入口覆盖判定 | ✅ |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| oxlint type-aware → tests/tsconfig.json | 逐文件按 include 归属 program | glob 覆盖 15 文件全归属 | ✅ |
| tsc → tests/tsconfig.json | 覆盖全目录 | 实测 219 error 分布于 7 spec + webview + vendor | ✅ |
| vitest → 12 spec 文件 | 全量运行 | 12 passed (12)，556 passed (556) | ✅ |
| gate 桩校验 → phase 产物 | 抽 @STUB(标签) 逐条对 registry | 产物零 @STUB，DEBT-019 不被误判 | ✅ |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| 12 cap-*.spec.ts 定稿（lint 修复写面） | phase-2 | 已冻结，未改 src/**（AC-24） | ✅ |
| test-scripts 定稿 + DEBT-1 关闭 | phase-3 | 已解决，本 Phase 未触碰 | ✅ |
| `buildEditorChatSpaHtml`（替代 `buildThinChatHtml`） | src（生产，只读） | 已存在 editor-chat-panel.ts:116 | ✅ |

---

## 关键发现

### 🔴 Must-Fix
- 无。

### 🟡 Should-Fix
- 无。

### 🟢 Observations
- `[文档保真]` `implementation.md` AC-18 段写「tests 自身 108 条（**8 个 spec 文件**）」，实际列出的文件分布为 **7 个** spec 文件（change-list / chat-panel / code-context / conversation / session-host / test-harness / timeline，合计 108）。7 vs 8 为报告措辞笔误，108 条总数与分布实测正确，不影响 AC-18 交付物（registry DEBT-019 记录正确）。
- 台账口径澄清（非缺陷）：`assertion-map.md` 的 keep=543 / drop=13 是**整合前原始用例**处置计数；vitest 的 556 对应**整合后新 CAP- 编号**（`capability-domains.json` entryAssertions 总和 556）。两者非同一口径，556 > 543 说明整合过程中存在用例拆分（非删例），故「556 vs keep 543」不构成「删用例报全绿」—— 权威的「应跑用例数」= entryAssertions 556 = vitest 556，精确一致。
- `apps/vscode-dsh/tests/_probe-tsconfig.tsbuildinfo`：调研残留的未跟踪文件，`incremental:false` 下无 tsconfig 消费它，不影响 glob/lint/test，可在收口时顺带清理（不在本 Phase 产出清单，非阻塞）。
