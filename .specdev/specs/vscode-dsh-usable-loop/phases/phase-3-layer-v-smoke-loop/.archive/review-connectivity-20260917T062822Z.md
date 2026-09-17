# Connectivity Review — Phase 3 (`phase-3-layer-v-smoke-loop`)

> **round-2 复审**（round-1 报告已归档至 `.archive/review-connectivity-round1-20260916T140231Z.md`）
> 分支：`impl-phase-3-layer-v-smoke-loop`（复核：`git branch --show-current` → 一致；本轮未做任何 git 写操作）
> 本报告只回答一个问题：**这些部件是否真的接在一起**（端到端路径 / 上下游 / 契约 / 数据消费）。

## 视角

**Integration Connectivity** — 模块间是否真正连通。不评实现正确性、不评设计选择、不评视觉。

## 判决

**PASS**

**0 🔴 / 0 🟡 / 10 🟢**（其中 1 条是 round-2 修复后**已消解**的旧 🟢-2）

> round-1 的 PASS **未被继承**：本轮对 8 条链路逐跳重走（端点在 round-2 被改过），并独立核实了「是否新增第二/第三条记录通道」。所有链路仍连通；round-2 的接线变更**没有**引入断点，也**没有**引入新通道（见 §C）。

---

## A. 逐链路重走（起点 → 每一跳 → 终点）

| # | 链路 | 起点 | 终点 | 判定 |
|:--:|---|---|---|:--:|
| 1 | R1 诊断证据链 | 驱动 `dsh.test.injectDisconnect` | `status.postLink` + `node.extensionSubprocessSide` → 壳 `case PASS` | ✅ 连通 |
| 2 | `node-environment` 构造链（新增） | 驱动 `runNodeEnvironmentConstruction()` | `status.nodeEnvironmentConstruction` → 五步链路照跑 | ✅ 连通 |
| 3 | AC-11(a) `terminalSide` 链（新增） | 壳 `measure_terminal_side` | `status.node.terminalSide` → `nodeCoverage` | ✅ 连通 |
| 4 | step4 审批链 | 模型升级帧 → `approval/request` | 探针文件出现 → 壳日志协证 | ✅ 连通（未被 round-2 波及） |
| 5 | step5 原生 Diff 链 | 模型 `edit` | `meta.diffs` → TabInputTextDiff → 壳协证 | ✅ 连通（未被 round-2 波及） |
| 6 | route A 影子 preset 链 | 壳 `write_overlay` / `generate_shadow_preset` | `discoverPresets` → 25 工具面 | ✅ 连通（未被 round-2 波及） |
| 7 | 退出码 / 结论分类链 | 驱动 `status.conclusion` | 壳 `set_conclusion` → 进程退出码 | ✅ 连通 |
| 8 | 清理链 / `artifact-index.md` 写入链 | 壳 `finish()` | 索引行 + git 追踪 + 无残留 | ✅ 连通 |

---

## 一、链路 1 —— R1 诊断证据链（round-2 改动重点）

```
驱动 runPostLinkDiagnostics                          test-scripts/layer-v-driver/extension.cjs:2181-2269
  → 读基线 getDiagnosticsText (recordsBefore)          :2183-2187
  → callCommand('dsh.test.injectDisconnect')           :2190
      → extension.ts:1228-1234  registerCommand('dsh.test.injectDisconnect')
          → host?.injectRuntimeDeath()                 ✅ session-host.ts:721-729
              → 门：status !== 'connected' ⇒ return     (session-host.ts:723)
              → await client.close()                    (session-host.ts:725)  ← 只造死亡，不 poke FSM
      ← transport 订阅以 TransportClosedError 结束
          → onTransportDeath(error)                     (session-host.ts:776)
              → 门①：status ∈ {connected, starting}      (:777)
              → afterHandshake = (status === 'connected') (:778)
              → try { recordTransportDeath(reason, error) } (:786-787)   ← round-2 新增 try
                  → 门②：recorder === undefined ⇒ return  (:835)
                  → requireNodeExecutable()             (:842 → :1019-1025) ← round-2 新增 fail-loud
                  → recorder.record({kind:'child-exited', phase:'post-handshake',
                                     resolvedExecutable, source, exitCode/…})  (:843-854)
                      → HostDiagnosticRecorder.record()  (host-diagnostics.ts:357-431)
                          → store.push(record)            (host-diagnostics.ts:431)
              → catch (violation) ⇒ errorMessage += "— host diagnostic invariant violated: …" (:788-791)
              → status = 'error'                        (:793)   ← 记录先于状态（注释 :771-773）
              → notifyError(errorMessage)               (:819)   → 状态观察者显示产品错误
              → statusListeners                         (session-host.ts:285-295)
                  → extension.ts:2337-2345 onStatusChange
                      → state === 'started' ⇒ orchestrator?.onUnexpectedDisconnect()  (:2342)
                          → auto-start-orchestrator.ts:174-189  （另一次启动尝试）
  → poll：fresh(按 seq 差集) 且 phase==='post-handshake' 恰 1 条      (extension.cjs:2191-2207)
      → 缺失 ⇒ conclusion:'HARNESS_ERROR'（**不是** note）             (:2204-2205)
  → 断言 post.length === 1 ⇒ 否则 linkFailure('duplicate-post-handshake-records') (:2210-2216)
  → 断言 18 字段集 / schemaVersion / resolvedExecutable===plan.expectedNodeBin
        / source==='vscode-setting' ⇒ 否则 HARNESS_ERROR               (:2218-2250)
  → 写 status.node.extensionSubprocessSide                                    (:2385-2395)
  → assertNodeCoverageSides(status)                                          (:2398)
  → status.conclusion = 'PASS' 仅此之后可达                                   (:2399)
Exit: 壳 driver_conclusion → case PASS → corroborate → exit 0   (run-layer-v-smoke.sh:2879,2898-2901)
```

**判定：✅ 连通。** 点名问题逐条回答：

| 点名问题 | 结论 | 证据 |
|---|:--:|---|
| round-2 的 `try-catch` 是否**吞掉**诊断写入失败（fail-open）？ | ✅ **不吞** | `catch` 只把不变量违规转成 `errorMessage` 后缀（`:790`）**并继续**设置 `status='error'`（`:793`）与 `notifyError`（`:819`）—— 违规**不会**静默，它变成产品可见错误。此时记录**缺失**，而下游驱动把「缺一条 post-handshake 记录」判 **`HARNESS_ERROR`**（`extension.cjs:2204-2205`），**不是** note、**不是** PASS。方向单向：违规 → 响亮失败。 |
| 该 `catch` 是否可能造成「记录已部分写入」的假证据？ | ✅ **不可能** | `requireNodeExecutable()` 在 `recorder.record()` **之前**调用（`:842` 先于 `:843`），违规即抛出，未触达 `store.push`。 |
| `requireNodeExecutable()`（D11）是否可达？ | ✅ 实际**不可达**（防御性） | `this.nodeExecutable` 全类**唯一赋值点**是 `:418`，且 `:420` 的 `assertNodeExecutable` 通过后才可能令 `status='connected'`（`:447`）——即 `afterHandshake` 为真时该字段必已存在。实测记录两字段齐备且与启动对象一致（见下）。 |
| `resolvedExecutable`/`source` 是否就是**当真 spawn** 的那个对象？ | ✅ 同一对象 | `:415-418` 解析并存入；**同一对象**传给 `HarnessClient`（`:432`，client 侧以 `nodeExecutable.path` 真 spawn）；`recordTransportDeath` 读同一字段（`:842-848`）。本次实测 `resolvedExecutable=/usr/local/n/versions/node/24.3.0/bin/node`、`source='vscode-setting'`、`schemaVersion=2`、`seq=2`、`fieldSet 18/18`、`recordsBefore 1 → recordsAfter 2`、`freshRecordCount 1`、`postHandshakeRecordCount 1`。 |
| 「恰 1 条」是否在**新执行序**下仍成立（含 auto-retry 并发）？ | ✅ 成立 | poll 以 `phase==='post-handshake'` 过滤（`:2196`），故 auto-retry 稍后追加的 `phase:'start'` 记录**不参与计数**；且 `post.length !== 1` 有硬断言（`:2210`）。`hostCreateCount`（`:2188,2251,2264`）是**只记录不断言**的证据字段 —— 因此重试并发不会制造假失败。 |

---

## 二、链路 2 —— `node-environment` 构造链（round-2 新增）

```
壳 prepare_unqualified_node                        run-layer-v-smoke.sh:748-803
  → 把不合格解释器写进 plan.unqualifiedNode        （本次：/home/chendc/.nvm/versions/node/v20.16.0/bin/node,
                                                     kind='default-path-node'，enginesOk=false，apisOk=false）
驱动 runNodeEnvironmentConstruction                extension.cjs:1929-2062
  → 未准备 ⇒ HARNESS_ERROR（不静默跳过）             :1932-1937
  → recordsBefore（数组性校验，非数组即 HARNESS_ERROR）:1948-1953
  → configuration.update('dsh.nodeBin', <不合格路径>)  :1959   ← 与产品读取同一 section/key
  → callCommand('dsh.test.requestStart','manual-retry') :1960
      → extension.ts:1221-1225 registerCommand('dsh.test.requestStart')
          → 每次 start 都**现读**设置：extension.ts:2352 readNodeBinSetting(vscode)
                                      → :2355 start({ nodeBinSetting })
                                      → session-host.ts:415-417 resolveNodeExecutableSpec({nodeBinSetting})
                                      → :420 assertNodeExecutable(...) 抛 NodeEnvironmentError
              → session-host.ts:449-468 catch ⇒ :459 this.diagnostics?.record(describeStartFailure(...))
                  → kind='node-environment' / phase='start' / resolvedExecutable / source / missingApis
                  → :461-466 抛 HostStartError('node-environment', …) ⇒ 编排器快照 errorKind='node-environment'
  → poll：fresh 中 kind==='node-environment' ≥1 条 → 否则 HARNESS_ERROR  :1969-1993
      → 逐字段断言（绝对 resolvedExecutable / 非空 source / phase==='start' /
        missingApis 数组 / v1 18 字段）⇒ 否则 HARNESS_ERROR               :2008-2027
  → finally { restoreNodeBinSetting(...) }            :2044-2058
      → 还原失败 ⇒ **从 finally 抛** HARNESS_ERROR（outranks 在飞异常）    :2050-2058
  → result.assertions.settingRestored = true          :2060
  → 回到 runAll：**先**构造（:2341-2342）→ **再**五步链路（:2344-2380）
Exit: status.nodeEnvironmentConstruction → 壳 corroborate 独立再读一次（AC-13/14 二次校验）:2438-2454
```

**判定：✅ 连通。** 逐跳回答点名问题：

| 点名问题 | 结论 | 证据 |
|---|:--:|---|
| 改设置**是否真被 `start()` 现读**？ | ✅ 是 | 读取发生在**每次尝试内部**：`extension.ts:2352`（`readNodeBinSetting`）→ `:2355` 传入 → `session-host.ts:415-417` 解析。**实测**：记录的 `resolvedExecutable` 与 `plan.unqualifiedNode.path` **逐字符相等**（`/home/chendc/.nvm/versions/node/v20.16.0/bin/node`），即新值确实穿过了解析链（若读的是旧值，记录会是 24.3.0）。 |
| 失败**是否真走到** `kind:'node-environment'` 的记录边？ | ✅ 是 | 唯一生产者是 `session-host.ts:459`（`start()` catch）；`describeStartFailure` 填 `resolvedExecutable`/`source`（`:134-179`，对象即 `:418` 所存）。**实测** `freshRecordCount 1`、`nodeEnvironmentRecordCount 1`、`phase='start'`、`missingApis=['zlib.createZstdDecompress','Promise.withResolvers']`。 |
| 还原**是否在成功与失败两条路径上都发生**？ | ✅ 都在 `finally` | `extension.cjs:2044-2059` 的 `finally` 覆盖「poll 成功」「poll 超时」「断言失败」「凭据跳过」全部出口；还原后 `settingRestoredTo` = 24.3.0 绝对路径（**实测**）。 |
| 还原后**是否真继续跑五步**（而不是留在失败态）？ | ✅ 是 | `runAll` 的构造在五步**之前**（`:2341`），构造成功才继续；**实测** step-1…step-5 全 `ok`（1771/671/1757/8963/6248 ms），`startState` 未被留在 `failed`。失败态快照 `startSnapshot.errorKind='node-environment'` 仅作为**该次构造**的证据，不污染后续链路。 |
| 该构造是否泄漏成第二条通道？ | ✅ 否 | 见 §C 与链路 8。 |

**边界声明**：`startSnapshot.errorKind` 是**只记录不断言**（`:2039`）——判定由「记录存在且字段合格」承担（更强证据），故本项不构成断点。

---

## 三、链路 3 —— AC-11(a) `terminalSide` 链（round-2 新增）

```
壳 main()：2823-2825
  → measure_path_defaults           (run-layer-v-smoke.sh:804-830)
  → measure_terminal_side           (:446-489)  ← 在 PATH 前置候选目录**之前**量
      → 写 TERMINAL_SIDE_JSON：ok/judge/qualified/path/version/enginesOk/apisOk/missing/
                                measuredAs/action/docsAnchor/threshold/providerQualifiedNodeDir
  → assert_terminal_side_evidence   (:494-542)  ← 结构 + 自洽 + **文档锚点可解析**
      → 任一不符 ⇒ fail_harness('node-terminal-side') ⇒ HARNESS_ERROR 4   (:539-541)
  → 写进 status.node.terminalSide（经 LV_NODE_JSON，:2506-2508）
驱动 assertNodeCoverageSides        extension.cjs:2114-2174
  → 两侧各自判定：terminalSide.judge 必须 === (qualified ? 'pass' : 'fail')   (:2131-2133)
  → extensionSubprocessSide：绝对路径 + source ∈ {dsh-node-bin, vscode-setting, process-exec-path} (:2142-2150)
  → **合并禁令（机械形式）**：`node` 顶层不得出现 /^(ok|judge|qualified|verdict|conclusion|status)$/i 字段 (:2152-2157)
      → 违规 ⇒ HARNESS_ERROR('node-coverage-sides-incomplete')
  → 写 status.nodeCoverage                                                (:2398)
Exit: status JSON → 壳 case PASS → corroborate                           (run-layer-v-smoke.sh:2898-2901)
```

**判定：✅ 连通，两侧**均未**被合并。**

| 点名问题 | 结论 | 证据 |
|---|:--:|---|
| 是否有任何一处把两侧结论合并？ | ✅ 无 | 机械检查（`:2154-2157`）在**每次运行**都执行；**实测** `mergedVerdictFields: []`，且 `node` 的键集恰为 `[path, version, source, directory, defaults, dshNodeBin, terminalSide, extensionSubprocessSide]`。两侧来源不同：`terminalSide` 由**壳**在 host 存在前测（`:446-489`），`extensionSubprocessSide` 由**驱动**从记录反填（`:2385-2395`）。 |
| 断言的**失败是否真的传播**到结论 / 退出码？ | ✅ 传播 | 结构/自洽/锚点不符 ⇒ `fail_harness` ⇒ `HARNESS_ERROR` 4（`:539-541`）；`nodeCoverage` 不符 ⇒ `harnessError` ⇒ catch 改写 `status.conclusion`（`:2401-2419`）⇒ 壳 `*` 分支 ⇒ 4（`:2912-2914`）。 |
| `terminalSide.judge='fail'` 却整体 PASS —— 是否为「结论不传播」？ | ✅ **否，是 spec 指定的语义** | `spec.md:176` 明文要求本机（默认 node v20.16.0）`terminalSide` 判 ❌ 并给出动作，同时 **不得**由一侧的 ✅ 推导另一侧。实测 `judge='fail'`、`qualified=false`、`action` 非空（给出 `export PATH=…` 的具体动作）、`docsAnchor=docs/development.md#node-environment` 且被断言解析到真实标题。 |

---

## 四、链路 4 / 5 / 6 —— 未被 round-2 波及（复核结论）

| 链路 | 复核方式 | 结论 |
|---|---|---|
| **4 step4 审批** | ① `interaction-coordinator.ts:288-301 resolveApproval` 现行代码（先 `finishApproval` 再 `abort`，`unknown-id`/`invalid-outcome` 显式返回）；② 入口 `extension.ts:1108` 「本 Phase 新增」的 `dsh.test.answerApproval`；③ **本次运行实测** | ✅ 连通：`approvals.asked=2 / decided=2`，两条 `outcome='allowed-once'`、`toolName='bash'`、`reason` 非空；`probesRemoved=true` |
| **5 step5 原生 Diff** | ① `runStep5`（`extension.cjs:1675-1900`）未被 round-2 触碰（round-2 的驱动改动全部落在 `:1904` 之后 + `runAll`）；② **实测** | ✅ 连通：`nativeDiffs=[{path: …/step-5-target.txt, oldText:string, newText:string}]`；step-5 `status=ok`；目标文件在**被忽略**的 `test-artifacts/` 下（`git check-ignore` → `.gitignore:52`） |
| **6 route A 影子 preset** | ① `launch_host` 环境契约（`run-layer-v-smoke.sh:1263-1280`）；② **实测** `run-summary.json.shadowPreset` | ✅ 连通：`env -u DSH_NODE_BIN` + `PATH=<node_dir>:` + `HOME=<sandbox>` 显式白名单未变；`run1Sha256===run2Sha256===placedSha256`、`shippedUntouched=true`、`diff` 恰 `28,29d27`（2 删 0 增）、`toolCount=25/25` |

> round-2 对 `launch_host` 的唯一改动是**条件追加** `XAUTHORITY`（`:1259-1262`），仅在「本 run 用 `xvfb-run` 分配了显示」时生效 —— **不删除、不覆盖**任何既有变量，故对链路 6 的既有契约是加法。

---

## 五、链路 7 —— 退出码 / 结论分类链

```
驱动 status.conclusion（唯一 PASS 赋值点 :2399，位于两次构造 + nodeCoverage 断言之后）
  → 壳读 driver_conclusion                        run-layer-v-smoke.sh:2879
      （读不出 ⇒ "UNKNOWN" ⇒ 落 `*` ⇒ HARNESS_ERROR，不静默）
  → status_belongs_to_this_run 复核（防串 run）     :2890-2893
  → assert_probes_gone / assert_real_home_untouched :2895-2896
  → case：PASS → corroborate → 0                    :2899-2901
          LINK_FAILURE → 1（含 corroborate 的 problems 升格）:2465-2467 → :2903-2904
          SKIPPED_NO_CREDENTIALS → 3（stage 用 driver_stage，不再冒充 step-1）:2885,2906-2907
          SKIPPED_NO_DISPLAY → 2                     :2909-2910
          *（含 UNKNOWN）→ HARNESS_ERROR 4            :2912-2914
  → exit_now → finish() → exit "${EXIT_CODE}"        :213-216
```

**判定：✅ 连通，无吞码路径。** 点名问题逐条回答：

| 点名问题 | 结论 | 证据 |
|---|:--:|---|
| 全脚本是否有吞码路径（`set +e` 等）？ | ✅ 无 | 头 `set -uo pipefail`（`:46`），**全脚本 `set -e` / `set +e` 零命中**；退出**唯一**出口是 `exit_now`（`:213-216`），`^exit [0-9]` 零命中。 |
| fallback 是否 fail-closed？ | ✅ 是 | 两处关键 `|| true` 均已核：corroborate 的 node 程序输出为空 ⇒ `fail_harness`（`:2458-2460`）；诊断读取非数组 ⇒ poll 超时 ⇒ `HARNESS_ERROR`（驱动侧 `:1950-1952,1985,2204`）。 |
| `toolCount !== 25` 升为 `problems`（D13）是否真改变结论与退出码？ | ✅ 是 | JS 侧 `:2361-2365` push problems → 壳 `:2463-2467` `fail_link "corroboration"` ⇒ **LINK_FAILURE 1** ⇒ `:2903-2904`。**实测**：`corroboration={"problems":[],"warnings":[],"toolCount":25}`，`toolCount===25`（`tools.length 25`）。 |
| `SKIPPED_*` 是否绝不落在 PASS 上？ | ✅ 是 | case 分支互斥（`:2898-2915`）；skip 路径**不经过** `corroborate`；`credentialSkipForConstruction` 在两个探测点（`:1964`、`:1994-2006`）产出 `SKIPPED_NO_CREDENTIALS` + `stage='node-environment-construction'`，壳用 `driver_stage` 如实命名（`:2885,2907`），不会误报成 step-1。 |
| `problems` 与 `warnings` 是否被正确分流？ | ✅ 是 | problems ⇒ `fail_link`（改变结论）；warnings ⇒ `note`（`：2468-2470`）。本次运行 `notes: []`（索引写入自断言亦无 note） |

> `assert_probes_gone` / `assert_real_home_untouched` 在 case **之前**执行（`:2895-2896`），故任何结论都无法绕过清理断言；`record_teardown_violation` 对 PASS 是单向升格为 HARNESS_ERROR（`:205-211`）。

---

## 六、链路 8 —— 清理链 / `artifact-index.md` 写入链

```
壳 finish()                                        run-layer-v-smoke.sh:~2793
  → 守卫 [ -d "${ARTIFACT_DIR}" ] ⇒ emit_report_files / write_fallback_report
  → write_report_meta：index:{path, tracked}        :2500-2502（git ls-files --error-unmatch）, :2571
  → emit_report_files                               :2577-2702
      → 锚 = **首个连续表格块末尾**（blockEnd+1）    :2630-2648（placeholder 分支 :2624-2628）
      → 写后**自断言**：rowOccurrences===1 && rowInFirstTableBlock
                        && headerRowsBeforeRow===1  :2651-2675
      → 自断言不符 ⇒ **note**（不改结论）            :2694-2698
Exit: 行落表内 + git 追踪 + 无残留
```

**判定：✅ 连通。** 点名问题逐条回答：

| 点名问题 | 结论 | 证据 |
|---|:--:|---|
| 写入是否**仍被 git 追踪**？ | ✅ 是 | `git ls-files --error-unmatch …/artifact-index.md` → 成功（`tracked=yes`；`run-summary.json.index.tracked=true`）；`git check-ignore` 对其 exit 1（未命中）。状态 `AM` = 已纳入索引且有后续修改。 |
| 新锚是否**不会**把行写到表外（边界情形）？ | ✅ 本次成立 | **实测**索引末 6 行全部落在同一表格块内（含 round-2 的 `13:56:56 LINK_FAILURE 1`、`13:57:15 SKIPPED_NO_CREDENTIALS 3`、`13:57:53 PASS 0`），且 `notes: []` ⇒ 三条自断言均通过。 |
| 是否有临时残留？ | ✅ 无 | **实测**：`tempRootRemoved=true`、`socketReleased=true`、`codeProcessesNotInBaseline=[]`、`crashpadForThisRun=[]`、`sandboxHomeProcesses=[]`、`probesRemoved=true`、`realHomeIntegrity.unchanged=true`（585 entries / 同一 digest）；`git status --porcelain` 中**无** `test-artifacts/` 行（`artifactsGitStatus.artifactsDirInGitStatus=false`）。 |
| 写入失败是否会导致假通过？ | ✅ 不会，但**降级为 note** | 见 🟢-1（round-1 已记，round-2 未改变该口径，只是把「写到哪」纳入自断言）。 |

---

## 上下游连接检查

| 新/改函数·组件 | 上游（谁调用） | 连接 | 下游（调用谁） | 连接 |
|---|---|:--:|---|:--:|
| `validate_phase_id`… 本 Phase 无关 | — | — | — | — |
| `onTransportDeath`（round-2 加 try/catch） | transport 订阅失败边（`session-host.ts:747-750`） | ✅ | `recordTransportDeath`（`:787`）→ `notifyError`（`:819`）→ statusListeners | ✅ |
| `recordTransportDeath` | `onTransportDeath` 的 `afterHandshake` 门 | ✅ | `requireNodeExecutable`（`:842`）→ `recorder.record`（`:843`） | ✅ |
| `requireNodeExecutable()`（D11 新增） | `recordTransportDeath` | ✅ | `this.nodeExecutable`（唯一赋值 `:418`） | ✅ |
| `HostDiagnosticRecorder.record()` | `session-host:459,843`／`host-diagnostics:338,346`／`extension:2385` | ✅ | `store.push`（`host-diagnostics.ts:431`）→ `records()`（`:443`） | ✅ |
| `records()` | `dsh.test.getDiagnosticsText`（`extension.ts:1120-1123`） | ✅ | 驱动 poll → 断言（`extension.cjs:2191-2250`、`:1969-2027`） | ✅ |
| `lastSeq()` | `extension.ts:2349,2384`（fallback 守卫）、`host-diagnostics.ts:323`（listener 高水位） | ✅ | 两条去重判定 | ✅ |
| `runNodeEnvironmentConstruction()`（新增） | `runAll`（`extension.cjs:2341`） | ✅ | `configuration.update`／`requestStart`／`restoreNodeBinSetting` | ✅ |
| `measure_terminal_side` / `assert_terminal_side_evidence`（新增） | 壳 `main:2824-2825` | ✅ | `LV_NODE_JSON`（`:2506-2508`）→ 驱动 `assertNodeCoverageSides` | ✅ |
| `credentialSkipForConstruction`（新增） | 构造的两个探测点（`:1964,2000,2004`） | ✅ | 壳 `case SKIPPED_NO_CREDENTIALS` + `driver_stage`（`:2885,2907`） | ✅ |
| `corroborate`（D13 改动） | 壳 `case PASS`（`:2900`） | ✅ | `fail_link`（problems）／`note`（warnings） | ✅ |
| `emit_report_files`（新锚） | `finish()`（`:2795`） | ✅ | `artifact-index.md`（git 追踪） | ✅ |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|---|---|---|:--:|
| `extension.ts` → `IdeSessionHost` | 每 attempt 现读 `dsh.nodeBin` 并传入 | `:2352-2355` → `session-host.ts:415-417` | ✅ |
| `session-host` → `HostDiagnosticRecorder` | `record(input)` 可声明 `phase:'post-handshake'` | `host-diagnostics.ts:70`（联合含该成员）、`:431` 直接采信 | ✅ |
| `session-host` → `HostFailureRecorder` | 新增可选 `lastSeq?()` | `host-diagnostics.ts:451`；调用侧用 `?.()` 容错（`:323`） | ✅ |
| 驱动 → 产品命令面 | 6 个 `dsh.test.*` 命令存在且可用 | `extension.ts:1108,1120,1189,1221,1226,1228`（均在 `shouldRegisterTestHooks` 块内） | ✅ |
| 驱动 ↔ 壳（结论语义） | 5 结论 ↔ 0/1/2/3/4 | `run-layer-v-smoke.sh:2898-2915` | ✅ |
| 驱动 ↔ 壳（构造证据字段） | `nodeEnvironmentConstruction.{record,settingRestoredTo,freshRecordCount}` | 壳 `:2441-2454` 独立复读 `kind/resolvedExecutable/source` | ✅ |
| 壳 ↔ 文档锚点 | `docsAnchor` 必须可解析 | `assert_terminal_side_evidence`（`:494-542`）校验文件存在 + 标题 slug 命中；**实测通过** | ✅ |
| 索引写入者 ↔ 索引读者 | 行必须在**首个表格块内**且唯一 | 自断言 `:2651-2675` + 本次索引实测 | ✅ |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 | 接口状态 | 连接 |
|---|:--:|:--:|:--:|
| `HostDiagnosticRecorder` / `records()` / `lastSeq()` | Phase 2 | 本 Phase **扩展** `phase` 联合（`+ 'post-handshake'`）并把 `SCHEMA_VERSION 1→2`（**字段集仍 18**）；`lastSeq()` 为**新增可选成员**（向后兼容） | ✅ |
| `createStartFailureListener` | Phase 2 | 未改签名；round-2 在其内补 `lastSeq` 高水位判定（见 §C） | ✅ |
| `dsh.nodeBin` 设置项 / `resolveNodeExecutableSpec` | Phase 1 | 未改；`source:'vscode-setting'` 取值路径不变（实测命中） | ✅ |
| `AutoStartOrchestrator.onUnexpectedDisconnect()` | Phase 1 | 签名与语义未改；仅触发者仍是产品自身状态观察（`extension.ts:2342`） | ✅ |
| `discoverPresets` / 影子 preset / `tool-policy` | 既有包 | 未改；实测 25 工具面、shipped 哈希不变 | ✅ |
| `DEBT-010`（本 Phase 承接并修复） | Phase 2 | 注册表已迁入「已解决」，三条独立证据 + 真机证据齐备 | ✅ |
| 活跃债务 5 条（`DEBT-004/009/011/012/013`） | 前 Phase | 均 🟡 非阻塞、零行为影响、非本 Phase 新增 | ✅（不阻塞） |

---

## B. round-1 的 5 条 🟢 —— 逐条复核

| # | round-1 观察 | 本轮复核 | 结论 |
|:--:|---|---|:--:|
| 1 | `artifact-index.md` 对「沙箱建立前」的两条 HARNESS_ERROR 路径不追加行；写入失败只记 note | `finish()` 的 `[ -d "${ARTIFACT_DIR}" ]` 守卫仍在（`:2793`）；round-2 只改了**锚**，并把「行是否落在首个表格块内 / 是否唯一 / 表头是否唯一」纳入**自断言**（`:2651-2675`），但自断言不符仍只 `note`（`:2694-2698`）。**实测** `notes:[]` 且三条 round-2 运行的行都在表内 | **仍成立**（不构成断点、无假通过） |
| 2 | `toolCount !== 25` 只记不判 | **已被 round-2（D13）修复**：`corroborate` 把它升为 `problems`（`:2364-2365`）→ 壳 `fail_link`（`:2465-2467`）→ LINK_FAILURE 1。**实测** `problems:[] / toolCount 25` | **不再成立 → 已消解** |
| 3 | step5 行为依赖模型选对工具（`str_replace_editor` 结构性地永不产 `meta.diffs`） | 未变（round-2 未触碰 step5/Diff 链路）；失败仍是**响亮**的 LINK_FAILURE，不是静默通过。**实测**本次模型选 `edit`，`nativeDiffs` 1 条 | **仍成立**（响亮的失败模式） |
| 4 | 「恰 1 条 post-handshake」是断线后的即时快照，auto-retry 稍后可能追加记录 | 未变。补充：poll 以 `phase==='post-handshake'` 过滤（`:2196`），重试记录的 `phase` 是 `'start'`，**不参与**计数；`post.length!==1` 有硬断言（`:2210`）。**实测** `recordsBefore 1 → recordsAfter 2`（seq 1=构造、seq 2=post-handshake） | **仍成立**（且并发安全） |
| 5 | 范围外：本机仓库级测试噪声（`FiberState` 解析为 undefined 等）使「回归全绿」口径不成立 | 性质与 round-2 改动无关（round-2 只改 `session-host` 的失败边 + 脚本/驱动），本轮**未重测**该口径（属 verifier 范围，非连通性问题） | **仍成立**（未重测，无新证据表明变化） |

---

## C. 特别关注 —— 是否新增第二 / 第三条记录通道

**结论：无第二通道，无第三通道。同一次失败仍只产生一条记录。**

**（1）全部记录写入点已穷举（`grep -rn "\.record(" src/*.ts` → 5 处，全在失败路径）**

| # | 写入点 | 触发条件 | 与其他的互斥机制 |
|:--:|---|---|---|
| 1 | `session-host.ts:459`（`start()` catch） | 该次 `start()` 抛出（含 pre-flight 拒绝） | 唯一 pre-handshake 写入者 |
| 2 | `session-host.ts:843`（`recordTransportDeath`） | `status==='connected'` 时的 transport 死亡 | 与 #1 互斥：`status='connected'` 只能由 `:447` 到达，而 `:447` 之后不可能再进 `catch`；`requireNodeExecutable` 在写之前（`:842`） |
| 3 | `host-diagnostics.ts:338`（listener，`kind!==null` 分支） | `errorKind` 可映射为 kind 的启动失败 | 映射表（`:275-289`）对 `node-environment`/`bridge-listen`/`spawn`/`handshake-timeout`/`process-failed`/`undefined` **一律返回 `null`**，即「Host 已能发言的种类 listener 不发言」；唯一非 null 的是 `missing-credentials`（编排器在 Host 之前拒绝 ⇒ #1 不可达）；另有 `signature` 去重（`:334-335`） |
| 4 | `host-diagnostics.ts:346`（listener，`kind:'other'` 兜底 = D10） | `errorKind==='process-failed'` **且** 高水位未动（`:344`） | 高水位 = `lastSeq()`：任何边界写过一条，mark 就动了 → 直接 return。即「有人替它发言就不补写」 |
| 5 | `extension.ts:2385`（extension fallback） | `start()` 失败 **且** `lastSeq()===seqBeforeStart`（`:2349,2384`） | 同一高水位判定的另一侧；与 #1/#3/#4 三者均互斥 |

**（2）针对用户点名的两个新执行序的独立核实**

| 场景 | 是否有第二条通道？ | 证据 |
|---|:--:|---|
| **`node-environment` 构造失败**（改设置触发 pre-flight 拒绝） | ✅ **仅 1 条** | #1 写（`:459`）；#3 **结构性地不写**（`hostFailureKindForStartError('node-environment') === null`，`:281-287`，随后 `:341` 因 `errorKind!=='process-failed'` 返回）；#5 因 mark 已动（`:2384`）不写；#4 因 `errorKind` 不是 `process-failed` 不写。**实测**：`recordsBeforeCount 0 → recordsAfterCount 1`、`freshRecordCount 1`、`nodeEnvironmentRecordCount 1` |
| **握手后受控断线**（R1.1 取证） | ✅ **仅 1 条** | #2 写；#1 不可达（`start()` 已成功）；#4/#5 需「`start` 失败」前提，均不可达。**实测**：`recordsBefore 1 → recordsAfter 2`、`freshRecordCount 1`、`postHandshakeRecordCount 1`；且驱动有**硬断言** `post.length !== 1` ⇒ `linkFailure`（`:2210-2216`，即 R1.3 要求的「同一次断线只允许一条」是程序化强制的） |
| 用户点名的竞态：「握手响应已达但 `status` 尚未置位」 | ✅ 只会**少记**，不会**多记**，且少记是**响亮**失败 | 若 `afterHandshake===false`（`:778`）则 #2 不写 → 驱动 poll 无 fresh 记录 ⇒ **`HARNESS_ERROR`**（`:2204-2205`），**不会**落到 PASS。方向上无 fail-open。实际场景（五步链路完成后的受控断线）此时 `status` 恒为 `connected`，竞态不可达 |

**（3）`records()` 的「空数组」语义未被削弱**：`dsh.test.getDiagnosticsText` = `hostDiagnostics?.records() ?? []`（`extension.ts:1120-1123`）。R1.2 要求「完成取证构造后读到 `[]` ⇒ `HARNESS_ERROR`」，本轮该口径由驱动 poll 的 `conclusion:'HARNESS_ERROR'` 承担（`:2204`），未被 round-2 改动削弱。

> **必须点明的前置依赖**：`recordTransportDeath` 在 `recorder === undefined` 时**静默 return**（`session-host.ts:834-835`）。这条路径的安全性**完全依赖**下游「记录缺失 = HARNESS_ERROR」的契约（而非 note）——即 §一 表格第三行。契约在，链路就响亮；若哪天有人把该 poll 的结论降级为 note，此处立刻变成 fail-open。

---

## 关键发现

### 🔴 Must-Fix

（无）

### 🟡 Should-Fix

（无）

### 🟢 Observations

1. **`artifact-index.md` 的写入校验不参与判决，且沙箱建立前的两条自杀路径不追加行**（round-1 #1，仍成立）：`finish()` 以 `[ -d "${ARTIFACT_DIR}" ]` 为守卫（`run-layer-v-smoke.sh:2793`），写入自断言不符只 `note`（`:2694-2698`）。**影响面**：AC-33(b) 的可验收场景（真实运行 / 跳过 / 失败）全部有行；仅「脚本连沙箱都没建起来」的两种退出无行（此时也没有产物可索引）。**不构成断点，亦无假通过。**
2. **`node-environment` 构造链的「恰一条」是只记录、不断言**（round-2 新增的**不对称**）：断线链有硬断言 `post.length !== 1`（`extension.cjs:2210`，对应 R1.3 明文要求），而构造链只把 `freshRecordCount` 写进证据（`:2034`）不判。**当前无任何 AC 要求该侧唯一性**（AC-13/14 只要求「存在 `kind:'node-environment'` 且 `resolvedExecutable` 为绝对路径」），且实测为 1，故**不升格为 SHOULD-FIX**；若希望两侧对称地把「一次构造 = 一条记录」变成程序化事实，加一行 `if (found.fresh.length !== 1) problems.push(...)` 即可。
3. **`recordTransportDeath` 在无 recorder 时静默 return**（`session-host.ts:834-835`）：这是链路 1 上唯一的静默分支，其安全性由下游「记录缺失 ⇒ HARNESS_ERROR」契约兜住（见 §C 末）。属**可接受的边界**，但它是「契约一旦降级即 fail-open」的承重点，值此点名。
4. **构造链的「还原失败」会覆盖在飞异常**（`extension.cjs:2044-2058`，从 `finally` 抛出）：方向仍是 fail-closed（HARNESS_ERROR），但**主因**（如 poll 超时）会在报告里被还原问题取代。注释声明这是刻意取舍（「不可还原的设置 outranks 在飞异常」），故只记录不要求返工。
5. **本次 PASS 运行的显示模式是 `reuse`**（`run-summary.json.display.mode="reuse"`, `value=":1"`），因此 round-2 的 `xvfb-run` + `XAUTHORITY` 分支（`run-layer-v-smoke.sh:644-694,1259-1262`）**未被最新证据覆盖**（见「未能验证 / 边界」）。
6. `[文档保真]` **注册表 `DEBT-010` 的证据指针写的是 `layer-v-status.json` 的 `r1` 段**，实际键名是 `postLink` 与 `node.extensionSubprocessSide`（无 `r1` 键）。指针不解析属可追溯性瑕疵，对交付物零影响；相位内已有「锚点必须可解析」的既有实践（链路 3 的 `docsAnchor` 断言），故顺带点名。

---

## Stub Detection

| 检查项 | 结论 | 证据 |
|---|---|---|
| 本 Phase 产物是否含 `@STUB(...)`？ | ✅ **零** | `grep -rn "@STUB" phases/phase-3-layer-v-smoke-loop/*.md` → 仅命中「自检说明」文字，无标记；`implementation.md:280` 自陈一致 |
| 产品面是否新增未登记桩？ | ✅ 无 | `repo-exploration.md:318,339-340` 的绝对扫描（`@STUB(|TODO|FIXME` → 0 hits）；本轮复核未见新增标记 |
| registry 交叉核 | ✅ 一致 | `DEBT-010` 已迁入「已解决」并列三条独立证据 + 真机证据；活跃 5 条（`DEBT-004/009/011/012/013`）均 🟡 非阻塞、零行为影响、非本 Phase 新增 |
| 依赖「不可用接口」的假设？ | ✅ 无 | 本 Phase 的跨模块依赖（Phase 1/2 接口）均已在仓库中实现并被实测消费 |

---

## 未能验证 / 边界（明确声明）

1. **`xvfb-run` + `XAUTHORITY` 分支未被最新证据覆盖**：最近一次 PASS 运行走 `reuse`（`:1`），`DISPLAY_AUTHORITY` 为空 → `display_env` 分支未执行。可判断的范围：该改动是**条件追加**（仅当本 run 以 `xvfb-run` 分配显示时生效）、不删除既有变量，结构上不破坏链路 6 的契约；但「真正走 xvfb 时的连通性」本轮**无实测证据**。
2. **未重跑仓库级测试**（round-1 #5 的口径未重测）：属 verifier 范围，非连通性问题。
3. **未验证语义层**：证据「指向真实位置」可核（路径存在 / 字段齐备 / 锚点解析），但「证据是否支持该断言」是 `reviewer-design` 的职责；本轮**未**评实现正确性、设计合规、视觉。
4. **`hostCreateCount` 的并发下界未做压力验证**：它是只记录不断言的字段（`extension.cjs:2188,2251,2264`），理论上重试可使其 before≠after，本轮实测相等（2/2）。
5. **未做任何 git 写操作**，未修改产品代码 / 脚本 / 测试 / spec；唯一写入是本报告文件。

---

## 实际验证动作

**读过的文件（读原文 / 读 function body，非只读签名）**

- 规格与上游：`spec.md`（含修订段 `R1.0`–`R1.3`，`AC-10/11/13/14` 行）、`scope-amendment-01.md`、`implementation.md`（round-2）、`repo-exploration.md`、`tech-debt-registry.md`、round-1 归档报告
- 产品代码：`src/{extension,session-host,host-diagnostics,interaction-coordinator}.ts`（逐跳读 `onTransportDeath`/`recordTransportDeath`/`requireNodeExecutable`/`start()`/`record`/`createStartFailureListener`/`hostFailureKindForStartError`/`createStartHostPort`）
- 脚本与驱动：`test-scripts/run-layer-v-smoke.sh`（`exit_now`/`fail_*`/`record_teardown_violation`/`measure_terminal_side`/`assert_terminal_side_evidence`/`prepare_unqualified_node`/`launch_host`/`corroborate`/`emit_report_files`/`finish`/`main`）、`test-scripts/layer-v-driver/extension.cjs`（`runNodeEnvironmentConstruction`/`credentialSkipForConstruction`/`restoreNodeBinSetting`/`assertNodeCoverageSides`/`runPostLinkDiagnostics`/`runAll`）
- 产物：`test-artifacts/layer-v/{layer-v-status.json,layer-v-plan.json,layer-v-log-evidence.json,run-summary.json,layer-v-corroboration.json}`、`.specdev/.../artifact-index.md`

**跑过的命令与看到的结果（全部只读）**

| 命令 | 结果 |
|---|---|
| `git branch --show-current` | `impl-phase-3-layer-v-smoke-loop`（与任务给定一致） |
| `git diff --stat HEAD -- apps/vscode-dsh/src apps/vscode-dsh/test-scripts` | `extension.ts +21`／`host-diagnostics.ts +78`／`interaction-coordinator.ts +53`／`session-host.ts +119`／`README.md +105` / `.gitignore +5` —— 与用户给定清单一致（**口径更正**：这些数与 `HEAD` 比，是**本 Phase 累计**，不是 round-2 单轮增量） |
| round-1 归档件符号检索（7 个 round-2 新符号） | 全部 **0 命中** → 确认 `measure_terminal_side`/`assert_terminal_side_evidence`/`prepare_unqualified_node`/`runNodeEnvironmentConstruction`/`assertNodeCoverageSides`/`requireNodeExecutable`/`credentialSkipForConstruction` 均为 round-2 引入 |
| `grep -rn "\.record(" src/*.ts` | 恰 5 处写入点（含 §C 表） |
| `grep -n "set +e\|set -e"` / `^\s*exit [0-9]` | **零命中**（唯一出口 `exit_now`） |
| 读 `layer-v-status.json` | `conclusion=PASS`；`terminalSide.judge=fail / ok=false / qualified=false`（两侧未合并，`mergedVerdictFields:[]`）；`extensionSubprocessSide.ok=true / source='vscode-setting' / resolvedExecutable=…/24.3.0/bin/node / seq=2 / schemaVersion=2`；`postLink{recordsBefore 1, recordsAfter 2, freshRecordCount 1, postHandshakeRecordCount 1, fieldSet 18/18}`；`nodeEnvironmentConstruction{recordsBeforeCount 0, recordsAfterCount 1, freshRecordCount 1, nodeEnvironmentRecordCount 1, record.kind='node-environment', record.phase='start', settingRestoredTo=…/24.3.0/bin/node, startErrorKind='node-environment'}`；`steps` 5×`ok` |
| 读 `layer-v-log-evidence.json` | `approvals.asked=2 / decided=2`（均 `allowed-once`、`toolName='bash'`、reason 非空）；`nativeDiffs` 1 条（`oldText`/`newText` 均 string）；`toolCount=25`、`tools.length=25` |
| 读 `run-summary.json` | `probesRemoved=true`；`realHomeIntegrity.unchanged=true`；`reclamation.runtimeResidue{tempRootRemoved:true, socketReleased:true}`；`reclamation.processResidue{codeProcessesNotInBaseline:[], crashpadForThisRun:[]}`；`artifactsGitStatus.artifactsDirInGitStatus=false`；`shadowPreset{deterministic:true, shippedUntouched:true, diff='28,29d27'}`；`index.tracked=true`；`notes:[]` |
| `git status --porcelain` / `git ls-files --error-unmatch …/artifact-index.md` / `git check-ignore -v …` | 索引**被追踪**；`test-artifacts/` 命中 `.gitignore:52` 且不出现在 status 中；无临时残留 |
| 尾部读 `artifact-index.md` | round-2 三次运行（`13:56:56 LINK_FAILURE 1`、`13:57:15 SKIPPED_NO_CREDENTIALS 3`、`13:57:53 PASS 0`）全部落在**同一表格块内** |

**未做的事**：未修改任何产品代码 / 脚本 / 测试 / spec；未执行任何 git 写操作；未评判实现正确性、设计合规、视觉；未重跑测试套件。
