# Correctness Review — Phase 2（tests 归并、编号与筛选）

## 视角
**Implementation Correctness** — 代码是否正确工作（亲自复核，不轻信自陈）

## 判决
**SHOULD-FIX**

> 核心功能全部正确：556 用例全绿、CAP 编号全树唯一、台账 556 行双向差集为空、13 条 drop 理由码与所指对象齐全。唯一未完全满足的是 AC-10 的次级条款——78 个 `describe` 标题与 35 条注释仍含**未带工作流限定的裸 `AC-<n>`**（0 条工作流限定引用）。该偏差不破坏功能与编号迁移，但违反「既有需求引用只允许出现在注释中且必须带工作流限定」。

## 逐条 AC 验证

| AC | 描述 | 判定 | 证据 |
|----|------|:--:|------|
| AC-1 | 文件名归并为 `cap-<domain>`，无 phase/gap/spike/verifier-phase 命名 | ✅ | `find tests -name '*.spec.ts' -o -name '*.spec.tsx' \| grep -E 'phase[0-9]\|gap-[0-9]\|spike-\|verifier-phase'` 输出为空；树内仅 12 个 `cap-*.spec.ts|tsx` |
| AC-2 | `absorbed` 并集 = 61 整合前 spec，双向差集为空 | ✅ | `capability-domains.json` 的 `absorbed` 并集 = 61（唯一、无重复）；与树内 12 个域文件双向差集为空 |
| AC-3 | 每域含顶层 `describe('cap:<domain> — ')`，域 id 集合 = 清单 | ✅ | 全树 `describe('cap:...` 域 id 集合 = 10 域（change-list/chat-panel 各 2 处，其余 1 处），与清单 10 域完全一致 |
| AC-6 | 每个 `it`/`test` 标题含恰好一个 `CAP-<DOMAIN>-<NNN>` | ✅ | 锚定正则统计 556 个 `it(`/`it.each(`/`test(` 声明，0 个标题 CAP 计数 ≠ 1 |
| AC-7 | `CAP-` 编号全树唯一 | ✅ | `grep -rhoE 'CAP-...' \| sort \| uniq -d` 为空；全树 556 个唯一 CAP |
| AC-8 | 编号格式合法、域段与文件一致 | ✅ | 逐文件核对 `CAP-<SEGMENT>-<NNN>` 的 segment 与文件名域一致，0 处错配 |
| AC-9 | 台账 556 行，双向差集为空，字段完整 | ✅ | `assertion-map.md` 556 数据行（543 keep + 13 drop）、11 列齐全；程序化核对：台账 CAP 集合（556）↔ 树内 CAP 集合（556）双向差集均空；keep 行新编号全部在树中可 grep |
| AC-10 | 编号迁移到 CAP；it/test 标题无裸 AC；需求引用仅限限定注释 | ⚠️ | it/test 标题 0 裸 AC ✅；但 **78 个 describe 标题 + 35 条注释含裸 `AC-<n>`（无工作流限定），0 条 `AC[...]-n` 限定引用**（见 Should-Fix #1） |
| AC-11 | 每域 `entryAssertions` 非空，entrypoint→caps 可判定 | ✅ | 10 域 `entryAssertions` 均非空；10 个 entrypoint 在 `src/`/`webview/src/` 均可 grep（`dsh.test.*` 命令 1 命中、`createMessageBridge` 3 命中）；caps 全部指向树中真实 CAP（见 Observation #1） |
| AC-12 | 每条 drop 恰一个 D1–D4，所指对象字段完整 | ✅ | 13 条 drop = 10 D1 + 3 D2；D1 均带固化依据（`路径:行号`，路径存在不越界）；D2 均带非空 `privateSymbols`；0 条空/多理由码 |
| AC-13 | 完整域文件运行（非只跑新增块） | ✅ | 实现记录并复现 `vitest run apps/vscode-dsh/tests`（全 12 域文件 / 556 用例） |
| AC-24 | 不修改生产代码 | ✅ | `git status` 中 `apps/vscode-dsh/src|webview`、`packages/` 无 `M`/`A` 改动（仅 `tests/` 的 D/M + 未跟踪 cap 文件；`packages/typert/generator/tests/.generated-tools-*` 为运行产生的未跟踪临时目录，非代码修改） |
| AC-25 | 不产生旧产物副本（无 `.archive/`、无 `*-old.spec.ts`） | ✅ | `find tests -name '.archive' -o -name '*-old.spec.ts' -o -name '.verifier-baseline.json'` 为空 |
| AC-26 | spike/gap 5 文件归域 + 每条断言台账有处置 | ✅ | 5 文件（gap-003-004/gap-005-009/spike-attribution/spike-t0a/spike-t0b）均在 `absorbed` 归属；其全部用例标题在台账可查处置 |
| AC-27 | 台账每行 keepChecks 三 bool；K=true 行给有效 `路径:行号` | ✅ | 程序化核对 543 keep 行：每行 `true/false/...` 三 bool，K=true 行 `K 依据` 路径均存在且行号不越界；0 条「keepCheck=true 却 drop」 |
| AC-28 | drop 行理由码恰一 D | ✅ | 13 条 drop 每条恰好 1 个 D（`D1`=10、`D2`=3），0 条 0 个或 ≥2 个 |
| AC-29 | 筛选硬约束（不以 D1/D2 删 K 项、D2 私有符号可 grep、无未标 weakened 弱化） | ✅ | 0 条「keepCheck=true 却 drop」；3 条 D2 的 `privateSymbols` 均在**原文件内 grep 到**（`git show HEAD` 复核：`onDidSaveTextDocument`@L86、`SNAPSHOT_STORE_SPIKE`@L13/141/147、`showErrorMessage`@L45/68）；`weakened` 全部 `false`，0 条弱化 |

## Stub Detection（桩代码检测）

### 已注册桩（对照 registry）
- registry「活跃债务」表为空，无已知桩。

### 新发现的未注册桩
- 无。全树无 `@STUB`、无 `it.skip`/`it.todo`、无硬编码空壳返回值。
- 唯一 `ctx.skip(`（`cap-session-host.spec.ts:1343`）是**运行时环境探测的合法条件跳过**（`ctx.skip(located.length === 0, ...)`，仅在找不到 Node 24 安装时跳过），非占位桩。

## 关键发现

### 🔴 Must-Fix
- 无。

### 🟡 Should-Fix
1. **AC-10 次级条款未完全满足**：78 个 `describe` 标题（如 `cap-timeline.spec.ts:26 describe('TimelineStore projector (AC-13/14/23)')`）与 35 条注释（如 `cap-timeline.spec.ts:549 // ... (AC-34).`）仍含**未带工作流限定的裸 `AC-<n>`**，全树 0 条 `AC[vscode-dsh-usable-loop]-n` 限定引用。AC-10 与 design 决策 2 均要求「既有需求引用只允许出现在**带工作流限定的注释**中」。建议：将 describe 标题中的 `AC-<n>` 迁移为带工作流限定形式，或移入注释并加限定；至少应统一口径（当前 `.tmp-clean-ac.mjs` 显示曾尝试清洗 describe 标题但未完成）。
2. **遗留临时脚本** `apps/vscode-dsh/tests/.tmp-clean-ac.mjs`（55 行，未跟踪）。属一次性归并辅助脚本（与已删除的 `.merge-tools/` 同类），但仍在 tests 目录内，HG-3 提交时有被误 `git add` 的风险。建议删除。
3. **4 个空目录残留**：`tests/verifier-phase1/`、`tests/verifier-phase2/`、`tests/layer-a/`、`tests/layer-a-rtl/`（全部为空，git 不跟踪空目录，但磁盘残留）。AC-1 判定为文件级故不阻断，建议清理。

### 🟢 Observations
1. **`entryAssertions` 映射过宽（语义，不阻断）**：每域 `entryAssertions` 在单一 `entrypoint` 下罗列该域**全部** caps（如 session-host `activate` → 144 caps、test-harness `dsh.test.simulateStartupOnly` → 131 caps）。机械三条件（① 在域 spec 内 ② 域段一致 ③ 在 it/test 标题）均满足，AC-11 判定通过；但「每个 cap 都覆盖该 entrypoint」语义上过宽（多数 cap 不直接断言入口行为）。是否收紧为「仅入口行为断言」属设计一致性判断，建议移交 reviewer-design 关注。
2. **D1 固化依据落「关闭依据」列**：design 数据模型将「关闭依据」标为「仅 D4 行」，但实际 D4=0，该列被 D1 行复用存放固化依据（`src/replay-hydrator.ts:363` 等）。依据本身存在且路径/行号有效，AC-12 满足；仅 schema 标注与实际用法有偏差。
3. **[文档保真]** `implementation.md` 的 keep/drop 统计**逐项复算一致**：keep=543、drop=13（D1=10/D2=3/D3=0/D4=0）；keep 理由码 K1=272、K1,K3=227、K1,K2=19、K1,K2,K3=25（合计 543）；「556 passed」测试结果**复现一致**（见下）。这些陈述准确，无失实。
4. **[文档保真]** `implementation.md` 偏差 3 称 `it.each` 展开为 `CAP-TEST-HARNESS-065..072`、`074..080`（8+7）。实际树中 073 属独立用例「accepts the sandbox home the shell created」（非 it.each 展开），故该范围描述无误；但表述「065..072、074..080」略去 073 的归属，易误读为编号有缺口。实际编号 058–082 连续无缺口。

## 测试结果（亲自复跑）

```
命令：/usr/local/n/versions/node/24.3.0/bin/node node_modules/vitest/vitest.mjs run apps/vscode-dsh/tests

 Test Files  12 passed (12)
      Tests  556 passed (556)
   Duration  8.92s
```

- Node 24.3.0 下 12 域文件全绿，0 failed，无 import 断裂 / hook 污染 / 误删导致的失败。
- 与 implementation.md 自陈「556 passed / 0 failed」一致。
