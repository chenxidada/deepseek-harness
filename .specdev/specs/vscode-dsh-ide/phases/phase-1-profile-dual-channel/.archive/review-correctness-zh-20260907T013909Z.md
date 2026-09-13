# 正确性审查 — Phase 1（`phase-1-profile-dual-channel`）

## 视角
**实现正确性** — 代码是否真正工作

## 判决
**SHOULD-FIX**

## 逐条 AC 验证

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-1 | ide profile 启动 + initialize 后门闩 session/prompt | `profile.ts` / `IdeSessionHost.start` / SDK server | ✅ | 模板正确；仅 initialize 成功后 connected；SDK 未初始化拒绝 prompt |
| AC-2 | stdout 仅 JSON-RPC | sdk-app + e2e | ✅ | e2e 逐行 JSON.parse |
| AC-3 | 有序 shutdown + UI | session-host / extension | ✅ | close client → bridge；deactivate/stop 更新 UI |
| AC-4 | initialize 失败不假连接 | session-host + 单测 | ✅ | status=error，非 connected |
| AC-5 | 禁挂 Web UI 应答插件 | cordis.patch + ide.spec | ✅ | 静态断言禁止 id/包名 |
| AC-18 | bridge 非 stdout | host/client/ndjson | ✅ | UDS+NDJSON；e2e 收 hello |
| AC-32 | 密钥不进扩展日志 | redact + extension | ⚠️ | 主路径 OK；credentials 选项边界缺口 |
| AC-33 | ≥1 集成 + ≥1 e2e | bridge 测 + dual-channel-smoke | ✅ | 存在；本机 Node 过旧未复跑 e2e |

## Stub Detection

### 已注册桩
| ID | 位置 | 状态 |
|----|------|:--:|
| STUB-001 | approval → unavailable | ⚠️ Known（Phase 3） |
| STUB-002 | user-questions → NO_PROVIDER | ⚠️ Known（Phase 3） |

### 新发现未登记桩
无。

## 关键发现

### 🔴 Must-Fix
无。

### 🟡 Should-Fix
- `redactSecrets` 未覆盖仅存在于 `credentials` 选项、不在 Extension `process.env` 中的密钥。
- 缺少 IdeSessionHost 成功 shutdown → `disconnected` 的单测。

### 🟢 Observations
- 单元/集成 46 测通过；e2e 需在 engines 合规 Node 上由 verifier 复跑。
