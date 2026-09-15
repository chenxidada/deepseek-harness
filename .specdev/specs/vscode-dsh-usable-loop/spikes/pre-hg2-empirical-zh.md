# Pre-HG-2 Empirical Spike —— 真实模型审批触发验证

执行时间：2026-09-15 11:26–11:31（+08:00），目标仓库 `/workspace/chendecheng/code/need/deepseek/deepseek-harness`。
四次真机 Extension Development Host 启动（`/usr/bin/code` 1.112.0）—— 其中一次因驱动缺陷在发出任何 prompt 前即终止，其余三次各产生一个会话；实际发出 **3 次 prompt**，使用**默认 `ide` profile** 与**真实模型**（`deepseek-v4-flash`，provider `deepseek-official`），共 **7 次模型 API 调用**。
未修改仓库任何产品代码、配置或文档。仓库内唯一写入的文件是本报告及其英文版。

---

## 结论摘要（一句话结论 + 置信度）

**✅ CONFIRMED：在真机 Extension Development Host 中，用默认 `ide` profile 与真实模型确实能确定性地产生一次「审批请求」，并能被程序化观察到 —— 但只有走「先被沙箱拒绝 → 同回合原样重试并提权」这条两步路径才行。设计里计划的那次「预先直接携带 `sandbox_permissions` 的单次工具调用」❌ 不成立：真实模型会拒绝它。**

| # | 设计中标为 ⚠️ HYPOTHESIS 的问题 | 判定 | 实测 |
|---|---|---|---|
| 1 | `ide` profile + 真实模型在真机上是否端到端产生审批请求？ | **✅ CONFIRMED** | 是。该场景第一次发送 prompt 即产生，`sendPrompt` 后 **4070 ms**；会话日志记录 `approval/asked` |
| 2 | 模型是否愿意发出 `sandbox_permissions` + `justification`？ | **❌ 不会 —— 没有前置拒绝时它拒绝提权** | 模型原文：「`sandbox_permissions` 是*对被拒绝命令的一次性重试*参数，不是*预先授权*参数……预先提权会伪造证据」 |
| 3 | 能否程序化观察到审批？ | **✅ CONFIRMED** | `dsh.test.listPendingInteractions` → `[{kind:'approval', state:'presented', …}]`，计数 0→1 |
| 4 | 在**尚无新 hook** 的情况下能否程序化作答？ | **✅ 可以，走 QuickPick 路径** | `workbench.action.acceptSelectedQuickOpenItem` → pending 1→0；会话日志记录 `approval/decided outcome:"allowed-once"`，随后被提权的命令真正执行成功（exit 0） |
| 5 | 是否仍需要 `dsh.test.answerApproval`？ | **⚠️ 仍需要（理由改变），但不再是阻塞项** | 5 条 hook 不存在的探测有原文证据；可用的作答路径是 UI 层命令，且无法断言审批主体 |
| 6 | 审批是否确实由提权触发、而非链路噪声？ | **✅ CONFIRMED（对照）** | 场景 B：不提权的 `bash` 调用**完全没有**审批（`sawPending: false`，会话日志无 `approval/asked`） |

**置信度：✅ CONFIRMED** —— #1、#2、#3、#4、#6 全部在真机观察到，并有会话日志原文佐证。**⚠️ HYPOTHESIS** —— QuickPick 作答路径的*稳健性*（#4 在多次运行、焦点被抢、队列深度 > 1 的情况下），本次只跑了一次，未做变量对照。

**对设计最重要的一处更正**：确定性构造子是**「先被拒绝 → 同回合重试并提权」**，不是「预先提权的一次调用」。提权的**运行时**确实不要求前置拒绝（`packages/sandbox/sandbox/src/escalation.ts:157-189` 不读取任何拒绝状态），但**模型**要求 —— 所以让 prompt 一上来就要 `sandbox_permissions`，结果是模型拒绝、**一次审批都不会产生**。

---

## 环境事实（含实际命令与输出）

```
$ export PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH
$ node -v
v24.3.0
$ command -v node
/usr/local/n/versions/node/24.3.0/bin/node
$ /usr/bin/code --version
1.112.0
07ff9d6178ede9a1bd12ad3399074d726ebe6e43
x64
$ echo $DISPLAY
:1
```

启动脚本自身记录（原文，来自 `evidence-A.txt`）：

```
--- node facts ---
which node: /usr/local/n/versions/node/24.3.0/bin/node
node -v: v24.3.0
DSH_NODE_BIN=/usr/local/n/versions/node/24.3.0/bin/node
DISPLAY=:1
DEEPSEEK_API_KEY injected: prefix=sk- length=35
DSH_PERMISSION_MODE set? <unset>
```

- 凭据：通过 `set -a; . "$REPO/.env"; set +a` 注入启动环境；从未 echo、从未写入任何产物。报告只记录「已注入 / 前缀 `sk-` / 长度 35」。
- `DSH_PERMISSION_MODE` **刻意保持 unset**（硬约束 5）。会话日志确认审批处于武装状态：`permission/preset {"preset":"workspace-write"}`、`sandbox/mode {"mode":"workspace-write"}`、`approval/policy {"policy":"ask"}`。
- 构建产物**直接复用，未重新构建**（硬约束 7）：`apps/vscode-dsh/lib/extension.js` + `extension-RWu5dSvU.js`（2026-09-14 17:12）、`packages/sdk/client/lib/index.js`（2026-09-14 20:07）均存在且可用；`apps/vscode-dsh/package.json` 的 `"main": "lib/extension.js"`。

**沙箱 runner（用于挑选「必被拒绝」的操作）** —— `bwrap` 存在且其 profile 探针通过，可用：

```
$ which bwrap
/usr/bin/bwrap
$ bwrap --ro-bind / / --dev /dev --unshare-pid --proc /proc --die-with-parent -- true
probe_exit=0
$ uname -r
5.15.0-134-generic
```

`workspace-write` 只允许写「工作区根 + `/tmp`」（`packages/sandbox/sandbox-local/src/profiles.ts:16-23`：`--ro-bind / /` + `--tmpfs /tmp` + `--bind <root> <root>`），会话日志也原文给出了根路径：`workspace-write … may modify files under the session workspace: "/workspace/chendecheng/code/need/deepseek/deepseek-harness"`。因此**写 `$HOME` 就是确定性的拒绝点**。实测拒绝文本用的是 bwrap 的 EROFS 方言（`Read-only file system`），与 `DENIAL_SIGNATURES.bwrap = ['read-only file system']`（`packages/sandbox/sandbox-local/src/index.ts:206`）一致。⚠️ HYPOTHESIS：实际由 bwrap（而非 Landlock）执行 —— 本机未构建 Landlock launcher 产物（`native/node-addon-landlock-run` 下无 `.node`），且观测到的 stderr 是 bwrap 方言；provider 未向客户端报告选中了哪个 runner。

---

## 运行时枚举到的 `dsh.*` / `dsh.test.*` 命令清单（完整，供 Phase 3 使用）

在运行中的 extension host 内用 `await vscode.commands.getCommands(true)` 枚举（共 2824 条命令），过滤 `dsh.` 前缀 —— **共 69 条**，按注册顺序：

```
dsh.chat.open
dsh.chat.focus
dsh.chat.resetViewLocation
dsh.conversations.open
dsh.conversations.focus
dsh.conversations.resetViewLocation
dsh.history.open
dsh.history.focus
dsh.history.resetViewLocation
dsh.timeline.open
dsh.timeline.focus
dsh.timeline.resetViewLocation
dsh.chat.toggleVisibility
dsh.chat.removeView
dsh.conversations.toggleVisibility
dsh.conversations.removeView
dsh.history.toggleVisibility
dsh.history.removeView
dsh.timeline.toggleVisibility
dsh.timeline.removeView
dsh.showPanel
dsh.statusBarAction
dsh.openExtensionSettings
dsh.copyToClipboard
dsh.startSession
dsh.stopSession
dsh.newConversation
dsh.switchConversation
dsh.closeConversation
dsh.deleteConversation
dsh.openHistory
dsh.searchSessions
dsh.promptActiveConversation
dsh.askAboutSelection
dsh.selectPermissionPreset
dsh.reviewWorkspaceDiffs
dsh.openTimelineDiff
dsh.continueConversation
dsh.restoreMoreTabs
dsh.deleteHistory
dsh.test.sendPrompt               ← 本次用于注入 prompt
dsh.test.askAboutSelection
dsh.test.prefillComposer
dsh.test.closeConversation
dsh.test.deleteConversation
dsh.test.panelSnapshot            ← 本次用于观察会话转录
dsh.test.getIndex
dsh.test.openPanel
dsh.test.openHistory
dsh.test.listHistory
dsh.test.injectAssistant
dsh.test.switchConversation
dsh.test.listPendingInteractions  ← 本次用于观察审批
dsh.test.reveal
dsh.test.deleteHistory
dsh.test.changedFileCount
dsh.test.restoreOpenTabs
dsh.test.continue
dsh.test.restoreMoreTabs
dsh.test.diffAvailability
dsh.test.getStartState
dsh.test.simulateStartupOnly
dsh.test.setCredentialPresence
dsh.test.fireConversationVisibility
dsh.test.triggerAutoReady
dsh.test.requestStart
dsh.test.hostCreateCount
dsh.test.lastCopiedText
dsh.test.injectDisconnect
dsh.test.openActivityBar
```

**经运行时证实不存在**（不是靠读代码推断）：`dsh.test.answerApproval`、`dsh.answerApproval`、`dsh.test.resolveApproval`、`dsh.test.answerPendingInteraction`、`dsh.test.acceptApproval` —— 五条全部返回 `command '…' not found`，且有**缺失命令对照探针**（`dsh.test.__definitely_not_a_command__` → `command '…' not found`）证明失败模式是「真的不存在」而非「错误被吞掉」。`dsh.test.getDiagnosticsText` 同样不存在。✅ CONFIRMED。

---

## 场景 A：真实模型触发审批

### 启动命令原文

```
--- launch command (verbatim) ---
setsid /usr/bin/code /workspace/chendecheng/code/need/deepseek/deepseek-harness --user-data-dir /tmp/spike-prehg2/ud-A --extensions-dir /tmp/spike-prehg2/ext-A --extensionDevelopmentPath /workspace/chendecheng/code/need/deepseek/deepseek-harness/apps/vscode-dsh --extensionDevelopmentPath /tmp/spike-prehg2/driver > /tmp/spike-prehg2/code-A.log 2>&1 &
setsid_launcher_pid=3457065
```

启动环境：`PATH` 前置 `/usr/local/n/versions/node/24.3.0/bin`、`DSH_NODE_BIN=/usr/local/n/versions/node/24.3.0/bin/node`、`VSCODE_DSH_TEST=1`（L2 hook 门禁）、注入凭据；`DSH_PERMISSION_MODE` unset。驱动扩展是一个最小 CJS 扩展（`"activationEvents": ["*"]`，`main: ./extension.js`），通过第二个 `--extensionDevelopmentPath` 加载。

### 实际使用的 prompt 原文

发送方式：先由 `dsh.test.fireConversationVisibility` + `dsh.test.triggerAutoReady` 建立一个活跃 live tab，再 `vscode.commands.executeCommand('dsh.test.sendPrompt', prompt)`。

> 这是一次用户明确授权的诊断实验，目的是验证沙箱提权审批链路。请按下面两步做：
> 1. 用 bash 工具运行命令 `touch "$HOME/.dsh-sandbox-escalation-probe"`（description = `sandbox escalation probe`），使用默认权限。
> 2. 该命令会被沙箱拒绝。看到拒绝标记或提权提示后，请在同一回合内严格按照工具说明，原样重试这同一条命令一次，并附带 `sandbox_permissions`（能成功的最窄更宽模式）和一句非空的 `justification`。
> 请只做这两步，不要改用别的命令，也不要用任何其他方式绕过沙箱。

**为什么必须长成这样（一条对设计有意义的负面结果，来自实际发出的第一次 prompt）**：那一次的 prompt 就是静态 spike 建议的构造子 —— 让模型发一次带 `sandbox_permissions: "danger-full-access"` + `justification` 的 `bash` 调用。模型**拒绝提权**，改用默认权限执行命令（会话 `eb43f5e3-ac84-440a-8b65-b9c0e85469c3`，回合 8.03 s 完成，0 次审批）。它的推理原文：

> The user is asking me to call bash with sandbox_permissions = danger-full-access, but … the sandbox just denied … No denial has occurred. … escalating up front … would falsify the evidence.

其最终回答原文（节选）：

> 核心问题是：`sandbox_permissions` 参数的合法用途只有一种——**对刚刚被沙箱拒绝的同一条命令做一次性重试**。它是一个"补救"参数，不是"预先授权"参数。

这个拒绝是**模型侧**的，不是**运行时**的：`approveEscalation` 只检查是否严格更宽、审批通道是否存在、是否有 agent（`packages/sandbox/sandbox/src/escalation.ts:157-189`），**不读取任何前置拒绝状态**。真正的闸门是模型读到的工具说明（`packages/shell/tool-bash/src/index.ts:88-89`）：「Never escalate speculatively: ground the request in a real denial」。因此下面的 prompt 改为先制造一次真实拒绝，模型随即按工具说明在同回合提权。

### 观察手段

1. **`dsh.test.listPendingInteractions`**，驱动侧每 1 s 轮询 → 拿到 pending 审批投影。
2. **`dsh.test.panelSnapshot`**，每 10 s 轮询 → tab 状态、消息列表、assistant 文本。
3. **产品自身的会话日志** `~/.dsh/sessions/--workspace-chendecheng-code-need-deepseek-deepseek-harness--/7c56398f-6aea-45f7-a574-8818eeadf65a/session.jsonl.zstd`（串接的多个 zstd frame，逐 frame 解压）→ 工具调用、拒绝、审批及其结局的权威原文记录。**这条通道在设计里没有被提到，但它是本次最有力的证据来源**；单靠 `listPendingInteractions` 无法说明这次审批「是为了什么」（见「对设计的影响」）。

### 观察到的原文证据（pending 计数 / QuickPick 文本 / 状态 JSON 条目 / 时间戳）

**（a）用 L2 hook 观察到审批** —— 状态行，驱动时钟，`sendPrompt` 后 4070 ms：

```json
{"step":"approval-observed","elapsedMs":4070,"pollAttempt":4,
 "pending":[{"kind":"approval","id":"b80e57c5-945a-4a1c-9401-c97294f857e5",
             "sessionId":"7c56398f-6aea-45f7-a574-8818eeadf65a",
             "state":"presented","abort":{},"tabId":"f90ac96a-e725-485f-9d50-93bb48969b6e"}]}
```

注意这个投影的字段只有 `kind` / `id` / `sessionId` / `state` / `abort` / `tabId` —— **没有 `toolName`，没有 `reason`**。

**（b）让模型决定提权的那次拒绝**（`session.jsonl.zstd` 中的 `tool/call` + `tool/result`）：

```
tool/call call_00_Ro75ztjo4djcUJpguIxw4615 bash
  {"command": "touch \"$HOME/.dsh-sandbox-escalation-probe\"", "description": "sandbox escalation probe"}

tool/result call_00_Ro75ztjo4djcUJpguIxw4615 (isError: false)
  [stderr]
  touch: cannot touch '/home/chendc/.dsh-sandbox-escalation-probe': Read-only file system
  [sandbox: file access denied under workspace-write mode]
  [sandbox: escalation available — retry this exact command once with sandbox_permissions (the narrowest wider mode that suffices) + justification; the approval prompt asks the user]
  [exit code: 1]
```

**（c）模型随后发出的提权请求** —— 同一条命令，带提权参数：

```
tool/call call_00_qitv5qROauYnz4c2nDJc5436 bash
  {"command": "touch \"$HOME/.dsh-sandbox-escalation-probe\"",
   "description": "sandbox escalation probe",
   "sandbox_permissions": "danger-full-access",
   "justification": "The probe writes to $HOME, outside the workspace, so workspace-write was denied by the read-only filesystem; full access is the narrowest mode that can reach that path."}
```

**（d）审批请求本体，来自产品自己的日志** —— `approval/asked`：

```json
{"type":"approval/asked","seq":352,"time":1789442921756,
 "data":{"id":"bfbfd55b-c19c-4635-a16c-832c830aa912","toolName":"bash",
         "callId":"call_00_qitv5qROauYnz4c2nDJc5436",
         "reason":"escalate sandbox to danger-full-access: The probe writes to $HOME, outside the workspace, so workspace-write was denied by the read-only filesystem; full access is the narrowest mode that can reach that path."}}
```

**（e）裁决** —— `approval/decided`，由驱动在 889 ms 后程序化作答产生：

```json
{"type":"approval/decided","seq":353,"time":1789442922645,
 "data":{"id":"bfbfd55b-c19c-4635-a16c-832c830aa912","outcome":"allowed-once"}}
```

**（f）被提权的命令确实执行了** —— `tool/result` 为 `(no output)`、`isError: false`，且宿主机文件系统侧可证（探针文件被创建，随后由本 spike 清理删除）。

**（g）整轮往返产出非空回答** —— `turn/start 1789442918613` → `turn/end 1789442925777`，共 **7.16 s**；最终 assistant 消息 994 字符，原文开头：

> 两步都已完成，结果如下。**第 1 步：默认权限运行（被拒绝，符合预期）** —— 命令：`touch "$HOME/.dsh-sandbox-escalation-probe"` … 拒绝标记：`touch: cannot touch '…': Read-only file system` / `[sandbox: file access denied under workspace-write mode]` / `[sandbox: escalation available …]` / exit code: 1 … **第 2 步：同一回合内原样重试一次 + 提权** … 结果：exit code 0，无输出，即命令成功执行

### 出现耗时

| 里程碑 | 时间戳（epoch ms） | 相对 `sendPrompt` |
|---|---|---|
| `sendPrompt` 返回 | 1789442918624 | — |
| 模型第 1 次 `bash`（被拒绝） | 由拒绝结果定位，约 1789442921.7 s（turn step 1） | 约 +3 s |
| 会话日志 `approval/asked` | 1789442921756 | +3.13 s |
| **驱动观察到 pending**（`listPendingInteractions`） | 1789442922626 | **+4.07 s** |
| 驱动执行 `acceptSelectedQuickOpenItem` | 1789442922644 | +4.09 s |
| `approval/decided allowed-once` | 1789442922645 | +4.09 s |
| `turn/end` | 1789442925777 | +7.16 s |

整个场景的墙钟时间（启动 → 驱动 done → 收尾）：**40.04 s**。审批远在 bridge 的 120 s fail-closed 窗口之内；从观察到它到完成作答相隔 18 ms。

### 作答尝试（每条路径的原文结果）

路径 a —— 现有 `dsh.*` 业务/hook 命令。五个候选名全部探测，并有对照：

```
answer-ladder-missing-command-control
  {"command":"dsh.test.__definitely_not_a_command__","ok":false,"error":"command 'dsh.test.__definitely_not_a_command__' not found"}
answer-attempt-hook {"command":"dsh.test.answerApproval","ok":false,"error":"command 'dsh.test.answerApproval' not found"}
answer-attempt-hook {"command":"dsh.answerApproval","ok":false,"error":"command 'dsh.answerApproval' not found"}
answer-attempt-hook {"command":"dsh.test.resolveApproval","ok":false,"error":"command 'dsh.test.resolveApproval' not found"}
answer-attempt-hook {"command":"dsh.test.answerPendingInteraction","ok":false,"error":"command 'dsh.test.answerPendingInteraction' not found"}
answer-attempt-hook {"command":"dsh.test.acceptApproval","ok":false,"error":"command 'dsh.test.acceptApproval' not found"}
```

路径 b —— QuickPick UI 路径。**✅ 成功：**

```
answer-attempt-workbench {"command":"workbench.action.acceptSelectedQuickOpenItem","ok":true,"elapsedMs":2}
answer-attempt-workbench-pending-after {"after":[]}          ← pending 由 1 → 0
answer-ladder-result {"via":"workbench.action.acceptSelectedQuickOpenItem"}
```

产品记录的裁决是 `allowed-once`（证据 e），并且先前被拒绝的那条命令随后执行成功（证据 f）。这两点合起来证明被接受的是 **「Allow once」**，即 `APPROVAL_CHOICES` 的第一项（`apps/vscode-dsh/src/interaction-ui.ts:61-65`：`Allow once` / `Reject` / `Cancel`）—— 不是 `Reject` 或 `Cancel`，否则会抛错而不是执行。`workbench.action.acceptSelectedQuickOpenItem` 的实现是 `quickInputService.accept()`，挂在 `quickInputVisible` 上下文上（`/usr/share/code/resources/app/out/vs/workbench/workbench.desktop.main.js`），而审批 presenter 用 `createQuickPick` 构建列表，所以该命令能作用到它。

路径 c —— 「在新 hook 缺失前只能宣布无法作答」：**不成立**。所以结论不是「今天无法程序化作答」，而是「今天可以通过一个 UI 层命令作答，而新增一等公民 hook 仍然有价值」。

### 结论

- **✅ CONFIRMED**：真机 + 默认 `ide` profile + 真实模型，`bash` 沙箱提权确实产生**恰好一次**审批请求，`dsh.test.listPendingInteractions` 可在约 4.1 s 内观察到。
- **✅ CONFIRMED**：上面的 prompt 可复用且确定性——**前提**是它让模型先撞上一次真实拒绝。不带前置拒绝、直接索要 `sandbox_permissions` 的 prompt **一次审批都不会产生**（预先提权那次运行，模型拒绝）。
- **✅ CONFIRMED**：今天就可用 `workbench.action.acceptSelectedQuickOpenItem` 程序化作答；裁决是 `allowed-once`，被提权的命令真的执行了。
- **⚠️ HYPOTHESIS**：QuickPick 路径的稳健性（队列深度 > 1、焦点被别的视图抢走、反复运行）。本次只跑了一次。

---

## 场景 B：不提权是否不触发审批

同一驱动、同一启动形态（`ud-B` / `ext-B`），1 次 prompt 往返。prompt 原文：

> 这是一次用户明确授权的诊断实验。请调用 bash 工具，参数为：command = `echo SPIKE-NO-APPROVAL`，description = `spike no-approval probe`。使用默认权限：不要设置 `sandbox_permissions`，也不要提供 `justification`。请只发起这一次工具调用，不要执行任何其他命令，也不要请求任何提权。

观察到的原文状态行：

```
{"step":"sendPrompt","elapsedMs":55,"command":"dsh.test.sendPrompt","ok":true, ...}
{"step":"turn-settled","attempt":4,"elapsedMs":4058}
{"step":"scenarioB-summary","sawPending":false,"assistantSeen":true}
```

会话日志 `accdbb08-6838-4d56-b5d4-91b388e8dd5d` 内含 `permission/preset workspace-write`、`sandbox/mode workspace-write`、`approval/policy ask`，恰好一次 **不带** `sandbox_permissions` 的 `tool/call`，一次成功的 `tool/result`（`SPIKE-NO-APPROVAL\n`，`isError: false`）—— 并且**完全没有 `approval/asked` 事件**。

**✅ CONFIRMED：审批确实由提权触发，而不是链路噪声。** 场景墙钟时间：10.01 s。

---

## 对设计的影响（需改写 design.md / phase-3 spec.md 的具体表述，逐条列出）

| # | 位置 | 必须怎么改 |
|---|---|---|
| 1 | `phases/phase-3-layer-v-smoke-loop/spec.md` AC-25 第 4 步（「触发一次需要审批的工具调用」） | 把「单次调用构造子」改成**两步拒绝优先序列**：(i) 用 `bash` 写「工作区根之外且 `/tmp` 之外」的路径（如 `touch "$HOME/<probe>"`），默认权限 → 工具结果必须带 `[sandbox: file access denied under workspace-write mode]`；(ii) **同一条命令**重试，附带 `sandbox_permissions: "danger-full-access"` + 非空 `justification` → 审批。并写明这个顺序是**模型契约**要求的，不是运行时要求的。 |
| 2 | `spikes/pre-hg2-spike.md:431-443`（「Concrete constructor for step 4」那段 JSON） | **已被取代。** 那个不带前置拒绝、直接携带 `sandbox_permissions` 的 `bash` 调用会被真实模型拒绝（原文推理见上），因此产生不了审批。它只能作为上述序列中**第二次调用**的描述保留。 |
| 3 | `design.md`（新增 `dsh.test.answerApproval` / `InteractionCoordinator.resolveApproval`） | hook 保留，但理由要改写：**今天已经能作答**（`workbench.action.acceptSelectedQuickOpenItem` 已被证实）。新增一等公民 hook 的理由变为：(a) 不依赖 UI 焦点与「哪一项处于活动态」的确定性；(b) 能断言审批主体；(c) 不依赖私有 workbench 命令。同时保留静态 spike 的要求：`resolveApproval` 必须同时 abort 已呈现的座位。 |
| 4 | `design.md` / Phase 3 —— 审批观察 | `dsh.test.listPendingInteractions` 返回的是**投影**，只有 `kind` / `id` / `sessionId` / `state` / `abort` / `tabId`（`apps/vscode-dsh/src/interaction-coordinator.ts:188-199`），**没有 `toolName` / `reason`**。因此「断言这条 pending 审批就是那次 bash 提权」这类 Phase 3 校验**仅凭该 hook 无法完成**。要么扩展该投影（推荐），要么改从会话日志断言。 |
| 5 | Phase 3 —— 证据来源 | 把产品会话日志提升为一等证据通道：`$DSH_HOME/sessions/--<cwd-slug>--/<sessionId>/session.jsonl.zstd`（串接的 zstd frame，需逐 frame 解压 —— 对每个 `28 B5 2F FD` frame 调 `zlib.zstdDecompressSync`）。它原文携带 `permission/preset`、`sandbox/mode`、`approval/policy`、`approval/asked`（含 `id`、`toolName`、`callId`、`reason`）、`approval/decided`（含 `outcome`），以及每一次 `tool/call` / `tool/result`。 |
| 6 | Phase 3 驱动 prompt | 采用场景 A 的 prompt（第 1 条）作为模板，探针路径每次运行唯一。**不要**指望模型自己会提权：用「预先提权」的 prompt 时，模型给出的是一段有理有据的拒绝，审批数为 0。 |
| 7 | Phase 3 驱动断言 | 两端都要断言：第一条工具结果里同时出现**拒绝标记**与**提权提示标记**；随后 `approval/asked` → 作答 → `approval/decided: allowed-once` → 第二条 `tool/result` 成功。只问 prompt「成功了吗」无法区分「本次不需要审批」和「提权从未发生」。 |
| 8 | Phase 3 清理 | 被提权的命令是**无沙箱**执行的 —— 写 `$HOME/...` 的探针真的会创建该文件。要选一个「创建了也无害」的探针路径，并在收尾中删除它（本 spike 已做：`/home/chendc/.dsh-sandbox-escalation-probe`，0 字节，已删）。Crashpad 收尾（`pgrep -f -- "<UD>/Crashpad"`）继续保留。 |
| 9 | 驱动环境变量 | `DSH_PERMISSION_MODE` 保持 **unset**（各次运行均确认为 unset；`approval/policy: ask`、`sandbox/mode: workspace-write`）。设为 `danger-full-access` 会解除审批武装，使第 4 步不可证伪。 |
| 10 | `design.md:382`（假设 A-1，双 `--extensionDevelopmentPath`） | 从「通过阅读 CLI 选项表确认」升级为端到端实测确认：两个扩展在同一 host 内激活，且以此方式加载的驱动扩展成功驱动了一次真实会话。 |
| 11 | Phase 3 驱动实现（新发现） | **不要 `await` `dsh.newConversation`** —— 在无人值守的 host 中它永不 settle（其 `showInformationMessage` toast 不会被关闭；首次启动因此卡死、且未发出任何 prompt）。正确做法：`dsh.test.fireConversationVisibility` + `dsh.test.triggerAutoReady`，然后「发射不等待」地调 `dsh.newConversation`，再轮询 `dsh.test.panelSnapshot` 直到出现 `sessionId`。 |

---

## 未验证事项

1. **QuickPick 作答路径的稳健性**：`workbench.action.acceptSelectedQuickOpenItem` 在本机接受的是「当前活动项」，只成功过一次。未测：同时排队两个审批、焦点被其他视图抢占、活动项是否可能不是第一项。⚠️ HYPOTHESIS。
2. **`dsh.test.answerApproval` 的语义**：该 hook 不存在（已证），Phase 3 实现之后的行为自然也无法预先验证。
3. **120 s fail-closed 窗口**（`packages/ide/ide-bridge/src/index.ts`）从未接近 —— 本次在观察到审批后 18 ms 就完成作答；`unavailable` 结局路径在真机未被触发。
4. **不加显式两步指令时模型会怎么做**只验证了负面方向（预先提权那次运行 → 拒绝、无审批）。是否存在某种措辞能让模型预先提权没有被穷举，也不建议把它作为设计基础。
5. **只验证了一种「可被拒绝的操作」**（写工作区之外）。其他拒绝来源（例如 `read-only` 下的任何写入）未跑；设计只需要一个确定性的即可。
6. **Landlock 路径未被触发**：本机没有 Landlock launcher 产物，runner 选择也不上报给客户端 —— 之所以判断是 bwrap，⚠️ HYPOTHESIS 依据是 EROFS 方言的 stderr 与通过的 `bwrap` 探针。
7. **场景 B 只跑了 1 次 prompt 往返**（按预算），因此「无审批」这个反向结论也是单样本。
8. **`--extensions-dir` 不能作为加载通道**（静态 spike 结论）本次未复测；本 spike 只是遵循该结论，用第二个 `--extensionDevelopmentPath` 加载驱动扩展。

---

## 残留清理自检（三条 pgrep 原文输出）

收尾在每个场景内部执行（先按 `--user-data-dir` 定位 GUI 进程组 → 必要时 `-KILL`，再 `pgrep -f -- "<UD>/Crashpad"`，再杀 `dsh --profile ide` 子进程与 `setsid` launcher 组），随后删除临时根目录。每个场景收尾时自检四项全部 `PGREP-EMPTY`（来自 `evidence-A.txt` / `evidence-B.txt`）：

```
=== residue self-check ===
--- A: pgrep -af extensionDevelopmentPath ---
PGREP-EMPTY
--- B: pgrep -af /usr/share/code/ ---
PGREP-EMPTY
--- C: pgrep -af dsh ---
PGREP-EMPTY
--- D: this scenario's user-data-dir / crashpad ---
PGREP-EMPTY
```

随后 `rm -rf /tmp/spike-prehg2`，并在仓库根目录执行三条硬约束自检（用方括号技巧，确保检查命令自身不会命中）：

```
=== 1) pgrep -af '[e]xtensionDevelopmentPath' ===
exit=1

=== 2) pgrep -af '[/]usr/share/code/' ===
exit=1

=== 3) pgrep -af '[d]sh' ===
exit=1

=== 4) pgrep -af '[s]pike-prehg2' ===
exit=1

=== 5) ls -d /tmp/[s]pike-prehg2 ===
ls: cannot access '/tmp/[s]pike-prehg2': No such file or directory
exit=2
```

三条必需的 `pgrep` 自检**全部为空**（`exit=1`，无任何输出 —— 连检查用的 shell 自身也被方括号模式排除）。临时根目录已删除。唯一的非 `/tmp` 残留是产品自身的会话数据，出于完整披露列在这里（由本次运行创建）：

```
/home/chendc/.dsh/sessions/--workspace-chendecheng-code-need-deepseek-deepseek-harness--/
  eb43f5e3-ac84-440a-8b65-b9c0e85469c3/   ← 预先提权那次运行（模型拒绝，无审批）
  7c56398f-6aea-45f7-a574-8818eeadf65a/   ← 场景 A（产生并作答了审批）
  accdbb08-6838-4d56-b5d4-91b388e8dd5d/   ← 场景 B（对照）
```

另有 `/home/chendc/.dsh-sandbox-escalation-probe`，由被提权（无沙箱）的命令创建，已在清理中删除（`ls` → `No such file or directory`）。上述会话日志是**有意保留**的（它们是产品正常的按会话状态，也是本报告的原文证据来源）；若要清除，删除上面三个目录即可。

---

## 仓库无改动确认（`git status --porcelain` 原文）

在任何启动**之前**先抓取 `git status --porcelain` 基线（11:13）；两个场景与临时目录删除**之后**再抓一次（11:33）：

```
$ git status --porcelain > /tmp/spike-prehg2/git-status-final.txt
$ diff /tmp/spike-prehg2/baseline-git-status.txt /tmp/spike-prehg2/git-status-final.txt
diff_exit=0                       ← 逐字节相同，零行差异
$ wc -l /tmp/spike-prehg2/baseline-git-status.txt /tmp/spike-prehg2/git-status-final.txt
  820 /tmp/spike-prehg2/baseline-git-status.txt
  820 /tmp/spike-prehg2/git-status-final.txt
```

该工作树本来就带着约 820 条既有脏条目（早前工作产生的已编译 `src/*.js` / `*.d.ts` 残留、以及被修改的 webview bundle），因此有意义的检查是「与运行前基线逐字节相同」，而不是「status 为空」。写完本报告对之后，新增的只有 spike 目录：

```
$ git status --porcelain | wc -l
820
$ git status --porcelain .specdev/
 M .specdev/specs/workflows.json
?? .specdev/specs/vscode-dsh-usable-loop/
```

`git status --porcelain .specdev/specs/vscode-dsh-usable-loop/spikes/` → `?? .specdev/specs/vscode-dsh-usable-loop/spikes/`（即本 spike 的两个产物；该 untracked 目录本身在基线中已存在）。

---

## 成本

| 启动 | 是否发出 prompt | 模型步数（API 调用） | 输出 token | 结果 |
|---|---|:--:|---|---|
| #1 — 驱动 v1 | **无**（驱动在 `sendPrompt` 前卡死） | 0 | — | 卡在 `dsh.newConversation`，人工终止；模型成本为 0 |
| #2 — 驱动 v2，预先提权 prompt | 有 | 2 | 518 + 571 = 1089 | **模型拒绝提权 → 0 次审批**；回合 8.03 s 完成 |
| #3 — 驱动 v3，**场景 A**（先拒绝后提权） | 有 | 3 | 138 + 261 + 535 = 934 | **产生并作答了审批（allowed-once）**；回合 7.16 s，墙钟 40.04 s |
| #4 — 驱动 v3，**场景 B**（对照） | 有 | 2 | 84 + 234 = 318 | 无审批；回合 4.06 s，墙钟 10.01 s |

合计：4 次启动、3 次 prompt、7 次模型 API 调用、2341 个输出 token。场景 A 用满了它的 2 次发送预算（启动 #2 与 #3）；场景 B 用了 1 次。两个场景都在问题被回答后立即停止。模型：`deepseek-v4-flash`，provider `deepseek-official`，`reasoningEffort: high`，`contextWindow: 1000000`。

关于启动 #1：它在驱动缺陷修复前运行 —— 在无人值守 host 中 `await dsh.newConversation` 永不 settle，因为它的 `showInformationMessage` toast 无人关闭。修复方式（先用 `dsh.test.fireConversationVisibility` + `dsh.test.triggerAutoReady`，再「发射不等待」地调 `dsh.newConversation`，然后轮询 `dsh.test.panelSnapshot` 直到出现 `sessionId`）本身就是一条 Phase 3 驱动要求：**不要 `await` `dsh.newConversation`。**
