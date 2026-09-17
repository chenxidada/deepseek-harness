# Phase 3 审查报告（合并 · round-3）

## 判决：SHOULD-FIX

## 并行审查摘要

| 视角 | Reviewer | 判决 | 关键发现 |
|---|---|:--:|---|
| 实现正确性 | reviewer-correctness | PASS | 0 🟡；5 个指派点全部独立核查通过（`MIN_DISTINCT_MD5` 单点定义 / workspace 半区真 fail-closed / `homeSandboxOf` 7 类输入全拒绝 / 「空即拒绝」期望已改 / `owned` 非恒真） |
| 设计一致性 | reviewer-design | SHOULD-FIX | 3 🟡：`$()` 守卫只覆盖行内形态 / 注释指针悬空 + registry 条件措辞 / `owned` 只钉 2 项 |
| 集成连通性 | reviewer-connectivity | PASS | 0 🟡；链路闭合、变量面完整、`homeSandboxOf` fail-closed、workspace 半区调用侧确实传参 |
| 视觉一致性 | reviewer-visual | N/A | 本视角无对象（DAG `ui: false`，无 ui-spec / visual-baseline / design-system） |

**合并规则**：`MUST-FIX` > `SHOULD-FIX` > `PASS` > `N/A`（`N/A` 不参与加权）。
本合并合计 **🔴 = 0**；有 🟡 ⇒ 判决 `SHOULD-FIX`。

> **审查时序说明（如实留痕）**：`reviewer-correctness` 首轮运行于 17:03 后停摆（转录 31 分钟无写入、无 vitest/oxlint 进程），已重派并收窄范围（禁跑 90s 级契约测试、总预算 ≤12 分钟）。重派后判决 **PASS**（0🔴/0🟡/4🟢），已并入上表 —— 其结论与其余三份一致，**不改变合并判决**（`SHOULD-FIX` 由 `review-design` 的 3 条 🟡 确立）。
>
> **四视角合计 🔴 = 0**，`SHOULD-FIX` 全部来自 `review-design`，且三条均**不影响任何 AC**、不改变交付物功能。

## Must-Fix 汇总

（空 —— 四视角合计 🔴 = 0）

## Should-Fix 汇总

来自 `review-design.md` 的 3 条（均**不影响任何 AC**，不改变交付物功能）：

1. **🟡-1** 「调用方不得用命令替换」的静态守卫只覆盖 `$(` 的**行内**形态，backtick 与跨行写法可绕过。
   证据：`apps/vscode-dsh/tests/display-evidence-shell.spec.ts:430-431`。
2. **🟡-2** `run-layer-v-smoke.sh:1173-1174` 的注释把 `apps/cli` 的排除理由指向 `implementation.md` 的边界说明，但该文件对 `apps/cli` **零命中**（悬空指针）；同条牵出 registry `DEBT-014` 关闭条件 (iii) 原措辞「无成员落在比较之外」**字面为假**。
   → **registry 措辞已由调度者订正**（见 `tech-debt-registry.md` 的 DEBT-014 行，改为真实契约「每个 tsdown 成员要么在比较 glob 内、要么被显式命名在 `OUTSIDE_THE_GLOBS`」，并写明 `apps/cli` 的排除理由是**源码启动路径**而非「无产物」）。
   → 注释指针一处**未修**（纯文字，不影响功能）。
3. **🟡-3** `scripts/oxlint-contract.spec.ts` 的 `owned` 数组只钉住 `apps/vscode-dsh/tests/tsconfig.json` 的 `include` 9 项中的 2 项，其余成员的归属无人断言。

## 关于 `owned` 替代 probe 列表 —— 一处对用户裁定的偏离

`scope-amendment-02.md` §8.1 第 3 项的字面要求是「在 `scripts/oxlint-contract.spec.ts` 的 probe 列表补一行」。
implementer 未按字面实现，改用 `owned` 数组；`reviewer-design` 与 `reviewer-connectivity` **各自独立**判定为「等价或更强」。

调度者独立实测支持该判定（`OXC_LOG=debug`）：

| 被驱动文件 | `Got tsconfig` |
|---|---|
| 写入该目录的探针 | `<none>`（`Total programs: 0`, `Unmatched files: 1`） |
| `display-evidence-shell.spec.ts`（被 include 点名） | `apps/vscode-dsh/tests/tsconfig.json` |
| `chat-ux-session-search.spec.ts`（未点名） | `<none>` |

原因：该 tsconfig 用**显式列举文件名**（非 glob），探针名随机 ⇒ 归属必然 `<none>` ⇒ 断言恒假。**字面要求构成构造性矛盾。**

> ⚠️ 该偏离**仍须在 HG-3 由用户确认** —— 依 `CLAUDE.md` 冲突优先级（用户确认 > design.md），不得以「reviewer 已认可」替用户决定。

## 调度者独立核验（非采信子 agent 自述）

- **真机闭环已跑通**（本 Phase 的终极目标）：`runId=20260917T092240Z-654599`，`conclusion=PASS`，exit 0，耗时 36s；五步全 `ok`；五张截图 md5 全不同（5/5，floor 3）；`postLink.postHandshakeRecordCount=1`；`artifact-index.md` 已追加 PASS 行。
- **消费侧缺陷已解除**（round-4 的 🔴 CRITICAL）：用逐字抽取的 shipped 函数复测 —— stdout 干净、`pass`/`retry`/`skip`/`*` 四分支全部可达、`retry` 置 `DISPLAY_RETRY_REQUIRED="true"`、AC-26(e) 记账写入真实值。
- **A5 回归测试可失败**：把 `run-layer-v-smoke.sh` 的调用包回 `$( )` → `1 failed | 10 passed`。
- **lint**：10 个触及文件各 0 条。
- **边界未扩大**：`HOST_DIAGNOSTIC_SCHEMA_VERSION` 仍 2；`MIN_DISTINCT_MD5` = 3；`spec.md` 无残留写死 `2`。

## 详细报告

- [review-correctness.md](./review-correctness.md)（待返回）
- [review-design.md](./review-design.md)
- [review-connectivity.md](./review-connectivity.md)
- [review-visual.md](./review-visual.md)
