# Phase 1 验证报告 — phase-1-code-context（polish 复验）

## 判决：PASS

上一轮 PARTIAL 的三项（GAP-CCD-012 / GAP-CCD-013 / DEBT-CCD-002）均已用**独立探针**复现为「已修复」行为；主路径 AC-1/2/3/3a/3b/4 L2 回归仍绿。Registry 中 012/013/002 仅在「已解决」，不在「活跃债务」。

---

## 测试执行矩阵

| 场景 | 来源 | 命令 | 结果 | 证据 |
|------|:--:|------|:--:|------|
| AC-1…4 + polish L2（含 multi-root open / cold-start prefill / meta open） | spec / implementer | `vitest run apps/vscode-dsh/tests/phase1-code-context.spec.ts packages/bundle/ide/tests/ide.spec.ts` | ✅ | **24 passed** (2 files)；含 `planReferenceOpen scans all roots…`、`prefillComposer before attach…`、`SelectionMetaStore lines…` |
| AC-1 clean-doc → Host send pointer-only e2e | verifier independent | `vitest --config …/test-scripts/vitest.config.ts` | ✅ | saveCalls=0；prompt 无 SECRET body |
| AC-2 empty selection | spec | phase1-code-context.spec.ts | ✅ | empty-selection；无 prefill |
| AC-3 gate + reject + no body inject | spec | phase1 suite | ✅ | 原样 @；not-found reject |
| AC-3 quoted spaces via Host | verifier independent | independent suite | ✅ | `@"notes/my design.md"` as-is |
| AC-3a ①②③④⑤ + after-final | spec | phase1 suite | ✅ | fail/fail/pass/pass/fail 矩阵 |
| AC-3a alias / N-2 last assistant / offset-limit / spaces cover / param variation | verifier independent | independent suite | ✅ | 非常量桩；`path` alias 覆盖 |
| AC-3b ide mount + FILE_REFERENCE assemble | spec + reviewer | ide.spec + `file-reference-local … -t "installs read-tool guidance"` | ✅ | 1 passed (+4 skipped in file) |
| AC-3b agent-loop untouched | static | `git diff --name-only main...HEAD` | ✅ | no `packages/core/agent-loop` |
| AC-4 ref-card + meta open semantics | spec + verifier | phase1 + independent | ✅ | meta→0-based；不解析 NL |
| **GAP-CCD-012 closed**：preferred miss → `planReferenceOpen` 扫全 root | focus / prior PARTIAL | independent + implementer | ✅ | abs 落在 non-preferred root；`existsSync` true |
| **GAP-CCD-012 e2e**：gate+open+meta（verifier 新探针） | verifier independent | independent suite | ✅ | preferred=rootA 仍打开 rootB + selection 4–7 |
| **GAP-CCD-013 closed**：prefill before attach replay | focus / prior PARTIAL | independent + implementer | ✅ | attach 后收到 `composer/prefill` |
| **GAP-CCD-013 latest-wins**（verifier 新探针） | verifier independent | independent suite | ✅ | 两次 prefill 只重放 latest；二次 attach 不重放 |
| **DEBT-CCD-002**：stub ≠ true-model 显式文档 | focus / AC-3a Must | independent file-read assert + static | ✅ | `ref-read-coverage.ts` + phase1 test header + `implementation.md` §AC-3a |
| P1-1/2/3 / P2-A / P2 AD-CCD-15 / P2-3 read | spec | phase1 + static | ✅ | 无 `unreadable`；`file_path`；ide 继承 read |
| 回归 panel L2 | regression | `panel-l2-l3-protocol.spec.ts` | ✅ | **6 passed** |
| Registry 012/013/002 | tech-debt | 读 `tech-debt-registry.md` | ✅ | 仅在「已解决」；活跃表无此三项 |

**一键脚本**：`bash …/test-scripts/run-verifier-phase1.sh` → exit **0**  
汇总：**implementer 24** + **FILE_REFERENCE 1** + **panel 6** + **verifier independent 15** = 全部通过。

---

## 独立验证场景（verifier 自设计）

| 场景 | 命令 | 结果 |
|------|------|:--:|
| Clean 选区预填 → Host 发送无正文 | independent vitest | ✅ |
| 空格路径 Host 发送 | independent | ✅ |
| AC-3a：`path` alias / N-2 末条 assistant / offset+limit / 引号空格 / 参数变化 | independent | ✅ |
| AC-4 meta→selection；Host `action/open-reference` | independent | ✅ |
| 多 root：preferred miss 打开对齐门禁（原 PARTIAL 复现 → 现应成功） | independent | ✅ |
| 冷启动：attach 前 prefill 重放（原 PARTIAL 复现 → 现应成功） | independent | ✅ |
| **新**：多 prefill 只重放 latest + clear | independent | ✅ |
| **新**：gate+open+meta 仅在非 preferred root | independent | ✅ |
| **新**：DEBT-002 源文件头显式 stub ≠ true-model | independent | ✅ |
| P1-2 无 `unreadable` reason | independent | ✅ |

**独立套件**：`Test Files 1 passed / Tests 15 passed`（exit 0）。

---

## Reviewer 建议的验证场景

| 场景 | 命令 | 结果 |
|------|------|:--:|
| 重跑 implementer 主套件 | phase1 + ide.spec | ✅ 24 passed |
| FILE_REFERENCE prompt 组装 | file-reference-local guidance | ✅ 1 passed |
| panel 回归 | panel-l2-l3-protocol | ✅ 6 passed |
| 合并审查 PASS 后的 polish 焦点 | GAP-012/013 + DEBT-002 | ✅ 独立复验通过 |

---

## 端到端验证

| 数据路径 | 结果 | 证据 |
|----------|:--:|------|
| **Path B′**：clean selection → `askAboutSelection` → pointer + meta → `ChatPanelHost.sendPrompt` → 原样文本（无磁盘正文） | ✅ | independent e2e；无 SECRET |
| **Path A′**：composer `@` → `validateComposerAtPaths` → accept/reject | ✅ | implementer + spaces Host |
| **Path C**：ide 预挂载 `file-reference-local` + read 时组装 FILE_REFERENCE | ✅ | ide.spec + REAL guidance test |
| **AC-3a stub**：session-log covering-path（**≠ 真模型保证**，已文档化） | ✅ | ①–⑤ + independent；DEBT-002 关闭 |
| **Open 对齐门禁**：`@` 仅在非 preferred root → gate ok → `planReferenceOpen` abs 正确 + meta 行号 | ✅ | independent GAP-012 e2e |
| **Cold-start**：`prefillComposer` →（无 port）→ `attach` 重放 latest | ✅ | independent GAP-013 + latest-wins |

---

## 残余风险

| 风险 | 严重性 | 说明 |
|------|:------:|------|
| AC-3a L2 stub 不证明生产模型总会 read | 🟢 LOW | 规格要求「文档注明 stub ≠ 真模型」；DEBT-CCD-002 已关闭。属产品契约边界，非本 Phase 缺陷。 |
| AC-3b idle 为模块加载代理（偏差 2） | 🟢 LOW | spec 无硬阈值；implementation 已记录；不影响 FILE_REFERENCE 挂载验收。 |
| P2-A 未回写 design.md AD-CCD-14 主字段名 | 🟢 LOW | implementer Must Not 改 design；以 `pathsFromReadToolArgs` 为准（沿用偏差 1）。 |

无 CRITICAL / MEDIUM 残余风险；先前 PARTIAL 的 MEDIUM 边界（012/013）已关闭。

---

## Pipeline 合规检查

- 当前分支：`impl-phase-1-code-context` ✅
- `packages/core/agent-loop`：无改动 ✅
- 代码改动位于 `apps/vscode-dsh/**`、`packages/bundle/ide/**`（工作区未提交，符合「implementer 不自行 commit、HG-3 统一提交」）✅
- Pipeline compliance: ✅ 所有本 Phase 实现变更在 `impl-*` 分支工作区

---

## 验证脚本

| 脚本 | 用途 |
|------|------|
| `test-scripts/run-verifier-phase1.sh` | 一键：implementer 主套件 + FILE_REFERENCE + panel 回归 + independent |
| `test-scripts/verifier-independent-phase1.spec.ts` | verifier 自有 15 场景（含 polish 复验与 latest-wins / gate+open+meta / DEBT-002 文档断言） |
| `test-scripts/vitest.config.ts` | independent 隔离配置 |

运行：

```bash
source ~/.nvm/nvm.sh && nvm use 22.14.0
bash .specdev/specs/vscode-dsh-code-context-diff/phases/phase-1-code-context/test-scripts/run-verifier-phase1.sh
```
