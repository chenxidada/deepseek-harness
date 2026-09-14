# Phase 1 验证报告：类型层一致性修复

## 判决：PASS

全部 11 条验收标准（AC-1~11）独立复跑实证通过。编译门禁以 `tsc -b --force` 从零重编译（强于 implementer 的增量 `tsc -b`）0 错误退出；9 个 vitest 文件 93 用例全部通过；`matchTier`/`Thenable` 静态残留为 0；条件展开的运行时等价由消费方守卫逐处确认。无 CRITICAL/MEDIUM 残余风险。

## 测试执行矩阵

| 场景 | 来源 | 命令 | 结果 | 证据 |
|------|:--:|------|:--:|------|
| AC-1 `tsc -b` 0 错误 | spec | `export PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH && cd apps/vscode-dsh && ../../node_modules/.bin/tsc -b` | ✅ | 退出码 0，无 `error TS` 输出 |
| AC-1（加强）从零重编译 | verifier | `cd apps/vscode-dsh && ../../node_modules/.bin/tsc -b --force` | ✅ | 退出码 0，耗时 7.5s，无 `error TS` |
| AC-2 vitest 回归 | spec | `./node_modules/.bin/vitest run <9 文件>` | ✅ | `Test Files 9 passed (9)` / `Tests 93 passed (93)`，退出码 0 |
| AC-3 `matchTier` 单数无残留 | spec | `rg -n '\bmatchTier\b' src webview/src tests` | ✅ | 0 匹配（rg 退出码 1） |
| AC-4 tier 字段名 Host/Webview 一致 | spec | 读 `session-search.ts:31` + `webview/dist` bundle | ✅ | Host 类型改 `matchTiers`；webview bundle 已用 `matchTiers`，搜索用例通过 |
| AC-5 `requestSearchSessions` 无 `as` 断言 | spec | 读 `extension.ts:1403-1407` | ✅ | `return controller.searchSessions(query)` 直接返回，无 `as` |
| AC-6 `Thenable` 无残留 | spec | `rg -n '\bThenable\b' src` | ✅ | 0 匹配（rg 退出码 1） |
| AC-7 `save()` 三种返回均接受 | spec | 读 `selection-ask.ts:22` + 编译 + `phase1-code-context` 用例 | ✅ | `PromiseLike<boolean> \| Promise<boolean> \| boolean`，编译通过 + 用例通过 |
| AC-8 6 个调用点条件展开 | spec | 读 `revert.ts` / `conversation-controller.ts` / `extension.ts` + 编译 | ✅ | 6 处 `...(x === undefined ? {} : { x })` 全部就位，`tsc` 0 错误 |
| AC-9 `skipWrite` 默认写盘不变 | spec | 读 `revert.ts:199` | ✅ | `if (options.skipWrite !== true)`，省略 ≡ undefined 走默认写盘 |
| AC-10 `confirmGate` 取消语义不变 | spec | 读 `revert.ts:263/275` | ✅ | `confirmGate !== undefined` 缺失时返回 `{ ok:false, reason:'cancelled', cancelled:true }` |
| AC-11 `turn` 字段省略兼容 | spec | 读 `conversation-controller.ts:1800-1801` | ✅ | `...turn === undefined ? {} : { turn }`，对象字段集合与修复前一致 |

## 独立验证场景（verifier 自己设计）

| 场景 | 命令/方法 | 结果 |
|------|-----------|:--:|
| 从零干净重编译（排除增量缓存假阳性） | `tsc -b --force`（composite/incremental 下强制全量） | ✅ 退出码 0 |
| 运行时等价 — `skipWrite` 缺省守卫 | `rg 'options\.skipWrite !== true'` → `revert.ts:199` | ✅ 确认缺省写盘 |
| 运行时等价 — `confirmGate` 缺省守卫 | `rg 'options\.confirmGate !== undefined'` → `revert.ts:263` + `reason:'cancelled'`@275 | ✅ 确认取消语义 |
| 运行时等价 — `turn` 条件展开 | `rg 'turn === undefined ? {} : { turn }'` → `conversation-controller.ts:1756/1797/1800/1801/1883` | ✅ 确认字段省略 |
| 无 `as` 断言污染 | `rg 'requestSearchSessions'` → `extension.ts:1403`，读回调体无 `as` | ✅ 确认契约闭合 |

> 说明：本 Phase 是纯类型层修复（5 文件、14 处类型注解/条件展开，0 运行时逻辑变更）。「独立端到端运行时验证」由 9 个既有 vitest 文件（93 用例）承担——它们执行的是真实代码路径（`searchSessions → SearchHit.matchTiers → hit.matchTiers.includes`、`executeRevert skipWrite`、`executeRevertMany confirmGate`、`streamingAssistant turn`），非 mock 假实现。消费方守卫的语义等价由源码逐处复核确认。

## Reviewer 建议的验证场景

| 场景 | 命令 | 结果 |
|------|------|:--:|
| 编译门禁 | `tsc -b`（Node 24.3.0） | ✅ 退出码 0 |
| 静态残留 | `rg '\bmatchTier\b'` + `rg '\bThenable\b'` | ✅ 均 0 匹配 |
| 运行时回归 | `vitest run <9 文件>` | ✅ 9 files / 93 tests |
| `skipWrite===undefined` 默认写盘 | 读 `revert.ts:199` | ✅ 确认 |
| `confirmGate` 缺失取消 | 读 `revert.ts:263/275` | ✅ 确认 |
| `turn===undefined` 字段省略 | 读 `conversation-controller.ts:1800-1801` | ✅ 确认 |

## 端到端验证

| 数据路径 | 结果 | 证据 |
|---------|:--:|------|
| `SearchHit.matchTiers`（接口）→ `session-search.ts` 实现 → `extension.ts:711/712` 消费 → `chat-panel-host.ts:131`/`protocol.ts:179` 线契约 → Webview `matchTiers` 读取 | ✅ | `chat-ux-session-search` + `editor-chat-phase2` + `layer-b-host` 等搜索用例通过；Host 类型改名后与 webview bundle（已用复数）一致 |
| `requestSearchSessions` 契约 ← `extension.ts:1403` 返回 `controller.searchSessions()` | ✅ | 无 `as` 断言，`tsc` 类型闭合 |
| `executeRevert`/`executeRevertMany` → `skipWrite`/`confirmGate` 缺省语义 | ✅ | `phase3-review-revert-replay` 用例通过 + 守卫复核 |
| `streamingAssistant` Map 写 `{ messageId, turn? }` | ✅ | `chat-ux-streaming-cancel-follow` / `activity-stream` 用例通过 + 条件展开复核 |

## 残余风险

| 风险 | 严重性 | 说明 |
|------|:--:|------|
| 无 | — | 纯类型层修复，编译 + 93 运行时用例 + 静态残留 + 消费方守卫四重证据闭环，无未验证边界 |

## Pipeline 合规检查

- ✅ 5 个 bugfix 源文件（`session-search.ts`/`extension.ts`/`selection-ask.ts`/`revert.ts`/`conversation-controller.ts`）的改动全部位于 `impl-phase-1-fix` 分支（`git status -s` 显示 ` M`，当前分支 `impl-phase-1-fix`）。
- ⚠️ 观察项（非本 bugfix 引入）：工作区存在两类与本次类型修复无关的未提交改动——
  1. `apps/vscode-dsh/webview/dist/assets/index.css` / `index.js`：mtime `2026-09-14 09:21`（早于本 Phase 开始），系上一 `vscode-dsh-chat-ux` feature 的 webview 构建残留，内容为 CSS 属性重排 + bundle 重压缩（已含 `matchTiers` 复数），与本次 5 文件类型修复无关联。
  2. `packages/*/src/*.js` / `*.d.ts` / `*.map`（大量 untracked）：`tsc -b`（含 `--force`）对 composite 引用项目无 outDir 时 emit 到源目录的构建产物，是编译门禁的固有副作用（spec 已声明「tsc -b 会自动构建引用图」）。
- 结论：合规层面无违反——bugfix 自身的非 specs 改动（5 源文件）均在 impl 分支上。

## 验证脚本

- `test-scripts/run-verifier-phase1.sh` — 一键复跑编译门禁 + 静态残留 + 运行时回归 + 语义等价抽查。

## 环境

- Node `v24.3.0`（`/usr/local/n/versions/node/24.3.0/bin`，符合仓库 `node ^22.19 || >=24` 支持范围）
- vitest `v4.1.8`
- 仓库默认 PATH 的 Node 为 `v20.16.0`（不在支持范围），故显式 `export PATH` 指向 Node 24 后运行。
