# Phase 1 验证报告 — phase-1-deterministic-fixes

## 判决：PASS

## 测试执行矩阵

| 场景 | 来源 | 命令 | 结果 | 证据 |
|------|:--:|------|:--:|------|
| AC-2 DEBT-9 词边界单测 | spec | `pnpm exec vitest run apps/vscode-dsh/tests/cap-code-context.spec.ts` | ✅ | Test Files 1 passed / Tests 28 passed（含 CAP-CODE-CONTEXT-024~028） |
| AC-2 DEBT-9 类型检查 | spec | `node_modules/.bin/tsc --noEmit -p apps/vscode-dsh/tsconfig.json` | ✅ | exit 0，无类型错误 |
| AC-3 DEBT-9 真机闭环（正向，带 key） | spec | `bash apps/vscode-dsh/test-scripts/run-layer-v-capabilities.sh --capability cap-selection-ask` | ✅ | `conclusion=PASS`，runId `20260920T021225Z-406454`，`ask-about-selection` 步返回 `{ok:true, path:"apps/vscode-dsh/package.json"}` |
| AC-3 DEBT-9 真机闭环（负向，无 key） | spec | `env -u DEEPSEEK_API_KEY bash ... --capability cap-selection-ask` | ✅ | `SKIPPED_NO_CREDENTIALS` exit 3（`requiresModel:true` fail-closed） |
| AC-10 DEBT-8 真机往返（带 key） | spec | `bash ... --capability cap-history-panel --capability cap-message-list-streaming` | ✅ | `conclusion=PASS`，runId `20260920T021325Z-424354`，两项 `closedLoop.closed=true` 三齐 |
| AC-11 DEBT-11 脚本删除 + 守卫 | spec | `grep -rn "run-chat-ready-regression" apps/vscode-dsh/tests scripts/ apps/vscode-dsh/README.md apps/vscode-dsh/README.zh.md` | ✅ | 4 处守卫零残留；仅剩 `assertion-map.md:471`（drop 台账）与 `run-layer-v-smoke.sh:89`（stale 注释），均非守卫 |
| AC-11/12 全量回归 | spec | `pnpm exec vitest run apps/vscode-dsh/tests` | ✅ | Test Files 12 passed / Tests 560 passed |
| AC-11/12 脚本语法护栏 | spec | `bash scripts/check-test-scripts-syntax.sh` | ✅ | `6 shell asset(s) parse`，exit 0 |
| AC-1 范围授权 | spec | `git diff --name-only -- apps/vscode-dsh/src/ packages/core/agent-loop` | ✅ | 仅 `selection-ask.ts` + `index.ts`（barrel），无 agent-loop 改动 |

## 独立验证场景（我自己设计的）

| 场景 | 命令/方法 | 结果 |
|------|------|:--:|
| 函数体独立判读（不依赖 implementer 断言） | 逐行读 `selection-ask.ts:147-161` `isLanguageIdTokenLeaked`：`package.json` 中 `json` 前邻 `.`（路径 token 字符）→ 不判泄漏；`@foo/json` 前邻 `/` 后邻空格 → 判泄漏；空 languageId 短路 `return false` | ✅ |
| 真机前先重建产物，避免测到 stale 代码 | 实测 `apps/vscode-dsh/lib/` 未含 `isLanguageIdTokenLeaked`（实现只跑了 `tsc --noEmit` 未 build）→ `pnpm run build:host` 后 `grep -rln isLanguageIdTokenLeaked apps/vscode-dsh/lib/` 命中新 chunk `extension-CItkimG8.js`，旧 `includes(doc.languageId)` 消失 | ✅ |
| 流式增量真实捕获（AC-10 独立复核） | 读 runId `20260920T021325Z-424354` journal：`streamed-message` 步 `sawStreaming=true, sawGrowth=true`，证明 `requireIncrement:true` 真实捕获了分段落流式增量（非 `$assistantContains` 一次性匹配） | ✅ |
| 守卫穷尽复查（防第 5 处遗漏） | 全仓 grep `run-chat-ready-regression`（排除 `.specdev/specs` / `docs/wiki` / `.explore`）→ 仅 `assertion-map.md`（drop 台账）与 `run-layer-v-smoke.sh:89`（注释） | ✅ |

## Reviewer 建议的验证场景

| 场景 | 命令 | 结果 |
|------|------|:--:|
| 台账双向差集（reviewer-correctness should-fix 已回填） | grep `CAP-TEST-HARNESS-083` 于 `apps/vscode-dsh/tests/` + `scripts/` → 零命中；`capability-domains.json` `entryAssertions[].caps` 已移除该 ID；`assertion-map.md:471` 该行 keep→drop（D4） | ✅ |
| DEBT-8 断言原语注册齐全（reviewer-connectivity） | `layer-v-capabilities.json` 可解析，`cap-history-panel` steps 含 `sendPrompt`→`closed-turn`→`listHistory`（断言 `0.firstUserPreview $contains:LAYER-V-CAP-41-OK`）；`cap-message-list-streaming` steps 含 `sendPrompt`→`stream`（`$assistantContains:LAYER-V-CAP-42-OK`, `requireIncrement:true`） | ✅ |

## 端到端验证

| 数据路径 | 结果 | 证据 |
|------|:--:|------|
| 选区提问：编辑 `apps/vscode-dsh/package.json` → `dsh.test.openEditorWithSelection` → `dsh.test.askAboutSelection` 返回 `{ok:true, path}` → `sendPrompt` → 模型回 `LAYER-V-CAP-26-OK` | ✅ | runId `20260920T021225Z-406454`，journal 全步 PASS，`cap-selection-ask.png`（701KB） |
| 历史窗口：`sendPrompt`(LAYER-V-CAP-41-OK) → `closed-turn` → `listHistory` 断言 `firstUserPreview` 含 marker → 截图 | ✅ | runId `20260920T021325Z-424354`，`history-panel-lists-the-real-session` PASS，`cap-history-panel.png`（695KB） |
| 消息流式：`sendPrompt`(四段指令 LAYER-V-CAP-42-OK) → `stream` 步捕获增量（`sawGrowth=true`）→ 截图 | ✅ | runId `20260920T021325Z-424354`，`streamed-message` PASS，`cap-message-list-streaming.png`（723KB） |

## 视觉验证

`ui: false`（本 Phase 无 UI 变更），跳过视觉验证矩阵。真机截图作为闭环证据（`realScreenshot:true`），非「被设计的界面」验证。

## 残余风险

| 风险 | 严重性 | 阻塞 HG-3 | 说明 |
|------|:--:|:--:|------|
| `capability-domains.json:674` `absorbed` 数组仍列 `chat-ready-regression.spec.ts` | 🟢 LOW | 否 | 历史「已被归并」台账记录，非对已删脚本的守卫引用；`capability-domains.json` 无活跃测试/脚本消费方（仅旧工作流 `.specdev/.../verify-phase*.cjs` 历史脚本引用），零功能影响 |
| `run-layer-v-smoke.sh:89` 注释仍提 `run-chat-ready-regression.sh` | 🟢 LOW | 否 | stale 注释（`test-scripts/` 内、非 `scripts/`），非守卫、`bash -n` 不受影响；implementation.md 已注明 |
| `isLanguageIdTokenLeaked` 字符集 `[A-Za-z0-9._-]` 对 `+`/`$`/`!` 理论误判 | 🟢 LOW | 否 | 无标准 languageId 含这些字符，且与 design.md 冻结算法一致（reviewer 已观察） |
| 真机产物需先重建（实现只跑了 `tsc --noEmit`） | 🟢 LOW | 否 | 属构建环节而非代码缺陷；本验证已 `pnpm run build:host` 重建后复验；CI/发布链路会自行重建 |

无 🔴 / 🟡 残余风险。

## Pipeline 合规检查

- ✅ 当前分支 `impl-phase-1-deterministic-fixes`，本 Phase 全部非 spec 文件改动（`selection-ask.ts` / `index.ts` / `cap-code-context.spec.ts` / `layer-v-capabilities.json` / `run-chat-ready-regression.sh`(D) / `cap-test-harness.spec.ts` / `check-test-scripts-syntax.sh` / `capability-domains.json` / `README.md` / `README.zh.md` / `assertion-map.md`）均在工作区、位于 `impl-*` 分支，未提交到 main。
- ✅ 无 `@STUB` / `TODO` / `FIXME` / `XXX` 残留于改动 src。
- ✅ 无 agent-loop / 无其他业务逻辑改动（AC-1）。
- 说明：工作区内另有 `.cursor/`、`.gitignore`、其他工作流 `.specdev/specs/<other-slug>/` 等预存在改动/未跟踪文件，与本 Phase 无关，非本 Phase 产物。

## 验证脚本

本 Phase 全部复用既有命令与既有真机驱动脚本，无新增临时脚本（故无需落盘 `test-scripts/`）。关键命令：

```bash
# 单测 + 全量回归
pnpm exec vitest run apps/vscode-dsh/tests/cap-code-context.spec.ts
pnpm exec vitest run apps/vscode-dsh/tests
bash scripts/check-test-scripts-syntax.sh
node_modules/.bin/tsc --noEmit -p apps/vscode-dsh/tsconfig.json

# 真机（重建产物后）
cd apps/vscode-dsh && pnpm run build:host && cd ../..
export DEEPSEEK_API_KEY="$(grep '^DEEPSEEK_API_KEY=' .env | head -1 | cut -d= -f2- | tr -d '\r')"
bash apps/vscode-dsh/test-scripts/run-layer-v-capabilities.sh --capability cap-selection-ask
bash apps/vscode-dsh/test-scripts/run-layer-v-capabilities.sh --capability cap-history-panel --capability cap-message-list-streaming
env -u DEEPSEEK_API_KEY bash apps/vscode-dsh/test-scripts/run-layer-v-capabilities.sh --capability cap-selection-ask
```

真机证据（截图 + status/journal）落盘于：
- `apps/vscode-dsh/test-artifacts/layer-v-capabilities/runs/20260920T021225Z-406454/`（AC-3，cap-selection-ask）
- `apps/vscode-dsh/test-artifacts/layer-v-capabilities/runs/20260920T021325Z-424354/`（AC-10，cap-history-panel + cap-message-list-streaming）

## 结论

三条债务（DEBT-9 产品 bug / DEBT-8 manifest 修正 / DEBT-11 过时脚本清理）静态、单测、全量回归、真机闭环四层全部独立复验通过。DEBT-9 词边界判定修复经真机以 `package.json` 探针闭环（`ask-about-selection` 返回 `{ok:true, path}` 而非 `path-unrepresentable`）；DEBT-8 两项 `requiresModel:true` 翻转后经真实模型往返闭环（历史会话 `listHistory` 断言 + 流式增量 `sawGrowth=true` 捕获）；DEBT-11 脚本删除 + 4 处守卫清理后回归全绿。AC-1/2/3/10/11/12/13 全部通过，无 CRITICAL / MEDIUM 残余风险。
