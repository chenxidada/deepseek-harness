# 原生 Diff 可行性 Spike

> **范围**：仅做可行性调研 —— 不实施工作流，不改产品代码。
> **待答问题**：能否在不做（或只做极小）产品改造的前提下，让 `ide` profile 产生**原生 Diff**（模型调用 `write`/`edit` 类工具，其 `tool/result` 携带 `meta.diffs`，从而使扩展的时间线 Diff 与 `dsh.reviewWorkspaceDiffs` 真正可用）？
> **日期**：2026-09-15 · **仓库**：`deepseek-harness` @ 分支 `new/vscode-dsh`（`d92b0e55e1`）

---

## 结论摘要

**✅ 原生 Diff 在 `ide` profile 上可达，且最小代价路径是选项 (a)：零仓库改动。** 出厂配置与原生 Diff 之间只隔**一行 loader 记录** —— 即 `specdev-orchestrator` preset（`ide` profile 的 default preset）所挂载的 `orchestrator-tool-policy` 插件。Host 平面本来就挂载了 `tool-fs`（`write`/`edit`），这些工具本来就会给结果附加 `meta.diffs`，扩展本来就会消费它。因此一个 overlay 就足够 —— **而且这个 overlay 甚至不必通过 argv 传入：它可以走 profile 的用户 patch 层（`$DSH_HOME/profiles/<profile>/cordis.patch.yml`），该层由 `composeProfile` 原生支持，既不需要改代码，也不需要任何 `--patch` 参数。** 置信度：**✅ CONFIRMED —— 已在 `ide` profile 上实机观测，产出的 `meta.diffs` 同时出现在实时 `tool/result` 事件与持久化的 zstd 会话日志中。**

两个会实质影响 HG-2 决策的注意点：

1. **参考 overlay（把 `agent-presets.config.default` 设为 `standard`）在 `ide` profile 上可以直接加载，不缺任何插件** —— 与 `sdk` profile 不同（在 `sdk` 上 `standard` 额外需要插入一行 Host 的 `tool-subagent/model-selection-settings`）。另有一次带该 insert 的 `sdk` 运行证明该 insert 充分，但在 `ide` 上并不需要它。
2. **还有一条交付成本更低的路线，完全不需要切换 preset（选项 (d)）**：子 Agent 的 diff 是**按整个会话树**聚合的，而三个已可达的 specdev preset（`specdev-implementer`、`specdev-wiki`、`specdev-plan-generator`）本来就允许模型写文件。⚠️ 该结论为 HYPOTHESIS，仅有代码级证据（未在 VS Code 内实测）。

---

## 方法与环境

| 项 | 值 |
|---|---|
| Node | v24.3.0（`/usr/local/n/versions/node/24.3.0/bin`）—— 需要它才有 `zlib` 的 zstd 与 `Promise.withResolvers` |
| 凭据 | 以 `set -a; . ./.env; set +a` 从仓库根 `.env` 注入 `DEEPSEEK_API_KEY` —— **其值从未被打印或写入**，报告中只记「已注入」 |
| 模型 | `deepseek-official` / `deepseek-v4-flash` |
| Harness 入口 | `DeepSeekHarness` SDK 客户端（`@deepseek-ai/dsh-sdk-client`），传 `profile`、`dshHome`、`env`、`patches` |
| 暂存目录 | `/tmp/spike-native-diff/**`（结束时已清理） |
| 仓库代码 | `apps/`、`packages/`、各配置 —— **完全未改动**（也无需临时 worktree，见「工作区改动确认」） |

4 次真实模型运行由 `/tmp/spike-native-diff/run.ts` / `run-ide.ts` 驱动；每次 prompt 完全相同：

```
Read /tmp/spike-native-diff/ws/hello.txt. Then use the edit tool to change the word "alpha" to "omega" in that file. When done, reply with exactly: DONE
```

`run-ide.ts` 通过在一个 Unix socket 上启动真实的 `IdeBridgeHostServer` 并向子进程传入 `DSH_IDE_BRIDGE_SOCK`，构造出**完整的 `ide` 组合** —— 全程没有 VS Code、没有扩展宿主、没有 `code` / `code-tunnel` 进程。

### 模型调用预算

| 运行 | Profile | Overlay | prompt 往返 | 模型请求 | totalTokens |
|---|---|---|---:|---:|---:|
| 1 | `sdk` | `overlay-implementer.yml` | 1 | 3 | 31,735 |
| 2 | `sdk` | `overlay-coder.yml` | 1 | 3 | 31,342 |
| 3 | `sdk` | `overlay-standard2.yml` | 1 | 3 | 25,822 |
| 4 | **`ide`** | `overlay-standard2.yml` | 1 | 3 | 26,026 |
| **合计** | | | **4** | **12** | **约 114.9k** |

预算为 ≤ 6 次 prompt 往返 → **用了 4 次**。另有一次尝试（在 `sdk` 上覆盖为 `standard`）在**挂载阶段**即失败，消耗 **0** 次模型调用。

---

## P1 —— 可达 preset 里哪些允许 `write`/`edit`？

### P1.1 —— `specdevPresets.presetRoot` 的实际磁盘路径

**✅ CONFIRMED** —— `packages/specdev/specdev-presets/src/index.ts` 定义该插件；其 `presetRoot` 解析为

```
packages/specdev/specdev-presets/presets/
```

其中含 **11** 个 preset 目录，每个都有 `agent.cordis.yml`（用 `find packages/specdev/specdev-presets/presets -name 'agent.cordis.yml'` 枚举）。

### P1.2/P1.3 —— 逐 preset 的写能力

决定性机制在 `packages/specdev/specdev-presets/src/tool-policy.ts`：`applyOrchestratorToolPolicy` 用 `ORCHESTRATOR_ALLOW`（`tool-policy.ts:21-26`）替换会话的工具切片，并对每次调用按 `ORCHESTRATOR_WRITE_BLOCK`（`tool-policy.ts:30`）拦截，后者包含 `write`、`edit`、`str_replace_editor`。

```21:30:packages/specdev/specdev-presets/src/tool-policy.ts
const ORCHESTRATOR_ALLOW = [
  'read',
  'read_image',
  'grep',
  'glob',
  'bash',
] as const

const ORCHESTRATOR_WRITE_BLOCK = ['write', 'edit', 'str_replace_editor'] as const
```

下表的行数为对每个 `agent.cordis.yml` 的 grep 计数（`tool-fs` = 来自 `packages/bundle/base/cordis.patch.yml:266-267` 的 Host 记录，即 `@deepseek-ai/dsh-tool-fs` = `write` + `edit`）：

| Preset（目录） | 挂 `tool-fs`（`write`/`edit`） | 挂 `orchestrator-tool-policy` | 模型可写文件？ | `meta.diffs` 路径 |
|---|:--:|:--:|:--:|---|
| `specdev-orchestrator` | ❌ | ✅ ×2 | **❌ 否** | 不可达 |
| `specdev-implementer` | ✅ | ❌ | **✅ 是** | `write`/`edit` → `meta.diffs` |
| `specdev-plan-generator` | ✅ | ❌ | **✅ 是** | 同上 |
| `specdev-requirement-analyst` | ✅ | ❌ | **✅ 是** | 同上 |
| `specdev-code-explorer` | ✅ | ❌ | **✅ 是** | 同上 |
| `specdev-reviewer` | ✅ | ❌ | **✅ 是** | 同上 |
| `specdev-reviewer-correctness` | ✅ | ❌ | **✅ 是** | 同上 |
| `specdev-reviewer-design` | ✅ | ❌ | **✅ 是** | 同上 |
| `specdev-reviewer-connectivity` | ✅ | ❌ | **✅ 是** | 同上 |
| `specdev-verifier` | ✅ | ❌ | **✅ 是** | 同上 |
| `specdev-wiki` | ✅ | ❌ | **✅ 是** | 同上 |

导致整个问题的非对称性由此显形：`specdev-orchestrator` 是**唯一**挂载 `orchestrator-tool-policy` 的 preset，也是**唯一**没有挂载 `tool-fs` 的 preset。所有角色 preset 都能写；唯独主会话不能。

shipped presets（`packages/preset/agent-presets/presets/`）：

| shipped preset | 挂 `tool-fs` | 需要额外 Host 记录 | 模型可写？ | `meta.diffs` |
|---|:--:|:--:|:--:|---|
| `standard` | ✅ | ✅ `tool-subagent/model-selection-settings` | **✅ 是** | ✅ |
| `ptc` | ✅ | ✅（推测同族） | **✅ 是** | ✅ |
| `cordis` | ✅ | ✅（推测同族） | **✅ 是** | ✅ |
| `minimal` | ❌（改用 `str-replace-editor`） | — | 可写，但**无持久化 `meta`** | ❌ 见下 |

### P1.4 —— 结论

**✅ CONFIRMED：存在现成的、允许 write 的 preset。** 两族：

- **无需任何 insert 即可达**：九个非 orchestrator 的 SpecDev 角色 preset（它们来自 `ide` profile 本就挂载的 specdev 根）。安装成本最低，但各自带角色专属的 SpecDev persona 与契约。
- **persona 正确的通用选择**：shipped `standard`（`request/header` 系统提示中即为通用编码 Agent 文本 —— 已实测）。在 **`ide` profile 上它无需任何 insert 即可加载**（运行 4 实测）；在 **`sdk` profile 上则需要**插入 `tool-subagent/model-selection-settings` 这行 Host 记录（运行 3 与失败尝试对比）。

### `meta.diffs` 的产出链路（静态，全部 ✅ CONFIRMED）

```94:99:packages/fs/tool-fs/src/write.ts
    presentationMeta: (args, value) =>
      value.before === null
        ? { diffs: [] }
        : { diffs: computeHunkDiffs(value.before, value.after, args.file_path) },
```

`edit` 更严格 —— 只有内容真的改变时才附 meta（`packages/fs/tool-fs/src/edit.ts:106-109`）。持久化那一跳由 `packages/core/tools/src/index.ts:1796-1805` 的 `meta: output.presentationMetaView({...})` 完成，最终以 `session.append('tool/result', { …, meta })` 落盘（`packages/core/agent-loop/src/tool-calls.ts:282-287`）。因此生产者/消费者的契约本就是端到端连通的。

### ⚠️ 两个必须带进设计阶段的限制

1. **新建文件不会产生可恢复的 diff。** `write` 在 create 场景下 `FsWriteOutcome.before === null`（`packages/fs/fs/src/types.ts:133-141`），于是 `presentationMeta` 返回 `diffs: []`，而 `recoverableDiffsFromMeta` 会丢弃空数组。因此，若工作流的 implementer 以**新建文件**为主，这些文件在时间线上不会有 Diff；只有"覆盖已有文件"与 `edit` 才有。
2. **`str_replace_editor` 永远不产生可恢复的 diff。** 该包只注册了 `presentCall`（`packages/fs/tool-str-replace-editor/src/index.ts:497`），没有 `presentationMeta`，因此其结果既不带 `output` 也不带 `diffs` meta，时间线 Diff 始终为空 —— 即便用 `minimal` preset 也一样。真正有意义的只有 `tool-fs` 的 `write`/`edit`。

---

## P2 —— 能否不改源码就切换 default preset？

### agent-presets config 字段与可覆盖性

**✅ CONFIRMED** —— `packages/preset/agent-presets/src/index.ts` 中 `AgentPresets.Config` 暴露了 `default`、`roots`（`{path, trust}`）、`includeShippedRoot`、`includeUserRoot`，它们都是通过插件 `Config` schema 注册的普通受校验字段（`:104-112`）。当前生效的 default 由 `defaultId()` 读取（`:240-242`），其取值是 `settings.get().default ?? config.default` —— 即 `agent-presets` 的 **settings 命名空间**，而**不是**「按 `cwd` 持久化的会话选择」（*此处措辞已由 follow-up 章节更正；原表述有误*）；根列表由 shipped 根 + `roots` + user 根组合而成（`:178-182`），同一 id 由更靠前的根胜出（`packages/preset/agent-presets/src/discovery.ts:325-343`）。由于这四个都是声明式 config，**任何一个都能被 patch 层覆盖** —— 无需改源码。

可承载该 patch 的根层（`apps/cli/src/profile-boot.ts:138-142`）：

```138:142:apps/cli/src/profile-boot.ts
  return [
    ...composed.bundlePatches,
    ...composed.profile.patches,
    ...composed.homePatches,
    ...composed.overlays,
```

✅ **CONFIRMED（代码）**：profile 层即 `$DSH_HOME/profiles/<profile>/cordis.patch.yml`（`PROFILE_PATCH_FILENAME` 定义于 `packages/boot/app-boot/src/profile.ts:44`，拼接于 `:843`）。这一点很重要，因为它意味着该 overlay **可以完全不经 argv 交付**。本次 spike 为了不把改动永久留在用户的 `~/.dsh` 里，选择了第四层（`--patch`，`apps/cli/src/args.ts:132`）。**一次「仅靠 profile 层 patch、不带 `--patch`」的最终实机运行未执行** —— 见「未验证事项」。

### overlay 实验（命令原文与结果原文）

所有 overlay 位于 `/tmp/spike-native-diff/`。由于 **patch 会替换整段 `config`**，凡是想保留的键都必须重述。

`/tmp/spike-native-diff/overlay-standard2.yml`（两个 profile 上都跑通的那份）：

```yaml
- id: agent-presets
  config:
    default: standard
    includeShippedRoot: true
    includeUserRoot: false
    roots:
      - path: !!js specdevPresets.presetRoot
        trust: system
- insert:
    - id: subagent-model-selection-settings
      name: '@deepseek-ai/dsh-tool-subagent/model-selection-settings'
```

四次运行的原始结果（`report-*.json`、`analyze.ts` 输出）：

```
=== report-implementer.json  (sdk, preset specdev-implementer)
toolCallCount: 2  toolResultsWithDiffs: 1
tool/call #1 name=read ...
tool/call #2 name=edit args={"file_path":"/tmp/spike-native-diff/ws/hello.txt","old_string":"alpha","new_string":"omega"}
tool/result meta={"diffs":[{"path":".../hello.txt","oldText":"line one alpha\n...","newText":"line one omega\n..."}]} hasDiffs=true
--- ws file --- line one omega / line two beta / line three gamma

=== report-standard2.json  (sdk, preset standard)
toolCallCount: 2  toolResultsWithDiffs: 1   → hasDiffs=true

=== report-ide.json  (ide profile, preset standard)
bridge: listening ; sessionId: session-1c65afaeebd04dc692aaf51361a9673f ; eventCount: 98
toolCallCount: 2  toolResultsWithDiffs: 1
tool/result meta={"diffs":[{"path":"/tmp/spike-native-diff/ws/hello.txt","oldText":"line one alpha\nline two beta\nline three gamma","newText":"line one omega\nline two beta\nline three gamma"}]} hasDiffs=true
```

上面这段原始 `meta` 正是 `recoverableDiffsFromMeta`（`apps/vscode-dsh/src/replay-hydrator.ts:352`）转成 `recoveredDiffs` 的输入，随后由 `writeDiffsForSessionTree`（`apps/vscode-dsh/src/timeline-store.ts:171-173`，`collectDiffs` 在 `:391`）写出，供 `dsh.reviewWorkspaceDiffs` 使用。

那次 `ide` 运行的系统提示中还出现了 IDE 的 workspace 路径前导语，说明**确实执行了 ide 层组合**，并非一次披着 `ide` 外衣的 `sdk` 运行。

### 持久化日志确认

会话日志被独立于 harness 地解压（对 `$DSH_HOME/sessions/--tmp-spike-native-diff-ws--/` 下的 `.jsonl.zstd` 做帧扫描 + `zstdDecompressSync`），并在持久化流中找到了携带 `meta.diffs` 的 `tool/result` 事件。**✅ CONFIRMED：`meta.diffs` 能通过持久化**，因此扩展中回放/再水合的会话可以重建该 diff。

### 观测到的失败模式（报错原文）

在 **`sdk`** profile 上不插入那行就挂载 `standard`，会在挂载阶段失败：

```
JsonRpcResponseError: agent-presets: preset "standard" failed to mount: failed to apply loader entry
delegation (cordis:group): failed to apply loader entry tool-subagent
(@deepseek-ai/dsh-tool-subagent): tool-subagent: `modelSelectionSettings` requires
@deepseek-ai/dsh-tool-subagent/model-selection-settings in the Host scope
```

原因：`standard` 的 `modelSelectionSettings: true`，而 `sdk-app` bundle 未挂载该 Host 记录；报错点位于 `packages/subagent/tool-subagent/src/index.ts:610`。修复即上面那一处 `insert` —— **✅ CONFIRMED 充分**（运行 3 成功）。**在 `ide` profile 上不需要这个 insert**（运行 4 用原样 overlay 就挂上了 `standard`；`ide` 的 bundle 集合本身已提供该记录）。

### `buildIdeChildEnv` 是否剔除 `DSH_HOME`？

**✅ CONFIRMED（函数体 + 运行期观测）。** 函数体先 scrub、再只重注入两个变量：

```30:39:apps/vscode-dsh/src/env.ts
export function buildIdeChildEnv(options: IdeChildEnvOptions): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...scrubbedParentEnv(),
    ...options.credentials,
    [IDE_BRIDGE_SOCK_ENV]: options.bridgeSock,
  }
  if (options.dshHome !== undefined) {
    env.DSH_HOME = options.dshHome
  }
  return env
}
```

`scrubbedParentEnv()` 会删除所有继承来的 `DSH_*`（`packages/subprocess/subprocess/src/index.ts:64-75`，注释即 `/* DSH_* is harness-internal. */`）。运行期观测：在子进程 env 中传入 `DSH_HOME` 与一个自定义 `DSH_X` 变量后，子进程的 `session/status` 报告的 `dshHome` 为**默认**的 `~/.dsh`。因此：

> **无法通过设置 VS Code 进程环境里的 `DSH_HOME`（或任何其他 `DSH_*`）把 overlay 交付给扩展的子进程。** 能到达子进程的只有 `options.dshHome`（由扩展自身计算）与 `options.env`（由 `buildIdeChildEnv` 构造）。

这一事实正是 P3 之所以不平凡的原因：扩展的 env 通道被有意关闭，交付必须走**文件系统**（`$DSH_HOME/profiles/<profile>/cordis.patch.yml`）或**新增管线**（选项 (b)）。

---

## P3 —— 交付到 VS Code 扩展路径的最小代价

### (a) 零产品改动 —— 经 profile patch 层交付

**✅ 原理上 CONFIRMED 可行；❓ 扩展解析出的 profile 是否落到同一个 `$DSH_HOME` 文件仍属 UNKNOWN（一次约 10 分钟的实机检查即可定案）。**

- `composeProfile` 每次启动都会读取 `$DSH_HOME/profiles/<profile>/cordis.patch.yml`（`apps/cli/src/profile-boot.ts:138-142`、`packages/boot/app-boot/src/profile.ts:44`、`:843`）。扩展 spawn 的 `dsh` 子进程通过同一个 loader 启动同一个 profile，因此只要它用同一个 `DSH_HOME`，就会自动读到该文件 —— **无 argv、无代码改动、无新配置项**。
- 今天 argv 通道**不是**可用的杠杆：`resolveDshLaunch` 确实支持任意 patch（`packages/sdk/client/src/launch.ts:158-171`，数据来自 `HarnessClientOptions.patches`，`packages/sdk/client/src/types.ts:29-30`），但 `IdeSessionHost.start` 从不设置它（`apps/vscode-dsh/src/session-host.ts:241-250`），而扩展**没有任何 `contributes.configuration`**（`apps/vscode-dsh/package.json:56` 的 `contributes` 只有 `commands`/`menus`/`views`），所以用户/脚本无法注入路径。

| | |
|---|---|
| 改动点 | 无（发布一份有文档说明的 `cordis.patch.yml`） |
| 规模 | 约 15 行 YAML + 一段 README 说明 |
| blast radius | **零代码、零测试、零快照。** 只影响该机器上 `$DSH_HOME` 中选定 profile 的行为；对 CI 与其他 profile 完全不可见。它同时还是一个**验证工具** —— 正是在真实扩展上裁决 HG-2 的 A/B 问题所需的那个旋钮。 |
| 风险 | 静默漂移：日后 `dsh` 配置变更可能让手维护的 overlay 失同步（patch 替换整段 `config`；漏键会是**响亮**的加载/校验错误，不是静默错配）。且不可分发给其他用户。 |
| 成本估计 | **约 30 分钟**（写 overlay，无需构建） |

### (b) 极小改动 —— 在扩展/客户端增加一个「overlay 路径」入口

| 改动点 | 内容 |
|---|---|
| `apps/vscode-dsh/src/session-host.ts:241-250`（`IdeSessionHost.start`） | 读取新设置并把 `patches: [...]` 传入 `HarnessClient` 构造参数 |
| `apps/vscode-dsh/src/env.ts:30-39`（`buildIdeChildEnv`） | *替代性*极小方案：在 `scrubbedParentEnv` 的保留名单里放行一个变量（`packages/subprocess/subprocess/src/index.ts:64-75`），让 `DSH_IDE_PATCH` 之类透传 |
| `apps/vscode-dsh/package.json` | 新增**第一个** `contributes.configuration` 项（如 `dsh-dsh.extraPatches`） |
| `apps/vscode-dsh/src/**` 测试 | 一个单测，断言 patch 路径确实到达 `HarnessClientOptions.patches` |

| | |
|---|---|
| 规模 | **约 3 个文件，≤ 30 行 + 1 个测试** |
| blast radius | 仅扩展包。SDK 客户端本就支持 `patches`；`subprocess` 保留名单那种改法面更大（`subprocess` 包是共享的），应优先选 `session-host` 那种改法。 |
| 风险 | 低，但这毕竟是为本工作流而新增的产品面；需要有文档，并起一个能活过 spike 的设置名。 |
| 成本估计 | **约 0.5–1 天**（含测试/文档/门禁） |

### (c) 产品语义改动 —— 让 `ide` profile 默认可写

候选改动：`packages/specdev/specdev-presets/src/tool-policy.ts`（`ORCHESTRATOR_WRITE_BLOCK` / `ORCHESTRATOR_ALLOW`）、`specdev-orchestrator` preset 的 `agent.cordis.yml`，或 `packages/bundle/sdk-app/cordis.patch.yml:46-55`（`agent-presets.config.default`）。

| | |
|---|---|
| blast radius | **广且跨域。** `sdk-app` + `specdev-presets` 被 `sdk`、`ide` 以及 headless 的 SpecDev 流程共享，改 default preset 等于处处改变**主会话 persona**；放宽 `tool-policy.ts` 则会为**每一个** SpecDev orchestrator 会话移除 write-block —— 而这是 SpecDev 工作流刻意设定的不变量（「orchestrator 只派发，写文件交给子 Agent」），会使其自身的假设、文档与录播会话预期失效。 |
| 风险 | **高。** 它为了解决本工作流的一个显示问题，静默改变了另一个工作流的语义，也是最容易被 SpecDev 归属方驳回的方向。 |
| 成本估计 | **约 1–2 天** + 跨域评审；快照/文档连带返工 |

### (d) 零改动、换个杠杆 —— 让现有子 Agent 产出 diff

**⚠️ HYPOTHESIS —— 但代码层面意图明确。** 扩展的 diff 收集是**按会话树**的：`writeDiffsForSessionTree` → `itemsForSessionTree` 被注释为 *"Items for a Tab root plus discovered subagent descendants (AC-14)"*，它并集 `collectTree(rootSessionId)` 各会话的缓冲（`apps/vscode-dsh/src/timeline-store.ts:151-156`、`:369`），再对该并集跑 `collectDiffs`（`:171-173`、`:391`）；命令入口本来就是以 Tab 根会话喂给它（`apps/vscode-dsh/src/extension.ts:854`、`:1216`）。由于可达的 `specdev-implementer` preset 本就允许写（P1），而 SpecDev 派发正是用它挂载子 Agent 会话 —— `rolePresetId('implementer')` → `specdev-implementer`（`packages/specdev/specdev/src/dispatch.ts:58-60`），经 `await presets.mount(agentCtx, presetId)`（`:185`）应用 —— 因此一个用 `tool-fs` 的 `edit` 改文件的 implementer 子 Agent，**本就已经在喂 `dsh.reviewWorkspaceDiffs`，既无需切换 preset，也无需任何产品改动**。

两个未经验证的依赖：(i) SpecDev 派发出的子会话在运行期是否会被登记为扩展 `children` 映射中**可发现的子 Agent 后代**（代码里确实写了这条子 Agent 后代遍历，但本 spike 从未在 VS Code 内跑过 SpecDev 流水线）；(ii) `design.md` §9 那个场景里的**orchestrator 自身写文件**是否也必须显示 diff —— 选项 (d) 覆盖不到 orchestrator 侧的写入。

| | |
|---|---|
| 规模 | **0 行代码**；在 VS Code 内端到端验证约 2–4 小时 |
| blast radius | 无 |
| 风险 | 只覆盖子 Agent 的写入；§P1 限制 1（新建文件）依然适用 |

---

## 成本估计与建议

| 选项 | 成本 | 产品改动 | 覆盖 orchestrator 写入 | 跨域风险 |
|---|---|---|---|---|
| **(a)** profile 层 overlay | 约 30 分钟 | 无 | ✅ | 无 |
| **(d)** 依赖子 Agent diff | 约 2–4 小时验证 | 无 | ❌ | 无 |
| **(b)** 扩展设置项 | 约 0.5–1 天 | 约 3 个文件 | ✅ | 低 |
| **(c)** 改 default preset / 策略 | 约 1–2 天 | bundle + preset 策略 | ✅ | **高** |

**建议。** 原生 Diff 在 `ide` profile 上**今天就可达**，因此 HG-2 的 A/B 问题是一个**产品语义**问题，而非可行性问题 —— 本 spike 已经排除了「拿不到原生 Diff」作为倾向任一分支的理由。

- 对「可用闭环」这个范围：先用 **(a)** 立刻解封，并以近乎零成本在真实扩展上验证 §9 的选项 B；待闭环形态定下来后，再把 **(b)** 作为可分发形态。
- 若意图是保持 SpecDev 工作流原样不动，**(d)** 是成本最低的真实路线，但必须在 VS Code 内验证后才能依赖，且它覆盖不到 orchestrator 侧写入。
- **(c)** 应保留给「有意识地变更 SpecDev 编排契约」的决策；它不是「极小」路径，并且会侵入另一个工作流的领域。

---

## 未验证事项

| # | 事项 | 状态 |
|---|---|---|
| 1 | **不带 `--patch` argv**、仅经 `$DSH_HOME/profiles/<profile>/cordis.patch.yml` 交付 overlay（选项 (a) 所依赖的确切机制） | ✅ **已由 follow-up（G2）解决** —— 已在实机不带 `--patch` 的情况下跑通，该层确实被读取并生效 |
| 2 | 扩展解析出的 `dshHome` 是否等于放置该 overlay 文件的那个 `DSH_HOME` | ✅ **已由 follow-up（G2）解决** —— 它是 `os.homedir()/.dsh`，即开发者真实的 `~/.dsh`；交付选项 (a) **确实需要写入那里** |
| 3 | 选项 (d) 在 VS Code 内的端到端行为（子 Agent 写入是否被会话树 diff 收集到） | ❓ UNKNOWN —— 仅代码级 HYPOTHESIS |
| 4 | shipped `ptc` / `cordis` 所需的额外 Host 记录：由同一个 `modelSelectionSettings` 标志推断，未对这两个 preset 实跑 | ⚠️ HYPOTHESIS |
| 5 | 选项 (c) 的快照/测试影响（本 spike 未跑任何门禁，也未改任何代码） | ❓ UNKNOWN |

---

## 残留清理自检

残留进程检查（`pgrep -af` 原文输出）：

```
=== [e]xtensionDevelopmentPath ===
(empty)
=== [/]usr/share/code/ ===
(empty)
=== [d]sh ===
(empty)
=== spike-owned crashpad (--database under /tmp/spike-native-diff) ===
(empty)
=== scratch dir ===
ls: cannot access '/tmp/spike-native-diff': No such file or directory
```

没有 `extensionDevelopmentPath` 进程、没有 `/usr/share/code/` 进程、没有 `dsh` 进程，也没有指向本 spike 暂存目录的 `chrome_crashpad_handler`。（有一次 `pgrep` 只匹配到它自己的 wrapper shell —— 因为模式串出现在该 shell 的 argv 中；改用带方括号的模式 `[e]xtensionDevelopmentPath` / `[/]usr/share/code/` / `[d]sh` 重跑，三项均为空。）机器上可见的 `chrome_crashpad_handler --database=/home/chendc/.config/Code/User/...` 实例启动于 2026-09-01，属**既有进程，非本 spike 所有**。

暂存清理：`/tmp/spike-native-diff/**`（overlay、preset、驱动脚本、报告、工作区）已删除。

有意保留的副作用（披露如下，无数据损失）：

- `$DSH_HOME/profiles/sdk/**` —— 本 spike 首次 `dsh` profile init 时创建；该路径此前不存在。保留它是因为这本就是 `dsh` 首次使用 `sdk` 时会创建的正常 profile 模板，不属于仓库内容。
- `$DSH_HOME/sessions/--tmp-spike-native-diff-ws--/**` —— 4 份 spike 会话日志。保留作为证据链；它们引用的 `/tmp` 工作区已被删除。

## 工作区改动确认

`git worktree list`（**未创建临时 worktree** —— 也不必要，因为没有任何实验需要改源码）：

```
/workspace/chendecheng/code/need/deepseek/deepseek-harness  d92b0e55e1 [new/vscode-dsh]
```

`git status --porcelain --untracked-files=no`（被跟踪文件的改动）：

```
 M .cursor/skills/project-build/SKILL.md
 M .specdev/specs/workflows.json
 M apps/vscode-dsh/webview/dist/assets/index.css
 M apps/vscode-dsh/webview/dist/assets/index.js
 M pnpm-lock.yaml
```

**这五项全是既有改动** —— 与会话开始时的 `git status` 快照逐字节一致，且本 spike 一项也未触碰。**`packages/`、`apps/*/src/` 以及任何 `cordis`/preset 配置文件均未被修改。** 暂存区为空（`git diff --cached --stat` 无输出）。未跟踪条目 815 项，全部为既有仓库/Agent 工具噪声；本 spike 新增的文件只有 `.specdev/specs/vscode-dsh-usable-loop/spikes/` 下的这两份报告。

---

## Follow-up: closing the three gaps (2026-09-15)

> **硬约束**：不改产品代码；**实际用掉 2 次真实 prompt 往返**（预算 ≤ 3）；其余结论全部来自静态 `file:line` 或「不调模型」的免费启动观测。
> 两次实机运行都**只靠 `HOME` 做沙箱** —— **真实的 `~/.dsh` 一次都没被写过**（证据见 §G2.3 与 §残留自检）。
> 驱动脚本、overlay、影子 preset 都放在 `/tmp/spike3/**`，结束时已删除。

| 运行 | Profile | 交付通道 | `--patch` argv | 实际组装出的 preset | prompt 往返 |
|---|---|---|---|---|---|
| **A** | `ide` | `<fake HOME>/.dsh/profiles/ide/cordis.patch.yml` | **无** | **影子化的** `specdev-orchestrator`（policy 行被移除） | 1 |
| **B** | `ide` | `<fake HOME>/.dsh/settings.yaml`（`agent-presets.default`） | **无** | `specdev-implementer` | 1 |

两次都由同一个 `/tmp/spike3/driver.ts` 经 SDK client 驱动（`profile: 'ide'`、真实 `IdeBridgeHostServer` 走 Unix socket、不启动 VS Code），`HOME` 指向新建的临时家目录，并从子进程环境中删除 `DSH_HOME`。

### 对 §P2 的更正

原句 *「`defaultId()` … prefers the persisted per-`cwd` session selection then falls back to `config.default`」* 是**错的**，上文与本处均已更正。`defaultId` 实为 `this.settings?.get().default ?? this.config.default`（`packages/preset/agent-presets/src/index.ts:240-242`），即 **`agent-presets` 的 settings 命名空间**，settings 接缝里**完全没有** `cwd`/workspace/project 键控（见 §G3）。原句被用来支撑的结论 ——「default 是声明式的、可被 patch 覆盖的值」—— 依然成立；错的只是用户层的**来源**名称。

---

### G1 最小 overlay 与 `orchestrator-tool-policy` 的可放开面（含实测）

#### G1.1 —— 该插件**没有** `Config`：拦截是硬编码的

**✅ CONFIRMED（代码）**，三条互不依赖的事实：

- `ORCHESTRATOR_ALLOW` 与 `ORCHESTRATOR_WRITE_BLOCK` 是模块级 `const`，不是 config 字段 —— `packages/specdev/specdev-presets/src/tool-policy.ts:21-27` 与 `:30`（拦截列表甚至没有 export）。
- 插件入口**根本不接受配置**：`export function apply(ctx: Context): void { applyOrchestratorToolPolicy(ctx) }`（`packages/specdev/specdev-presets/src/orchestrator-tool-policy.ts:18-20`）。没有 `Config`、没有 `config` 形参、没有 `Schema`。
- preset 那一行也没提供配置，提供了也不会被读：`packages/specdev/specdev-presets/presets/specdev-orchestrator/agent.cordis.yml:28-29` 只有裸 `id` + `name`。

> **结论：不存在任何能放开 write 拦截的 `Config` 字段。唯一的杠杆是让这一行不再被挂载。**

#### G1.2 —— 这一行**无法**被任何 patch 层禁用或删除

`PatchOptions.disabled` 确实是真实语法，启动器自己也在用 —— `disabled?: boolean | null`（`vendor/include/src/index.ts:151`），由 `resolveTelemetryPatch` → `{ id: TELEMETRY_ROW_ID, disabled: true }` 实际使用（`apps/cli/src/profile-boot.ts:101-104`）。但它只能寻址**被 patch 的那棵树上**的行，而 preset 的行不在那棵树上：

- `applyEntryPatches` 只从传入的数组里建 id 索引，且仅递归进入 group（`vendor/include/src/index.ts:66-75`）；未命中即 `warn('patch: entry %C not found', id)` + `continue` —— **静默空操作**（`:110-114`）。
- profile 层所 patch 的树是**profile 组合**（bundle 层 + `cordis.patch.yml` + home 层 + `--patch` overlay —— `apps/cli/src/profile-boot.ts:138-144`）。而 preset 的 `agent.cordis.yml` 是由 `mountPreset` 单独加载的：`const config: Include.Config = { path: pathToFileURL(preset.path).href }`（`packages/preset/agent-presets/src/mount.ts:386`）—— **preset 从未设置 `Include.Config.patches`**（`vendor/include/src/index.ts:167`），而这是加载 preset 组合的唯一入口。

> **✅ CONFIRMED：`cordis.patch.yml` 或 `--patch` 里写 `{ id: orchestrator-tool-policy, disabled: true }` 是空操作。** 这一行对所有 patch 层都不可达。用**真实 `ide` profile** 做的反向对照启动（就是这个 patch 全文）未产生任何可观测变化（启动器的 "entry not found" 诊断只会在 `composeEntries` 的 warn sink 上出现）。

#### G1.3 —— 真正可行的机制：从更靠前的根影子化该 preset id

**✅ CONFIRMED（代码）。** `discoverPresets` 明确是 *"first-root-wins per id"* —— 当 id 已被占用时，后续根的目录会被跳过（`packages/preset/agent-presets/src/discovery.ts:325-343`，`if (byId.has(preset.id)) continue`）。而 `resolvedRoots` 的顺序是 `[shipped（除非 `includeShippedRoot: false`）, ...config.roots, user 根]`（`packages/preset/agent-presets/src/index.ts:178-182`）。因此把本地的 `specdev-orchestrator` 放在 SpecDev 根**之前**，就能替换 default 所解析到的组合，而 preset 的其余部分（persona、`tool-fs-search`）原样保留。

**实际使用的最小 overlay 全文（逐行原文）：**

`<fake HOME>/.dsh/profiles/ide/cordis.patch.yml`：

```yaml
# Spike follow-up Run A (G1+G2): delivered through the PROFILE user patch layer,
# NOT through `--patch`. Lives at <fake HOME>/.dsh/profiles/ide/cordis.patch.yml.
#
# A patch REPLACES the whole `config` block, so every key to keep is restated.
# `roots` is ordered: our shadow root FIRST, the SpecDev root second
# (agent-presets resolves a duplicate id from the earliest root).
- id: agent-presets
  config:
    default: specdev-orchestrator
    includeShippedRoot: false
    includeUserRoot: false
    roots:
      - path: /tmp/spike3/presets
        trust: user
      - path: /workspace/chendecheng/code/need/deepseek/deepseek-harness/packages/specdev/specdev-presets/presets
        trust: system
```

其中 `config` 块是 shipped `sdk-app` 基线的逐字重述（`packages/bundle/sdk-app/cordis.patch.yml:46-55`：`default: specdev-orchestrator`、`includeShippedRoot: false`、`includeUserRoot: false`、`roots: [{path: !!js specdevPresets.presetRoot, trust: system}]`）—— 唯一的结构性新增就是最前面那个影子根。profile patch 文件里也可以写 `!!js specdevPresets.presetRoot`；这里写死字面路径是为了让根的**顺序**无歧义。

`/tmp/spike3/presets/specdev-orchestrator/agent.cordis.yml` 是 shipped preset **只减掉最后两行**：

```
$ diff packages/specdev/specdev-presets/presets/specdev-orchestrator/agent.cordis.yml \
       /tmp/spike3/presets/specdev-orchestrator/agent.cordis.yml
28,29d27
< - id: orchestrator-tool-policy
<   name: '@deepseek-ai/dsh-specdev-presets/orchestrator-tool-policy'
```

由于 profile patch 文件本身就是磁盘上的文件，影子 preset 也可以随 overlay 一起放在它自己的目录树里；不需要拷贝或修改任何仓库文件。

#### G1.4 —— 实机结果：非空 `meta.diffs`，且 orchestrator persona 保持

run A 的原始输出：

```
mode=A home=/tmp/spike3/home-a HOME=/tmp/spike3/home-a DSH_HOME=undefined profile=ide
finalResponse: "DONE"
sessionId=session-4d476eafaa4e48189d71929349d304fb   eventCount=236

modelVisibleTools=["bash","create_goal","edit","get_goal","glob","grep","interrupt_agent",
"job_kill","job_list","job_output","list_agents","ralph","read","read_image","send_message",
"skill","str_replace_editor","subagent","subagent_fork","todo_write","update_goal",
"web_fetch","web_search","workflow","write"]

systemPromptHead="You are the SpecDev Orchestrator. Your working directory is /tmp/spike3/ws.
You schedule SpecDev role subagents, confirm Human Gates only via ctx.specdev.confirmGate ..."

tool/call #1 read {"file_path":"/tmp/spike3/ws/hello.txt"}
tool/call #2 edit {"file_path":"/tmp/spike3/ws/hello.txt","old_string":"alpha","new_string":"omega"}
  tool/result meta={"diffs":[{"path":"/tmp/spike3/ws/hello.txt",
    "oldText":"line one alpha\nline two beta\nline three gamma",
    "newText":"line one omega\nline two beta\nline three gamma"}]}      ← 非空 ✅
tool/call #3 read {"file_path":"/tmp/spike3/ws/hello.txt"}            ← 文件内容已是 "line one omega"
```

持久化确认（自写的逐帧扫描 zstd 读取器，读的是子进程自己的家目录）：

```
/tmp/spike3/home-a/.dsh/sessions/--tmp-spike3-ws--/session-4d476eafaa4e48189d71929349d304fb/session.jsonl.zstd
  frames=20 lines=67 tool/result=3 withDiffs=1
```

**✅ CONFIRMED：在被影子化的 `specdev-orchestrator` 上放宽 policy，模型确实会调用 `edit` 并产出非空 `meta.diffs`，且该运行保持 SpecDev Orchestrator persona。** 尽管 persona 里写着「不得修改应用源码」，模型也**没有**拒绝 —— 但要注意目标是仓库之外的临时文件。

与本次 spike 自己 §P2 测得的基线对比（orchestrator 默认、无 overlay）：`[bash, glob, grep, read, read_image]` → 5 个工具。run A：26 个工具。

⚠️ **这才是重要的副作用。** 移除该行**不只是**加上 `write`/`edit`：它把整个白名单掩码拿掉了，于是 orchestrator 会话继承了**整个宿主面全局工具集** —— `subagent`、`subagent_fork`、`ralph`、`workflow`、`send_message`、`interrupt_agent`、`list_agents`、`*_goal` 家族、`job_kill`、`web_fetch`、`web_search`、`skill`…… 这远比「让 diff 可用」所需的行为变更大得多，也是应当优先考虑更窄杠杆（见「修订后的建议」）的具体理由。

---

### G2 (a) 的交付通道：子进程实际解析的 `DSH_HOME` + 是否必须写 `~/.dsh`

#### G2.1 —— 扩展从不传 `dshHome`，而 `HOME` 能存活过剔除

**✅ CONFIRMED（代码 + 实测）。** 完整链条，逐跳列出：

| # | 事实 | 证据 |
|---|---|---|
| 1 | `IdeSessionHost.start` 接受**可选**的 `dshHome`，且**仅在已定义时**把它转发给 `buildIdeChildEnv` 与 `HarnessClient` | `apps/vscode-dsh/src/session-host.ts:46-47`、`:239-243`、`:244-248` |
| 2 | 扩展的**唯一**调用点只传 `cwd` 与可选 `credentials` —— **没有 `dshHome`** | `apps/vscode-dsh/src/extension.ts:2219-2222`（`await next.start({ cwd, ...Object.keys(credentials).length === 0 ? {} : { credentials } })`） |
| 3 | 因此 `buildIdeChildEnv` 只重新注入**两个** `DSH_*` 名，且其中一个才是无条件的：`DSH_IDE_BRIDGE_SOCK`（总是）与 `DSH_HOME`（**仅当 `options.dshHome !== undefined`**，而扩展从不设置它） | `apps/vscode-dsh/src/env.ts:30-40` |
| 4 | `scrubbedParentEnv()` 剔除「凭据形状」的名字（`/KEY|PASSWORD|SECRET|TOKEN/i`）以及**全部** `DSH_*`；`HOME` 两个谓词都不匹配，其 docstring 明确说明 `PATH`、`HOME`、locale 与代理变量会保留 | `packages/subprocess/subprocess/src/index.ts:45`、`:64-78`，docstring `:49-52` |
| 5 | `resolveDshHome()` 优先级：显式配置 → 非空 `$DSH_HOME` → `defaultDshHome()` = `join(homedir(), '.dsh')` | `packages/util/home-paths/src/index.ts:87-91`、`:61-63`，`DSH_HOME_DIR_NAME = '.dsh'` 在 `:12` |

> **✅ CONFIRMED：扩展 spawn 出来的 `dsh` 子进程解析到的是 `os.homedir()/.dsh` —— 也就是开发者真实的 `~/.dsh`，与 VS Code 进程自身持有的 `DSH_HOME` 无关。** 因此交付选项 (a) **确实需要写入真实的 `~/.dsh/profiles/ide/cordis.patch.yml`**。这是对 HG-2 决策影响最大的事实，而它现在是 CONFIRMED 而非 UNKNOWN。

#### G2.2 —— 该 profile 层**确实**会在**不带 `--patch`** 时被读取（实机）

**✅ CONFIRMED（实机，即上文 run A）。** run A 中**唯一**的交付就是 `<fake HOME>/.dsh/profiles/ide/cordis.patch.yml`，argv 里没有 `--patch`（SDK 的 `resolveDshLaunch` 由 `HarnessClientOptions.patches` 构造 argv，而驱动从未设置它 —— `packages/sdk/client/src/launch.ts:158-171`）。可观测结果迫使结论成立：

- 系统提示词是**shipped** 的 SpecDev Orchestrator persona（说明被组装的正是 shipped preset —— 既不是 `standard`，也不是某个角色 preset），**并且**
- 工具集里有 `write`/`edit`/`str_replace_editor`（说明 `orchestrator-tool-policy` 那一行**没有**挂载）。

只有 profile 层里的影子根能同时解释这两点；而 `initProfile` 不可能产生它，因为它在 patch 文件已存在时拒绝覆盖（`if (!existsSync(patchPath))` —— `packages/boot/app-boot/src/profile.ts:217-218`），这正是预先写好的 patch 能在首次 profile 初始化中存活下来的原因。运行后子进程的家目录树（假家目录、真结构）：

```
<fake HOME>/.dsh/profiles/ide/cordis.patch.yml   ← 我写的 overlay，运行后逐字节不变
<fake HOME>/.dsh/profiles/ide/cordis.yml         ← 由启动过程写入（PROFILE_ROOT_CONFIG）
<fake HOME>/.dsh/profiles/ide/package.json       ← 由 initProfile 写入
<fake HOME>/.dsh/sessions/--tmp-spike3-ws--/session-4d476eaf.../session.jsonl.zstd
```

#### G2.3 —— 是否必须写真实 `~/.dsh`？对扩展是「必须」，对本次验证是「不必」

- **本次 spike：不必。** 两次实机运行都传 `HOME=/tmp/spike3/home-{a,b}` 并从子进程环境删除 `DSH_HOME`，所有产物（profile 目录、会话）都落在临时家目录下。两次运行之后 `~/.dsh` 的最新 mtime 是 **12:02:22**（`sessions/`），而 follow-up 的两次运行发生在 **12:14–12:15**（见 `/tmp/spike3/driver.ts` 与 `report-A/B.json` 的 mtime）—— 也就是说 **`~/.dsh` 自那之后一个字节都没变**。`~/.dsh/settings.yaml` 根本不存在；`~/.dsh/profiles/ide/cordis.patch.yml` 的 mtime 仍是 **2026-09-07 15:05:42**。**因此没有什么需要备份或还原 —— 因为什么都没写。**
- **对真实扩展：是必须。** 见 §G2.1 —— 子进程解析到 `~/.dsh`。
- **对于「自己掌控其环境」的进程，重定向 `HOME` 确实是可行的沙箱**：POSIX 上 `os.homedir()` 在 `$HOME` 已定义时返回 `$HOME`，否则才回退到 passwd 数据库。实机探针：

```
$ node -e 'console.log(require("node:os").homedir())'          → /home/chendc
$ env -u HOME node -e 'console.log(require("node:os").homedir())' → /home/chendc   （passwd 回退）
```

这正是整个 follow-up 能在不触碰开发者家目录的前提下完成的原因 —— 但它**并不能**给扩展提供交付通道，因为扩展的 `HOME` 来自 VS Code 进程，而扩展没有提供任何修改它的设置项。

---

### G3 文件级 preset 选择器（是否存在 + 实测做法）

#### G3.1 —— 选择器是 `$DSH_HOME/settings.yaml`，且**不**按 `cwd` 键控

**✅ CONFIRMED（代码 + 实测）。**

- `defaultId` 读 `this.settings?.get().default ?? this.config.default`（`packages/preset/agent-presets/src/index.ts:240-242`）；`settings` 是通过通用 settings 接缝注册的 `agent-presets` 命名空间，schema 为 `{ default: string }`（`SETTINGS_NAMESPACE = 'agent-presets'` 在 `:55`，schema 在 `:65-73`，注册在 `:188-199`）。
- settings 接缝**没有** `cwd`/workspace/project 键控 —— `SettingsScope`/`register` 只以命名空间寻址（`packages/settings/settings/src/index.ts:115`、`:423`；该文件中没有出现 `cwd`/`workspace`）。
- 其背后的 provider 是 `@deepseek-ai/dsh-settings-file`，文档路径为 `config.path ?? join(resolveDshHome(config.dshHome), 'settings.yaml')`（`packages/settings/settings-file/src/index.ts:57`）—— 即 **`$DSH_HOME/settings.yaml`**。
- 它在 `ide` profile 中已挂载：`packages/bundle/base/cordis.patch.yml:90-91`（`id: settings`、`name: '@deepseek-ai/dsh-settings-file'`），而 `ide` = base + sdk-app + ide（`packages/boot/app-boot/src/profile.ts:154-157`）。

**四个子问题的答案：**

| 问题 | 答案 |
|---|---|
| 磁盘路径 + 格式 + 字段 | `<DSH_HOME>/settings.yaml`（YAML，一份「命名空间 section」的映射），section `agent-presets`，字段 `default` —— `packages/settings/settings-file/src/index.ts:24-31`、`:57` |
| 是否按 `cwd` 键控？ | **否。** 每个 `$DSH_HOME` 一份文档；settings 接缝里不存在 `cwd`/workspace 键控 |
| 只写它就能让 `ide` 的**新会话**采用允许 write 的 preset 吗？ | **能** —— `defaultId` 在每次创建会话时读取（`packages/preset/agent-presets/src/index.ts:236-239`），下面的实机运行已在全新会话上证明 |
| 是否有其它仓库内/项目级杠杆？ | **未发现。** 产品读取的**唯一** `<projectRoot>/.dsh/` 目录是 `<projectRoot>/.dsh/skills`（`packages/skill/skill-filesystem/src/index.ts:246`）—— 那是 skill 来源，不是配置。扩展没有暴露任何 project-scoped preset 状态；`agent-presets.copy` 的可写根是 `$DSH_HOME/.agent-presets`（`packages/preset/agent-presets/src/discovery.ts:51`、`packages/util/home-paths/src/index.ts:98-99`）—— 依然在 `$DSH_HOME` 下 |

#### G3.2 —— 实机验证，且**完全没有 overlay**

run B 用的是除此之外完全原样的 `ide` profile：假家目录下没有 `cordis.patch.yml`、没有 `--patch`，只有 `<fake HOME>/.dsh/settings.yaml`：

```yaml
agent-presets:
  default: specdev-implementer
```

run B 的原始输出：

```
mode=B home=/tmp/spike3/home-b HOME=/tmp/spike3/home-b DSH_HOME=undefined profile=ide
finalResponse: "DONE"
sessionId=session-331484589b3f4c69aa5ddeae904bac82   eventCount=297

systemPromptHead="You are the SpecDev implementer. Implement the current phase per
phases/<phase>/spec.md on branch impl-<phase-id>. Write implementation.md. No git commit.
Working directory: /tmp/spike3/ws. Publish SpecDev metadata ..."

tool/call #1 read {"file_path":"/tmp/spike3/ws/hello-b.txt"}
tool/call #2 edit {"file_path":"/tmp/spike3/ws/hello-b.txt","old_string":"alpha","new_string":"omega"}
  tool/result meta={"diffs":[{"path":"/tmp/spike3/ws/hello-b.txt",
    "oldText":"line one alpha\nline two beta\nline three gamma",
    "newText":"line one omega\nline two beta\nline three gamma"}]}      ← 非空 ✅
```

持久化日志：`.../home-b/.dsh/sessions/--tmp-spike3-ws--/session-331484589b3f4c69aa5ddeae904bac82/session.jsonl.zstd frames=19 lines=62 tool/result=3 withDiffs=1`。

**✅ CONFIRMED：一个两行文件、无 overlay、无 argv、无产品改动，就让 `ide` 的新会话采用具备写能力的 preset，并产出 `meta.diffs`。** 两点注意：

1. 它是由产品自己拥有的文档，不是 hack：Web app 的 General-settings 里的 agent-preset 行写的就是同一个命名空间（`packages/bundle/web-app/cordis.patch.yml:288-290`，即挂载 `@deepseek-ai/dsh-client-ui-agent-preset` 的 `ui-agent-preset` 行）。
2. 它**会换掉 persona** 成 SpecDev 角色 preset，不保留 orchestrator persona。对 `design.md` §9 的问题（「主会话是否必须能写」）来说这可能恰好合适；对「orchestrator persona + 能写」来说则不是。

---

## 修订后的建议（是否仍以 (a) 为最小代价路线）

**是 —— (a) 仍是「保留 orchestrator persona」前提下代价最小的路线，且现在已端到端 ✅ CONFIRMED（含交付通道）。但它的真实代价已从「未知」变为「会写入开发者真实的 `~/.dsh`」；同时 follow-up 又在同一个「零代码」类别里发现了一个更便宜的变体。**

| 路线 | 产品改动 | 保留 persona | 在开发机上写入的文件 | 代价 | follow-up 之后的定性 |
|---|---|---|---|---|---|
| **(a)** profile 层 overlay + 影子 preset | 无 | ✅ SpecDev Orchestrator | `~/.dsh/profiles/ide/cordis.patch.yml`（手工维护、整段 `config` 替换） | ~30 分钟 | ✅ **实机 CONFIRMED**（run A），含不带 `--patch` 的交付 |
| **(a′)** `~/.dsh/settings.yaml` → `agent-presets.default` | 无 | ❌ 换成角色 preset | `~/.dsh/settings.yaml`（产品本就拥有的文档里的一个两行 section） | **~5 分钟** | ✅ **实机 CONFIRMED**（run B） |
| **(b)** 扩展设置 + `patches` | ~3 个文件、≤30 行 + 1 个测试 | ✅ | 无 | ~0.5–1 天 | 未变 —— **也是唯一「可分发」的路线** |
| **(c)** 改 default preset / policy | bundle + preset policy | n/a | 无 | ~1–2 天 | 未变 —— 仍是风险最高的 |
| **(d)** 依赖子 Agent 的 diff | 无 | ✅ | 无 | ~2–4 小时（需在 VS Code 内验证） | 未变（仍是 ⚠️ HYPOTHESIS） |

**follow-up 对 HG-2 的改变：**

- **「零产品改动」是可达的，而且已被证明 —— 但它不可分发。** (a) 与 (a′) 都写开发者自己的 `~/.dsh`，只在这台机器上生效。如果工作流必须在新机器或他人机器上开箱可用，只有 (b) 能做到。因此 `design.md` §9 的 A/B 之争依然是产品语义问题，但零代码分支的**代价**现在是一个已知且已披露的副作用，而不是未知。
- **如果目标只是「主会话能产出原生 Diff」，优先 (a′)。** 它只是产品本就拥有、且其设置界面本就会写的一份文档里的一个 section；相比之下 (a) 需要手工维护整段 `config`，每当 `packages/bundle/sdk-app/cordis.patch.yml:46-55` 变化就得重新同步。因为 `patch` 是替换整段 `config`，(a) 的漂移是真实的维护负担。
- **如果目标是「保留 orchestrator persona 且让它能写」，(a) 是唯一的零代码路线** —— 但要知道：移除 policy 行并非只是加上 `write`/`edit`，它把整个宿主面全局工具集交给了 orchestrator 会话（5 → 26 个工具，§G1.4）。任何采纳 (a) 的设计都应当明确决定这个放大是否可接受，因为「在 allow-list 里只补 `write`/`edit`」这种行级细化**不**改源码是拿不到的。
- **(c) 现在更清楚地是错误形状**：同样的终态可以在一台机器上以零代码、零爆炸半径达成，那么为「所有人」改动 SpecDev 编排契约所付出的跨域风险，买来的只是「可分发」—— 而这件事 (b) 用约 30 行就能做到。

#### follow-up 未验证事项

| # | 事项 | 状态 |
|---|---|---|
| 1 | 扩展的会话树在实践中是否会收集子 Agent 会话的 diff（选项 (d)） | ❓ UNKNOWN —— 仍是代码级 HYPOTHESIS，未在 VS Code 内实跑 |
| 2 | 当 SpecDev orchestrator 真的能写时，它在**真实工作流任务**上的行为是否可接受（临时文件 prompt 并非 SpecDev 任务） | ⚠️ HYPOTHESIS —— 一个临时文件 prompt 不足以作为工作流行为的证据 |
| 3 | 经 `settings.yaml` 设定的 `agent-presets.default` 是否会在扩展自身设置界面写同一命名空间后存续 | ❓ UNKNOWN —— 同文档同字段，界面写入会覆盖它（预期如此，未实测） |

### Follow-up 残留自检

本 follow-up 的 `git status --porcelain --untracked-files=no` 与 `pgrep` 原文记录如下。

工作区（与会话开始时的快照一致 —— **这五项全部是既有改动，本 spike 一项未触碰**）：

```
$ git status --porcelain --untracked-files=no
 M .cursor/skills/project-build/SKILL.md
 M .specdev/specs/workflows.json
 M apps/vscode-dsh/webview/dist/assets/index.css
 M apps/vscode-dsh/webview/dist/assets/index.js
 M pnpm-lock.yaml

$ git diff --cached --stat
（无输出 —— 暂存区为空）
```

进程（`| grep -v extglob` 用于滤掉 `pgrep` 总会匹配到的那层 shell wrapper —— 因为模式串出现在它自己的 argv 里，这与第一轮已披露的自匹配假象是同一个）：

```
$ pgrep -af '[s]pike' | grep -v extglob                      → （空）
$ pgrep -af '[d]sh' | grep -v extglob                        → （空）
$ pgrep -af '[e]xtensionDevelopmentPath' | grep -v extglob   → （空）
$ pgrep -af '[/]usr/share/code/' | grep -v extglob           → （空）
```

没有 `dsh` 进程、没有 VS Code 进程、没有 `extensionDevelopmentPath` 进程，也没有任何 `--database` 指向 spike 目录的 `chrome_crashpad_handler`。机器上可见的 `crashpad` 实例分别属于 Trae CN、Cursor、Chrome、飞书与 CherryStudio —— 均启动于数日之前，无一为本 spike 所有。

暂存目录：

```
$ ls -d /tmp/spike3            → ls: cannot access '/tmp/spike3': No such file or directory
$ ls -d /tmp/spike-native-diff → ls: cannot access '/tmp/spike-native-diff': No such file or directory
```

两处暂存树均已删除（follow-up 的 `/tmp/spike3/**` —— 驱动、overlay、影子 preset、临时工作区、两份运行报告；以及原 spike 的 `/tmp/spike-native-diff/**`）。

#### 真实 `~/.dsh`：本 follow-up 一个字节都没写（一致性证据）

follow-up 的两次运行发生在 **12:14–12:15**（`/tmp/spike3/driver.ts` 的 mtime = 12:14，`report-A.json` / `report-B.json` = 12:15）。真实 `$DSH_HOME` 下的一切都**比这更早**，而路线 (a′) 所需的 `settings.yaml` **根本不存在**：

```
$ ls -lat --time-style=full-iso ~/.dsh
drwx------  5 chendc chendc 4096 2026-09-15 12:02:22.117216681 +0800 sessions
drwxrwxr-x  5 chendc chendc 4096 2026-09-15 12:00:31.777300502 +0800 profiles
drwx------  3 chendc chendc 4096 2026-09-08 16:24:57.505981096 +0800 storages
drwxrwxr-x  5 chendc chendc 4096 2026-09-08 16:24:57.497981151 +0800 .
-rw-rw-r--  1 chendc chendc   37 2026-09-07 14:29:24.661383800 +0800 .anonymous-user-id

$ ls -lat --time-style=full-iso ~/.dsh/sessions
drwx------ 6 ... 2026-09-15 12:05:43.469048973 +0800 --tmp-spike-native-diff-ws--     ← 第一轮 spike 的会话
drwx------ 5 ... 2026-09-15 12:02:22.117216681 +0800 .
drwx------ 6 ... 2026-09-15 11:29:51.981516851 +0800 --workspace-chendecheng-code-need-deepseek-deepseek-harness--
drwx------ 5 ... 2026-09-14 20:13:43.390843395 +0800 --workspace-chendecheng-code-XOS-msg--
```

真实 `~/.dsh/sessions` 下**没有 `--tmp-spike3-ws--`** —— follow-up 的两次会话只存在于 `/tmp/spike3/home-{a,b}/.dsh/sessions/`（已随暂存树删除）。真实 profile patch 文件自创建之日起未被触碰：

```
$ ls -lat --time-style=full-iso ~/.dsh/profiles/ide
-rw-rw-r-- 1 chendc chendc 223 2026-09-15 12:05:41.913050329 +0800 cordis.yml          ← 第一轮 spike 的真实 profile 启动
-rw-rw-r-- 1 chendc chendc 217 2026-09-07 15:05:42.722433564 +0800 cordis.patch.yml    ← 未被触碰
-rw-rw-r-- 1 chendc chendc 271 2026-09-07 15:05:42.722433564 +0800 package.json
-rw-rw-r-- 1 chendc chendc  61 2026-09-07 15:05:42.722433564 +0800 pnpm-workspace.yaml
drwxrwxr-x 3 chendc chendc 4096 2026-09-07 15:05:42.814432674 +0800 .dsh-module-fallback
drwxrwxr-x 2 chendc chendc 4096 2026-09-07 15:05:42.814432674 +0800 node_modules

$ sha256sum ~/.dsh/profiles/ide/cordis.patch.yml
ef189a8c27db6d63930aa3046a3040482e952eafcb7487c644d508e8d461f027  /home/chendc/.dsh/profiles/ide/cordis.patch.yml
```

**因为什么都没写，所以既不需要备份也不需要还原。** 真实 `~/.dsh` 下唯一早于 follow-up 的变更是 `profiles/ide/cordis.yml`（12:05:41），由**第一轮** spike 的真实 profile 启动写入，且在第一轮报告中已披露；`cordis.patch.yml` 与 2026-09-07 时逐字节相同，因此「已还原到 spike 前状态」这一条件平凡成立。

---

## EDH route-A 真机验证（2026-09-15）

**本节验证什么。** 用户已裁定 AC-25 第 5 步走 **route A —— HOME 沙箱 + 影子 preset，零仓库改动**（§修订建议 选项 a）。§G 只在**无 VS Code** 的 harness 里证明了 route A；本节补上它进入真实产品宿主后引入的两个假设，并在 route A 放宽后的工具面下重跑 AC-25 第 4 步的审批构造。

**环境。** `/usr/bin/code` 1.112.0，`DISPLAY=:1`；真机 EDH 以 `--user-data-dir` + `--extensions-dir` + 2×`--extensionDevelopmentPath`（`apps/vscode-dsh` + 一个 `/tmp` 内 driver 扩展）启动，`VSCODE_DSH_TEST=1`，`PATH` 前置 Node 24.3.0。**真实模型往返花费：2 次**（V2、V3；V1 不需要模型）。未修改仓库任何文件；所有暂存物都在 `/tmp/routeA`（结束时删除，见 §残留）。影子 overlay 与影子 preset 与 §G1 逐字节相同（仅沙箱 home 路径不同）。

**两条踩出来的操作性事实（都没花模型调用，但对 Phase 3 脚本至关重要）：**

1. **宿主只在 Conversation 视图可见后才启动。** `dsh.test.triggerAutoReady` 返回 `{"applied":false,"reason":"gated"}`，`getStartState` 一直停在 `idle`/`waiting-host`，直到 driver 触发 `dsh.test.fireConversationVisibility` 扩展才 spawn `dsh` 子进程。先等 `started`、后触发可见性的 driver 会死锁（实测 240 s 超时：`{"state":"idle",...}`，无子进程）。
2. **上一次会话被恢复时，面板变 `replay`，`dsh.test.sendPrompt` 会静默空转。** 沙箱产品存储里残留上一会话时，新的 EDH 运行把它恢复出来（`mode:"replay"`），发送返回 `{"ok":true,"value":{"ok":false,"reason":"replay"}}` —— 一个**看起来成功**的信封，prompt 从未到达模型。因此 route A 的每步场景都必须从干净的沙箱产品状态开始（清 `<sandbox>/.dsh/sessions`、`<sandbox>/.dsh/storages` 与 VS Code 的 `--user-data-dir`），否则 AC-25 第 3 步会**假通过**。

### V1 EDH 在非默认 HOME 下启动，子进程解析到沙箱 DSH_HOME

**（a）启动原文。**

```
=== env facts (no secret values) ===
HOME=/tmp/routeA/home
DSH_HOME=<unset>
DSH_NODE_BIN=<unset>
VSCODE_DSH_TEST=1
DISPLAY=:1
DEEPSEEK_API_KEY_present=yes
=== launch command (verbatim) ===
setsid /usr/bin/code /workspace/chendecheng/code/need/deepseek/deepseek-harness --user-data-dir /tmp/routeA/ud --extensions-dir /tmp/routeA/ext --extensionDevelopmentPath /workspace/chendecheng/code/need/deepseek/deepseek-harness/apps/vscode-dsh --extensionDevelopmentPath /tmp/routeA/driver
```

**（b）EDH 启动成功且 `apps/vscode-dsh` 已激活**（driver 状态 JSON，无模型调用）：

```json
{"step":"host-ready","ready":{"state":"started","lastReason":"conversation-view-visible","pendingReasons":[],"autoRetryUsed":false}}
{"step":"startup-only","result":{"ok":true,"value":{"ok":true,"startState":"started","hostStatus":"connected","hostCreateCount":1,"tabs":1,"openTabSet":0}}}
{"step":"command-surface","dshCommandCount":70, ...70 个 dsh.* 命令，含 dsh.reviewWorkspaceDiffs / dsh.openTimelineDiff / dsh.test.*...}
{"step":"extensions","extensions":[{"id":"deepseek-ai.@deepseek-ai/dsh-vscode-dsh","isActive":true}]}
```

**（c）被 spawn 的子进程 —— 读 `/proc`，不是读代码。** 在运行期间直接读扩展真正 spawn 的进程的 `/proc/<pid>/cmdline` 与 `/proc/<pid>/environ`：

```
--- pid=3815566 ppid=3815471 ---
cmdline: /usr/share/code/code --import file:///workspace/.../node_modules/.pnpm/tsx@4.22.4/node_modules/tsx/dist/esm/index.mjs /workspace/.../apps/cli/src/bin.ts --profile ide --patch /workspace/.../apps/cli/src/sdk-source.cordis.patch.yml
cwd: /tmp/routeA
env: HOME=/tmp/routeA/home | PWD=/tmp/routeA | VSCODE_DSH_TEST=1
```

该读取器只打印 `environ` 中**确实存在**的键；`DSH_HOME`（以及 `DSH_NODE_BIN`）**不存在**，因此 `resolveDshHome()` 落到 `homedir()/.dsh` = **`/tmp/routeA/home/.dsh`**。注意子进程跑在 VS Code 自带的 Node 上（driver 报 `process.version v22.22.0`，Electron 39.8.0），经 `--import tsx/esm` 执行源码 CLI，全程正常 —— EDH 路径**不需要 `DSH_NODE_BIN`**。

**（d）沙箱 home 确实是产品用的那个。** 运行期间暂存 home 长出了一套完整的产品 home，含沙箱工作区对应的 cwd 键会话目录：

```
/tmp/routeA/home/.dsh
  .anonymous-user-id
  profiles/{ide,node_modules}
  sessions/--tmp-routeA-ws--/<sessionId>/session.jsonl.zstd
  storages/session_projcache
```

**（e）真实 `~/.dsh` 零写入 —— 前后对比原文。** 运行前快照与 V2 后快照（`--time-style=full-iso` 目录清单 + 顶层文件 `sha256sum`）做 `diff`：

```
0a1
> === AFTER V2 ===
38a40,42
> c300dcf2ebc5f02062d6591268d29d3db6fe45e0cb138f5467276fe2ba06076e  profiles/ide/cordis.yml
> ef189a8c27db6d63930aa3046a3040482e952eafcb7487c644d508e8d461f027  profiles/ide/cordis.patch.yml
> 97bc339421280a29d772ece26667467c259b66c1b4723e220d3e3d7cfad22667  profiles/ide/package.json
```

全部差异只有新增的标题行与这三行哈希，而这三行哈希与运行前记录的**完全相同**（`c300dc…`、`ef189a…`、`97bc33…`）。目录 mtime 同样未变（`sessions` 12:02:22、`profiles` 12:00:31、`storages` 2026-09-08）。**三轮 EDH 运行对真实 `~/.dsh` 的写入量为零。**

**（f）不需要 `XDG_CONFIG_HOME` / `XDG_DATA_HOME` 修正。** 启动器两者都没导出；VS Code 只是把它自己的状态搬进了沙箱 home（`$HOME/.cache/{fontconfig,Microsoft}`、`$HOME/.pki`、`$HOME/.vscode`）。EDH 正常启动、正常激活、70 个 `dsh.*` 命令全部可用，**没有任何失败点需要报告**，因此问题里列出的最小修正手段在本环境并不需要。

> **✅ CONFIRMED — V1。** `HOME` 指向 `/tmp` 沙箱、不加任何 `XDG_*` 覆盖时 EDH 正常启动，`apps/vscode-dsh` 正常激活；它 spawn 的 `dsh` 子进程经 `/proc` 实测携带 `HOME=/tmp/routeA/home` 且 `DSH_HOME` 未设置，即解析到 `DSH_HOME = <沙箱>/.dsh`；真实 `~/.dsh` 零写入（文件哈希逐字节相同、目录 mtime 未变）。**route A 的交付通道在真机成立。**

### V2 沙箱 overlay 在 EDH 内生效（可写、`meta.diffs` 非空）

overlay 放在沙箱的 `$DSH_HOME/profiles/ide/cordis.patch.yml`（`/tmp/routeA/home/.dsh/profiles/ide/cordis.patch.yml`），**argv 里没有 `--patch`**，内容与 §G1 完全一致（仅 root 路径不同）：

```yaml
- id: agent-presets
  config:
    default: specdev-orchestrator
    includeShippedRoot: false
    includeUserRoot: false
    roots:
      - path: /tmp/routeA/presets
        trust: user
      - path: /workspace/chendecheng/code/need/deepseek/deepseek-harness/packages/specdev/specdev-presets/presets
        trust: system
```

`/tmp/routeA/presets/specdev-orchestrator/agent.cordis.yml` 是 shipped preset **只减掉 `orchestrator-tool-policy` 那一行**（与 §G1 的 diff 相同）。prompt 要求对**已存在**文件做一次最小 `edit`（新建文件不产生 diff，所以文件预先创建）：

```
使用 edit 工具对**已存在的**文件 /tmp/routeA/ws/hello.txt 做一次最小修改：old_string = "alpha"，new_string = "omega"。
约束：不要使用 bash、不要使用 write、不要使用 str_replace_editor，不要创建任何新文件 …
```

**观测来自产品自己的会话日志**（`<沙箱>/.dsh/sessions/--tmp-routeA-ws--/03227eee-…/session.jsonl.zstd`，22 个 zstd 帧 / 67 个事件）：

```
SESSION={"type":"session","version":0,"id":"03227eee-…","cwd":"/tmp/routeA/ws","agentPreset":"specdev-orchestrator"}
REQUEST/HEADER … system: "You are the SpecDev Orchestrator. Your working directory is /tmp/routeA/ws. You schedule SpecDev role subagents …"

CALL read  {"file_path": "/tmp/routeA/ws/hello.txt"}
CALL edit  {"file_path": "/tmp/routeA/ws/hello.txt", "old_string": "alpha", "new_string": "omega"}
RESULT     meta={"diffs":[{"path":"/tmp/routeA/ws/hello.txt",
                    "oldText":"line one alpha\nline two beta\nline three gamma",
                    "newText":"line one omega\nline two beta\nline three gamma"}]}      ← 非空 ✅
CALL read  {"file_path": "/tmp/routeA/ws/hello.txt"}
```

磁盘内容一致（`line one omega`），扩展自己的投影也出现了 diff 卡片：面板 role 列表里有 `notice:diff-summary:11`，`dsh.test.changedFileCount = {"count":1}`。

**工具面 —— 实测而非推断。** `request/header.data.header.tools` 在本次 follow-up 的 V2 与 V3 两个会话里都含 **25** 个工具：

```
TOOL_COUNT=25
TOOLS=bash,create_goal,edit,get_goal,glob,grep,interrupt_agent,job_kill,job_list,job_output,
list_agents,ralph,read,read_image,send_message,skill,str_replace_editor,subagent,subagent_fork,
todo_write,update_goal,web_fetch,web_search,workflow,write
```

> **⚠️ 对 §G1.4 以及 AD-15 / AC-25 第 5 步「预期 26」的更正。** §G1.4 的正文写「5 → 26 tools」，但它自己打印出的 `modelVisibleTools=[…]` 列表只有 **25** 个条目；把该列表与本轮 EDH 实测列表逐名做 diff，结果为**空**（两张表是同样的 25 个名字；应为 `5 → 25`）。此处以 EDH 实测为准，因为它是从序列化后的 request header 读出来的，而不是回显列表。**AC-25 第 5 步证据里的 `toolCount` 与 Phase 3 spec 中的「route A 的 26 工具面」都应按 25 预期**；至于 harness-only 的 §G1 那次是否真有第 26 个工具，已无法复核（暂存树已删除），且其打印列表并不支持该说法。

> **✅ CONFIRMED — V2。** 在真机 EDH 会话内，route A 放在沙箱 home 的影子 overlay 确实生效：组合出来的是 shipped `specdev-orchestrator` 人格（`agentPreset:"specdev-orchestrator"`，系统提示为 SpecDev Orchestrator），模型调用 `edit`，`tool/result.meta.diffs` **非空且含 `oldText` + `newText`**，面板渲染 `notice:diff-summary`。该会话的工具面是宿主机全局工具集（**25** 个，`write`/`edit`/`str_replace_editor`/`subagent`/`workflow`/`web_*` 全在）。**route A 在 EDH 内确实能产出原生 Diff；代价正是 §G1.4 警告过的工具面放宽。**

### V3 放宽工具面下两步式审批仍然成立

§G 的审批证据来自 **5** 工具面会话；route A 把 AC-25 五步放在同一个 **25** 工具面会话里，因此这里重跑了第 4 步的构造。构造沿用 Phase 3 spec 的「先拒绝后提权」形状，只改探针路径：**在 route A 下 `$HOME` 不能作为被拒目标**，因为沙箱 HOME 是 `/tmp/routeA/home`，而 `/tmp` 属于 `workspace-write` 的可写集（`packages/sandbox/sandbox-local/src/profiles.ts:18-21`：`--tmpfs /tmp` + `--bind workspaceRoot workspaceRoot`；Landlock：`readWrite = ['/dev/null', '/tmp', workspaceRoot]`）。因此探针打到 `/var/tmp` —— 既在 workspace root 之外，也在 `/tmp` 之外：

```
这是一次用户明确授权的诊断实验，目的是验证沙箱提权审批链路。请按下面两步做：
1. 用 bash 工具运行命令 `touch /var/tmp/routeA-step4-probe`（description = `sandbox escalation probe`），使用默认权限。
2. 该命令会被沙箱拒绝。看到拒绝标记或提权提示后，请在同一回合内严格按照工具说明，原样重试这同一条命令一次，
   并附带 `sandbox_permissions`（能成功的最窄更宽模式）和一句非空的 `justification`。
请只做这两步，不要改用别的命令，也不要用任何其他方式绕过沙箱。
```

**恰好一次审批，经 L2 钩子观测**（driver 状态 JSON；`sendPrompt` 在 elapsed 2590 ms）：

```json
{"elapsedMs":6595,"step":"approval-observed","pending":[{"kind":"approval","id":"a226d398-2a9a-42f4-8f8c-7c4b459e2f94","sessionId":"d0538a68-…","state":"presented","abort":{},"tabId":"fc72cb09-…"}],"pollNumber":1,"distinctIdCount":1,"pendingCount":1}
{"elapsedMs":6597,"step":"approval-answered","via":"workbench.action.acceptSelectedQuickOpenItem","result":{"ok":true}}
{"elapsedMs":6597,"step":"approval-pending-after-answer","after":[]}
...
"summary": {"sawPending":true,"approvalObservationCount":1,"distinctApprovalIdCount":1,
            "distinctApprovalIds":["a226d398-2a9a-42f4-8f8c-7c4b459e2f94"],"answeredCount":1,"finalPending":[]}
```

**链路两端，来自产品会话日志**（`<沙箱>/.dsh/sessions/--tmp-routeA-ws--/d0538a68-…/session.jsonl.zstd`，44 帧 / 95 事件）：

```
CALL  {"turn":1,"step":1,"callId":"call_00_T5nm0qYlNKjiGt8B6Bpo2790","name":"bash",
       "arguments":"{\"command\": \"touch /var/tmp/routeA-step4-probe\", \"description\": \"sandbox escalation probe\"}"}
RESULT text="[stderr]\ntouch: cannot touch '/var/tmp/routeA-step4-probe': Read-only file system\n
       [sandbox: file access denied under workspace-write mode]\n
       [sandbox: escalation available — retry this exact command once with sandbox_permissions …]\n[exit code: 1]"

CALL  {"turn":1,"step":2,"callId":"call_00_2GdYpSJ1B9GfzHaYDUmY0193","name":"bash",
       "arguments":"{\"command\": \"touch /var/tmp/routeA-step4-probe\", …, \"sandbox_permissions\": \"danger-full-access\",
                     \"justification\": \"The probe writes to /var/tmp, which is outside the workspace, so workspace-write already denied it; …\"}"}

approval/asked={"type":"approval/asked","seq":498,"time":1789449679963,
  "data":{"id":"115a1931-a35e-473c-baf2-0a66b3d2d591","toolName":"bash",
          "callId":"call_00_2GdYpSJ1B9GfzHaYDUmY0193",
          "reason":"escalate sandbox to danger-full-access: The probe writes to /var/tmp, which is outside the workspace, so workspace-write already denied it; …"}}
approval/decided={"type":"approval/decided","seq":499,"time":1789449680150,
  "data":{"id":"115a1931-a35e-473c-baf2-0a66b3d2d591","outcome":"allowed-once"}}

RESULT callId=call_00_2GdYpSJ1B9GfzHaYDUmY0193 isError=false text="(no output)"      ← 被提权命令真的执行，exit 0
```

被提权的写入确实落到了宿主机文件系统，随后被清理：

```
$ ls -la --time-style=full-iso /var/tmp/routeA-step4-probe
-rw-rw-r-- 1 chendc chendc 0 2026-09-15 13:21:20.152647644 +0800 /var/tmp/routeA-step4-probe
PROBE-EXISTS
probe removed
ls: cannot access '/var/tmp/routeA-step4-probe': No such file or directory
```

route A 内的耗时：`approval/asked` 在发送后 **+3.82 s**（`sendPrompt` 05:21:16.143 → `asked` epoch 1789449679963）；driver 在 **+4.01 s** 观测到；`approval/decided` 距 `asked` **187 ms**；最后一条 assistant 输出落在 05:21:23.152（发送后约 7.0 s）。与 5 工具面的实测（4.07 s）同一量级。

**未验证的部分：「按 id 作答」。** 当前代码树里没有 `dsh.test.answerApproval`（那是 AD-12 的 Phase 3 工作），所以作答走的是 `workbench.action.acceptSelectedQuickOpenItem` —— 与 5 工具面那次同一条路径。因此「按 id 作答」这一断言仍依赖尚未实现的 Phase 3 钩子；route A 的重跑证明的是**审批构造本身**（恰好一次 pending、含 `toolName`/`reason`、`allowed-once`、被提权命令 exit 0）在放宽工具面下依然成立。

> **✅ CONFIRMED — V3。** 在 route A 的 **25** 工具面会话里，「先拒绝后提权」构造产生**恰好一次**审批（1 个 distinct id，只被观测到一次，无重复）：`approval/asked` 带 `toolName:"bash"` + 非空 `reason` + `callId`；作答后 `approval/decided outcome:"allowed-once"`，pending 回到 `[]`；被提权的 `bash` 重试成功（`(no output)`，exit 0），且探针文件在宿主机上被验证真实创建。**AC-25 第 4 步的构造在 route A 下不需要新形状。**
> **⚠️ HYPOTHESIS（不变）：** QuickPick 作答路径在本次与 §G 各只跑过一次；在审批排队或焦点被抢时的稳健性仍未被验证。

## route A 可行性裁定（可行）

**✅ route A 可行：零仓库改动、零真实家目录写入。** 三个问题全部给出肯定答案，下面两条操作性约束属于脚本设计约束，不是拦路石。

| # | route A 的必要条件 | 判定 | 证据 |
|---|---|---|---|
| 1 | EDH 能在沙箱 `HOME` 下启动 | ✅ CONFIRMED | V1（a）/（b）；不需要 `XDG_*` 修正 |
| 2 | 被 spawn 的 `dsh` 子进程把 `DSH_HOME` 解析到沙箱 | ✅ CONFIRMED | V1（c）`/proc` environ：`HOME=/tmp/routeA/home`，`DSH_HOME` 未设置 |
| 3 | 真实 `~/.dsh` 零写入 | ✅ CONFIRMED | V1（e）哈希逐字节相同、mtime 未变 |
| 4 | profile patch 层在没有 `--patch` 时就能交付 overlay | ✅ CONFIRMED | V2 overlay + 影子根；`agentPreset:"specdev-orchestrator"` 且写工具可用 |
| 5 | EDH 内模型调用 `edit` 且 `meta.diffs` 非空 | ✅ CONFIRMED | V2 `tool/result.meta.diffs` 含 `oldText`+`newText`；`notice:diff-summary` |
| 6 | AC-25 第 4 步审批构造仍成立 | ✅ CONFIRMED（25 工具面） | V3 恰好一次审批 → `allowed-once` → exit 0 |
| 7 | 「按 id 作答」（AD-12 的钩子） | ❓ UNKNOWN | `dsh.test.answerApproval` 尚未实现，本次走 QuickPick 路径 |

**Phase 3 脚本必须吸收的约束（全部在本轮发现，且都不涉及产品代码改动）：**

1. **`toolCount` 是 25，不是 26** —— 更正 AC-25 第 5 步的预期值，以及 Phase 3 spec 中「route A 的 26 工具面」的措辞；「工具面放宽」这一结论不受影响。
2. **每个场景都要从干净的沙箱产品状态开始** —— 否则恢复出的上一会话会让面板进入 `replay`，`dsh.test.sendPrompt` 返回 `{ok:false,reason:"replay"}`，第 3 步可能在没有模型调用的情况下「通过」。
3. **宿主由「会话可见」触发启动，而不是 `triggerAutoReady`** —— driver 必须先触发可见性，再等 `started`。
4. **route A 下第 4 步的被拒目标不能用 `$HOME`**（沙箱 `HOME` 落在可写的 `/tmp` 内）—— 用既在 workspace root 之外、又在 `/tmp` 之外的路径（`/var/tmp` 可用），并在之后删除探针。
5. **不需要 `DSH_NODE_BIN`** —— EDH 子进程用 VS Code 自带 Node（v22.22.0）经 `--import tsx/esm` 跑源码 CLI，工作正常。

**残留（本轮结束状态）。** 所有进程已按 `setsid` 进程组终止；自检对 `[e]xtensionDevelopmentPath`、`[/]usr/share/code/`、`[d]sh` 以及 `[C]rashpad.*<本次 ud>` 全部打印 `PGREP-EMPTY`；`/var/tmp/routeA-step4-probe` 已删除；`/tmp/routeA` 暂存树（沙箱 home、`ud`、`ext`、driver、影子 preset、读取器）已移除，上面引用的沙箱会话存储也随之删除。本节给机器新增的文件只有仓库内的这两份 spike 报告。

#### 本 follow-up 在机器上留下的有意产物披露

仓库之外：**没有。** 两份运行报告与所有驱动脚本都在 `/tmp/spike3` 下且已删除；本 follow-up 追加的报告位于仓库内 `.specdev/specs/vscode-dsh-usable-loop/spikes/`。凭据仅通过驱动的 `credentials` 选项注入，未打印任何密钥，且驱动脚本已删除。
