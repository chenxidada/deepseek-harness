# Pre-HG-2 Spike 报告

本报告记录 2026-09-15 在 `/workspace/chendecheng/code/need/deepseek/deepseek-harness` 上执行的两个**只读性质可行性 spike**。
未修改任何产品代码、配置或文档。唯一写入的文件是本报告及其英文版。
未执行任何真实模型 API 调用（未设置 `DEEPSEEK_API_KEY`，未跑 `pnpm dsh`，无 prompt 往返）。两个 spike 均不需要执行任何 Node 命令。

实际使用环境：`/usr/bin/code`（VS Code 1.112.0——该版本号也逐字出现在 Crashpad handler 的注解 `--annotation=_version=1.112.0` 中）；`DISPLAY=:1` 上 X.Org 存活（`xdpyinfo` → `name of display: :1`，`version number: 11.0`）。

---

## 结论摘要

| # | Spike | 结论 | 置信度 |
|---|-------|------|:--:|
| 1 | `code` 能否用两个 `--extensionDevelopmentPath` 同时加载两个扩展？ | **✅ 可以。** 两个扩展在同一个 extension host 进程内、启动后约 **3.02s** 激活，GUI 进程 argv 中 `--extensionDevelopmentPath` 恰好 2 个 token。对照实验（只传一个）只激活一个。`--extensions-dir` fallback **❌ 不可用**：放进该目录的扩展（无论 symlink 还是真实拷贝、冷目录还是热目录）会被写入 `extensions.json` 登记，但在存在 dev path 时**永不激活**。 | ✅ CONFIRMED（真机，5 次启动 + 1 次两轮预热启动） |
| 2 | 默认 `ide` profile 下是否存在可确定性构造的审批触发操作？ | **✅ 存在，但不是设计假设的那个操作。** `ide` profile 下唯一可达的审批来源是 sandbox 提权；而 SDK 默认 preset `specdev-orchestrator` 把工具收窄为 `read` / `read_image` / `grep` / `glob` / `bash`，并对 `write` / `edit` / `str_replace_editor` 加 guard 阻断。因此确定性构造方法是 **`bash` + `sandbox_permissions: "danger-full-access"` + `justification`**——不是「让模型写文件」。 | 代码/配置路径 ✅ CONFIRMED；真机端到端 ⚠️ HYPOTHESIS（未执行——不允许真实模型调用） |

---

## Spike 1: 双 `--extensionDevelopmentPath`

### 假设

**A-1（见 `design.md:382` 记载）**：`code --extensionDevelopmentPath A --extensionDevelopmentPath B` 能同时加载两个扩展。此前仅通过读取 `/usr/share/code/resources/app/out/cli.js` 的 CLI 选项表（`extensionDevelopmentPath:{type:"string[]"}`）确认，**没有真实进程行为验证**。

### 实验设计

构造两个最小 CJS 扩展 `ext-a`（id `spike.spike-ext-a`）与 `ext-b`（id `spike.spike-ext-b`），各自 `activate()` 时向共享 marker 文件 `/tmp/spike-extdev-final/activated.log` 追加一行自证据标记：

```js
// /tmp/spike-extdev-final/ext-a/extension.js  （ext-b 除标记名外完全相同）
const fs = require('fs');
const MARKER = '/tmp/spike-extdev-final/activated.log';
function instanceId() {                                   // 从 /proc/self/cmdline 取 --user-data-dir
  const cmdline = fs.readFileSync('/proc/self/cmdline', 'utf8').split('\0');
  const hit = cmdline.find((a) => a.startsWith('--user-data-dir='));
  return hit ? hit.slice('--user-data-dir='.length) : 'unknown';
}
function activate() {
  fs.appendFileSync(MARKER,
    'MARKER-A id=spike.spike-ext-a pid=' + process.pid +
    ' userDataDir=' + instanceId() + ' ts=' + Date.now() + '\n');
}
module.exports = { activate };
```

每行 marker 都带 extension host 的 `pid`、实例的 `--user-data-dir` 与时间戳，因此一行标记不可能被归因到错误实例或无关写入者。

**激活策略与理由**：`package.json` 使用 `"activationEvents": ["*"]`（1.112.0 仍支持该 legacy always-on 事件），且**不声明**任何 `contributes.commands`。理由：本假设问的是「两个扩展是否都被**加载**」，`"*"` 提供无条件的 eager 激活，不依赖命令被调用、语言被打开或任何 UI 状态。这样 marker 是对「加载」的直接观测，而不是二阶副作用。证据表明该策略生效：extension host 日志记录 `spike.spike-ext-a` 为 `startup: true, activationEvent: '*'`（见下方 exthost 摘录）。

**启动拓扑（实验发现，也是收尾必须特殊处理的原因）**：`/usr/bin/code` 是 shell wrapper，会 re-exec `ELECTRON_RUN_AS_NODE=1 /usr/share/code/code <cli.js> <args>`；随后 `cli.js` 在一个**新进程组**中 spawn 真正的 GUI（`sh -c "/usr/share/code/code <args>"`），CLI 进程随即退出。因此 `setsid` launcher pid、CLI pid、GUI pid/pgid 三者互不相同，收尾必须针对 GUI 进程组。

### 实际执行的命令（原文）

```bash
chmod +x /tmp/spike-extdev-final/run.sh
/tmp/spike-extdev-final/run.sh dual 90 flags /tmp/spike-extdev-final/ext-a /tmp/spike-extdev-final/ext-b
```

其执行内容（逐字来自 evidence 文件）：

```
### CASE=dual mode=flags timeout=90s
extensions-dir listing:
total 8
drwxrwxr-x 2 chendc chendc 4096 9月  15 10:55 .
drwxrwxr-x 6 chendc chendc 4096 9月  15 10:55 ..

--- pre-flight: our processes alive BEFORE launch (must be PREFLIGHT-CLEAN) ---
PREFLIGHT-CLEAN
launch command (verbatim):
  setsid /usr/bin/code /tmp/spike-extdev-final/ws --user-data-dir /tmp/spike-extdev-final/ud-dual --extensions-dir /tmp/spike-extdev-final/ext-dual --extensionDevelopmentPath /tmp/spike-extdev-final/ext-a --extensionDevelopmentPath /tmp/spike-extdev-final/ext-b > /dev/null 2>&1 &

t_launch=1789440941.915391954 setsid_launcher_pid=3340834
t_poll_end=1789440944.958017215
MARKER-A first seen at: 1789440944.939127069
MARKER-B first seen at: 1789440944.956256833
  latency A = 3.023735115s
  latency B = 3.040864879s
```

注意：**该次启动除 `--user-data-dir`、`--extensions-dir` 与两个 `--extensionDevelopmentPath` 外没有任何其他 flag**。`--no-sandbox`、`--disable-gpu`、`--skip-welcome`、`--skip-release-notes` 在此 case 中被刻意省略。

### 实际观察到的输出（原文）

GUI 进程的精确 argv，逐 token 读取 `/proc/3340869/cmdline`（NUL 分隔）——不是从 `ps` 读取，因此不存在别名或截断问题：

```
--- process snapshot: main GUI process of THIS instance ---
[pid, ppid, pgid, args] →
3340869    3022 3340869 /usr/share/code/code /tmp/spike-extdev-final/ws --user-data-dir /tmp/spike-extdev-final/ud-dual --extensions-dir /tmp/spike-extdev-final/ext-dual --extensionDevelopmentPath /tmp/spike-extdev-final/ext-a --extensionDevelopmentPath /tmp/spike-extdev-final/ext-b

--- exact argv tokens of GUI pid 3340869, one per line (/proc/3340869/cmdline) ---
     1	/usr/share/code/code
     2	/tmp/spike-extdev-final/ws
     3	--user-data-dir
     4	/tmp/spike-extdev-final/ud-dual
     5	--extensions-dir
     6	/tmp/spike-extdev-final/ext-dual
     7	--extensionDevelopmentPath
     8	/tmp/spike-extdev-final/ext-a
     9	--extensionDevelopmentPath
    10	/tmp/spike-extdev-final/ext-b

--- exact count of '--extensionDevelopmentPath' argv tokens in GUI pid 3340869 ---
2
--- value following each '--extensionDevelopmentPath' token ---
  -> /tmp/spike-extdev-final/ext-a
  -> /tmp/spike-extdev-final/ext-b

--- marker file (raw, verbatim) ---
MARKER-A id=spike.spike-ext-a pid=3341116 userDataDir=/tmp/spike-extdev-final/ud-dual ts=1789440944632
MARKER-B id=spike.spike-ext-b pid=3341116 userDataDir=/tmp/spike-extdev-final/ud-dual ts=1789440944633

--- marker lines attributable to THIS instance (userDataDir=/tmp/spike-extdev-final/ud-dual) ---
2
--- err file (raw) ---
```

两个 marker 的 `pid` 同为 `3341116`（同一个 extension host）、`userDataDir` 相同，时间戳相差 1ms（`ts=…632` vs `…633`）。该实例另有 2 个 extension host 进程（3341064、3341066），执行激活的是 3341116。

### 对照实验

```bash
/tmp/spike-extdev-final/run.sh ctrl-a 90 flags /tmp/spike-extdev-final/ext-a
```

```
### CASE=ctrl-a mode=flags timeout=90s
--- pre-flight: our processes alive BEFORE launch (must be PREFLIGHT-CLEAN) ---
3340892 /usr/share/code/chrome_crashpad_handler --monitor-self-annotation=ptype=crashpad-handler ... --database=/tmp/spike-extdev-final/ud-dual/Crashpad ...
launch command (verbatim):
  setsid /usr/bin/code /tmp/spike-extdev-final/ws --user-data-dir /tmp/spike-extdev-final/ud-ctrl-a --extensions-dir /tmp/spike-extdev-final/ext-ctrl-a --extensionDevelopmentPath /tmp/spike-extdev-final/ext-a > /dev/null 2>&1 &

t_launch=1789440974.888588991 setsid_launcher_pid=3342948
t_poll_end=1789441064.601426971
MARKER-A first seen at: 1789440977.910702457
MARKER-B first seen at: NEVER
  latency A = 3.022113466s

--- exact count of '--extensionDevelopmentPath' argv tokens in GUI pid 3342972 ---
1
--- value following each '--extensionDevelopmentPath' token ---
  -> /tmp/spike-extdev-final/ext-a

--- marker file (raw, verbatim) ---
MARKER-A id=spike.spike-ext-a pid=3343164 userDataDir=/tmp/spike-extdev-final/ud-ctrl-a ts=1789440977483

--- marker lines attributable to THIS instance (userDataDir=/tmp/spike-extdev-final/ud-ctrl-a) ---
1
```

**对照实验是决定性的**：只传一个 dev path 时 MARKER-B 从未出现（轮询跑满 90s 到 `t_poll_end=…1064.6`，即 `B_at=NEVER` 是真实超时而非提前退出）。因此 marker 文件没有被其他机制写入，dual case 中的 MARKER-B 确实由第二个 flag 造成。

注意 pre-flight 那一行：`dual` case 的收尾遗留了一个 `chrome_crashpad_handler`（`--database=/tmp/spike-extdev-final/ud-dual/Crashpad`）未被杀死。它不被 `--user-data-dir` 匹配，因此逃过了最初的收尾逻辑。此处如实记录，也是后续扩展收尾逻辑的原因（见下文「残留清理」）。

### 结论

- **✅ 双 `--extensionDevelopmentPath` 会同时加载两个扩展。** 两个 flag、两个不同扩展、两个 `activate()` 都被调用，且在同一 extension host 内。
- **最小可用 flag 集**（由 `dual` case 证明，该 case 未传任何其他 flag）：

```
setsid /usr/bin/code <workspace> \
  --user-data-dir <tmp>/ud \
  --extensions-dir <tmp>/ext \
  --extensionDevelopmentPath <extensionA> \
  --extensionDevelopmentPath <extensionB> \
  > <tmp>/code.log 2>&1 &
```

- 本机（`DISPLAY=:1`，VS Code 1.112.0）下 `--no-sandbox`、`--disable-gpu`、`--skip-welcome`、`--skip-release-notes` **均非必需**。但仍建议保留 `--user-data-dir` 与 `--extensions-dir`：它们提供隔离，且是进程识别与收尾能够确定化的前提。`--extensions-dir` **不**作为加载通道（见 fallback）。
- **耗时：首次激活约启动后 3.02s**，5 次启动实测：3.0237（dual）、3.0221（ctrl-a）、3.0209（symlink）、3.0243（copydir）、3.0230 / 3.0200（warm 第 1 / 第 2 轮）。dual case 中两个扩展激活相差约 17ms。单 case 总墙钟时间（启动 → 两个 marker → 收尾）为 5.6s。

### fallback 实测结果

**结果：❌ 当存在 `--extensionDevelopmentPath` 时，`--extensions-dir` 通道不会激活扩展。** 共测三种配置，每种启动一次（warm case 启动两次）：

| Case | ext-b 的提供方式 | `--extensionDevelopmentPath` 参数 | MARKER-B | 启动后 `extensions.json` |
|------|------------------|-----------------------------------|:--:|--------------------------|
| `symlink` | `ln -s ext-b <extdir>/spike.spike-ext-b-1.0.0` | 仅 ext-a | **NEVER**（45s） | `[{"identifier":{"id":"spike.spike-ext-b"},"version":"1.0.0","location":{...,"path":".../ext-symlink/spike.spike-ext-b-1.0.0",...},"relativeLocation":"spike.spike-ext-b-1.0.0"}]` |
| `copydir` | 真实目录拷贝到 `<extdir>/spike.spike-ext-b-1.0.0` | 仅 ext-a | **NEVER**（45s） | `[{"identifier":{"id":"spike.spike-ext-b"},...,"relativeLocation":"spike.spike-ext-b-1.0.0"}]` |
| `warm` 第 1 轮 | 真实目录拷贝，extensions-dir 全新建 | 仅 ext-a | **NEVER**（30s） | 本次启动写入 |
| `warm` 第 2 轮 | 同目录，启动前 `extensions.json` **已存在** | 仅 ext-a | **NEVER**（45s） | 未变化 |

两条独立证据表明该扩展**被发现了但没有被激活**：

1. extensions 目录中写出了 `extensions.json`，且其中**确实**以正确路径列出了 `spike.spike-ext-b`——VS Code 的扫描器看到了它。
2. extension host 的激活清单中**没有**它。逐字摘自 `ud-copydir/logs/20260915T105959/window1/exthost/exthost.log`：

```
2026-09-15 10:59:50.687 [info] ExtensionService#_doActivateExtension vscode.git-base, startup: true, activationEvent: '*'
2026-09-15 10:59:50.690 [info] ExtensionService#_doActivateExtension spike.spike-ext-a, startup: true, activationEvent: '*'
2026-09-15 10:59:50.693 [info] ExtensionService#_doActivateExtension vscode.github, startup: true, activationEvent: '*'
2026-09-15 10:59:50.759 [info] Eager extensions activated
```

出现的只有内置扩展（`vscode.git-base`、`vscode.github`、`vscode.emmet`、`vscode.github-authentication`、`vscode.debug-auto-launch`、`vscode.merge-conflict`）加 `spike.spike-ext-a`。`renderer.log` 也明确只加载了一个 development extension：

```
2026-09-15 10:59:50.186 [info] Started initializing default profile extensions in extensions installation folder. file:///tmp/spike-extdev-final/ext-copydir
2026-09-15 10:59:50.303 [info] Completed initializing default profile extensions in extensions installation folder. file:///tmp/spike-extdev-final/ext-copydir
2026-09-15 10:59:50.314 [info] Loading development extension at /tmp/spike-extdev-final/ext-a
```

**解释（⚠️ HYPOTHESIS，明确标注为推断）**：现代基于 profile 的扩展模型会把 `--extensions-dir` 中的扩展与某个 profile 关联，而在 Extension Development Host 启动模式下只有 dev-path 扩展加内置扩展会被激活。观察结果与「extensions-dir 贡献被登记、但未与本次启动窗口的 profile 关联」一致。本 spike 确立的是**行为**（✅ CONFIRMED）；其内部**机制**是从日志反推（⚠️ HYPOTHESIS），未继续深挖，因为设计不依赖该机制。

**对设计的推论：驱动扩展必须用两个 `--extensionDevelopmentPath` flag 同时加载两个扩展。`--extensions-dir` 没有可用的 fallback。**

### 残留清理自检

每个 case 结束都会做四项残留检查。逐字摘自 `evidence-symlink.txt`（其余后续 case 相同）：

```
--- residual check A: pgrep -af 'extensionDevelopmentPath' ---
PGREP-EMPTY
--- residual check B: any process whose cmdline mentions this case's user-data-dir (/tmp/spike-extdev-final/ud-symlink) ---
PGREP-EMPTY
--- residual check C: any process whose cmdline mentions the spike root (/tmp/spike-extdev-final) ---
PGREP-EMPTY
--- residual check D: pgrep -af '/usr/share/code/' ---
PGREP-EMPTY
### END CASE=symlink
```

两轮 warm 运行结束时：

```
=== FINAL residual check ===
PGREP-EMPTY (extensionDevelopmentPath)
PGREP-EMPTY (/tmp/spike-extdev-final)
```

**收尾逻辑在 spike 过程中被修正过。** 最初的收尾只杀 GUI 进程组以及被 `--user-data-dir <UD>` 匹配的进程，遗漏了 Electron 的 Crashpad handler——它的 argv 携带的是 `--database=<UD>/Crashpad` 而非 `--user-data-dir`。观察到并手动清除了两个此类进程：

```
3340892 /usr/share/code/chrome_crashpad_handler ... --database=/tmp/spike-extdev-final/ud-dual/Crashpad ...      （由 ctrl-a 的 pre-flight 发现）
3342995 /usr/share/code/chrome_crashpad_handler ... --database=/tmp/spike-extdev-final/ud-ctrl-a/Crashpad ...    （由 ctrl-a 之后的显式检查发现）
```

`kill -TERM`（必要时升级为 `kill -KILL`）后检查返回 `PGREP-EMPTY`。随后收尾逻辑被扩展为额外 `pgrep -f -- "<UD>/Crashpad"` 并 kill，此后所有 case（symlink、copydir、warm ×2）均报告 `0 process(es)`，无需人工介入。**对 Phase 3 的建议：驱动脚本的收尾必须显式杀死 Crashpad handler，否则会有残留。**

**删除前的最终状态（已记录）：**

```
=== [B] pre-cleanup: live processes referencing either root ===
3362991 grep --color=auto -E spike-extdev-final|spike-vscode-extdev      ← 检查用的 grep 自身；没有其他匹配

=== [C] pre-cleanup: any VS Code process left ===
 328031 /opt/google/chrome/chrome_crashpad_handler ...        ← 用户自己的 Chrome
 328036 /opt/google/chrome/chrome_crashpad_handler ...        ← 用户自己的 Chrome
 403164 /usr/share/trae-cn/chrome_crashpad_handler ...        ← 用户自己的 Trae
 422651 /tmp/.mount_CherryfUbLsu/chrome_crashpad_handler ...  ← 用户自己的 CherryStudio
3751093 /usr/share/cursor/chrome_crashpad_handler ...         ← 用户自己的 Cursor
```

没有任何 `/usr/share/code/code` 进程，也没有任何引用 spike 目录的进程。随后删除临时目录：

```bash
rm -rf /tmp/spike-extdev-final /tmp/spike-vscode-extdev
```
```
removed
ls: cannot access '/tmp/spike-extdev-final': No such file or directory
ls: cannot access '/tmp/spike-vscode-extdev': No such file or directory
```

**删除后的复核（验收条件所要求的那次）—— 通过。**

在上述删除操作之后，shell 环境确实一度失去响应（连续四条命令，包括 `echo alive` 与 `true`，均返回「no exit status」；工具报出「the execution environment may need to be restarted」；等待 45 秒也未恢复）。随后改为**从 `/tmp` 而非仓库根**发起命令，环境恢复，所需的复核得以执行：

```bash
echo "=== residual check: extensionDevelopmentPath (excluding my own shell wrapper) ==="
pgrep -af extensionDevelopmentPath | grep -v 'CURSOR_SANDBOX_ENV_RESTORE' | grep -v '/bin/bash -O extglob'
echo "count=$(pgrep -af extensionDevelopmentPath | grep -vc 'CURSOR_SANDBOX_ENV_RESTORE')"

echo "=== residual check: /usr/share/code/ ==="
pgrep -af '/usr/share/code/' | grep -v 'CURSOR_SANDBOX_ENV_RESTORE' || echo "PGREP-EMPTY"

echo "=== residual check: spike tmp roots ==="
(ls -d /tmp/spike-extdev-final /tmp/spike-vscode-extdev 2>/dev/null || echo "NO-SPIKE-TMP-DIRS")
```

```
=== residual check: extensionDevelopmentPath (excluding my own shell wrapper) ===
count=0

=== residual check: /usr/share/code/ ===
PGREP-EMPTY

=== residual check: spike tmp roots ===
NO-SPIKE-TMP-DIRS
```

`count=0`——`extensionDevelopmentPath` 的唯一匹配是检查命令自身的 shell wrapper（该模式出现在它自己的命令行里），上面已排除。没有任何 `/usr/share/code/` 进程存活。两个临时根目录都已删除。

**仓库未被改动 —— 已验证。** 本 spike 只在 `/tmp` 内写入，因此不应有任何产品文件变化。为避免被工作区中约 700 条既有的编译产物脏条目（早前工作留下的 `src/*.js` / `*.d.ts` 残渣）掩盖，验证采用修改时间而非 `git status`：

```bash
find packages apps docs scripts snapshots -type f -mmin -360 -not -path '*/node_modules/*' | wc -l
```

```
count=0
```

`packages/`、`apps/`、`docs/`、`scripts/`、`snapshots/` 下**零个**文件在最近 6 小时内被修改（本 spike 运行于今日约 10:35–11:05）。`packages/` 中最新产物是 `packages/sdk/client/src/launch.ts`，时间 `2026-09-14 20:39`——昨天，早于本会话。

---

## Spike 2: `ide` profile 审批路径

### 定位到的配置来源

| 层 | 绝对路径 | 关键片段原文 |
|----|----------|--------------|
| Profile 模板 | `packages/boot/app-boot/src/profile.ts` | `ide: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-sdk-app', '@deepseek-ai/dsh-ide'], patchReload: 'startup' }` |
| base bundle | `packages/bundle/base/cordis.patch.yml` | 见下方与审批相关的两行 |
| sdk-app bundle | `packages/bundle/sdk-app/cordis.patch.yml` | `- id: agent-presets` / `config: default: specdev-orchestrator` / `roots: - path: !!js specdevPresets.presetRoot` |
| ide bundle | `packages/bundle/ide/cordis.patch.yml` | `- insert: - id: ide-bridge / name: '@deepseek-ai/dsh-ide-bridge'`（以及注释 `Must NOT mount ui-approval / ui-user-questions (AC-5).`） |
| Orchestrator preset | `packages/specdev/specdev-presets/presets/specdev-orchestrator/agent.cordis.yml` | `- id: orchestrator-tool-policy / name: '@deepseek-ai/dsh-specdev-presets/orchestrator-tool-policy'` |
| 工具策略实现 | `packages/specdev/specdev-presets/src/tool-policy.ts` | `ORCHESTRATOR_ALLOW = ['read','read_image','grep','glob','bash']`，`ORCHESTRATOR_WRITE_BLOCK = ['write','edit','str_replace_editor']` |
| 审批服务 | `packages/bundle/base/cordis.patch.yml:230-233` | `- id: approval / name: '@deepseek-ai/dsh-user-approval' / config: policy: !!js "(process.env.DSH_PERMISSION_MODE ?? 'workspace-write') === 'danger-full-access' ? 'never' : 'ask'"` |
| sandbox 策略 | `packages/bundle/base/cordis.patch.yml:214-218` | `- id: sandbox-policy / name: '@deepseek-ai/dsh-sandbox-policy' / config: mode: !!js process.env.DSH_PERMISSION_MODE ?? 'workspace-write'` |
| 受限执行器 | `packages/bundle/base/cordis.patch.yml:220-224` | `- id: bash-sandbox / name: '@deepseek-ai/dsh-bash-sandbox' / disabled: !!js process.platform === 'win32'` |
| shell 工具 | `packages/bundle/base/cordis.patch.yml:252-254` | `- id: tool-bash / name: '@deepseek-ai/dsh-tool-bash' / disabled: !!js process.platform === 'win32'` |
| bridge 应答方 | `packages/ide/ide-bridge/src/index.ts` | `ctx.on('approval/request', …)`，`DEFAULT_INTERACTION_TIMEOUT_MS = 120_000` |
| Host 座位 | `apps/vscode-dsh/src/interaction-coordinator.ts` | `handleApproval(frame)`、`listPending()`、`finishApproval(entry, outcome)` |

因此 `ide` profile = `dsh-base` + `dsh-sdk-app` + `dsh-ide`。由于 `dsh-sdk-app` 以 `default: specdev-orchestrator` 挂载 `agent-presets`，且只挂 SpecDev preset 根（`includeShippedRoot: false`、`includeUserRoot: false`），并且 `AgentPresets.Config.default` 的文档原文是「Preset id mounted when a caller names none」（`packages/preset/agent-presets/src/preset.ts:53-54`），**VS Code 扩展在 `ide` profile 下通过 SDK 创建的每个会话都默认加入 `specdev-orchestrator`**。✅ CONFIRMED（配置 + schema JSDoc）。

### 触发审批的工具与判定依据

审批 seam 的消费方已被穷举（在 `packages/` 与 `apps/` 全量检索 `ctx.approval` / `ctx.get('approval')`）。`ide` profile 下恰好只有**两个**可能的产出方，而其中只有一个可达：

1. **sandbox 提权**——`packages/sandbox/sandbox/src/escalation.ts` 的 `approveEscalation(request, approval)`。当工具调用携带 `sandbox_permissions` 参数时发出请求：

```173:179:packages/sandbox/sandbox/src/escalation.ts
  const outcome = await approval.approver.request({
    agent: approval.agent,
    toolName: approval.toolName,
    callId: approval.callId,
    reason: `escalate sandbox to ${mode}: ${justification}`,
    ...approval.signal ? { signal: approval.signal } : {},
  })
```

  判定依据**不是**工具白名单/黑名单，也**不是**先前的拒绝。它只对*目标模式*做两项检查，两者都由配置决定、可确定性推导：

```162:164:packages/sandbox/sandbox/src/escalation.ts
  if (!(WIDER_MODES[effectiveMode] ?? []).includes(mode as SandboxMode)) {
    throw new Error(`sandbox escalation to "${mode}" is not strictly wider than this call's current "${effectiveMode}" mode`)
  }
```
```28:31:packages/sandbox/sandbox/src/escalation.ts
export const WIDER_MODES: Record<string, readonly SandboxMode[]> = {
  'read-only': ['workspace-write', 'danger-full-access'],
  'workspace-write': ['danger-full-access'],
}
```

  **bash** 工具在两个参数同时存在时无条件调用它——这是读函数体得出的，不是看签名：

```329:335:packages/shell/tool-bash/src/index.ts
    async execute(args: BashToolArgs, exec) {
      validateBashArgs(args)
      // Description is display metadata; workdir defaults to the caller's session.
      const standingPolicy = resolveSandboxPolicy(exec)
      const approvedMode = args.sandbox_permissions !== undefined && args.justification !== undefined
        ? await approveBashEscalation(args.sandbox_permissions, args.justification, exec, standingPolicy)
        : undefined
```

  因此**不需要先发生一次 sandbox 拒绝**——工具在收到显式提权请求时就会提示。工具描述中写「Only valid as a one-shot retry of a command the sandbox just denied」，拒绝结果也确实会携带同轮提示 `[sandbox: escalation available — retry this exact command once with sandbox_permissions … + justification]`；但那是对模型的引导，不是强制检查。
  `fs` 家族（`write` / `edit`）经 `packages/fs/tool-fs/src/sandbox.ts:100` 使用同一个 `approveEscalation`——但见下文：在默认 preset 下这些工具不可达。
2. **`tools/pre-execute` 返回 `{ kind: 'ask' }`**——由 `Tools.serviceAsk`（`packages/core/tools/src/index.ts:1680-1699`）路由到 `approval.request`。全仓库检索该决策的产出方，只找到一处实现：`packages/hooks/hooks-claude-code/src/index.ts:242`（Claude Code hook bridge）。**该插件未在 `ide` profile 中挂载**（三份 bundle patch 均无它）。因此 `ide` profile 下没有任何工具会默认 ask。✅ CONFIRMED。
   - `packages/interaction/permission-presets` **未注册任何面向模型的工具**（该包内无 `ctx.tools.register`），只暴露服务与 preset 旋钮。
   - `packages/interaction/tool-ask-user` 注册了工具，但它走的是 **user-questions** seam（Host 协调器中的 `kind: 'questions'`），不是审批座位。且它也不在 base insert 列表、sdk-app insert 列表或 ide insert 列表中。

**回答「默认 profile 是不是全放行」——不是。** 审批策略默认是 `'ask'`，除非 `DSH_PERMISSION_MODE === 'danger-full-access'`（`packages/bundle/base/cordis.patch.yml:233`），而 sandbox 默认是 `workspace-write`（`:217`）。也就是说审批默认是「武装」的；默认**缺少**的是发起提权的工具调用。

### Phase 3 第 4 步的可构造性

**✅ 可构造，但操作必须修正。**

设计中隐含的构造方法（「让模型调用 `write` 写某个文件」）在 `ide` profile 下**不可达**。理由是读取默认 preset 所应用的那份策略的函数体：

```21:50:packages/specdev/specdev-presets/src/tool-policy.ts
export const ORCHESTRATOR_ALLOW = [
  'read',
  'read_image',
  'grep',
  'glob',
  'bash',
] as const

/** Tool names that edit application source — always blocked by guard (defense in depth). */
const ORCHESTRATOR_WRITE_BLOCK = ['write', 'edit', 'str_replace_editor'] as const

export function applyOrchestratorToolPolicy(ctx: Context): void {
  const known = new Set(ctx.tools.schemas().map(schema => schema.name))
  const allowExisting = ORCHESTRATOR_ALLOW.filter(name => known.has(name))
  if (allowExisting.length > 0) {
    ctx.tools.restrict({ allow: [...allowExisting] })
  }
  ctx.tools.guard((exec) => {
    for (const blocked of ORCHESTRATOR_WRITE_BLOCK) {
      if (exec.name === blocked) {
        return 'SpecDev Orchestrator must not edit application source (AC-22)'
      }
    }
    return undefined
  })
}
```

`write` / `edit` 不只是被 restrict——它们被 guard 阻断，因此即使传入未声明的调用也会被拒。本机 `bash` **在** allow 集合内（因为 `tool-bash` 在非 Windows 上启用，故该工具在 host 上存在）。

此外 `specdev-gate` 从不阻断 orchestrator 角色——读 switch 得出：

```61:66:packages/specdev/specdev-gate/src/check.ts
  switch (role) {
    case 'requirement-analyst':
    case 'code-explorer':
    case 'orchestrator':
    case 'wiki':
      return undefined
```

因此该工具调用既不会被收窄掉，也不会被门禁拒绝。

**第 4 步的具体构造方法**——prompt 驱动模型发出一次 `bash` 调用：

```json
{
  "name": "bash",
  "arguments": {
    "command": "echo DSH-APPROVAL-MARKER-<run-id>",
    "description": "Print the approval-path marker",
    "sandbox_permissions": "danger-full-access",
    "justification": "Need unconfined access for this one diagnostic command to exercise the approval path."
  }
}
```

链路追踪（均为代码阅读）：
1. `bash.execute` 见到 `sandbox_permissions` 与 `justification` 同时存在 → `approveBashEscalation`（`tool-bash/src/index.ts:333-335`）。
2. `effectiveMode` = `workspace-write`（`sandbox-policy` 配置默认）→ `WIDER_MODES['workspace-write'] = ['danger-full-access']` → 严格更宽 ✅（`escalation.ts:162`）。
3. `ctx.get('approval')` 可解析（`dsh-user-approval` 已挂载）且 agent 存在 → `approval.request({ agent, toolName: 'bash', callId, reason: 'escalate sandbox to danger-full-access: <justification>' })`（`escalation.ts:173-179`）。
4. `policy: 'ask'` → 请求被交给终端应答方；`ide-bridge` 通过 socket 应答 `approval/request` 帧（`packages/ide/ide-bridge/src/index.ts`）。
5. Host 侧：`session-host` 把该帧交给 `InteractionCoordinator.handleApproval(frame)`，后者创建一个 `pending` 状态的 `ApprovalEntry`。
6. **`dsh.test.listPendingInteractions()` 会返回它**——`() => host?.interactions.listPending() ?? []`（`apps/vscode-dsh/src/extension.ts:1024-1027`），且 `listPending()` 过滤 `state === 'pending' || state === 'presented'`（`interaction-coordinator.ts:188-199`）。
7. 驱动扩展作答 → 授予的模式只盖在那一次调用上 → 命令不受限执行 → `DSH-APPROVAL-MARKER-<run-id>` 出现在 transcript → pending 计数归 0。

**置信度**：第 1–3 步与第 6 步 ✅ CONFIRMED（读过函数体）；挂载与 `policy: 'ask'` 配置 ✅ CONFIRMED（读过配置原文）。第 4–5 步与第 7 步的端到端 ⚠️ HYPOTHESIS：未启动真实 `dsh --profile ide` 进程、未做模型调用，因此 socket 往返与 transcript marker 未在真机观测。

**两条值得在设计时考虑的行为/时序约束**（均来自代码阅读）：

- `DEFAULT_INTERACTION_TIMEOUT_MS = 120_000`（`packages/ide/ide-bridge/src/index.ts:78`）——Host 必须在 120s 内作答，否则审批解析为 `unavailable`，即 fail closed（`escalation.ts:186` 抛出 `… requires approval, but no approval channel is available`）。
- UI presenter 基于 `createQuickPick`，并在 abort 时隐藏（`apps/vscode-dsh/src/interaction-ui.ts:212-215`，`onAbort → qp.hide(); finish(undefined)`）。如果驱动扩展在新的 `resolveApproval` 里作答时 QuickPick 仍打开，那么解析过程必须同时 abort 该座位，否则 QuickPick 会留在屏幕上，`presentEntry` 会一直阻塞 `pump()` 直到它关闭。

### 若不成立的替代方案

不适用——确定性路径存在。作为完整性补充，按优先级从高到低列出可达的备选：

1. **把提权配置出来。** `DSH_PERMISSION_MODE` 是唯一会改变审批是否「武装」的旋钮：设为 `danger-full-access` 会令 `policy: 'never'`，第 4 步将变得不可能；保持未设置（默认值）则维持 `'ask'`。因此驱动脚本**不得**设置 `DSH_PERMISSION_MODE`。
2. **`dsh-permission-presets` 服务路径。** 其 `setPolicy` 按会话写入审批策略（`packages/interaction/permission-presets/src/index.ts:271,393,427`），但它不暴露面向模型的工具，因此无法由模型工具调用驱动——只能由 Host/SDK 代码驱动。
3. **写一个 `tools/pre-execute` 的 `{ kind: 'ask' }` hook** 可以让任何工具产生审批，但那意味着新增产品代码，超出本 spike 范围，而且是设计变更而非验证路径。

### `dsh.test.*` 现有 hooks 与注册门禁

门禁，读函数体得出：

```2120:2127:apps/vscode-dsh/src/extension.ts
/**
 * AD-CR-10: register `dsh.test.*` only under test env or injected vscode harness.
 * @param vscodeArg - injected module from Node tests.
 */
function shouldRegisterTestHooks(vscodeArg?: VsCodeLike): boolean {
  if (process.env.VSCODE_DSH_TEST === '1' || process.env.VSCODE_DSH_TEST === 'true') return true
  return vscodeArg !== undefined
}
```

因此门禁是 `VSCODE_DSH_TEST === '1' | 'true'`，**或**注入 vscode 测试替身（`vscodeArg !== undefined`）。真机 Extension Development Host 因此必须在启动环境中设置 `VSCODE_DSH_TEST=1`。✅ CONFIRMED。

当前注册 30 条 hook（`extension.ts:939-1136`），按注册顺序：
`sendPrompt`、`askAboutSelection`、`prefillComposer`、`closeConversation`、`deleteConversation`、`panelSnapshot`、`getIndex`、`openPanel`、`openHistory`、`listHistory`、`injectAssistant`、`switchConversation`、**`listPendingInteractions`**、`reveal`、`deleteHistory`、`changedFileCount`、`restoreOpenTabs`、`continue`、`restoreMoreTabs`、`diffAvailability`、`getStartState`、`simulateStartupOnly`、`setCredentialPresence`、`fireConversationVisibility`、`triggerAutoReady`、`requestStart`、`hostCreateCount`、`lastCopiedText`、`injectDisconnect`、`openActivityBar`。

**`dsh.test.answerApproval` 尚不存在，`dsh.test.getDiagnosticsText` 也尚不存在**——全仓库检索这两个名字，只命中把它们规定为**新增**的 design / plan / spec 文档。第 2 步所需的 `dsh.newConversation` **确实存在**，是生产命令：`vscode.commands.registerCommand('dsh.newConversation', …)` 位于 `extension.ts:515`，并在 `apps/vscode-dsh/package.json:67` 中贡献。

### InteractionCoordinator pending 座位结构（读函数体后的结论）

**✅ CONFIRMED：座位已存在且可直接复用；`resolveApproval(id, outcome)` 尚不存在，但不需要任何新的数据结构。**

- 队列是 `private readonly queue: QueueEntry[] = []`（`:109`），其中审批条目为：

```74:86:apps/vscode-dsh/src/interaction-coordinator.ts
type ApprovalEntry = {
  kind: 'approval'
  id: string
  sessionId: string
  tabId?: string
  state: InteractionPresentationState
  abort: AbortController
  demoted: boolean
  settled: boolean
  toolName: string
  reason?: string
  resolve: (outcome: ApprovalOutcome) => void
}
```

- `handleApproval(frame)` 以捕获的 promise `resolve` 构造该条目，入队并 pump（`:227-253`）。
- 私有 settle 路径已经实现了 `resolveApproval` 所需的全部语义：

```459:467:apps/vscode-dsh/src/interaction-coordinator.ts
  private finishApproval(entry: ApprovalEntry, outcome: ApprovalOutcome): void {
    if (entry.settled) return
    entry.settled = true
    entry.state = 'resolved'
    this.removeEntry(entry.id)
    entry.resolve(outcome)
    this.syncApprovalBadges()
    this.emit()
  }
```

因此 `resolveApproval(id, outcome): boolean` 只是一个薄公共包装：在 `this.queue` 中按 `id` 找到 `kind === 'approval'` 的条目，调用 `this.finishApproval(entry, outcome)`，返回 `true`；否则返回 `false`。`settled` 守卫保证后续 UI 事件无法覆盖驱动扩展给出的答案。

- **通过阅读 `presentEntry`（`:377-457`）发现的两个顺序细节，实现时必须遵守**（⚠️ HYPOTHESIS——由代码阅读推导，未执行验证）：
  1. 为了让已打开的 QuickPick 消失、让队列继续推进，包装函数应在 `finishApproval` **之后**调用 `entry.abort.abort()`。该 abort 会让 `ui.presentApproval` 与一个解析为 `'unavailable'` 的 promise 竞争（`:411-419`），但由于 `finishApproval` 已把 `settled` 置为 `true`，落败分支的 `finishApproval(entry, 'unavailable')`（`:426`）会立即返回——不会覆盖。abort 同时触发 `pickItems` 的 `onAbort → qp.hide()`。
  2. `finishApproval` → `removeEntry` 会清空 `presentedId`，`presentEntry` 的 `finally`（`:454-456`）再清一次是无害的，因此一旦 QuickPick 解析完成，`pump()` 可以继续处理下一个 pending 条目。不会死锁，但 QuickPick 打开期间 pump 一直被阻塞——这正是第 1 点的原因。

---

## 对设计的影响

| # | 文档 / 表述 | 需要改动的内容 |
|---|-------------|----------------|
| 1 | `design.md:382` ——「A-1 已通过读取 CLI 选项表确认」 | 改写为已实证确认：双 `--extensionDevelopmentPath` 可同时加载两个扩展，激活约 3.02s；最小 flag 集为 `--user-data-dir` + `--extensions-dir` + 2×`--extensionDevelopmentPath`（无需 `--no-sandbox` / `--disable-gpu` / `--skip-welcome` / `--skip-release-notes`）。引用本报告。 |
| 2 | Phase 3 的启动方案（隐含） | 驱动脚本**必须**用两个 `--extensionDevelopmentPath` flag 同时加载 `apps/vscode-dsh` 与驱动扩展。`--extensions-dir` 不是可替代的加载通道——不要在该通道上设计 fallback。 |
| 3 | `phases/phase-3-layer-v-smoke-loop/spec.md` AC-25 第 4 步——「触发一次需要审批的工具调用」 | 明确写出触发方式：一次 `bash` 调用，带 `sandbox_permissions: "danger-full-access"` 与非空 `justification`，并在 `command` 中带唯一 marker。**不要**写成「写文件」——`write`/`edit` 被 SDK 默认的 `specdev-orchestrator` preset 以 guard 阻断，该步骤会不可达。同时记录：驱动脚本**不得**设置 `DSH_PERMISSION_MODE=danger-full-access`（会解除审批武装）。 |
| 4 | AC-25 第 4 步的超时预算 | bridge 等待 120s（`DEFAULT_INTERACTION_TIMEOUT_MS`）；必须远早于此作答，并把 `unavailable` 视为 fail-closed 的失败而非静默通过。 |
| 5 | `design.md:207`、`:284`、`:444`、`:527` 与 `phase-2 spec.md:60,78`——新增 `InteractionCoordinator.resolveApproval` + `dsh.test.answerApproval` | 仍然需要；座位已存在，因此这是 `finishApproval` 之上的薄包装。需补充一条设计尚未写明的约束：`resolveApproval` 必须同时 abort 已呈现的座位，否则 QuickPick 会留在屏幕上、呈现 pump 会停滞。 |
| 6 | Phase 3 的收尾描述（如有） | 必须除 GUI 进程组之外再杀死 Electron Crashpad handler（`pgrep -f -- "<UD>/Crashpad"`），否则会有残留进程。 |
| 7 | `design.md` 真机相关要求 | 补充：启动时设置 `VSCODE_DSH_TEST=1`（这是真实 Extension Development Host 中存在 `dsh.test.*` hooks 的唯一途径；注入替身那一分支不适用）。 |

---

## 未验证事项

1. **删除后的残留自检 —— 现为 ✅ CONFIRMED（曾受阻，已解决）。** `rm -rf /tmp/spike-extdev-final /tmp/spike-vscode-extdev` 成功之后，shell 环境立即失去响应（连续四条命令返回「no exit status」，包括 `true`；等待 45 秒未恢复）。改为从 `/tmp` 而非仓库根发起命令后环境恢复，所需的复核随即执行：`pgrep -af extensionDevelopmentPath` → `count=0`（仅自匹配），`pgrep -af '/usr/share/code/'` → `PGREP-EMPTY`，两个临时根目录 → `NO-SPIKE-TMP-DIRS`。无任何残留。同一次检查还确认了 `packages/`、`apps/`、`docs/`、`scripts/`、`snapshots/` 下最近 6 小时内零文件被修改，即仓库未被改动。
2. **未启动真实 `dsh --profile ide` 进程，也未做模型调用。** Spike 2 全部为静态分析：bundle 配置、工具优先策略、提权逻辑、bridge 与 Host 协调器。socket 往返（bridge → Host → QuickPick）、`listPendingInteractions()` 中出现 `approval` 条目、以及最终 transcript marker 均属 ⚠️ HYPOTHESIS。
3. **模型是否愿意发出 `sandbox_permissions` 未经测试。** 设计必须假定这是 **prompt 的责任**。若模型拒绝、或选择 `workspace-write` 而非 `danger-full-access`（后者不严格更宽，会抛错而不是弹审批），第 4 步就不会有审批可答。确定性驱动脚本应断言工具调用参数，而不是依赖模型的措辞。
4. **`--extensions-dir` 不激活的机制属推断**，未被证明。行为已在 symlink / copy / warm-copy 三种配置下确认；其解释（profile 关联）是从 renderer/exthost 日志反推，属 HYPOTHESIS。
5. **`--no-sandbox` 在其他场景（如以 root 运行、容器内）是否必需未测试**——只测了本机（非 root、`DISPLAY=:1`）的行为。
6. **`dsh.test.getDiagnosticsText` 未做调查**，仅确认其尚不存在；它超出本 spike 范围。
7. **本机的 Landlock 实际执行未被触发。** 提权提示发生在执行之前，因此第 4 步不依赖它；但授权之后那条命令的 `enforcement: 'none' | 'landlock'` 值未被观测（内核 5.15 满足 Landlock ABI v1，因此预期可用——⚠️ HYPOTHESIS）。
