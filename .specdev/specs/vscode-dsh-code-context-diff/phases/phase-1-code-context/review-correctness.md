# Correctness Review — Phase 1 (phase-1-code-context) — polish re-review

## 视角
**Implementation Correctness** — 代码是否正确工作

## 判决
**PASS**

## Polish 闭环确认（本轮焦点）

| ID | 声称修复 | 真实逻辑？ | L2 证据 | 判定 |
|----|---------|:--:|--------|:--:|
| **GAP-CCD-012** | `openReferencePath` → `planReferenceOpen` / `resolveAtPathInWorkspace` | ✅ `planReferenceOpen` 委托门禁同序 resolve；`extension.ts` 用 `plan.abs` 打开 | `phase1-code-context.spec.ts` multi-root；verifier probe「GAP-CCD-012 closed」 | ✅ |
| **GAP-CCD-013** | `pendingPrefill` + `attach()` 重放 | ✅ `prefillComposer` 无 port 时缓冲 latest；`attach()` 在 `pushFullState` 后重放并清空 | `prefillComposer before attach is replayed…`；verifier cold-start | ✅ |
| **DEBT-CCD-002** | 显式「stub ≠ 真模型」 | ✅ 文档句（非空壳代码） | `ref-read-coverage.ts` 模块头；`phase1-code-context.spec.ts` 头；`implementation.md` §AC-3a | ✅ |

先前 SHOULD-FIX 的 AC-4 meta open 夹具：同轮 `planReferenceOpen uses SelectionMetaStore lines, not NL` 已覆盖（meta 1-based→0-based，且不采用 NL 行号）。

Registry：GAP-CCD-012 / 013 / DEBT-CCD-002 已在「已解决」；活跃债仅 phase-2 目标项（GAP-010/011、DEBT-001），本 Phase 未触碰。

---

## 逐条 AC 验证

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-1 | 脏保存→指针预填；失败不生成；空格 `@"…"`；无正文/`languageId`；replay→live；**冷启动缓冲** | `selection-ask.ts`；`chat-panel-host.ts:pendingPrefill` / `prefillComposer` / `attach` | ✅ | 脏失败仍无 prefill；成功路径指针-only；**polish**：port 未 attach 时缓冲 latest，`attach()` 重放（GAP-CCD-013）。L2 含 cold-start + spaces + replay→live |
| AC-2 | 空选区不生成引用 + 轻量提示 | `selection-ask.ts` | ✅ | `isEmpty` → notice；`prefills=[]`；既有夹具仍过 |
| AC-3 | `@` 提取/校验；reason 仅三值；原样纳入；禁止读盘拼正文 | `at-path.ts`；`chat-panel-host.ts:sendPrompt` | ✅ | exists-only 探测；无 `unreadable`；`acceptSend(trimmed)`；SECRET_BODY 不入 prompt |
| AC-3a | 去重 path 覆盖性 read（L2 stub）+ **文档注明 stub ≠ 真模型** | `ref-read-coverage.ts`；phase1 ①–⑤ | ✅ | 覆盖判定函数体真实（`file_path` 优先、精确相等、N-2 锚点）；①②⑤ fail / ③④ pass；**DEBT-CCD-002 文档句已显式落地** |
| AC-3b | ide 预挂载 `file-reference-local`；不改 agent-loop；idle 观测 | `packages/bundle/ide/cordis.patch.yml`；`implementation.md` | ✅ | patch + 依赖；idle 代理观测已声明偏差；agent-loop 不在变更面 |
| AC-4 | 引用卡；权威无正文；打开用 meta 不解析 NL；**多 root 与门禁一致** | `open-reference.ts:planReferenceOpen`；`extension.ts:openReferencePath`；`chat-panel-provider` | ✅ | `planReferenceOpen` = resolve + meta selection；preferred 未命中则扫全部 folder（GAP-CCD-012）；meta→0-based L2 已测 |
| P1-1 | covering path 规范化相等；目录默认不算 | `ref-read-coverage.ts:readArgsCoverPath` | ✅ | 默认无 directory prefix |
| P1-2 | reason 无 `unreadable` | `at-path.ts`；`protocol.ts` | ✅ | 联合类型仅三值 |
| P1-3 | 官方 grammar + 空格路径 L2 | `at-path.ts` | ✅ | `@"…"` 夹具通过 |
| P2-A | read 入参提取 | `pathsFromReadToolArgs` | ✅ | 主字段 `file_path` + aliases；输出随输入变化 |
| P2 / AD-CCD-15 | 接受整文件 read | `implementation.md`；模块注释 | ✅ | 显式声明 |
| P2-3 | ide 具备 `read` | base tool-fs + 条件挂载 | ✅ | read 存在才挂 FILE_REFERENCE |

---

## Stub Detection（桩代码检测）

### 已注册桩（对照 registry）

| Registry ID | 文件:函数 | 状态 | 说明 |
|-------------|-----------|:--:|------|
| GAP-CCD-010 | `tool-fs write.ts:presentationMeta` | ⚠️ Known | 目标 phase-2；本 Phase 未触碰 |
| GAP-CCD-011 | `tool-str-replace-editor` | ⚠️ Known | 目标 phase-2；未触碰 |
| DEBT-CCD-001 | SnapshotStore / design 附录 | ⚠️ Known | 目标 phase-2；未触碰 |

### 已解决（本轮 polish，非新桩）

| Registry ID | 状态 | 说明 |
|-------------|:--:|------|
| GAP-CCD-012 | ✅ Resolved | 真实 `planReferenceOpen` + 测试 |
| GAP-CCD-013 | ✅ Resolved | 真实 `pendingPrefill` + 测试 |
| DEBT-CCD-002 | ✅ Resolved | 三处显式文档句 |

### 新发现的未注册桩

| 文件:函数:行号 | 当前行为 | 严重性 | 处理建议 |
|---------------|---------|:--:|---------|
| — | — | — | **无** |

说明：`assertEveryRefReadBeforeFinalAnswer` 仍是 AC-3a 规定的 L2 契约判定函数（非产品空壳）。`pathsFromReadToolArgs` 对非对象 `return []` 是合法失败路径。polish 文件无 `@STUB` / 硬编码假成功。

---

## 关键发现

### 🔴 Must-Fix
- （无）

### 🟡 Should-Fix
- （无 — 上一轮三项 Should-Fix / PARTIAL 残余均已闭环）

### 🟢 Observations
- AC-3b idle 仍为模块加载 RSS 代理（implementation 已声明偏差；spec 无硬阈值）→ 不构成正确性失败。
- 无 Extension Host L3/L4 真机点选 `showTextDocument`；spec 以 L2 为主证据，且 open 规划函数已有可执行夹具。
- `languageId` 防泄漏仍用 `pointerText.includes(doc.languageId)`（极少误杀风险）；非空洞。

## 独立重跑证据

```bash
./node_modules/.bin/vitest run \
  apps/vscode-dsh/tests/phase1-code-context.spec.ts \
  packages/bundle/ide/tests/ide.spec.ts
# Test Files  2 passed (2) / Tests  24 passed (24)

./node_modules/.bin/vitest run \
  --config .specdev/specs/vscode-dsh-code-context-diff/phases/phase-1-code-context/test-scripts/vitest.config.ts
# Test Files  1 passed (1) / Tests  12 passed (12)

./node_modules/.bin/vitest run apps/vscode-dsh/tests/panel-l2-l3-protocol.spec.ts
# Tests  6 passed (6)
```

---

## 相对上一轮 correctness（SHOULD-FIX）的变化

| 上一轮问题 | 本轮 |
|-----------|------|
| 多 root open 只拼 preferred（GAP-CCD-012） | ✅ 修复 + L2 |
| 冷启动 prefill 丢失（GAP-CCD-013） | ✅ 修复 + L2 |
| AC-3a 缺「stub ≠ 真模型」文档（DEBT-CCD-002） | ✅ 三处显式句 |
| AC-4 open 缺 meta 行为夹具 | ✅ `planReferenceOpen` + SelectionMetaStore 夹具 |
