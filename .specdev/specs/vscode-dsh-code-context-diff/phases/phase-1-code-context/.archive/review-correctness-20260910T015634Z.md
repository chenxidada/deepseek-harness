# Correctness Review — Phase 1 (phase-1-code-context)

## 视角
**Implementation Correctness** — 代码是否正确工作

## 判决
**SHOULD-FIX**

## 逐条 AC 验证

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-1 | 脏保存→指针预填；失败不生成；空格 `@"…"`；无正文/`languageId`；replay→live | `selection-ask.ts:143-195`；`extension.ts:runAskAboutSelection`；`chat-panel-host.ts:prefillComposer` | ✅ | `askAboutSelection`：脏则 `await save()`，`!== true` → banner「请手动保存后重试」且不调 `prefillComposer`；成功路径 `buildPointerText`→`formatOfficialAtPath`（空格走 `formatFileMention`→`@"…"`）；防御断言禁止 `languageId` 泄漏；replay 活跃时 `newConversation` 再 prefill。L2：dirty fail/success、spaces path、replay→live 均过 |
| AC-2 | 空选区不生成引用 + 轻量提示 | `selection-ask.ts:149-151` | ✅ | `isEmpty` → `notify('请先选中代码再试。')`，`prefills=[]`；测试断言 `empty-selection` |
| AC-3 | `@` 提取/校验；reason 仅三值；原样纳入；禁止读盘拼正文 | `at-path.ts:54-190`；`chat-panel-host.ts:sendPrompt:320-350` | ✅ | `validateComposerAtPaths` 仅 `exists` 探测（无内容读）；`AtPathRejectReason` 无 `unreadable`；`acceptSend(trimmed)` 原样文本；L2：`SECRET_BODY` 不进入 prompt；非法 `not-found` reject；无 `@` 回归发送通过 |
| AC-3a | 去重 path 覆盖性 read（L2 stub）；入参映射；先于最终 assistant | `ref-read-coverage.ts:95-146`；`phase1-code-context.spec.ts` ①–⑤ | ⚠️ | `assertEveryRefReadBeforeFinalAnswer` 真实逻辑：`file_path` 优先 + aliases；精确 path 相等（目录默认不算）；①②⑤ fail / ③④ pass / 读在最终 assistant 之后不计。**缺** AC 要求的「stub ≠ 真模型」文档注明（见 Should-Fix） |
| AC-3b | ide 预挂载 `file-reference-local`；assembled prompt；不改 agent-loop；idle 观测 | `packages/bundle/ide/cordis.patch.yml`；`file-reference-local` installPrompt；`implementation.md` idle 表 | ✅ | patch insert + `package.json` 依赖已落地；provider 在 `tools.get('read')` 存在时挂 `FILE_REFERENCE_PROMPT`；implementation 记录 RSS/耗时代理观测；agent-loop 不在变更面；ide.spec + phase1 静态断言挂载 |
| AC-4 | 引用卡识别；权威无正文；打开用 meta 行号不解析 NL | `chat-panel-provider.ts:renderUserTextWithRefCards`；`extension.ts:openReferencePath`；`selection-meta.ts` | ⚠️ | 用户气泡把 `@` token 渲成 `ref-card`；权威 `msg.text` 仍为指针；`openReferencePath` 读 `SelectionMetaStore` 行号，不解析「的 N-M 行」。**边界**：多 root 下相对 path 仅拼 `preferredFolder`，非 preferred 根上已校验通过的引用打开可能误报不存在（见 Should-Fix） |
| P1-1 | covering path = 规范化相等；目录/glob 默认不算 | `ref-read-coverage.ts:readArgsCoverPath` | ✅ | 默认 `allowDirectoryPrefix` false；`readArgsCoverPath(['src'], 'src/a.ts') === false` |
| P1-2 | reason 不得含 `unreadable` | `at-path.ts:12`；`protocol.ts:RejectSendReason` | ✅ | 类型联合仅三值；测试显式 `not.toBe('unreadable')` |
| P1-3 | 官方 grammar + 空格路径 L2 | `at-path.ts:extractAtPathTokens`；`formatOfficialAtPath` | ✅ | 复用 `formatFileMention`；NL 后缀不并入 path；`@"docs/design notes.md"` 夹具通过 |
| P2-A | 探测 read 入参；提取规则 | `ref-read-coverage.ts` 头注释 + `pathsFromReadToolArgs` | ✅ | 主字段 `file_path`（对齐 tool-fs）；另接受 `path`/`file`/`target`；implementation 记录偏差（未改 design.md，结构化字段已存在故不触发「无字段须回写」分支） |
| P2 / AD-CCD-15 | 接受整文件 read 声明 | `implementation.md`；`ref-read-coverage.ts` 模块注释 | ✅ | 明确「本版本接受模型可能整文件 read」；禁止回退内联 |
| P2-3 | ide agent 具备 `read` | base `tool-fs` + file-reference-local 条件挂载 | ✅ | ide 继承 base；prompt 仅在 `read` 存在时非空 |

## Stub Detection（桩代码检测）

### 已注册桩（对照 registry）

| Registry ID | 文件:函数 | 状态 | 说明 |
|-------------|-----------|:--:|------|
| GAP-CCD-010 | `tool-fs write.ts:presentationMeta` | ⚠️ Known | 目标 phase-2；本 Phase 未触碰 |
| GAP-CCD-011 | `tool-str-replace-editor` | ⚠️ Known | 目标 phase-2；本 Phase 未触碰 |
| DEBT-CCD-001 | SnapshotStore / design 附录 | ⚠️ Known | 目标 phase-2；本 Phase 未触碰 |

### 新发现的未注册桩

| 文件:函数:行号 | 当前行为 | 严重性 | 处理建议 |
|---------------|---------|:--:|---------|
| — | — | — | 无 |

说明：`assertEveryRefReadBeforeFinalAnswer` 是 **AC-3a 规定的 L2 stub 判定函数**（纯函数断言会话事件），不是产品空壳；`pathsFromReadToolArgs` 对非对象返回 `[]` 是合法失败路径。未发现 `@STUB` / 硬编码假成功 / `(void)args` 空实现。

## 关键发现

### 🔴 Must-Fix
- （无）

### 🟡 Should-Fix
1. **多 root 打开引用只拼 preferred 根** — `extension.ts:openReferencePath` 对相对 path 固定 `resolve(join(preferred, path))`。发送门禁可在「preferred 未命中、另一 root 唯一命中」时放行，但点击引用卡会在 preferred 下找不到文件。建议：与 `resolveAtPathInWorkspace` 同序扫描各 workspace folder（或在 meta 中记录 owning root）。
2. **AC-3a 缺「stub ≠ 真模型」文档注明** — 功能夹具①–⑤齐全，但 `implementation.md` / `ref-read-coverage.ts` / 测试头均未写明 stub 断言 ≠ 真模型运行时保证。补一句即可满足 AC 文档义务。
3. **AC-4 打开钩子缺 L2 行为夹具** — HTML 含 `ref-card` / `action/open-reference` 已测；`SelectionMetaStore` 在 prefill 时写入已测；但无测试驱动 `openReferencePath`（或 Host `requestOpenReference`）验证打开 selection 使用 meta 行号、且不解析 NL。建议补一条纯函数/注入 vscode fake 用例。

### 🟢 Observations
- `languageId` 防泄漏用 `pointerText.includes(doc.languageId)`：若相对路径碰巧含子串（极少见）会误杀预填；属防御过严，非功能空洞。
- AC-3b idle 为模块加载 RSS 代理（implementation 已声明偏差）；spec 无硬阈值，不构成正确性失败。
- 独立重跑 `phase1-code-context.spec.ts` + `ide.spec.ts`：**21 passed**，exit 0。

## 独立重跑证据

```bash
./node_modules/.bin/vitest run apps/vscode-dsh/tests/phase1-code-context.spec.ts packages/bundle/ide/tests/ide.spec.ts
# Test Files  2 passed (2)
# Tests       21 passed (21)
# exit 0
```
