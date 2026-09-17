# Connectivity Review — Phase 3 (`phase-3-layer-v-smoke-loop`)

## 视角

**Integration Connectivity** — 模块间是否真正连通（端到端数据路径 / 上下游集成 / 跨模块接线）。
本报告**不**评判代码风格、架构合规、实现正确性（分别属 `reviewer-design` / `reviewer-correctness`），也**不**评判界面（`reviewer-visual`，本 Phase `ui: false` → N/A）。

## 判决

**PASS**

七条被点名追踪的链路 + 偏差 D5 的 FSM 接线，**全部连通**：每一跳都读到了 function body 而非签名，且关键链路有**本次运行的真实产物**佐证（`test-artifacts/layer-v/`）与独立可重跑的单元契约（5 个 spec 文件 99/99 绿）。

- 🔴 MUST-FIX：0
- 🟡 SHOULD-FIX：0
- 🟢 Observations：5（均不构成断点，其中 #5 是**范围外**的工作区噪声，但它会让「回归全绿」这一口径在本机不成立，点名给 verifier）

---

## 一、`AC-11(b)` / `AC-10` 证据链（R1 的核心）

```
驱动 step: runPostLinkDiagnostics (layer-v-driver/extension.cjs:1902-1989)
  → callCommand('dsh.test.getDiagnosticsText') 读基线 (extension.cjs:1904)
  → callCommand('dsh.test.injectDisconnect')    (extension.cjs:1911)
      → extension.ts:1228-1234  registerCommand('dsh.test.injectDisconnect')
          → host?.injectRuntimeDeath()                       ✅ session-host.ts:1228→1232
              → 门：status !== 'connected' || client === undefined ⇒ return   (session-host.ts:723)
              → await client.close()                              (session-host.ts:725)
                  → HarnessClient 发 shutdown 后 dispose 子进程     (client.ts)
                  → NotificationSubscriptionImpl.close() ⇒ 所有 waiter 以
                    TransportClosedError 拒绝                     (client.ts:160-166)
      ← transport 订阅循环 next() 抛错                            (session-host.ts:735-752)
          → onTransportDeath(error)                              (session-host.ts:747-750)
              → 门：status ∈ {connected, starting}                  (session-host.ts:777)
              → afterHandshake = (status === 'connected')           (session-host.ts:778)
              → if (afterHandshake) recordTransportDeath(...)       (session-host.ts:781)
                  → recorder.record({kind:'child-exited',
                                     phase:'post-handshake',
                                     resolvedExecutable: resolved.path,
                                     source: resolved.source,
                                     exitCode/terminationSignal/stderrTail ← TransportClosedError.details})
                                                                    (session-host.ts:822-838)
                      → HostDiagnosticRecorder.record()             (host-diagnostics.ts:403-437)
                          → phase 直接采信输入声明的 'post-handshake'   (host-diagnostics.ts:405,410)
                          → retryOfSeq = null（断线不是失败启动的重试） (host-diagnostics.ts:413)
                          → chainStartSeq ??= record.seq（开新链）      (host-diagnostics.ts:430)
                          → store.push(record)                       (host-diagnostics.ts:431)
              → status = 'error'                                     (session-host.ts:782)
              → notifyError → 状态观察者 → onUnexpectedDisconnect    (extension.ts:2339-2343)
  → poll: getDiagnosticsText ⇒ fresh(按 seq 差集) + phase==='post-handshake' 恰 1 条 (extension.cjs:1912-1937)
      → 断言 fieldSet 含 v1 18 字段 / schemaVersion 合法            (extension.cjs:1939-1957)
      → 断言 resolvedExecutable === plan.expectedNodeBin            (extension.cjs:1958-1965)
      → 断言 source === 'vscode-setting'                            (extension.cjs:1966-1971)
  → 写入 status.node.extensionSubprocessSide{ok:true, via:'controlled-post-handshake-disconnect'} (extension.cjs:2098-2110)
Exit: 驱动 PASS → 壳 corroborate（不重复判此链，见下）→ exit 0
```

**判定：✅ 连通。** 逐条回答点名的四个问题：

| 问题 | 结论 | 证据 |
|---|---|---|
| 每一跳真的接上？ | ✅ 接上（含四个显式门） | 见上链；关键门：`injectRuntimeDeath` 的 connected 门（`session-host.ts:723`）、`onTransportDeath` 的 status 门（`:777`）、`afterHandshake` 门（`:781`）、`record()` 的 phase 采信（`host-diagnostics.ts:405`） |
| `resolvedExecutable`/`source` **值** = 启动时实际 spawn 的那个 `ResolvedNodeExecutable`？ | ✅ **同一对象**，非二次推导 | `session-host.ts:415-418` 解析并存入 `this.nodeExecutable`；**同一对象**传给 `HarnessClient`（`:429-436`）；client 侧 `launch.ts:177-184` 用它做 `command: nodeExecutable.path` 真 spawn；`recordTransportDeath` 读的就是 `this.nodeExecutable`（`:826-831`）。本次运行实测：`resolvedExecutable=/usr/local/n/versions/node/24.3.0/bin/node`，与 `layer-v-status.json.node.path` **逐字符一致**，`source='vscode-setting'`（= 该值经 `dsh.nodeBin` 设置项进入解析链；脚本已显式清除继承的 `DSH_NODE_BIN`，`run-layer-v-smoke.sh:970`，故不可能是环境变量来源）。注意勿混淆两个同名字段：记录里的 `source` 是**产品**解析链的来源（`vscode-setting`），`status.node.source` 是**壳**自己挑 Node 的来源（`candidate-directory`），二者本就不同，不构成矛盾 |
| 是否**恰 1 条**？有无**第二条通道**？ | ✅ 恰 1 条；无第二条通道 | **全部**写记录点仅 4 处：`host-diagnostics.ts:338/346`（启动失败监听，Phase 2）、`session-host.ts:459`（`start()` catch，仅握手前）、`session-host.ts:827`（本次新增，仅握手后）、`extension.ts:2385`（**有守卫**：仅当 `diagnostics.lastSeq() === seqBeforeStart` 才写，`:2349` 取快照）。`auto-start-orchestrator.ts:225-229` 的合成 `failed` 快照**只写 state/errorKind/errorMessage，不写记录**（该函数体内无 `record(` 调用）。`onStatusChange('error')→onUnexpectedDisconnect`（`extension.ts:2339-2343`）会触发一次 auto-retry（`auto-start-orchestrator.ts:174-189`），但那是**另一次启动尝试**，其（若有的）记录是 `phase:'start'|'retry'`，不落 `post-handshake`。实测 `recordsBefore:0 / recordsAfter:1 / freshRecordCount:1 / postHandshakeRecordCount:1` |
| `phase:'post-handshake'` 与 `retryOfSeq` 语义一致？ | ✅ 一致 | `phase` 由边界显式声明（`:829` → `:405,410`），`retryOfSeq:null`（`:413`）+ `chainStartSeq ??= record.seq`（`:430`）= 「断线不是失败启动的重试，且它自己开一条可被后续 retry 指向的链」。契约由单测钉死：`session-host.spec.ts:455-500`（`phase/retryOfSeq/resolvedExecutable/source/exitCode` + **恰 18 字段** + 凭据已脱敏）、`:502-518`（握手**前**死亡只记 1 条 `phase:'start'`，transport 边不得重复记） |

补充（用户点名的「`[]` 是否合法」）：R1 之后「空数组」只可能是**受控断线没产生记录**——那被判 `HARNESS_ERROR`（`extension.cjs:1922-1928` 的 poll `conclusion:'HARNESS_ERROR'`），不会被当成「没有发现问题」。✅

---

## 二、`AC-25 step4` 审批链

```
壳 prompt/plan 声明 step4 构造（extension.cjs；驱动 plan ^）
  → 模型 bash（默认权限）touch /var/tmp/<probe>          ← 必然被拒（EROFS）
  → 同回合重试：bash + sandbox_permissions:"danger-full-access" + justification（实测帧：toolFrames[1]）
  → 运行时升级为 approval/request
      → IdeSessionHost → InteractionCoordinator.handleApproval()        (interaction-coordinator.ts:308-333)
          → enqueue + syncApprovalBadges + emit + pump                  (:329-332)
  → 驱动轮询 listPendingInteractions（0→1）                              (extension.cjs:1306-1310)
      → extension.ts:1096-1099  dsh.test.listPendingInteractions → host.interactions.listPending()   ✅
      → 断言 kind==='approval' && toolName==='bash' && reason 非空        (extension.cjs:1364-1369)
  → 驱动 dsh.test.answerApproval(id,'allowed-once')                     (extension.cjs:1375)
      → extension.ts:1108-1113（**在 shouldRegisterTestHooks 门禁内**）→ interactions.resolveApproval(id,outcome)  ✅
          → resolveApproval()                                          (interaction-coordinator.ts:288-301)
              → queue.find(id && kind==='approval') ⇒ 否则 {ok:false,'unknown-id'}   (:289-293)
              → isApprovalOutcome(outcome) ⇒ 否则 {ok:false,'invalid-outcome'}       (:294)
              → finishApproval(entry,outcome)  ← **先 settle**                         (:298 → :539-547)
                  → entry.settled 幂等守卫 / state='resolved' / removeEntry / resolve(outcome)  (:540-544)
              → entry.abort.abort()            ← **后 dismiss**（注释明说：避免向运行时二次作答）(:299)
                  → 表现层竞态走 settleAbort() → entry.settled 已为 true ⇒ 直接 return（**无二次回答**）(:569-579)
      → 返回 {ok:true,id,outcome}；驱动断言 ok===true，否则 refused 分支        (extension.cjs:1388-1403)
          → reason==='invalid-outcome' ⇒ HARNESS_ERROR；其余 ⇒ LINK_FAILURE（不静默吞）(:1399-1402)
  → 运行时返回 approval → 命令**真执行** → 探针文件出现
  → 会话日志 approval/asked + approval/decided（outcome='allowed-once'）   ← 本次运行实测 2 组（主/对照）齐备
  → 壳 corroborate 从**产品持久日志**反查：asks≥2 / decisions≥2 / allowed-once≥2 / 每条工具名与 reason 非空
                                                                          (run-layer-v-smoke.sh:2057-2066)
  → 收尾：remove_sandbox_root 删两个 /var/tmp 探针                          (run-layer-v-smoke.sh:205-215)
      → assert_probes_gone（按 driver_conclusion 判）                       (main:2457)
```

**判定：✅ 连通。** 回答点名问题：

- **`resolveApproval` 接线完整，无二次回答竞态**：语义是「先 settle 再 abort」（`:295-300` 的注释即此设计），`finishApproval` 以 `entry.settled` 幂等（`:540`），`settleAbort` 同样先查 `settled`（`:570`），`removeEntry` 清 queue 与 `presentedId`（`:581-585`）。即 QuickPick 与 hook 同时到达也只有一个答案送出。
- **`dsh.test.answerApproval` 真在 `VSCODE_DSH_TEST` 门禁内**：`extension.ts:1108-1113` 位于 `shouldRegisterTestHooks(vscodeArg)`（`:1009`）打开的注册块内；命令面对照见驱动白名单 `extension.cjs:66-68`。
- **未注册时不是静默 `undefined`**：`executeCommand` 对未注册 id 会 reject → 驱动 step 包装器抛出 → 顶层 `error instanceof StageError ? error : harnessError(...)`（`extension.cjs:2114-2116`）⇒ **HARNESS_ERROR**。另外产品侧自身对 `no-host`/`invalid-id` 也返回 `{ok:false,reason}` 而非 undefined（`extension.ts:1109-1111`），驱动将其判为 refusal（link 失败或 harness 错误），不会烧掉整个超时窗口后报成「超时」（`:1382-1402` 的注释即此意图）。
- **日志证据**：本次运行 `layer-v-log-evidence.json.chosen.approvals.asked/decided` 各 2 条，`outcome` 均为 `allowed-once`，工具名 `bash`，`reason` 非空；`toolFrames` 里两条升级帧都同时含 `sandbox_permissions` 与 `justification`（壳的佐证要求 `:2069-2074`）。

---

## 三、`AC-25 step5` 原生 Diff 链

```
壳：assert_gitignore_rule_first  ← **先**验规则（run-layer-v-smoke.sh:2400 → :400-425）
  → resolve_display（:2401）→ …→ printf 'line one alpha…' > TARGET_FILE（:2417）← **后**建探针
  → （顺序约束满足：探针存在之前规则已命中；实测 `git check-ignore -v` → `.gitignore:52`）
驱动：模型 read 探针 → 模型 edit（实测 toolFrames[5]，old_string='alpha'→new_string='omega'）
  → 工具结果 presentationMeta.diffs = computeHunkDiffs(before, after)     (packages/fs/tool-fs/src/edit.ts:106-109)
      → 落 session log 的 tool/result.meta.diffs（含 oldText + newText）
  → 驱动 diskConsistency：hunkNewTextOnDisk && probeChanged 必真，否则 LINK_FAILURE  (extension.cjs:1804-1818)
  → 驱动 dsh.reviewWorkspaceDiffs（或注入的不存在 id → 必失败）            (extension.cjs:1746-1763)
      → 轮询 vscode.window.tabGroups 出现真 TabInputTextDiff，双端 suffix 匹配目标路径
        （产品用 dsh-diff 虚拟文档 `old:/…` `new:/…`，故按后缀判）           (extension.cjs:1765-1794)
  → 驱动读**持久日志**再确认同一条 meta.diffs（有界轮询，非单次读）        (extension.cjs:1827-1850)
  → 壳 corroborate 独立再查一次：chosen.nativeDiffs 中存在 oldText 与 newText 均为 string 的帧
                                                                          (run-layer-v-smoke.sh:2091-2093)
  → exit 0
```

**判定：✅ 连通。** 本次运行实测 `nativeDiffs = [{path: …/step-5-target.txt, oldText:"line one alpha…", newText:"line one omega…"}]`，且 `diffSource:'native-meta-diffs'`、`realDshHomeUntouched:true` 齐备。

回答点名问题：

- **`str_replace_editor` 是否真的永不产生 `meta.diffs`？** 是。它的 `execute` 只返回文本渲染（`packages/fs/tool-str-replace-editor/src/index.ts:471-497`），带 `diffs` 的只有 `presentCall`（`:377-420`），而 **`presentCall` 是 pending 态的调用卡片**，落进结果 `meta` 的通道叫 `presentationMeta`（`packages/core/tools/src/presentation.ts:269-280` 说明它「persisted with the session log」）。`str_replace_editor` 没有 `presentationMeta`，因此它的 diff 永远不会进 `meta.diffs`。
- **驱动会不会误选它？** 驱动**不选工具**——选的是模型。若模型选 `str_replace_editor`：时间线 hunk 仍可能生成（`diffAvailability` 可能通过），但 `meta.diffs` 永远为空 ⇒ 壳的 `withText.length < 1` 判 **LINK_FAILURE**（`:2093`，响亮失败，**不是假通过**）。本次运行模型选了 `edit`；prompt 亦明确称该文件为探针（`spec.md` step5 构造）。→ 记为 🟢#3（行为依赖模型的稳健性风险，无连接断点）。
- **`.gitignore` 顺序**：`assert_gitignore_rule_first`（`:2400`）**早于** `TARGET_FILE` 创建（`:2417`），且早于 `reset_artifact_dir` 之后的一切产物；`write_overlay`/`generate_shadow_preset` 都在其后。✅

---

## 四、route A / 影子 preset 链

```
layer-v-shadow-preset.sh --check-shadow-preset   ← 本次独立重跑（无真机依赖）：exit 0，
    determinism（run1==run2==placed sha256）、diff 恰 2 删 0 增（28,29d27）、shipped 哈希不变
  → generate_shadow_preset（run-layer-v-smoke.sh:582-645）
      → layer_v_write_shadow_preset(${SHADOW_ROOT})   ← **唯一实现**（主脚本无第二处生成）
      → 与自检两次生成逐哈希比对 + 与 shipped 比对（:615-620）→ 任一不符 fail_harness
  → write_overlay 写 ${SANDBOX_HOME}/.dsh/profiles/ide/cordis.patch.yml（:566-580）
      config 四键齐备：default / includeShippedRoot:false / includeUserRoot:false / roots  （:571-573）
      roots 顺序：① ${SHADOW_ROOT} trust:user  ② ${SHIPPED_PRESETS_ROOT} trust:system     （:575-578）
  → assert_overlay_contract 强制校验（:718-747）：四键存在 + default===AGENT_PRESET + **第一 root 必须是影子根**
  → 载体：patch 层替换整个 config 块（无需 --patch flag）→ AgentPresets.resolvedRoots
      = [] (includeShippedRoot=false) + config.roots **按序** + [] (includeUserRoot=false)   (packages/preset/agent-presets/src/index.ts:178-181)
  → discoverPresets(roots) 逐根扫描，byId Map **first-root-wins**（packages/preset/agent-presets/src/discovery.ts:327-335）
      ⇒ 影子根的 `agent-presets` id 赢 ⇒ 25 工具面（少了 orchestrator-tool-policy 一行）
  → HOME 沙箱：launch_host 用 `HOME="${SANDBOX_HOME}"`（:972），并把探针外的环境显式清空（`env -u DSH_NODE_BIN`，:970）
  → toolCount 取值：壳 extractor 从**产品会话日志** `request/header.header.tools` 提取
      → 驱动写入 step3/step5 证据 toolCount + tools（extension.cjs:2143-2149）
      → 壳 corroborate 校验 chosen.toolCount 是 number（否则 problems）(run-layer-v-smoke.sh:2050-2055)
  → 真实 ~/.dsh 隔离：REAL_HOME_BEFORE/AFTER 摘要比对，不一致即 fail_link（:2005-2033，且 before 快照在 :2406 取）
```

**判定：✅ 连通。**

- 四个 `config` 键齐备、`roots` 顺序正确，且**顺序有程序化断言**（`:734-746`），不是只写在文档里。✅
- 「唯一实现」由自检 + 主脚本哈希比对双重保证（`:615-620`）+ `--check-shadow-preset` 可独立复跑（本次重跑 exit 0）。✅
- **`HOME` 沙箱隔离**：真被断言，不是文档声称——`real_home_snapshot_json` 前后摘要比对失败即 `fail_link`（`:2025-2030`），并存进状态 JSON（`LV_REAL_HOME_*`，`:2150-2152`）。本次运行 `step5.evidence.realDshHomeUntouched === true` 且壳的 corroborate 会因此项缺失而判 LINK_FAILURE（`:2089`）。✅
- 唯一软化点：`toolCount !== 25` 只记 warning（`:2053-2055`）→ 🟢#2。

---

## 五、退出码 / 结论分类接线

```
判定点（唯一）：main case "${driver_conclusion}"                        (run-layer-v-smoke.sh:2460-2477)
  PASS                     → set_conclusion "PASS" 0 "" ""              (:2461-2464)
  LINK_FAILURE             → "LINK_FAILURE" 1 ${driver_failed} …        (:2465-2467)
  SKIPPED_NO_CREDENTIALS   → "SKIPPED_NO_CREDENTIALS" 3 …               (:2468-2470)
  SKIPPED_NO_DISPLAY       → "SKIPPED_NO_DISPLAY" 2 "display" …         (:2471-2473)
  *（含 ABORTED/UNKNOWN）  → "HARNESS_ERROR" 4 …（fail-closed，绝不默认放行）(:2474-2476)
  → exit_now ⇒ finish() ⇒ exit "${EXIT_CODE}"                            (:194-197, :2352-2373)
其他判定点（全部收敛到 set_conclusion，再走同一 exit 通道）：
  fail_harness / fail_link / fail_display（:163-179）、preflight 缺输入（:2384）、
  Node 门槛（:2389-2392）、无 status 文件 / 该文件属于别的 run（:2429-2439, :2452-2455）、
  沙箱布局失败（:551-554）、corroborate 的 problems（:2104-2106）、
  teardown 违规（:186-192，**单向升级**：PASS ⇒ HARNESS_ERROR）
trap：'exit_now' INT TERM（:224）+ 'cleanup' EXIT（:225）→ 任何退出路径都过 finish()
```

**判定：✅ 连通，无吞码路径。**

- 全脚本**无 `set +e`**（`set -uo pipefail`，:46）；唯一子 shell 是 host 启动（:966-983），其 pid 为空即 `fail_harness`（:985-987）。
- 逐结论自查映射：本 Phase 的索引里已有 `PASS 0` / `LINK_FAILURE 1` / `SKIPPED_NO_CREDENTIALS 3` / `HARNESS_ERROR 4` 的真实行（`artifact-index.md:16-46`）；`SKIPPED_NO_DISPLAY 2` 由 `fail_display`（:175-179 + `start_xvfb` :455,475,477）走同一通道。
- fail-closed 细节：驱动结论读出失败回落 `UNKNOWN`（:2445）→ 落 `*` 分支 ⇒ HARNESS_ERROR；佐证无法计算（verdict 为空）⇒ `fail_harness`（:2097-2099）；`assert_real_home_untouched` 内部解析失败回落 `"false"` ⇒ 判失败（:2024）。
- `record_teardown_violation` 写的是「记录 + 单向升级」，注释与实现一致（:181-192），不会把已失败的运行降级、也不会让 PASS 存活。

---

## 六、回收链

```
正常/异常退出两条路：
  exit_now → finish()（幂等，FINISHED 守卫 :2352-2356）
      → reclaim_run_processes（:1175-1250）
          → 记录到的 PID + pkill --user-data-dir=<UD>（:1196）
          → pkill --database=<UD>/Crashpad（:1199）+ pkill <UD>/Crashpad（:1200）
          → wait_for_run_tree_exit 20s 失败 ⇒ SIGKILL 升级（:1204-1209）
          → 追加「仍带沙箱 HOME 的进程」清扫（:1211-1215）
      → assert_process_reclamation（:1330-1435）：四项断言 + setsid/进程组**源码断言**（:1352-1358）
      → preserve_host_logs → remove_sandbox_root（含 bridge socket 所在 TMP_ROOT，:205-215）
      → assert_runtime_residue（:1442-1487）：socket 已释放 / TMP_ROOT 已删 / 无本 run 的 bridge 持有者
      → assert_artifacts_ignored_in_git_status（:1492-1510）
  cleanup（EXIT trap）→ 再跑一次 reclaim + remove_sandbox_root（:217-223，**刻意不设 already-ran 守卫**，以便升级 SIGKILL）
  trap - EXIT INT TERM 先解绑（:219）避免递归
```

**判定：✅ 连通。** 覆盖全部退出路径（含 `SKIPPED_*` 与 `HARNESS_ERROR`：它们都经 `exit_now`/`finish`）。Crashpad 按 `<UD>/Crashpad` 与 `--database=<UD>/Crashpad` 两种匹配显式回收（:1199-1200, :1092, :1349），并有 `crashpadForThisRun` 断言（:1419-1421）。bridge socket 与沙箱 `HOME` 由 `remove_sandbox_root` 收回并被断言（:1473-1481）。

---

## 七、`artifact-index.md` 写入链

```
每次运行：finish()（:2352-2373）
  → if [ -d "${ARTIFACT_DIR}" ]（:2365）
      → write_report_meta（:2122-2214）→ emit_report_files（:2216-2274）
          → 行格式：| finishedAt | artifactDir | conclusion | exitCode | step→file 映射 |
          → **插入到表格内**（placeholder 替换 / 最后一行表行之后 splice，:2254-2269），不是文档尾追加
          → 每次 writeFileSync 重写全文（读旧 + 插行），**不覆盖已有行**
          → 索引不存在时 stderr 记录，不静默吞（:2250-2251）
          → 附带 meta.index.tracked（由 git ls-files --error-unmatch 判定，:2138-2141）
  → 索引文件被 git 追踪且未被 ignore（本次核验：`git ls-files --error-unmatch` 成功；
     `git check-ignore` 对其 exit 1（未命中））
```

**判定：✅ 连通（有一处边界，见 🟢#1）。** 实证：索引中同时存在 `HARNESS_ERROR`、`LINK_FAILURE`、`SKIPPED_NO_CREDENTIALS`、`PASS` 的行（`artifact-index.md:16-46`），且失败/跳过运行**不被覆盖**（"Never overwritten" 的声明与实际机制一致）。

---

## 特别关注：偏差 D5（`injectDisconnect` 语义收紧）

| 核对项 | 结论 | 证据 |
|---|:--:|---|
| **FSM 入口是否真的未变**（仍经 `onUnexpectedDisconnect`） | ✅ 未变 | 钩子不再直接调用编排器（`extension.ts:1228-1234` 只调 `host.injectRuntimeDeath()`，注释明说「FSM is not poked directly」）；死亡边 → `session-host.ts:782` status='error' → 状态观察者 `extension.ts:2339-2343` 在 `state === 'started'` 时调 `orchestrator?.onUnexpectedDisconnect()` → `auto-start-orchestrator.ts:174-189`。即入口仍是 `onUnexpectedDisconnect`，只是**触发者从钩子换成了产品自身的状态观察**。 |
| **是否不再有第二条记录通道** | ✅ 无 | `src/` 内全部 `record(` 调用点已穷举（4 处，见链路一表格）；`auto-start-orchestrator.ts:225-229` 的合成 `failed` 快照不写记录；`extension.ts:2385` 的兜底记录带 `lastSeq()===seqBeforeStart` 守卫（`:2349`）。单测正反两向钉死：`layer-v-inject-disconnect.spec.ts`（落点）、`session-host.spec.ts:455-500`（握手后 1 条）/ `:502-518`（握手前 1 条且 transport 边不重复记）。 |
| **既有依赖该钩子的测试/契约是否被破坏** | ✅ 未破坏 | 全仓 grep `injectDisconnect`：仅 ① 注册 `extension.ts:1228`、② 文档注释 `session-host.ts:708`、③ README×2 `:231`、④ 驱动白名单 `extension.cjs:68` + 调用 `:1911`、⑤ 本 Phase 新增 spec。**没有任何既有测试**（含 `spike*`、`vscode-dsh-chat-ready` 相关用例、`run-chat-ready-regression.sh`）断言该钩子的旧行为。唯一历史契约是 `vscode-dsh-chat-ready` 归档审查里的「L2: `dsh.test.injectDisconnect` → 同 FSM 入口 ✅」——该契约在 D5 下**仍然成立**（见上表第一行）。 |
| **是收紧还是放宽** | ✅ **收紧**（更贴近真机崩溃） | 旧实现只能造「无生产者的合成 `failed` 态」，拿不到启动时解析的 `ResolvedNodeExecutable`，也**不产生**诊断记录（即 DEBT-010 本体）；新实现走真实 transport 死亡边：① 必须真的持有活连接才可能产生死亡（`session-host.ts:723` 的 connected 门，且注释称「cannot manufacture a death to record」）；② 记录字段来自真实 spawn 的那个对象（`:826-831`）；③ `exitCode/terminationSignal/stderrTail` 来自 `TransportClosedError.details`（`:825,832-836`）；④ 无活连接时钩子返回而不产生死亡 ⇒ 驱动 poll 超时判 `HARNESS_ERROR`（响亮失败）。 |

**附带核实**：`onTransportDeath` 的 status 门为 `{connected, starting}`（`:777`），`watchTransport` 用 `stopped` 标志区分「用户 Stop 拆除」与「意外死亡」（`:734,748-757`），而 `injectRuntimeDeath` **刻意**不走 `shutdownInternal`（`:710-717` 注释）——这正是它能被当作意外死亡的原因，接线自洽。

---

## 上下游连接检查

| 新函数/组件 | 上游（谁调用） | 连接 | 下游（调用谁） | 连接 |
|---|---|:--:|---|:--:|
| `IdeSessionHost.injectRuntimeDeath()` | `dsh.test.injectDisconnect`（`extension.ts:1232`） | ✅ | `client.close()`（`session-host.ts:725`）→ transport death | ✅ |
| `recordTransportDeath()` | `onTransportDeath`（`:781`，经 `afterHandshake` 门） | ✅ | `HostDiagnosticRecorder.record()`（`:827`） | ✅ |
| `HostDiagnosticRecorder.record()` | `session-host`（`:459`,`:827`）、`host-diagnostics:338/346`、`extension:2385` | ✅ | `store.push` → `records()`（`host-diagnostics.ts:431,443`） | ✅ |
| `records()` | `dsh.test.getDiagnosticsText`（`extension.ts:1122`） | ✅ | 驱动 `poll` → 断言（`extension.cjs:1913-1971`） | ✅ |
| `InteractionCoordinator.resolveApproval()` | `dsh.test.answerApproval`（`extension.ts:1112`，门禁内） | ✅ | `finishApproval` + `entry.abort.abort`（`:298-299`） | ✅ |
| `ApprovalResolution` 返回值 | 驱动 step4（`extension.cjs:1375-1403`） | ✅ | 驱动 refusal 分支 / 壳日志佐证 | ✅ |
| `write_overlay` / 影子根 | 壳（`:2408`） | ✅ | `AgentPresets.resolvedRoots` → `discoverPresets` → 25 工具面 | ✅ |
| `set_conclusion` / `exit_now` | 全脚本判定点 | ✅ | `finish()` → 进程退出码 | ✅ |
| `emit_report_files` | `finish()`（`:2366-2367`） | ✅ | `artifact-index.md`（git 追踪） | ✅ |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|---|---|---|:--:|
| `extension.ts` → `IdeSessionHost` | `injectRuntimeDeath(): Promise<void>`，仅在活连接时有副作用 | `session-host.ts:721-729`（connected 门 + 吞掉 teardown 错误） | ✅ |
| `session-host` → `HostDiagnosticRecorder` | `record(input: HostDiagnosticInput)`，`phase` 可声明 `'post-handshake'` | `host-diagnostics.ts:70`（联合含 `'post-handshake'`）、`:403-413`（采信并归零 `retryOfSeq`） | ✅ |
| `session-host` → `HarnessClient` | `ResolvedNodeExecutable` 对象直传，client 用它 spawn | `client.ts`（`HarnessClientOptions.nodeExecutable`）→ `launch.ts:177-184` `command: nodeExecutable.path` | ✅ |
| `extension.ts` → `InteractionCoordinator` | `resolveApproval(id, outcome) → ApprovalResolution` | `interaction-coordinator.ts:26-28`（判别联合）、`:288-301` | ✅ |
| 驱动 → 产品命令面 | `dsh.test.answerApproval` / `listPendingInteractions` / `getDiagnosticsText` / `injectDisconnect` 存在且可用 | `extension.ts:1096-1123, 1228-1234`（均在测试门禁块内） | ✅ |
| 驱动 ↔ 壳（退出码语义） | 五结论一一对应 0/1/2/3/4 | `run-layer-v-smoke.sh:2460-2477` | ✅ |
| 壳 → 产品（route A 环境契约） | `HOME`=沙箱、`DSH_NODE_BIN` 已清、`DSH_TEST_BRIDGE_SOCKET` 指向 tmp | `:966-983` 启动环境 + `:970` `env -u` | ✅ |
| `meta.diffs` 生产者 → 消费者 | 仅 `edit`/`write` 类工具产 `meta.diffs`（`presentationMeta`），`str_replace_editor` 不产 | `tool-fs/src/edit.ts:106-109` ↔ `tool-str-replace-editor/src/index.ts`（无 `presentationMeta`） | ✅ |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 | 接口状态 | 连接 |
|---|:--:|:--:|:--:|
| `HostDiagnosticRecorder` / `records()` / `lastSeq()` | Phase 2 | 已实现；本 Phase **扩展** `phase` 联合 + `SCHEMA_VERSION 1→2`（字段集**仍 18**，未新增记录面） | ✅ |
| `createStartFailureListener`（启动失败边界） | Phase 2 | 未改动；与新增的死线边界**互斥**（握手前/后） | ✅ |
| `AutoStartOrchestrator.onUnexpectedDisconnect()` | Phase 1 | **签名与语义未改**（`auto-start-orchestrator.ts:174-189` 未在本 Phase 改动集内），仅触发者改变 | ✅ |
| `resolveNodeExecutableSpec` / `dsh.nodeBin` 设置项 | Phase 1 | 未改动；`source:'vscode-setting'` 取值路径不变 | ✅ |
| `discoverPresets` / `AgentPresets`（first-root-wins） | 既有包 | 未改动（不在本 Phase 改动集） | ✅ |

## 关键发现

### 🔴 Must-Fix

（无）

### 🟡 Should-Fix

（无）

### 🟢 Observations

1. **`artifact-index.md` 对「沙箱建立之前」的两条 HARNESS_ERROR 路径不追加行（字面口径的边界，无假通过）**：`finish()` 的写入以 `[ -d "${ARTIFACT_DIR}" ]` 为守卫（`run-layer-v-smoke.sh:2365`），而 `ARTIFACT_DIR` 由 `prepare_sandbox` 创建（`:551`，调用点 `:2397`）；`preflight 缺输入`（`:2384`）与「无合格 Node」（`:2389-2392`）发生在其**之前**。**影响面**：AC-33(b) 的可验收场景（真实运行 / 跳过 / 失败）**全部**有行——实证索引中已有 `HARNESS_ERROR 4`、`LINK_FAILURE 1`、`SKIPPED_NO_CREDENTIALS 3`、`PASS 0` 行（`artifact-index.md:16-46`）；仅「脚本连沙箱都没建立起来」的两种自杀式退出无行（此时也没有任何产物可索引）。**判定**：不构成断点，亦无法造成假通过；若要求「字面每次运行必有行」，需在 node 解析失败/预检失败处补一个纯 shell 写入分支。
2. **`toolCount` 期望值只记不判**：壳对 `chosen.toolCount !== 25` 只 push warning（`:2053-2055`），warning 转 note（`:2107-2109`），不改变结论；驱动把 `toolCount` / `toolCountExpected` / 完整 `tools` 集都落盘（`extension.cjs:2143-2149`、`:1885-1887`）。这与 AC 行「状态 JSON 记 `toolCount`，预期 25，与工具集一并记录」的**记录**口径一致，但意味着工具面漂移（例如 24）不会让运行失败。**建议**（非本 Phase 阻塞）：若 AD-15 决策 2 的「25 工具面」是硬前提，宜升为 problem。本次运行实测 `toolCount: 25`。
3. **step5 的行为依赖模型选对工具**：`str_replace_editor` 结构性地**永不**产生 `meta.diffs`（`tool-str-replace-editor/src/index.ts:471-497` 无 `presentationMeta`；对照 `tool-fs/src/edit.ts:106-109`），故若模型选它会以 **LINK_FAILURE** 暴露（壳 `:2091-2093`），**不会**假通过——是响亮的失败模式而非连接断点。prompt 明确要求编辑已存在的探针文件；本次运行模型选 `edit`（`toolFrames[5]`）。（可选的加固方向：把"模型是否用了 `edit`/覆盖写"写进证据，便于区分「构造失败」与「连接失败」。）
4. **「恰 1 条 post-handshake 记录」是断线后的即时快照**：驱动按 `seq` 差集取 fresh 记录并过滤 `phase==='post-handshake'`（`extension.cjs:1912-1937`），随后 FSM 的 auto-retry（`auto-start-orchestrator.ts:185-188`）可能**稍后**追加一条 `phase:'retry'|'start'` 记录（属**另一次事件**，不落 `post-handshake`，故不会误计；`onStartSucceeded` 还会重置链，`host-diagnostics.ts:394-396`）。本次运行实测 `recordsAfter: 1` 且 `disconnect.state==='starting'`（retry 已在进行中）。语义与 R1「同一次断线只允许一条记录」一致。
5. **范围外：本机工作区的仓库级测试噪声会让「回归全绿」口径不成立**（点名给 verifier，**不是**本 Phase 的断点）：`pnpm run test -- apps/vscode-dsh` 实际执行了**全仓** 1111 个测试文件，得到 462 failed / 639 passed；根因是 `FiberState` 解析为 `undefined`（`packages/core/agent-loop/src/index.ts:8,40` 处的 `@deepseek-ai/cordis` 导出缺失，`scripts/test-invariants.ts:88/:188` 报 `reading 'PENDING'/'ACTIVE'`）等**模块解析/构建态**问题，与 768 个 mtime 2026-09-11 的未跟踪编译产物（用户已声明为既存噪声）一致。**本 Phase 变更集内**的 5 个 spec 文件 **99/99 通过**；`apps/vscode-dsh` 目录下 53 个测试文件中失败的 4 个（`spike-t0b-continue-capability`、`spike-t0a-replay-rebuild`、`panel-close-delete.e2e`、`verifier-phase1/layer-a-rtl`）均**不在**本 Phase 改动集，失败原因亦与改动集无关。→ AC「回归」行需按此口径判读。

---

## 实际验证动作

**读过的文件（读原文/读 function body，不只读签名）**

- 规格与上游：`phases/phase-3-layer-v-smoke-loop/spec.md`（含修订段 R1）、`scope-amendment-01.md`、`implementation.md`（含 §6 偏差台账 D5）、`repo-exploration.md`（§4 调用链）、`design.md`（AD-12/13/14/15/16）、`phase-plan.md`、`tech-debt-registry.md`
- 产品代码：`apps/vscode-dsh/src/{extension,session-host,host-diagnostics,interaction-coordinator,auto-start-orchestrator}.ts`
- SDK：`packages/sdk/client/src/{client,launch,types}.ts`；工具：`packages/fs/tool-fs/src/edit.ts`、`packages/fs/tool-str-replace-editor/src/index.ts`、`packages/core/tools/src/presentation.ts`；preset：`packages/preset/agent-presets/src/{index,discovery}.ts`
- 测试与脚本：`apps/vscode-dsh/tests/{session-host,host-diagnostics,layer-v-inject-disconnect}.spec.ts`、`apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh`（全量通读关键函数）、`test-scripts/layer-v-shadow-preset.sh`、`test-scripts/layer-v-driver/extension.cjs`
- 产物与文档：`artifact-index.md`、`test-artifacts/layer-v/layer-v-log-evidence.json`、`layer-v-status.json`、`README.md` / `README.zh.md`（命令面）

**跑过的命令与看到的结果**

| 命令 | 结果 |
|---|---|
| `vitest run` 本 Phase 5 个 spec 文件 | **exit 0，Test Files 5 passed，Tests 99 passed** |
| `bash apps/vscode-dsh/test-scripts/layer-v-shadow-preset.sh --check-shadow-preset` | **exit 0**；run1==run2==placed sha256 一致；diff 恰 `28,29d27`（2 删 0 增）；shipped 哈希前后相同 |
| `git ls-files --error-unmatch .specdev/…/artifact-index.md` | 成功（**被追踪**）；`git check-ignore` 对其 exit **1**（未命中） |
| `git check-ignore -v apps/vscode-dsh/test-artifacts/layer-v/step-5-target.txt` | 命中 `.gitignore:52:apps/vscode-dsh/test-artifacts/`（来自仓库根规则） |
| 读 `layer-v-log-evidence.json`（成功运行） | `chosen.toolFrames`：2× bash（默认权限→带 `sandbox_permissions`+`justification` 重试）× 2 探针 + read + **edit**；`approvals.asked/decided` 各 2 条且均 `allowed-once`；`nativeDiffs` 含 `oldText`/`newText`（step-5-target.txt） |
| 读 `layer-v-status.json` | R1 证据：`recordsBefore 0 / freshRecordCount 1 / postHandshakeRecordCount 1`；记录 `phase:'post-handshake'`、`retryOfSeq:null`、`resolvedExecutable=/usr/local/n/versions/node/24.3.0/bin/node`、`source:'vscode-setting'`、`fieldSet 18/18`、`schemaVersion 2`；`recordsAfter 1` |
| `git status` / `git diff --stat`（只读） | 改动集与用户给定清单一致；`test-artifacts/` 未出现在 `git status --porcelain` |
| `vitest run apps/vscode-dsh`（范围外噪声归因） | 4 failed / 49 passed（文件）；失败均在本 Phase 改动集之外，根因 `FiberState` 解析为 undefined |

**未做的事**：未修改任何产品代码 / 脚本 / 测试 / spec；未执行任何 git 写操作；未评判实现正确性、设计合规与视觉（另三视角职责）。
