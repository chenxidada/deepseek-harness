# Phase 1 实现摘要

## 变更清单（文件列表）

### 新增
- `packages/ide/` — 新包组（README 双语 + i18n）
- `packages/ide/ide-bridge/` — Host bridge 插件、NDJSON 传输、Host server/client、应答桩、测试、README
- `packages/bundle/ide/` — `cordis.patch.yml`（`profile: ide` + insert `ide-bridge`）、组合互斥测试、README
- `apps/vscode-dsh/` — Extension Host：`IdeSessionHost`、env scrub/reinject、secret redact、activate/deactivate、测试、README
- `apps/cli/tests/profiles/ide/dual-channel-smoke.e2e.ts` — 双通道 e2e 冒烟
- `.agents/notes/implemented/architecture/2026-09-04-ide-profile-dual-channel.md` — 决策记录

### 修改
- `packages/boot/app-boot/src/profile.ts` — `PROFILE_TEMPLATES.ide`
- `packages/boot/app-boot/tests/profile.spec.ts` — 断言 ide 模板
- `apps/cli/package.json` — in-box 依赖 `@deepseek-ai/dsh-ide`
- `apps/cli/README.md` / `.zh.md` / `reference/README.md` / `.zh.md` — in-box 列表含 `dsh-ide`
- `packages/README.md` / `.zh.md`、`packages/bundle/README.md` / `.zh.md` — 登记 ide 组/包
- `tsconfig.host.json` — 引用 ide-bridge、bundle/ide、apps/vscode-dsh
- `tsconfig.base.json` — gen-tsconfig-paths 生成 `dsh-ide` / `dsh-ide-bridge` 别名
- `scripts/verify-subsystem-pages.ts` — `ide` 组免责声明
- `scripts/verify-package-readme-model-experience.ts` — ide / ide-bridge ME 短句审计
- `pnpm-lock.yaml` — 工作区锁更新
- `.specdev/specs/vscode-dsh-ide/tech-debt-registry.md` — STUB-001 / STUB-002

## 对每个验收标准的实现说明

| AC | 实现 |
|----|------|
| **AC-1** | `PROFILE_TEMPLATES.ide` = base + sdk-app + ide；`IdeSessionHost.start` 使用 `HarnessClient({ profile: 'ide', env })`，仅在 `initialize` 成功后将 `status` 置为 `connected`。e2e 证明 `initialize` 成功。 |
| **AC-2** | 复用 sdk-app stdout JSON-RPC；e2e 对每行 stdout 做 JSON.parse，非 JSON 即失败。诊断走 stderr。 |
| **AC-3** | `IdeSessionHost.shutdown` → `client.close()`（协议 shutdown + dispose ladder）再关 bridge；Extension `deactivate` / `dsh.stopSession` 调用 shutdown。 |
| **AC-4** | `start` 捕获 initialize/spawn 失败 → `status='error'` + `redactSecrets` 消息，不标记 connected；`session-host.spec.ts` 覆盖。 |
| **AC-5** | `packages/bundle/ide/tests/ide.spec.ts` 静态断言 patch 不含 `ui-approval` / `ui-user-questions` 及其包名。 |
| **AC-18** | `IdeBridgeHostServer` UDS/named-pipe + NDJSON；env `DSH_IDE_BRIDGE_SOCK`；e2e 在 bridge 上收到 `hello` 且 SDK 仍走 stdout。 |
| **AC-32** | `redactSecrets` + 测试；日志/错误 UI 不回显密钥形 env 值。 |
| **AC-33** | ≥1 集成：bridge UDS 往返 + answerer stubs；≥1 e2e：`dual-channel-smoke.e2e.ts`。 |

## 测试结果（命令 + 输出）

```text
# 单元 / 集成（Node 24）
./node_modules/.bin/vitest run packages/bundle/ide/tests packages/ide/ide-bridge/tests apps/vscode-dsh/tests
# Test Files  3 passed (3)
# Tests  7 passed (7)

# 含 profile 模板断言
./node_modules/.bin/vitest run packages/boot/app-boot/tests/profile.spec.ts packages/bundle/ide/tests packages/ide/ide-bridge/tests apps/vscode-dsh/tests
# Test Files  4 passed (4) / Tests  46 passed (46)

# e2e 冒烟（需 Node ^22.19 || >=24；源码树加 sdk-source typert patch）
./node_modules/.bin/vitest run --config vitest.e2e.config.ts apps/cli/tests/profiles/ide/dual-channel-smoke.e2e.ts
# Test Files  1 passed (1)
# Tests  1 passed (1)
```

## 偏差记录

无与 Phase 1 spec 冲突的行为偏差。

**说明（非偏差）**：源码 checkout 下 e2e 使用 `apps/cli/src/sdk-source.cordis.patch.yml` 禁用 `typert-loader`，与 SDK client 源码启动一致；已构建安装不需要该 patch。

## 登记的 STUB

| ID | 位置 | 目标 Phase |
|----|------|------------|
| STUB-001 | `ide-bridge` `approval/request` → `unavailable` | phase-3-interaction-fail-closed |
| STUB-002 | `ide-bridge` `user-questions/request` → `NO_PROVIDER` | phase-3-interaction-fail-closed |

完整应答 UI / bridge 往返、session/dispose、permission RPC、多 Tab 均不在本 Phase 范围。
