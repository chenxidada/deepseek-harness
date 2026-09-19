# Connectivity Review — Phase 2 (tests 归并、编号与筛选)

## 视角
**Integration Connectivity** — 模块间是否真正连通

## 判决：PASS

## 端到端路径追踪

### Path 1: 12 域文件 → 被测 src/webview 模块 import 链路
```
Entry: 12 个 cap-<domain>.spec.ts|tsx（apps/vscode-dsh/tests/）
  → import '../src/<module>.ts' / '../src/<group>/<module>.ts'   ✅ 全部解析到真实文件
  → import '../webview/src/App.tsx' / bridge / probes / store    ✅ 全部解析到真实文件
  → import '@deepseek-ai/dsh-*' (agent/session/llm/... 包)      ✅ 与仓库其余测试一致
Exit: 0 个悬空 import
```
**判定**: ✅ 相对 import 共 107 处（12 域文件 + 3 helper），逐一 `os.path` 解析全部命中真实文件；仅有 2 处正则误报（`./extension-chunk.js`、`./extension-dangling.js` 是 `cap-test-harness.spec.ts:920/923/1021` 测试内写盘 fixture 字符串内容，非静态 import）。

### Path 2: fixture `fake-sdk-runtime.mjs` 依赖连通
```
Entry: cap-conversation(3) + cap-interaction(4) + cap-session-host(2) + cap-timeline(2) = 11 处引用
  → fileURLToPath(new URL('./fixtures/fake-sdk-runtime.mjs', import.meta.url))  ✅ 从 tests/ 根解析
  → fixtures/fake-sdk-runtime.mjs 实际存在                                   ✅
Exit: 真实子进程运行时可定位
```
**判定**: ✅ 11 处引用全部指向存在的 `fixtures/fake-sdk-runtime.mjs`；域文件在 tests 根，`./fixtures/` 相对深度无需改动。

### Path 3: 3 个 spike helper 依赖连通（保留而非删除的依据）
```
Entry: cap-timeline.spec.ts:14 → ./spike-attribution-helpers.ts            ✅ 存在
       cap-test-harness.spec.ts:1 → ./spike-t0a-replay-hydrator.ts         ✅ 存在
       cap-test-harness.spec.ts:2 → ./spike-t0b-continue-helpers.ts        ✅ 存在
  helper 自身 import：
    spike-attribution-helpers.ts → ../src/timeline-store.ts + ../src/replay-hydrator.ts  ✅ 真实 src 模块
    spike-t0a-replay-hydrator.ts → @deepseek-ai/dsh-session                ✅ 包存在
    spike-t0b-continue-helpers.ts → @deepseek-ai/dsh-llm + dsh-session     ✅ 包存在
Exit: 无 helper import 已删除旧 spec
```
**判定**: ✅ 3 helper 均被保留域文件真实 import（偏差 2 成立），且 helper 自身只依赖 src 模块与 `@deepseek-ai/dsh-*` 包，不 import 任何已删除旧 spec。

### Path 4: entryAssertions.entrypoint → src 真实命令/导出
```
Entry: capability-domains.json 每域 entrypoint
  activate / dsh.test.newConversation / dsh.test.listHistory / dsh.test.injectApproval /
  dsh.test.resolveAtPath / dsh.test.listChanges / dsh.test.searchSessions /
  dsh.showPanel / createMessageBridge / dsh.test.simulateStartupOnly
  → 9 个 dsh.* 命令全部在 src/extension.ts registerCommand 定位（:512/:564/:1079/:1170/:1243/:1339/:1392/:1419/:1452）  ✅
  → createMessageBridge 在 webview/src/bridge/message-bridge.ts:64 export                ✅
Exit: 10 域 entrypoint 全部映射到真实 src 入口
```
**判定**: ✅ 全部 entrypoint 可判定，无悬空命令 id / 导出符号。

### Path 5: 台账「新 CAP- 编号」→ 树中 grep 反查
```
Entry: assertion-map.md 556 行（543 keep + 13 drop）
  → 树中 556 个唯一 CAP（grep -rhoE ... | sort -u）
  → 台账 556 个唯一 CAP（正则抽取）
  → tree - ledger = ∅ 且 ledger - tree = ∅                     ✅ 双向差集为空
  → 2 行 it.each 多值行：CAP-TEST-HARNESS-065..072 / 074..080 全部在树中 grep 到  ✅
Exit: 每个 keep 行新编号可反查到真实断言
```
**判定**: ✅ 双向差集为空；偏差 3 的 2 行多值编号（8+7）逐号均存在于 `cap-test-harness.spec.ts`。

## 上下游连接检查

| 新文件/组件 | 上游（谁消费） | 连接状态 | 下游（依赖谁） | 连接状态 |
|------------|--------------|:--:|--------------|:--:|
| 12 域文件 `cap-*.spec.ts|tsx` | `vitest run apps/vscode-dsh/tests`（glob 发现） | ✅ | `../src/**` / `../webview/src/**` / `@deepseek-ai/dsh-*` | ✅ |
| `fake-sdk-runtime.mjs` | 4 域 11 处 `new URL(...)` | ✅ | 独立 .mjs（无外部依赖） | ✅ |
| `spike-attribution-helpers.ts` | `cap-timeline.spec.ts` | ✅ | `../src/timeline-store.ts` / `../src/replay-hydrator.ts` | ✅ |
| `spike-t0a-replay-hydrator.ts` | `cap-test-harness.spec.ts` | ✅ | `@deepseek-ai/dsh-session` | ✅ |
| `spike-t0b-continue-helpers.ts` | `cap-test-harness.spec.ts` | ✅ | `@deepseek-ai/dsh-llm` / `dsh-session` | ✅ |
| `assertion-map.md` | reviewer/verifier 反查 | ✅ | 域文件内 CAP 编号（真实存在） | ✅ |
| `capability-domains.json` | Phase 4 lint / AC-2 / AC-11 | ✅ | `absorbed` 文件集 / entryAssertions.caps | ✅ |

## 跨模块契约验证

| 模块间 | 调用方期望 | 被调用方实际 | 一致？ |
|--------|-----------|-------------|:--:|
| 域文件 → `../src/<module>.ts` | 相对路径可解析到文件 | 107 处 import 全部命中真实文件 | ✅ |
| `entrypoint` 字符串 → `extension.ts` | 命令 id 已注册 | 9 个 `dsh.*` 命令逐一 grep 命中 | ✅ |
| `entrypoint: createMessageBridge` → `message-bridge.ts` | 导出符号存在 | `export function createMessageBridge` (:64) | ✅ |
| `entryAssertions.caps` → 域 spec | 每 cap 在该域 spec 且域段一致 | 10 域 caps 全部命中、0 缺失、0 重复、0 跨域段 | ✅ |
| 台账「新 CAP- 编号」→ 树 | 编号真实存在 | 双向差集为空 | ✅ |
| 台账「K 依据 / D1 关闭依据」`路径:行号` → 仓库 | 路径存在 + 行号不越界 | 553 处引用：0 缺失、0 越界 | ✅ |

## 跨 Phase 依赖检查

| 本 Phase 依赖 | 来自 Phase | 接口状态 | 连接状态 |
|--------------|:--:|:--:|:--:|
| `capability-domains.json` 骨架（10 域 + absorbed + entryAssertions 骨架） | Phase-1 | 已冻结，本 Phase 只回填 caps | ✅ |
| `assertion-map.md` 556 行骨架（原文件/原标题两列） | Phase-1 | 已冻结，本 Phase 回填其余 9 列 | ✅ |
| 61 个整合前 spec 文件集（absorbed 双向差集基线） | Phase-1 | 已冻结 | ✅（12 域 absorbed 并集 = 61 文件，无遗漏无重复） |
| 被测 `src/**` / `webview/src/**` 模块 | 既有（非本工作流产物） | 本 Phase 不修改（AC-24） | ✅ |
| Phase-4 lint 收口的输入契约（定稿 tests 文件集） | 本 Phase → Phase-4 | 12 个 cap-*.spec 定稿，无旧 spec 残留 | ✅ |

## 关键发现
### 🔴 Must-Fix
- 无。

### 🟡 Should-Fix
- 无。

### 🟢 Observations
- `[文档保真]` `assertion-map.md` 头部注释（第 1–4 行）仍写「Phase 1 骨架 / 其余 9 列留空占位，待 Phase 2 逐条回填」——Phase 2 已回填完成，该说明已过期，但台账数据本身正确，属说明文字失实、零交付物影响。
- `apps/vscode-dsh/tests/` 下 `layer-a/`、`layer-a-rtl/`、`verifier-phase1/`、`verifier-phase2/` 四个空目录仍物理存在（已无文件）。AC-1 字面要求「必须不存在 verifier-phase<数字> 目录」，但 AC-1 判定命令 `find ... -type f` 只扫文件，不命中空目录；且空目录不会被 git 追踪、不影响 Phase 4 的 glob lint。属清理项，非连通性阻断。
- `tests/` 下残留 `_probe-tsconfig.tsbuildinfo`、`.tsconfig.probe-base.tsbuildinfo` 两个 tsbuildinfo 缓存文件（Phase 1 基线探针产物），非 spec、非台账，不影响本 Phase 连通。

## 结论

集成连通性全绿：107 处相对 import 无悬空、fixture 与 3 个 spike helper 依赖闭合、10 域 entryAssertions 全部映射真实 src 入口、台账 556 CAP 与树 556 CAP 双向差集为空、553 处 `路径:行号` 证据全部指向真实位置且行号不越界。Phase 2 产出（12 域文件 + 台账 + capability-domains.json）满足 Phase 4 lint 收口的输入契约。
