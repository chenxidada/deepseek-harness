# Phase 2 验证报告 — phase-2-tests-consolidation

## 判决：PASS

> 判决依据：16 项验收标准（AC-1/3/6/7/8/9/10/11/12/13/24/25/26/27/28/29）全部通过；唯一权威解释器 Node 24.3.0 下 `vitest run apps/vscode-dsh/tests` 全绿（12 files / 556 passed / 0 failed）；台账 556 行、CAP 全树唯一、AC-10 无裸 AC 均独立复测确认。

---

## 运行环境与解释器（AC-4/AC-14 前置）

| 项 | 值 |
|---|---|
| 权威解释器 | `/usr/local/n/versions/node/24.3.0/bin/node` → **v24.3.0** |
| 默认解释器（陷阱，不作基线） | `/home/chendc/.nvm/versions/node/v20.16.0/bin/node` → **v20.16.0** |
| 测试框架 | Vitest v4.1.8 |
| 运行分支 | `impl-phase-2-tests-consolidation`（自 `new/vscode-dsh` 切出） |

所有涉及 Node 的判定命令均以 `env PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH"` 显式携带解释器路径，规避 `~/.bashrc:151` 写死 v20 的环境陷阱。

---

## 测试执行矩阵（spec 验收标准）

| 场景 | 来源 | 命令 | 结果 | 证据 |
|------|:--:|------|:--:|------|
| AC-1 文件命名 | spec | `find apps/vscode-dsh/tests -type f \( -name '*.spec.ts' -o -name '*.spec.tsx' \) \| grep -E 'phase[0-9]\|gap-[0-9]\|spike-\|verifier-phase'` | ✅ | 输出为空；仅 12 个 `cap-*.spec.ts\|tsx` |
| AC-1 目录级 | spec | `find apps/vscode-dsh/tests -type d -name 'verifier-phase*'` | ✅ | 输出为空 |
| AC-2 absorbed 双向差集 | spec | 脚本 `verify-phase2.cjs`（absorbed 并集 vs 冻结 61 文件） | ✅ | 缺失 `[]`、多余 `[]`、重复 `[]`、并集 = 61 |
| AC-3 顶层 describe | spec | `grep -cE "^describe\('cap:" <spec>` 逐文件 | ✅ | 12 文件各 1 个顶层 `describe('cap:<domain> — ')`，域 id 集合 = 清单 10 域 |
| AC-6 每标题恰一 CAP | spec | 脚本逐 `it`/`test` 标题计数 CAP | ✅ | 556 条 `it`/`test` 声明，每标题恰 1 个 CAP，0 违例 |
| AC-7 CAP 全树唯一 | spec | `grep -rhoE 'CAP-[A-Z0-9-]+-[0-9]{3}' … \| sort \| uniq -d` | ✅ | 空；556 个唯一 CAP |
| AC-8 编号格式+域段一致 | spec | 脚本逐标题校验 `CAP-<DOMAIN>-<NNN>` 域段 = 文件域 | ✅ | 0 格式非法 / 0 域段不符 |
| AC-9 台账 556 行双向一致 | spec | 脚本解析 assertion-map.md | ✅ | 556 数据行 / 11 列；原文件 61 distinct；keep=543 drop=13；keep 新编号覆盖全 556 树 CAP |
| AC-10 无裸 AC | spec | `grep -rnE 'AC-[0-9]' … --include='*.spec.ts' --include='*.spec.tsx'` | ✅ | 0 命中（输出为空） |
| AC-11 entryAssertions | spec | 脚本 + `grep -rl <entrypoint> apps/vscode-dsh/src` | ✅ | 10 域 entryAssertions 非空，caps 全部在树 + 域段一致；entrypoint 均命中 `src/extension.ts` 等真实入口 |
| AC-12 drop 理由码 | spec | 脚本逐 drop 行校验 | ✅ | 13 drop 行，各恰一个 D（D1=10 / D2=3），D2 私有符号非空，D1 依据路径存在 |
| AC-13 完整域文件运行 | spec | `vitest run apps/vscode-dsh/tests`（全 12 域文件） | ✅ | 见下「端到端验证」 |
| AC-24 不改生产代码 | spec | `git status --porcelain -- apps/vscode-dsh/src apps/vscode-dsh/webview packages/` | ✅ | 无 M/A 改动（见残余风险 R-1） |
| AC-25 无副本 | spec | `find apps/vscode-dsh/tests -name '.archive' -o -name '*-old.spec.ts' -o -name '.verifier-baseline.json'` | ✅ | 输出为空 |
| AC-26 spike/gap 5 文件归域 | spec | 脚本（SPIKE_GAP_5 ⊆ absorbed） | ✅ | 5 文件均在 absorbed，且台账原文件集合含全部 61 文件 |
| AC-27 keepChecks | spec | 脚本（K=true → keep；K 依据路径存在+行号有效） | ✅ | 0 违例；543 条 K 依据路径全部存在且行号不越界 |
| AC-28 drop 恰一 D | spec | 脚本 | ✅ | 0 空/多理由码 |
| AC-29 筛选硬约束 | spec | 脚本（无 D1/D2 删 K；D2 私有符号可 grep；weakened 不计入 caps） | ✅ | 0 weakened；D2 符号在原文件可 grep；weakened 未入 entryAssertions |

---

## 端到端验证（AC-13 / AC-14）

命令（显式携带 Node 24.3.0）：

```bash
env PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" ./node_modules/.bin/vitest run apps/vscode-dsh/tests
```

实测输出（Vitest v4.1.8）：

```
Test Files  12 passed (12)
     Tests  556 passed (556)
   Duration  9.19s
```

`failed` = **0**，退出码 0。全 12 个域文件（含 `cap-change-list.dom` / `cap-chat-panel.dom` / `cap-webview.spec.tsx` 三个 jsdom 文件）完整运行，满足 AC-13「完整域文件运行」与 AC-14「failed = 0」双重要求。

> 域文件数（12）= 10 域 + 2 个 jsdom 拆分（change-list.dom / chat-panel.dom）。每文件 it-decl 数：session-host 144、test-harness 131、conversation 63、chat-panel 44+17、timeline 49、webview 36、code-context 23、change-list 16+7、interaction 20、search 6，合计 556。

---

## 独立验证场景（verifier 自设计，非 implementer 用例）

| # | 场景 | 命令/方法 | 结果 |
|:--:|------|------|:--:|
| V-1 | 台账「原文件」列与冻结 61 文件双向差集（防 Phase 2 回填时误增/删行） | `verify-phase2.cjs` 比对 FROZEN_61 | ✅ 双向为空 |
| V-2 | keep 行「新 CAP- 编号」集合与树中全部 CAP 的**双向**一致（防「有编号无测试」或「有测试无台账」） | 脚本：keep 新编号并集 vs 树 CAP 集 | ✅ 双向 = 556 |
| V-3 | keep 理由码与 keepChecks.K 三 bool **逐行**互相印证（防「理由码写 K1 但 keepChecks.K1=false」漂移） | 脚本：reason 集合 == keepChecks true 集合 | ✅ 0 不匹配 |
| V-4 | D1 依据路径与 D2 私有符号**真实可定位**（不信任自陈） | D1：路径存在+行号不越界；D2：`git show HEAD:<原文件>` grep 私有符号 | ✅ 全部命中 |
| V-5 | entrypoint 字符串映射 `src/` 真实入口（AC-11 三条件之一） | `grep -rl <entrypoint> apps/vscode-dsh/src` | ✅ 10 域 entrypoint 全部命中 `extension.ts` / `webview/src/bridge/message-bridge.ts` / `auto-start-orchestrator.ts` |
| V-6 | it.each 展开对账（偏差 3） | 台账 2 行静态声明 → 树中 8+7=15 个独立 `it`；`grep -rE 'it\.each\('` = 0 | ✅ 台账 556 行 ↔ 树 556 it 声明对齐，无 `it.each` 残留 |
| V-7 | 集成分支隔离（pipeline 合规） | `git branch --show-current` | ✅ `impl-phase-2-tests-consolidation` |

> 上述 V-1~V-6 全部封装进 `test-scripts/verify-phase2.cjs`（已落盘），可复算。

---

## Pipeline 合规检查

- 当前分支：`impl-phase-2-tests-consolidation`（`impl-*` 分支）。
- 非 specs 文件变更全部落在该分支工作区：61 个旧 spec 删除（`D`）、12 个 `cap-*.spec.ts|tsx` 新增（`??`）、`assertion-map.md` + `capability-domains.json` 修改（`M`）。
- `apps/vscode-dsh/tests/tsconfig.json`（Phase 4 范围）、`apps/vscode-dsh/test-scripts/`（Phase 3 范围）均**无改动**（`git status --porcelain` 为空）。
- `.merge-tools/`（一次性归并辅助）已删除（`ls` 不存在），符合偏差 1。

**Pipeline compliance: ✅ 所有变更在 impl-* 分支，无越界写面。**

---

## 残余风险

| 风险 | 严重性 | 阻塞 HG-3 | 说明 |
|------|:--:|:--:|------|
| R-1 `?? packages/typert/generator/tests/.generated-tools-Tlt0dU/`（未跟踪目录） | 🟢 LOW | 否 | 该目录含 `host.mjs`，mtime 为 **2026-09-15 16:18**（本工作流 9/18 启动之前），与 `packages/typert/generator/tests/` 下同类 `.generated-*` / `.typert-*` 暂存目录同源，是 typert generator 测试的遗留暂存物，**非本 Phase 产物**，且为 `??`（未跟踪）而非 `M`/`A`，不构成 AC-24「修改生产代码」。 |
| R-2 D1 依据的**语义**有效性（「replay-hydrator.ts:363 是否真固化 spike 结论」） | 🟡 语义判断 | 否 | 按 requirements AC-12 分工，属 `reviewer-correctness` 的语义判断。verifier 仅验证**机械可判定**部分：路径存在 + 行号不越界（已通过）。 |
| R-3 AC-25「行数比 > 0.9 且高度重合」第二副本 | 🟢 LOW | 否 | 域文件为多源聚合（12 文件 12K–187K，单一旧文件为小文件），构造上不存在「新文件 ≈ 某旧文件」的近似副本；`.archive`/`*-old.spec.ts`/`.verifier-baseline.json` 三者均已确认不存在。 |

> 无 🔴 CRITICAL、无 🟡 MEDIUM（非语义类）残余风险；R-2 语义判断已由 reviewer-correctness 在 `review.md` 复核留痕（判决 PASS）。

---

## 验证脚本

- `test-scripts/verify-phase2.cjs`（落盘）— 封装 AC-1/2/3/6/7/8/9/10/11/12/26/27/28/29 全部静态校验，含台账解析（正确处理 `\|` 转义管道）、冻结 61 文件双向差集、CAP 域段一致性、keep/drop 理由码与 keepChecks 互证、entryAssertions 三条件校验。

复算命令：

```bash
node .specdev/specs/vscode-dsh-test-consolidation/phases/phase-2-tests-consolidation/test-scripts/verify-phase2.cjs
# FINAL: PASS（problems: 0）
```

---

## 结论

Phase 2「tests 归并、编号与筛选」16 项验收标准全部通过：61 旧 spec 归并为 12 个能力域文件（10 域 + 2 个 jsdom 拆分），556 条用例全部携带全树唯一 `CAP-<DOMAIN>-<NNN>` 编号，`assertion-map.md` 台账 556 行（keep=543 / drop=13，理由码合法、字段完整、与冻结基线双向一致），AC-10 无裸 `AC-<数字>`，Node 24.3.0 下全绿（556 passed / 0 failed），未触碰生产代码。
