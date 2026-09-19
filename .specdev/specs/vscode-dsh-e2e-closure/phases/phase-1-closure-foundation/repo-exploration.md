# Repository Exploration Report — Phase 1: 闭环判定模型与证据隔离基座

> 模式：phase 级。范围：`capability-runner.cjs` / `run-layer-v-capabilities.sh` / `extension.cjs` 三个改动面 + manifest `expect` 形态 + registry 交叉校验。所有断言均标注 `文件:行号` 与代码原文，标注 ✅ CONFIRMED（已读函数体）。

## 1. Task Context

Phase 1 在既有层 V 能力驱动上落地：① `capability-runner.cjs` 新增 `classifyAssertionStrength`（弱证据/具体结果分类）与 `assessClosedLoop`（实际触发 / 具体断言 / 真实截图三元判定），`runCapability`/`runManifest` 返回携带正交于退出码的 `closedLoop`；② `run-layer-v-capabilities.sh` 把 flat 单一产物目录改为 `runs/<runId>/` per-run 隔离（plan 稳定路径 + `plan.artifactDir` 指向 per-run 目录）；③ 确认 journal 逐步追加（AC-7）与退出码契约 0/1/2/3/4（AC-8）不破坏。核心原则：复用不改 `primitives.cjs`/`layer-v-runtime.sh`/`MATCHERS`/`matchesExpect`/退出码契约。

## 2. Repository Overview

- 验证基础设施位于 `apps/vscode-dsh/test-scripts/`，全部为 plain Node CommonJS（`.cjs`）+ bash，无 npm 依赖。
- 三份文件职责分工：`capability-runner.cjs` = 依赖无关的编排半（manifest→选择→凭证门控→步执行→断言→聚合）；`extension.cjs` = in-host 半（绑 `vscode.commands` + capture tool + journal/status 落盘）；`run-layer-v-capabilities.sh` = shell 编排（display/Node/沙箱/launch/进程回收 + 退出码映射）。
- 应用包 `apps/vscode-dsh/package.json` 为 `"type": "module"`，故驱动目录用 `.cjs`（CJS 是 VS Code 在该目录树 `require` 的唯一形态）。`primitives.cjs` 头部明确："Plain CommonJS with no npm dependencies … never `vscode` … executable under plain Node"。

## 3. Most Relevant Areas

| 文件 | 与本 Phase 关系 | 来源 |
|------|------|:--:|
| `apps/vscode-dsh/test-scripts/layer-v-capability-driver/capability-runner.cjs` | 新增 `classifyAssertionStrength`/`assessClosedLoop`；`runCapability`/`runManifest` 返回加 `closedLoop` | 👁 |
| `apps/vscode-dsh/test-scripts/run-layer-v-capabilities.sh` | `write_plan` 改传 per-run `artifactDir`；产物路径变量拆分 | 👁 |
| `apps/vscode-dsh/test-scripts/layer-v-capability-driver/extension.cjs` | 复核 `resolveArtifactDir`（已支持 `plan.artifactDir`） | 👁 |
| `apps/vscode-dsh/test-scripts/layer-v-support/primitives.cjs` | 只读复用，**不改** | 👁 |
| `apps/vscode-dsh/test-scripts/layer-v-capabilities.json` | `expect` 形态来源（供 `classifyAssertionStrength` 落地） | 👁 |
| `.specdev/specs/vscode-dsh-e2e-closure/tech-debt-registry.md` | 交叉校验 | 👁 |

## 4. Key Entry Points / Call Paths

```
run-layer-v-capabilities.sh (main)
  └─ write_plan            → 写 plan.json（含 artifactDir）+ 调 layer-v-runtime.sh
  └─ launch_host           → 起 Extension Development Host，加载 layer-v-capability-driver/extension.cjs
        └─ extension.cjs activate() → runAll()
              ├─ readPlan()          → 从稳定路径读 plan
              ├─ resolveArtifactDir(plan) → plan.artifactDir || FALLBACK
              ├─ readManifest()      → 读 layer-v-capabilities.json
              ├─ runManifest(manifest, host, {selector, hasCredential, journal})
              │     ├─ selectCapabilities()
              │     ├─ 凭证门控: requiresModel && !hasCredential → SKIPPED_NO_CREDENTIALS
              │     └─ runCapability(cap, host, opts)  → 逐步执行，逐 record 产出
              │           └─ matchesExpect / resolveMatcher / MATCHERS（复用不改）
              ├─ appendJournal()     → 逐行 JSONL（每步）
              └─ 写 status.json（仅一次，最后）
  └─ wait_for_status       → 轮询 status，fail-closed
  └─ case 映射 driver conclusion → exit code 0/1/2/3/4
```

## 5. Likely Impact Surface

| 改动点 | 文件:行 | 风险 |
|------|------|:--:|
| `runCapability` 成功返回新增 `closedLoop` | `capability-runner.cjs:509` | 低 |
| `runManifest` 的 skip 分支（572）与 catch 分支（586）补 `closedLoop` 默认值 | `capability-runner.cjs:572,586` | 中：这两处**无 `steps` records**，`assessClosedLoop` 无从计算，需显式 `closedLoop: null` 或默认未闭环 |
| 新增导出 `classifyAssertionStrength`/`assessClosedLoop` | `capability-runner.cjs:597` | 低 |
| `write_plan` 的 `artifactDir` 参数改传 `${RUN_DIR}` | `run-layer-v-capabilities.sh:150` | 中：shell↔driver 路径错位风险（见 §7） |
| 新增 `RUN_DIR` 变量；`STATUS_PATH`/`SUMMARY_PATH` 指向 `RUN_DIR` | `run-layer-v-capabilities.sh:47,49` | 中 |
| `rm -f` 陈旧 status/journal 的行内 journal 路径同步 | `run-layer-v-capabilities.sh:332` | 中：当前 journal 路径是**行内硬编码**，非变量 |
| `extension.cjs` 仅复核，预计零改动 | — | 低 |

## 6. Existing Constraints / Conventions

- **`capability-runner.cjs` 必须保持依赖无关**：文件头（`:5-11`）声明 "deliberately free of any `vscode` import … executable under plain Node"；只 `require('../layer-v-support/primitives.cjs')`（`:49-65`）。新增代码不得引入 `vscode` 或 npm 依赖。
- **断言原语复用不改**：`MATCHERS`（`:203`）、`resolveMatcher`（`:220`）、`matchesExpect`（`:276`）为 AD-4 扩展点，Phase 1 只新增分类函数消费它们，不改函数体。
- **退出码/结论契约**：`CONCLUSION_PRECEDENCE = ['HARNESS_ERROR', 'LINK_FAILURE', 'SKIPPED_NO_CREDENTIALS', 'PASS']`（`:74`）；`primitives.cjs:13` 冻结结论词汇→退出码 `0/1/2/3/4`。
- **shell 复用共享 runtime**：`:120-123` `. "${SUPPORT_DIR}/layer-v-runtime.sh"`，display/Node/沙箱/launch/进程回收/`set_conclusion` 都在其中，不改。
- **plan 稳定路径契约**（`extension.cjs:10-14` 头注释）：plan 名 manifest 路径、run id、selector、artifactDir、hasCredential；`plan.artifactDir` 是 status/journal/screenshot 落盘唯一真相源，shell 从同目录读。

## 7. Risks / Unknowns

1. **shell↔driver 路径错位（design 高风险 #2 复现）**：`write_plan` 把 `artifactDir` 改传 `RUN_DIR` 后，`readPlan()`（`extension.cjs:78`）仍从 `FALLBACK_ARTIFACT_DIR/layer-v-capabilities-plan.json` 读 plan（稳定路径，✅ 不变），但 shell 侧 `wait_for_status` 读 `STATUS_PATH` 必须同步指向 `RUN_DIR`，否则「driver 写 runId 目录、shell 读 flat」静默错位。✅ CONFIRMED：`readPlan` 硬编码读 `FALLBACK_ARTIFACT_DIR`，不读 `plan.artifactDir`；shell 侧 `STATUS_PATH`（`:47`）当前=flat，需同步改。⚠️ HYPOTHESIS：`wait_for_status` 的 `status_belongs_to_this_run` fail-closed 会兜住「读到不属于本 run 的 status」，但「读到**旧 flat 残留** status 且 runId 恰巧不同」会判 HARNESS_ERROR 而非静默放行——这正是 fail-closed 语义，保留即可。
2. **`runManifest` 非成功路径无 `steps`**：skip 分支（`:572-577`）与 catch 分支（`:586-591`）产出的 capability 对象不含 `steps` records，`assessClosedLoop` 无法对其计算。implementer 需决定这两处的 `closedLoop` 默认值（建议 `null` 或 `{closed:false, missing:[...]}`），并确保 AC-8 的 SKIPPED/HARNESS 不被误判为「闭环」。✅ CONFIRMED（已读函数体）。
3. **`classifyAssertionStrength` 的 weakFields 白名单边界**：design 骨架 `weakFields = ['panelOpen','viewId','registered','ok']`。manifest 中存在 `{outcome:'created'}`（`:191`）、`{outcome:'empty', hits:[]}`（`:525`）、`{changes.0.status:'reverted'}`（`:461`）等形态，按骨架规则（`outcome`/`changes`/`hits` 不在 weakFields）会判 `concrete`。这与 AC-2「弱证据封禁」语义边界需要 implementer 在 fixture dry-run 中锁定，防止假阴性/假阳性。⚠️ HYPOTHESIS：这是语义判断，门禁不保证，属 reviewer 职责。
4. **`JOURNAL` 变量不存在**：shell 中**没有** `JOURNAL` 变量，journal 路径是行内硬编码 `${ARTIFACT_DIR}/layer-v-capabilities-journal.jsonl`（`:332`）。design 骨架写 `JOURNAL="${RUN_DIR}/..."` 需改为「新增变量」而非「改现有变量」。✅ CONFIRMED。

## 8. Uncertain / Unverified

| 签名 | 位置 | 说明 |
|------|------|------|
| `resolveCaptureTool(plan)` / `captureScreenshot` | `primitives.cjs`（`capability-runner.cjs:63-64` 引入） | 复用，未在本次改动面，行为由既有 smoke/能力测试覆盖，本 Phase 不改 |
| `run_owned_pids` / `set_conclusion` / `resolve_display` / `prepare_sandbox` | `layer-v-runtime.sh` | 复用，未读函数体（超出本 Phase 改动面），下游不得假设其细节，但 AC-5 明确不改 |

## 9. Stub Detection & Registry Cross-Validation

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| DEBT-1 | `capability-runner.cjs`（13+ 原语镜像） | 活跃：「独立第二份拷贝（镜像而非 require 复用）」 | 代码已 `require('../layer-v-support/primitives.cjs')`（`:49-65`），`primitives.cjs` 头部即「DEBT-1 dedup, AD-2 reuse」 | ⚠️ 已解决未更新（registry mismatch） |
| DEBT-2 | `sdk/server` + `conversation-controller` | 活跃 | 不在本 Phase 改动面 | ✅ 不相关 |
| DEBT-3 | `layer-v-capabilities.json` 流式增量 | 活跃 | 不阻塞 Phase 1（P3 关注） | ✅ 不相关 |
| DEBT-4 | `cap-change-index-store` 等 3 项未真机执行 | 活跃 | 不阻塞 Phase 1（P3 关注） | ✅ 不相关 |
| DEBT-5 | `cap-at-path-token` 等 5 项未真机执行 | 活跃 | 不阻塞 Phase 1（P3 关注） | ✅ 不相关 |

### Stub Detection Summary

- ✅ Confirmed stubs: 0 个（registry 中无 `STUB-*` 条目）。
- ⚠️ Registry mismatch: 1 个（DEBT-1 已随 `primitives.cjs` 落盘而事实解决，但 registry 仍列「活跃」，建议 Phase 1 或收尾时移到「已解决」）。
- 🔴 Unregistered stubs: 0 个。本 Phase 改动面（三个文件）内未发现空实现/假返回/`@STUB`/`TODO` 桩信号。所有被 `assessClosedLoop` 依赖的原语（`matchesExpect`/`resolveMatcher`/`MATCHERS`）均为 ✅ CONFIRMED 真实逻辑。

## 10. Recommended Next Reads

1. ⭐ MUST READ — `apps/vscode-dsh/test-scripts/layer-v-capability-driver/capability-runner.cjs`（改，全量 628 行）
2. ⭐ MUST READ — `apps/vscode-dsh/test-scripts/run-layer-v-capabilities.sh`（改，全量 381 行）
3. ⭐ MUST READ — `apps/vscode-dsh/test-scripts/layer-v-capability-driver/extension.cjs`（复核，227 行）
4. 🔷 SHOULD READ — `apps/vscode-dsh/test-scripts/layer-v-support/primitives.cjs`（复用不改，结论词汇/原语）
5. 🔷 SHOULD READ — `apps/vscode-dsh/test-scripts/layer-v-capabilities.json`（`expect` 形态，供 fixture 样例）
6. 🔹 OPTIONAL — `apps/vscode-dsh/test-scripts/layer-v-support/layer-v-runtime.sh`（复用不改）

---

## 附：五个焦点的事实摘录（供 implementer 免二次探索）

### 附 A. `capability-runner.cjs`

**A1. `runCapability` 签名与返回值**（`:334`、`:509-516`）：

```cjs
async function runCapability(cap, host, opts = {}) {
  ...
  return {
    id: cap.id,
    group: cap.group,
    title: cap.title,
    requiresModel: cap.requiresModel === true,
    conclusion: 'PASS',
    steps: records,      // ← closedLoop 加在此对象内
  }
}
```

**A2. `runManifest` 签名与返回**（`:549`、`:594`）：

```cjs
async function runManifest(manifest, host, options = {}) {
  ...
  return { conclusion: overallConclusion(capabilities), capabilities }
}
```

`capabilities[]` 每项三种来源（`closedLoop` 需覆盖三处）：
- 成功：`runCapability` 返回（含 `steps`）→ `:581` `capabilities.push(await runCapability(cap, host, options))`
- 凭证 skip：`:572-577` `{ ...base, conclusion: 'SKIPPED_NO_CREDENTIALS', skipped: true, reason: '...' }`（**无 steps**）
- 异常：`:586-591` `{ ...base, conclusion: staged.conclusion, reason, evidence }`（**无 steps**）

**A3. `matchesExpect`/`resolveMatcher`/`MATCHERS`（复用不改）**：

```cjs
// :203
const MATCHERS = {
  $string: { name: 'string', test: value => typeof value === 'string' },
  $number: { name: 'number', test: value => typeof value === 'number' },
  $boolean: { name: 'boolean', test: value => typeof value === 'boolean' },
  $object: { name: 'object', test: value => value !== null && typeof value === 'object' && !Array.isArray(value) },
  $array: { name: 'array', test: value => Array.isArray(value) },
  $present: { name: 'present', test: value => value !== undefined },
}
```

```cjs
// :220
function resolveMatcher(pred) {
  const known = MATCHERS[pred]
  if (known !== undefined) return known.test
  const match = /^\$array:(\d+)$/.exec(pred)
  if (match !== null) {
    const minimum = Number(match[1])
    return value => Array.isArray(value) && value.length >= minimum
  }
  // :233  $contains:
  if (typeof pred === 'string' && pred.startsWith('$contains:')) {
    const needle = pred.slice('$contains:'.length)
    return value => typeof value === 'string' && value.includes(needle)
  }
  // :237  $assistantContains:
  if (typeof pred === 'string' && pred.startsWith('$assistantContains:')) {
    const needle = pred.slice('$assistantContains:'.length)
    return value => assistantText(value).includes(needle)
  }
  // :246  $assistantClosed:
  if (typeof pred === 'string' && pred.startsWith('$assistantClosed:')) {
    const needle = pred.slice('$assistantClosed:'.length)
    return value => assistantText(value).includes(needle) && !assistantStreamingActive(value)
  }
  return () => false
}
```

```cjs
// :276
function matchesExpect(actual, expect) {
  if (isPredicate(expect)) { ... }        // $... 谓词作用于整个 unwrap 结果
  if (expect !== null && typeof expect === 'object' && !Array.isArray(expect)) {
    for (const [fieldPath, expected] of Object.entries(expect)) {
      const value = resolvePath(actual, fieldPath)
      const ok = isPredicate(expected) ? typePredicate(value, expected) : deepEqual(value, expected)
      if (!ok) return { ok: false, path: fieldPath, expected: safeJson(expected), actual: safeJson(value) }
    }
    return { ok: true }
  }
  return deepEqual(actual, expect) ? { ok: true } : { ok: false, ... }
}
```

**A4. 各 step kind 执行与 record 字段名**（`assessClosedLoop` 消费对象）：

record 基础结构（`:342-348`）：
```cjs
const record = {
  index: index + 1,
  kind: step.kind,
  step: step.step,
  command: step.command,
  ok: false,
}
```

| kind | 执行逻辑（行） | 产出 record 额外字段 | `ok` 语义 |
|------|------|------|------|
| `command` | `:353-357` | `record.value` | 命令完成即 `ok=true` |
| `assert` | `:358-381` | `record.value`、`record.expectation`、失败加 `record.mismatch` | `matchesExpect().ok` |
| `wait` | `:382-399` | `record.value` | poll 到 `expect` 满足即 `ok=true` |
| `stream` | `:400-421` | `record.value`、`record.streaming={sawStreaming,sawGrowth}` | `!requireIncrement || sawStreaming||sawGrowth` |
| `replay` | `:422-467` | `record.sessionId`、`record.closeResult`、`record.value`、失败 `record.mismatch` | `matchesExpect(opened, {outcome:'opened'})` |
| `screenshot` | `:468-483` | `record.screenshot = safeJson(shot)` | `shot.ok === true`（pngVerdict 非退化） |

关键：design 骨架 `assessClosedLoop(cap, records)` 用 `r.kind`/`r.step`/`r.ok`/`r.command` 与 `cap.steps` 的 `s.kind`/`s.command`/`s.step` 交叉匹配——两者字段名一致（record 有 `kind`/`step`/`command`/`ok`；cap.steps 元素有 `kind`/`command`/`step`/`expect`/`file`）。✅ CONFIRMED 字段对齐。

**A5. 凭证门控位置**（`:563-579`）：

```cjs
if (cap.requiresModel === true && !hasCredential) {
  journal({ capability: cap.id, step: null, kind: 'credential-gate', verdict: 'SKIPPED_NO_CREDENTIALS', evidence: [], detail: 'requiresModel capability and no DEEPSEEK_API_KEY' })
  capabilities.push({ ...base, conclusion: 'SKIPPED_NO_CREDENTIALS', skipped: true, reason: 'requiresModel capability and no DEEPSEEK_API_KEY' })
  continue
}
```

**A6. 文件末尾导出方式**（`:597-627`）：`module.exports = { ... }`，导出 `runCapability`/`runManifest`/`matchesExpect`/`resolveMatcher`/`MATCHERS`/`selectCapabilities`/`overallConclusion` 等。✅ CONFIRMED：plain Node 可直接 `require`（文件仅 `require('../layer-v-support/primitives.cjs')`，`primitives.cjs` 头部声明 "never `vscode` … executable under plain Node"，既有 `layer-v-capability-runner.spec.ts` 已用 vitest 直接驱动它）。design「plain Node 可 require」成立。

### 附 B. `run-layer-v-capabilities.sh`

**B1. 产物路径变量定义**（`:45-49`）：

```bash
ARTIFACT_DIR="${APP_DIR}/test-artifacts/layer-v-capabilities"
STATUS_PATH="${ARTIFACT_DIR}/layer-v-capabilities-status.json"
PLAN_PATH="${ARTIFACT_DIR}/layer-v-capabilities-plan.json"
SUMMARY_PATH="${ARTIFACT_DIR}/layer-v-capabilities-summary.json"
```

> ⚠️ 无 `JOURNAL` 变量；journal 路径行内硬编码见 `:332`。

**B2. `write_plan` 传参与落盘**（`:130-154`）：

```bash
# :137  plan 对象的 artifactDir 参数来源
const [planPath, runId, manifestPath, artifactDir, hasCredential, videoSize, stepMs, selectorJson] = process.argv.slice(1)
const plan = { schemaVersion: 1, runId, capabilitiesManifestPath: manifestPath, artifactDir, selector: ..., hasCredential: ..., screenshot: { videoSize }, timeouts: { stepMs: Number(stepMs) } }
fs.mkdirSync(artifactDir, { recursive: true })
fs.writeFileSync(planPath, JSON.stringify(plan, null, 2) + "\n")
# :150  调用实参
' "${PLAN_PATH}" "${RUN_ID}" "${MANIFEST_PATH}" "${ARTIFACT_DIR}" "${HAS_CREDENTIAL}" ...'
```

即：当前 `artifactDir` 传 `${ARTIFACT_DIR}`（flat），plan.json 写到 `${PLAN_PATH}`（=`${ARTIFACT_DIR}/layer-v-capabilities-plan.json`，稳定路径）。Phase 1 只需把第 4 个位置参数 `${ARTIFACT_DIR}` 改为 `${RUN_DIR}`，`PLAN_PATH` 保持稳定路径不变。

**B3. `wait_for_status` 读源与 fail-closed**（`:156-190`）：

```bash
status_run_id_of() {                       # :156  读 ${STATUS_PATH} 的 runId
  if [ ! -f "${STATUS_PATH}" ]; then printf ''; return 0; fi
  "${NODE_TOOL}" -e 'process.stdout.write(String(require(process.argv[1]).runId ?? ""))' "${STATUS_PATH}" 2>/dev/null || true
}
status_belongs_to_this_run() {             # :164
  [ "$(status_run_id_of)" = "${RUN_ID}" ]
}
wait_for_status() {                        # :168
  while [ "${SECONDS}" -lt "${deadline}" ]; do
    if [ -f "${STATUS_PATH}" ] && status_belongs_to_this_run; then return 0; fi
    # liveness = 整棵树 run_owned_pids，非 launcher PID；host 消失>90s → return 1
    ...
  done
  return 1
}
```

fail-closed 落在 `main` 的 `:340-349`（`wait_for_status` 失败→若存在「属于别的 run」的 status 则 HARNESS_ERROR，无则 HARNESS_ERROR 超时）与 `:356-359`（`status_belongs_to_this_run` 复检）。

**B4. 退出码 case 映射**（`:361-377`，design 引用 `:361` ✅）：

```bash
case "${driver_conclusion}" in
  PASS)                    set_conclusion "PASS" 0 "" "" ;;
  LINK_FAILURE)            set_conclusion "LINK_FAILURE" 1 "driver" "${driver_reason:-...}" ;;
  SKIPPED_NO_CREDENTIALS)  set_conclusion "SKIPPED_NO_CREDENTIALS" 3 "driver" "${driver_reason:-...}" ;;
  SKIPPED_NO_DISPLAY)      set_conclusion "SKIPPED_NO_DISPLAY" 2 "display" "${driver_reason:-...}" ;;
  *)                       set_conclusion "HARNESS_ERROR" 4 "driver" "${driver_reason:-...}" ;;
esac
```

### 附 C. `extension.cjs`

**C1. `resolveArtifactDir` 已支持 `plan.artifactDir`**（`:61-64`）：

```cjs
function resolveArtifactDir(plan) {
  if (typeof plan?.artifactDir === 'string' && plan.artifactDir !== '') return plan.artifactDir
  return FALLBACK_ARTIFACT_DIR
}
```

`FALLBACK_ARTIFACT_DIR`（`:50`）= `path.resolve(DRIVER_DIR, '..', '..', 'test-artifacts', 'layer-v-capabilities')` = `apps/vscode-dsh/test-artifacts/layer-v-capabilities`，与 shell `ARTIFACT_DIR` 完全一致（✅ 同源）。故 `write_plan` 改传 `RUN_DIR` 后，`resolveArtifactDir` 零改动即返回 per-run 目录。

**C2. `readPlan` 读稳定路径**（`:75-82`）：

```cjs
function readPlan() {
  const raw = fs.readFileSync(path.join(FALLBACK_ARTIFACT_DIR, 'layer-v-capabilities-plan.json'), 'utf8')
  const plan = JSON.parse(raw)
  if (typeof plan !== 'object' || plan === null) throw harnessError('plan-not-an-object')
  return plan
}
```

`readPlan` 硬编码读 `FALLBACK_ARTIFACT_DIR`（**不读 `plan.artifactDir`**）。Phase 1 保持 plan.json 写稳定路径 → `readPlan` 零改动。

**C3. `appendJournal` 逐行 JSONL**（`:66-73`）：

```cjs
function appendJournal(journalPath, artifactDir, entry) {
  try {
    fs.mkdirSync(artifactDir, { recursive: true })
    fs.appendFileSync(journalPath, `${JSON.stringify({ ts: nowIso(), ...entry })}\n`)
  } catch {
    // The journal is a diagnostic aid; losing a line must not fail the run.
  }
}
```

`journalPath` 由 `runAll`（`:100`）=`path.join(artifactDir, 'layer-v-capabilities-journal.jsonl')`，`artifactDir` 来自 `resolveArtifactDir(plan)`（`:98`）。故 per-run 隔离后 journal 自动落 `RUN_DIR`，`appendJournal` 零改动。

### 附 D. `layer-v-capabilities.json` 的 `expect` 形态（供 `classifyAssertionStrength` 落地）

| 类别 | 原文 | 行号 | 判定（按 design 骨架） |
|------|------|:--:|------|
| 弱证据（存在性） | `"expect": { "viewId": "dsh.editorChat", "panelOpen": true }` | `:18` | weak（仅 viewId/panelOpen） |
| 弱证据（存在性） | `"expect": { "panelOpen": true }` | `:31` | weak |
| 具体结果（字符串谓词） | `"expect": "$assistantContains:LAYER-V-CAP-14-OK"` | `:193` | concrete |
| 具体结果（闭环谓词） | `"expect": "$assistantClosed:LAYER-V-CAP-30-OK"` | `:503` | concrete |
| 具体结果（数组+内容+状态） | `"expect": { "changes": "$array:1", "changes.0.status": "unreviewed", "changes.0.changeId": "$string" }` | `:435` | concrete |
| 具体结果（hits 数组） | `"expect": { "outcome": "listed", "hits": "$array:1", "hits.0.sessionId": "$string", "hits.0.matchField": "firstUserPreview", "hits.0.firstUserPreview": "$contains:LAYER-V-CAP-30-OK" }` | `:504` | concrete |
| 具体结果（负向/空） | `"expect": { "outcome": "empty", "hits": [] }` | `:525` | concrete（outcome 不在 weakFields） |
| 边界：状态字段 | `"expect": { "ok": true, "startState": "started", "hostStatus": "connected" }` | `:430` | concrete（startState/hostStatus 不在 weakFields） |
| 边界：`outcome` 单独存在 | `"expect": { "outcome": "created" }` | `:191` | 按骨架判 concrete（`outcome` 不在 weakFields）——见 §7.3 |

> `classifyAssertionStrength` 的 fixture dry-run 建议覆盖：`{panelOpen:true}`、`{viewId:'x'}`、`"$assistantContains:..."`、`{hits:[{$contains:'x'}]}`、`{outcome:'created'}`、未知形态（如 `123` 或 `null`）。
