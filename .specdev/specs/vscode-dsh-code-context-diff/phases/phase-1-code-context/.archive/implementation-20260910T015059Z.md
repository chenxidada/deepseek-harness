# Phase 1 实现摘要 — phase-1-code-context

## 变更清单（文件列表）

### 新增
| 路径 | 说明 |
|------|------|
| `apps/vscode-dsh/src/code-context/at-path.ts` | 官方 `@` / `@"…"` 全句提取 + 工作区 resolve（无正文读） |
| `apps/vscode-dsh/src/code-context/selection-meta.ts` | 扩展本地选区行号元数据（AC-4 打开用） |
| `apps/vscode-dsh/src/code-context/selection-ask.ts` | 脏保存 + 指针预填编排（AC-1/2，D-6） |
| `apps/vscode-dsh/src/code-context/ref-read-coverage.ts` | AC-3a / AD-CCD-14 covering-path 判定（P2-A=`file_path`） |
| `apps/vscode-dsh/src/code-context/index.ts` | 模块导出 |
| `apps/vscode-dsh/tests/phase1-code-context.spec.ts` | L2：预填 / 门禁 / 空格路径 / AC-3a stub / AC-3b 静态 / AC-4 HTML |

### 修改
| 路径 | 说明 |
|------|------|
| `apps/vscode-dsh/src/chat-panel/protocol.ts` | `RejectSendReason` + `composer/prefill` + `action/open-reference` |
| `apps/vscode-dsh/src/chat-panel/chat-panel-host.ts` | `@path` 发送门禁；prefill；open-reference |
| `apps/vscode-dsh/src/chat-panel/chat-panel-provider.ts` | 引用卡 UI、prefill、reject 文案 |
| `apps/vscode-dsh/src/extension.ts` | `dsh.askAboutSelection`、VsCodeLike 扩面、门禁/打开接线 |
| `apps/vscode-dsh/src/index.ts` | 导出 code-context API |
| `apps/vscode-dsh/package.json` | 命令/菜单 + `@deepseek-ai/dsh-file-reference` |
| `apps/vscode-dsh/tsconfig.json` | project reference → file-reference |
| `packages/bundle/ide/cordis.patch.yml` | insert `file-reference-local`（AC-3b / AD-CCD-13） |
| `packages/bundle/ide/package.json` | 依赖 `dsh-file-reference-local` |
| `packages/bundle/ide/tests/ide.spec.ts` | 断言 mount + 依赖 |

### 未改
- `packages/core/agent-loop`（禁止）
- ChangeList / 归属 / 撤销（phase-2/3）
- `design.md` / `spec.md`（implementer 不改设计文档；P2-A 结论写入本文件 + 代码注释）

---

## 对每个验收标准的实现说明

| AC | 实现 |
|----|------|
| **AC-1** | `askAboutSelection`：脏则 `save()`；失败 → banner「请手动保存后重试」且不预填；成功 → `formatOfficialAtPath` + `的 N-M 行`；空格路径强制 `@"…"`；无选区正文 / `languageId`；replay 活跃时 `newConversation` 新 live 再 `composer/prefill` |
| **AC-2** | 空选区 → `notify('请先选中代码再试。')`，不预填 |
| **AC-3** | `ChatPanelHost.sendPrompt` 调 `validateComposerAtPaths`；reason 仅 `not-found` / `outside-workspace` / `ambiguous-root`；合法则 **原样** `acceptSend(trimmed)`，禁止读盘拼正文 |
| **AC-3a** | `assertEveryRefReadBeforeFinalAnswer`：去重 path；`tool/call` name=`read`；入参经 `pathsFromReadToolArgs`（主字段 **`file_path`**）覆盖；须在最后一条 `assistant/message` 之前。L2 stub 覆盖 ①②③④⑤ |
| **AC-3b** | ide `cordis.patch.yml` 预挂载 `file-reference-local`；依赖写入 ide `package.json`；assembled prompt 由既有 `file-reference-local` REAL 测试在 `read` 存在时断言含 `FILE_REFERENCE_PROMPT`；idle 观测见下 |
| **AC-4** | Webview 用户气泡把 `@` token 渲染为 `ref-card`；点击 → `action/open-reference`；Host 用 `SelectionMetaStore` 行号打开（不解析自然语言行范围）；权威消息 text 仍为指针 |
| **P1-1** | `readArgsCoverPath` 规范化相等；目录/glob 默认不算 |
| **P1-2** | `AtPathRejectReason` 无 `unreadable` |
| **P1-3** | 复用 `formatFileMention` / 全句扫描对齐 grammar；空格路径 L2 夹具 |
| **P2-A** | 开工探测确认 tool-fs `read` 主字段 = **`file_path`**（另接受 `path`/`file`/`target`）。**未改 design.md**（角色约束）；规则落在 `ref-read-coverage.ts` 与本摘要 |
| **P2 / AD-CCD-15** | **本版本接受模型可能整文件 `read`**；禁止回退「只贴选区」内联。见 `ref-read-coverage.ts` 模块注释与 selection-ask 防御断言 |

### P2-3 / read 工具存在性
ide profile 经 `dsh-base` 挂载 `tool-fs` → 默认 agent 具备 `read`。`file-reference-local` 仅在 `tools.get('read')` 存在时写入非空 `FILE_REFERENCE_PROMPT` section。

### AC-3b idle 观测（P2-2，无硬阈值）

模块加载代理（非完整 ide spawn；`WorkspaceFileSearch` 在 `list()` 时惰性索引）：

| 指标 | 值 |
|------|-----|
| 时间 | 2026-09-09T12:36:36Z |
| baseline RSS | 44.85 MiB |
| 加载 grammar 后 | 45.51 MiB |
| 加载 file-reference-local 后 | 51.41 MiB |
| Δ provider RSS | **+5.9 MiB** |
| grammar 加载 | 1.59 ms |
| local provider 加载 | 139.03 ms |

说明：完整 `dsh --profile ide` 进程 idle 成本未在本 Phase 做长时间采样；上述为挂载面代理观测，供后续发现意外后台索引成本。

---

## 测试结果（命令 + 输出）

```bash
# Node 22 required for current pnpm tooling in this workspace
source ~/.nvm/nvm.sh && nvm use 22.14.0

./node_modules/.bin/vitest run apps/vscode-dsh/tests/phase1-code-context.spec.ts packages/bundle/ide/tests/ide.spec.ts
# Test Files  2 passed (2)
# Tests  21 passed (21)

./node_modules/.bin/vitest run apps/vscode-dsh/tests/panel-l2-l3-protocol.spec.ts
# Test Files  1 passed (1) / Tests  6 passed (6)

./node_modules/.bin/vitest run packages/context/file-reference-local/tests/service.spec.ts -t "installs read-tool guidance"
# Tests  1 passed (FILE_REFERENCE_PROMPT assembled when read exists)
```

---

## 偏差记录

### 偏差 1 — P2-A 回写 design.md AD-CCD-14
- **偏差描述**：未编辑 `design.md` 将主字段从示例 `path`/`file`/`target` 改为文档化 `file_path`；改为在实现代码与本 `implementation.md` 声明。
- **影响范围**：spec.md §P2-A / design.md §AD-CCD-14 §7
- **原因**：implementer Must Not 禁止修改 design.md；调度者/后续可补丁 design。
- **影响**：下游仍以代码 `pathsFromReadToolArgs` 为准；语义与探测结果一致。

### 偏差 2 — AC-3b idle 为模块加载代理而非长时间 ide 进程采样
- **偏差描述**：记录的是 grammar / file-reference-local 内建产物加载的 RSS/耗时，不是完整 Host spawn 后 idle 采样。
- **影响范围**：spec.md AC-3b / design.md AD-CCD-13 §5（P2-2）
- **原因**：完整 spawn 成本高且环境相关；spec 明确不设硬阈值，允许观测记录。
- **影响**：若后续发现索引成本异常，应用完整 ide idle 采样复核。

---

## 债务

未新增 `@STUB`。GAP-CCD-010 / GAP-CCD-011 / DEBT-CCD-001 仍目标 **phase-2**（按 Phase Entry Gate 推迟），本 Phase 未触碰。
