# 正确性审查 — Phase 1 (phase-1-code-context) — polish 复审

## 视角
**实现正确性** — 代码是否正确工作

## 判决
**PASS**

## Polish 闭环确认（本轮焦点）

| ID | 声称修复 | 真实逻辑？ | L2 证据 | 判定 |
|----|---------|:--:|--------|:--:|
| **GAP-CCD-012** | `openReferencePath` → `planReferenceOpen` / `resolveAtPathInWorkspace` | ✅ `planReferenceOpen` 委托与门禁同序的 resolve；`extension.ts` 使用 `plan.abs` 打开 | `phase1-code-context.spec.ts` 多 root；verifier 探针「GAP-CCD-012 closed」 | ✅ |
| **GAP-CCD-013** | `pendingPrefill` + `attach()` 重放 | ✅ 无 port 时缓冲最新文本；`attach()` 在 `pushFullState` 后重放并清空 | `prefillComposer before attach is replayed…`；verifier 冷启动 | ✅ |
| **DEBT-CCD-002** | 显式「stub ≠ 真模型」 | ✅ 文档句（非空壳代码） | `ref-read-coverage.ts` 模块头；测试文件头；`implementation.md` §AC-3a | ✅ |

先前 SHOULD-FIX 的 AC-4 meta 打开夹具：同轮 `planReferenceOpen uses SelectionMetaStore lines, not NL` 已覆盖。

Registry：GAP-CCD-012 / 013 / DEBT-CCD-002 已在「已解决」；活跃债仅 phase-2 目标项。

---

## 逐条 AC 验证

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-1 | 脏保存→指针预填；失败不生成；空格路径；无正文；replay→live；**冷启动缓冲** | `selection-ask.ts`；`chat-panel-host.ts` | ✅ | **polish**：port 未 attach 时缓冲，`attach()` 重放（GAP-CCD-013） |
| AC-2 | 空选区不生成引用 + 提示 | `selection-ask.ts` | ✅ | notice + 无 prefill |
| AC-3 | `@` 门禁；原样发送；禁止读盘拼正文 | `at-path.ts`；`sendPrompt` | ✅ | exists-only；无正文注入 |
| AC-3a | 覆盖性 read stub + **文档注明 ≠ 真模型** | `ref-read-coverage.ts` | ✅ | 判定逻辑真实；DEBT-CCD-002 文档已落地 |
| AC-3b | ide 预挂载；不改 agent-loop | ide patch | ✅ | 挂载 + idle 偏差已声明 |
| AC-4 | 引用卡；meta 行号；**多 root 与门禁一致** | `planReferenceOpen`；`openReferencePath` | ✅ | GAP-CCD-012 已闭环；meta L2 已测 |
| P1-1…3 / P2 / P2-3 | 覆盖判定、无 unreadable、grammar、整文件 read、read 工具 | 各模块 | ✅ | 与上一轮一致且仍通过 |

---

## Stub Detection（桩代码检测）

### 已注册桩（对照 registry）
| Registry ID | 状态 | 说明 |
|-------------|:--:|------|
| GAP-CCD-010 / 011、DEBT-CCD-001 | ⚠️ Known | 目标 phase-2；本 Phase 未触碰 |

### 已解决（本轮）
GAP-CCD-012、GAP-CCD-013、DEBT-CCD-002 → ✅ Resolved（真实逻辑 + 测试 / 文档）

### 新发现的未注册桩
无。

---

## 关键发现

### 🔴 Must-Fix
- （无）

### 🟡 Should-Fix
- （无）

### 🟢 Observations
- AC-3b idle 仍为模块加载代理（已声明偏差）。
- 无真机 L3/L4；spec 允许 L2 为主证据。

## 独立重跑证据
- phase1 + ide：**24 passed**
- verifier independent：**12 passed**
- panel L2：**6 passed**

## 相对上一轮
上一轮 SHOULD-FIX 的多 root open / 冷启动 prefill / stub 文档 / AC-4 meta 夹具均已闭环 → **PASS**。
