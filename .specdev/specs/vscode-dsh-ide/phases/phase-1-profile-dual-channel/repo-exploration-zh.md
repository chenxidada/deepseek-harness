# 仓库调研报告 — Phase 1：Profile + 双通道骨架 + 生命周期

## 1. Task Context

Phase `phase-1-profile-dual-channel` 要落地可启动的 `ide` profile（`dsh-base` + `sdk-app` + `ide-bridge`），证明 SDK stdio 的 stdout 仅承载 JSON-RPC，搭好 Host bridge 的 UDS/named pipe NDJSON 骨架（可连接 + answerer 占位），并提供 `apps/vscode-dsh` 扩展宿主：先听 bridge，再 spawn `dsh --profile ide`，在任何 `session/prompt` 之前完成 SDK `initialize`，并有序 shutdown。与 Web `ui-approval` / `ui-user-questions` 的互斥必须显式失败（AC-5）。完整审批/提问 UX 属 Phase 3；本 Phase 要骨架 + registry 桩，不要完整交互闭环。密钥不得进入扩展日志（AC-32）。

## 2. Repository Overview

- **语言 / 运行时：** TypeScript ESM（`"type": "module"`），Node `^22.19 || >=24`，Cordis 插件组合。
- **包管理：** pnpm workspaces（`packages/*/*`、`apps/*`）。
- **产品启动器：** 仅 `apps/cli`（`dsh`）通过命名 profile 启动 Node 应用；禁止用 package bin / SDK argv 逃逸做产品启动。
- **现有 shipped profiles**（`packages/boot/app-boot/src/profile.ts` 的 `PROFILE_TEMPLATES`）：`web`、`headless`、`acp`、`sdk`、`sdk-minimal`。**没有 `ide` profile，没有 `packages/ide/`，没有 `apps/vscode-dsh/`。**
- **Bundle 组** `packages/bundle/`：可安装的 `cordis.patch.yml` 层（`base`、`sdk-app`、`acp-app`、`web-app`、`headless`、`sdk-minimal`）。
- **SDK** `packages/sdk/{protocol,client,server}`：在调用方拥有的流上做 NDJSON JSON-RPC；client 拥有子进程 spawn。
- **Interaction** `packages/interaction/{user-approval,user-questions}`：Host 瀑布事件 `approval/request` / `user-questions/request`。
- **ACP** `packages/acp/acp`：在*同一* stdio 协议上的 Host 终端 answerer（与 IDE 双通道对照）。

## 3. Most Relevant Areas

| 路径 | 为何相关 | 来源 |
|------|----------|------|
| `packages/boot/app-boot/src/profile.ts` | `PROFILE_TEMPLATES`；不加 `ide` 则首次启动会大声失败 | 👁 |
| `packages/bundle/base/cordis.patch.yml` | 共享核心：已挂载 `approval`、`user-questions`、`permission` | 👁 |
| `packages/bundle/sdk-app/cordis.patch.yml` + `src/index.ts` | stdout JSON-RPC 先例；`Config.profile` 用于 help；startup 门禁服务 | 👁 |
| `packages/bundle/acp-app/cordis.patch.yml` + `src/index.ts` | 最近的 profile-app 双胞胎（startup 服务 + 协议插件） | 👁 |
| `packages/bundle/web-app/cordis.patch.yml` | `ui-approval` / `ui-user-questions` 行 — AC-5 冲突集合 | 👁 |
| `packages/sdk/server/src/{index,server}.ts` | stdout 独占；`initialize` 就绪；未初始化拒绝 `session/prompt` | 👁 |
| `packages/sdk/client/src/{launch,client,types}.ts` | spawn + `profile` + `env` + `initialize`/`shutdown`/`close` | 👁 |
| `packages/sdk/protocol/src/transport.ts` | bridge 帧可参考的 NDJSON 分帧 | 👁 |
| `packages/acp/acp/src/index.ts` | Host `ctx.on('approval/request')` 拥有 agent 模式 | 👁 |
| `packages/interaction/user-approval/src/{index,types}.ts` | 瀑布 + fail-closed `unavailable` | 👁 |
| `packages/interaction/user-questions/src/{index,types}.ts` | 瀑布；失败路径为 `UserQuestionError` / `NO_PROVIDER` | 👁 |
| `packages/client/ui-approval/src/client/index.ts` | 浏览器 Remote `$on('approval/request')` — 不是 Host `ctx.on` | 👁 |
| `packages/client/ui-user-questions/src/client/index.ts` | 浏览器 Remote `$on('user-questions/request')` | 👁 |
| `apps/cli/package.json` | in-box bundle 依赖，保证安装优先解析 | 👁 |
| `apps/cli/tests/profiles/sdk/keyless-smoke.e2e.ts` | 真实 `dsh --profile sdk` initialize → prompt 的 e2e 模式 | 👁 |
| `docs/cookbook/extension-cookbook.md` | 协议驱动 + ACP 可运行范例 | 👁 |
| `docs/cookbook/adding-a-package.md` | 新包 / 新组清单 | 👁 |
| `packages/subprocess/subprocess/src/index.ts` | `scrubbedParentEnv` / `SENSITIVE_ENV_PATTERN` 密钥卫生 | 👁 |

**尚不存在（必须新建）：**

| 路径 | 设计角色 |
|------|----------|
| `packages/bundle/ide/` | Profile patch：叠在 sdk-app 上，插入 `ide-bridge`，设置 `profile: ide` |
| `packages/ide/ide-bridge/` | 新组 + 插件：读 `DSH_IDE_BRIDGE_SOCK`、连接、answerer 桩 |
| `apps/vscode-dsh/` | 扩展：bridge listen → spawn → initialize → 错误 UI / shutdown |

## 4. Key Entry Points / Call Paths

### 路径 A — Shipped profile 启动（今日：`sdk`；目标：`ide`）

```
dsh --profile <name>
  → apps/cli/src/bin.ts / profile-boot
  → loadProfile() [缺失时按 PROFILE_TEMPLATES 自动 init]
  → 按 dsh.profile.bundles 顺序叠 bundle cordis.patch.yml
  → Loader 启动插件
  → sdk-app-startup 发布 sdkAppStartup
  → sdk-jsonrpc-server 等待 inject [sdkAppStartup, loader]
  → JsonRpcLineTransport(process.stdin, process.stdout)
```

**建议的 `ide` 栈（设计已确认 + 现有模板风格）：**

```
PROFILE_TEMPLATES.ide = {
  bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-sdk-app', '@deepseek-ai/dsh-ide'],
  patchReload: 'startup',
}
```

`packages/bundle/ide/cordis.patch.yml` 应：

1. 覆盖 `- id: sdk-app-startup` 的 `config.profile: ide`（sdk-app 已支持 Config.profile；✅ 在 `sdk-app/src/index.ts` 已确认）。
2. 插入 `- id: ide-bridge` / `@deepseek-ai/dsh-ide-bridge`。
3. **不要**插入任何 `ui-approval` / `ui-user-questions` 行。

### 路径 B — 扩展双通道生命周期（Phase 1 目标）

```
VS Code Extension activate / startSessionHost
  → BridgeHostServer.listen(UDS path | named pipe)     // AC-18
  → 经 HarnessClient({ profile: 'ide', env: { …, DSH_IDE_BRIDGE_SOCK } }) spawn
  → 子进程：ide-bridge 读 env，连接 Host socket
  → client.initialize(...)  必须成功后才标「已连接」/ 才允许 session/prompt  // AC-1, AC-4
  → dispose 时：client.close() → protocol shutdown → EOF/SIGTERM 阶梯      // AC-3
```

### 路径 C — 审批 answerer（ACP 先例 → ide-bridge）

```
tool / policy → ApprovalService.request
  → ctx.waterfall(scopeTarget(agent), 'approval/request', req, () => 'unavailable')
  → ACP 今日：ctx.on('approval/request') 认领自有 agent；否则 next()
  → ide-bridge（Phase 1 可桩）：同一 Host 监听形态；经 socket 转发；
     缺连接 / 超时 / 非法结局 → 'unavailable'（对自有请求不要 next()）
```

**注意：** ACP **只**注册了 approval；**没有** `user-questions/request` 监听器（✅ grep 已确认）。ide-bridge 设计要求**两条**瀑布 — approval 可照抄；questions 需新建 Host 侧代码，沿用同一拥有权 + fail-closed 规则。

### 路径 D — 为何 Web UI 插件在概念上冲突（AC-5）

```
Web 浏览器半：
  ui-approval apply → ctx.remote.$on('approval/request', …)   // Client Typert Remote
  （Node 半 apply() 为空）

无 Host answerer 时 Host 瀑布 → unavailable / NO_PROVIDER
Host answerer（ACP / ide-bridge）+ 另一 Host 终端 answerer → 认领不确定
```

Web client 插件**不是** Host `ctx.on` 监听器。AC-5 仍要求：若 ide profile 挂载这些包行（或任何争抢同一瀑布终点的 Host 插件）则组合层拒绝。优先做**静态 patch 断言**（bundle 测试）+ 可选的 boot 期扫描组合 entry 名。

## 5. Likely Impact Surface

| 区域 | 改动 | 风险 |
|------|------|------|
| `packages/boot/app-boot/src/profile.ts` + 测试 | 向 `PROFILE_TEMPLATES` 加 `ide` | **高** — 不加则 `dsh --profile ide` 永不自动 init |
| `apps/cli/package.json`（+ README/reference 列表） | 依赖 `@deepseek-ai/dsh-ide` 以 in-box 解析 | **高** |
| `packages/bundle/ide/`（新建） | `cordis.patch.yml`、包元数据、组合测试 | **高** |
| `packages/ide/ide-bridge/`（新组） | 插件骨架、UDS 客户端、answerer 桩、README、组 README | **高** |
| `packages/README.md`、`packages/bundle/README.md` | 记录新组/包 | **中** |
| `tsconfig.host.json` references + `pnpm run gen-tsconfig-paths` | 注册新包 | **中** |
| `apps/vscode-dsh/`（新建） | 扩展骨架；可能需 VS Code engines / 打包约定，超出现有 `apps/web` Vite 模式 | **高**（新面） |
| `apps/cli/tests/profiles/ide/`（可选但符合 AGENTS.md） | stdout 纯度 + initialize 的 profile e2e | **中** |
| `tech-debt-registry.md` | 若 answerer 留桩则登记到 Phase 3 | **低**（流程） |
| `packages/core/**/agent-loop*` | **禁止修改** | — |
| `dsh-sdk-protocol` 方法集 | **不要**在 stdout 加审批 RPC | — |

## 6. Existing Constraints / Conventions

1. **Profile = 有序 bundle patch** 叠在空根上；同行 id 后写覆盖（`dsh-base` 注释 + app-boot README）。✅
2. **Stdout 纯度**由部署组合强制（`packages/sdk/server/README.md`）；不要组合 stdout logger。诊断走 stderr。✅
3. **插件导出形态：** function 插件导出 `name` / `inject` / `Config` / `apply`，**无 default export**（ACP postmortem）。✅
4. **注册即 effect**（`ctx.effect` / `ctx.on`）；认领的瀑布监听器认领后不得再 `next()`；非自有必须 `next()`。✅
5. **Approval fail-closed：** 缺失/非法/抛错 answerer → `unavailable`（`user-approval` 服务）。✅
6. **User-questions 失败路径：** 无 answerer → `UserQuestionError` `NO_PROVIDER`（reject），不是软结局 — bridge 桩需仔细映射。✅
7. **SDK client：** `HarnessClientOptions.profile` 默认 `'sdk'`；传 `'ide'`。提供 `env` 时**完全替换**父环境 — 调用方拥有凭据策略。✅
8. **`scrubbedParentEnv`：** 剥离凭据形名字 **以及所有 `DSH_*`**。若扩展用 scrub 建 env，**必须显式再注入** `DSH_IDE_BRIDGE_SOCK`（及所需 `DSH_HOME`）。✅
9. **新包组 `ide/`** 允许（adding-a-package.md）：仅容器；更新 `packages/README.md`；跑 path 生成；加 `tsconfig.host.json` reference。✅
10. **产品可见插件需要 REAL 组合测试**（packages/AGENTS.md）— 仅手建 `ctx.plugin` 对 profile 面不够。✅
11. **应用启动规则：** 扩展必须 spawn `dsh --profile ide`，不要另造直接 boot Cordis 的 Node bin。✅
12. **仓库内无现成 UDS/named-pipe Host IPC 库**（grep 仅见 HTTP `createServer`）。Phase 1 自建 bridge 传输；`JsonRpcLineTransport` 是分帧参考，不是可插拔 socket server。⚠️ 复用程度为假设。

## 7. Risks / Unknowns

| 项 | 确认度 | 说明 |
|----|:------:|------|
| `packages/ide` 与 `apps/vscode-dsh` 尚不存在 | ✅ CONFIRMED | 绿地 |
| `PROFILE_TEMPLATES` 无 `ide` | ✅ CONFIRMED | 必须改 app-boot |
| `base` + `sdk-app` + `ide` 三层叠合符合 AD-3 与现有 `acp`/`sdk` 模板 | ✅ 模式已确认 | 优先叠层，勿 fork sdk-app |
| Web `ui-approval` 的 Node `apply()` 为空；冲突在组合/Remote，非今日双 Host `ctx.on` | ✅ CONFIRMED | 仍须在 patch/boot 强制 AC-5 |
| ACP 仅为 approval 的 Host answerer 先例 | ✅ CONFIRMED | questions 为新工作 |
| 无 in-repo UDS/named-pipe NDJSON Host bridge | ✅ 确认缺失 | 新代码 |
| 本 monorepo 的 VS Code Extension 打包 / 测试惯例 | ❓ UNKNOWN | 仅有 `apps/cli` + `apps/web`；未发现 `@types/vscode` 先例 |
| 互斥强制点（静态测试 vs boot 断言 vs 两者） | ⚠️ HYPOTHESIS | 设计允许任一；建议 bundle 组合测试 + 可选 boot 断言 |
| `ide` 是否需像 retired headless 那样做 installation-owned tuple | ⚠️ HYPOTHESIS | 先只加普通 `PROFILE_TEMPLATES` 条目 |
| Windows named-pipe 路径格式 + VS Code listen 语义 | ❓ UNKNOWN | 设计 Q-2 要求；无本地样例 |

## 8. Uncertain / Unverified

- **`HarnessClient` + 自定义 `env` 与扩展密钥日志：** client 会保留 stderr 尾用于诊断（`STDERR_TAIL_LIMIT = 400`）。实现者须确保扩展日志路径不 dump env，并在展示前对 stderr 脱敏密钥（AC-32）。client 自身错误信息是否泄漏密钥未全量审计 — 把扩展日志当作可控面。
- **sdk-jsonrpc-server 是否在回答 `initialize` 前等待 ide-bridge fiber：** server 在挂载后等待 Loader settlement。若 ide-bridge 在 `apply` 后异步连接，可能出现 initialize 已成功但 bridge 仍断开 — Phase 1 应暴露 bridge 连接态，审批 fail-closed（AC-19 留给 Phase 3，但骨架勿假称「就绪」）。端到端时序未验证（新代码）。
- **完整 `AgentHandle.dispose()` / 经 bridge 的 session dispose** 属 Phase 2 / 设计 Q-3；勿用其阻塞 Phase 1 骨架。
- **新组的 gen-tsconfig-paths / constraints 门禁：** 按 cookbook；此处未重跑。

## 9. Stub Detection & Registry Cross-Validation

### Registry 校验结果

| Registry ID | 文件:函数 | Registry 状态 | 代码实际状态 | 判定 |
|-------------|-----------|:--:|------------|:--:|
| — | — | 活跃表为空 | N/A（尚无 ide/bridge 代码） | ✅ 匹配（无活跃债） |

### Stub Detection Summary

- ✅ 与 registry 匹配的已确认桩：**0**（registry 空；尚无 Phase 1 代码）。
- ⚠️ Registry 不一致：**0**。
- 🔴 阻塞本 Phase 主路径的未注册桩：**0**。
- **预期 Phase 1 将写入的桩（写完即登记）：** 无 Host UI 时返回 `unavailable` / reject questions 的 ide-bridge answerer 体；可选 `session/dispose` / permission RPC 占位 — 按设计标 `@STUB(phase-3-interaction-fail-closed)` 并更新 `tech-debt-registry.md`。

**相关空 Node apply（非本 Phase 债）：** `packages/client/ui-approval/src/index.ts` 与 `ui-user-questions/src/index.ts` 的 Host `apply()` 为空是设计使然（浏览器半拥有监听）。勿当作未完成的 Host answerer。

## 10. Recommended Next Reads

1. ⭐ MUST READ — `packages/boot/app-boot/src/profile.ts`（`PROFILE_TEMPLATES`、`loadProfile`、`resolveBundleDir`）
2. ⭐ MUST READ — `packages/bundle/sdk-app/cordis.patch.yml` + `src/index.ts` + `tests/sdk-app.spec.ts`
3. ⭐ MUST READ — `packages/acp/acp/src/index.ts`（approval 监听约 L152–173）+ `packages/bundle/acp-app/cordis.patch.yml`
4. ⭐ MUST READ — `packages/sdk/client/src/{launch,client,types}.ts` 与 `packages/sdk/server/src/index.ts`
5. ⭐ MUST READ — `packages/interaction/user-approval/src/{types,index}.ts` + `user-questions/src/{types,index}.ts`
6. 🔷 SHOULD READ — `packages/bundle/web-app/cordis.patch.yml`（ui-approval / ui-user-questions id）+ `packages/client/ui-approval/src/client/index.ts`
7. 🔷 SHOULD READ — `apps/cli/tests/profiles/sdk/keyless-smoke.e2e.ts` + `apps/cli/reference/README.md`（需扩展的 in-box bundle 列表）
8. 🔷 SHOULD READ — `docs/cookbook/extension-cookbook.md`（协议驱动）+ `docs/cookbook/adding-a-package.md`
9. 🔷 SHOULD READ — `.specdev/specs/vscode-dsh-ide/design.md` AD-2/AD-3/AD-4 + 组件图
10. 🔹 OPTIONAL — `packages/sdk/protocol/src/transport.ts`（NDJSON 分帧）、`packages/subprocess/subprocess/src/index.ts`（`scrubbedParentEnv`）、`packages/bundle/sdk-app/tests/startup.spec.ts`

### Implementer 清单（归纳）

1. 创建 `packages/ide/ide-bridge` + `packages/bundle/ide`；注册 `PROFILE_TEMPLATES.ide` 与 `apps/cli` 依赖。
2. 复用 sdk-app 层；只 patch `profile: ide` + 插入 bridge；断言 patch 不含 Web UI answerer 包名。
3. 扩展：listen socket → 设 `DSH_IDE_BRIDGE_SOCK` → `HarnessClient({ profile: 'ide', env })` → `initialize` 门禁 → shutdown 时 `close`；握手失败绝不标已连接。
4. Answerer 桩：ACP 形 `ctx.on('approval/request')` + 新建 `user-questions/request`；桩登记到 tech-debt-registry（Phase 3）。
5. 测试：组合/互斥测试 + ≥1 集成（boot/initialize/bridge 连接）+ ≥1 e2e（AC-33）；断言 stdout 未被污染。
