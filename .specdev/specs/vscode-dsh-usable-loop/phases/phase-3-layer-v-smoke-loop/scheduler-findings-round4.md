# 调度者独立复现：DEBT-017 / R2 消费侧缺陷（round-4 verifier 报 🔴 CRITICAL）

- **日期**：2026-09-17
- **触发**：`verifier` round-4 终局独立验证判决 `PARTIAL`，残余风险最高 🔴 —— 报 `run-layer-v-smoke.sh` 消费侧缺陷。四视角 reviewer 与模块层 spec 均**未捕获**。
- **结论**：**CRITICAL 成立，且爆炸半径比 verifier 描述更精确 —— 恰好命中 PASS 路径，即「层 V 冒烟闭环永远无法通过」。**

## 1. 根因链（逐环独立确认）

| # | 位置 | 事实 | 证据 |
|---|---|---|---|
| 1 | `layer-v-support/display-evidence.cjs:183` | 模块在**正常 judge 路径上无条件写 stderr**（`process.stderr.write(verdict.reason + "\n")`） | 源码 + 复现中 `stderr_file` 恒非空 |
| 2 | `run-layer-v-smoke.sh:2643-2645` | shell 侧见 stderr 非空即调 `log "display evidence (...): ..."` | 源码 |
| 3 | `run-layer-v-smoke.sh:206` | `log()` = `printf '[layer-v] %s\n' "$*"` → **写 stdout** | 源码 |
| 4 | `run-layer-v-smoke.sh:2730` | `action="$(display_evidence_verdict …)"` 捕获的是 **stdout** ⇒ 日志行与末尾 `printf` 的 `pass/retry/skip` **串在一起** | 复现：`action = $'[layer-v] display evidence (reusefalse): …\nretry'` |
| 5 | `run-layer-v-smoke.sh:2739` | `case "${action}"` 因此**永不匹配** `pass`/`retry`/`skip` → 恒落 `*)` → `fail_harness` → `HARNESS_ERROR`/4 | 复现 |
| 6 | `run-layer-v-smoke.sh:2636-2651` vs `:158-160` | 三个 `DISPLAY_EVIDENCE_{ACTION,JSON,REASON}` 在 `$(…)` **子 shell 内**赋值 ⇒ 父 shell 恒为初值 | 复现：返回后 `ACTION=''` |
| 7 | `run-layer-v-smoke.sh:3140-3143` | `DISPLAY_RETRY_REQUIRED` 恒 `false` ⇒ R2.3 的 `xvfb` 重跑分支**从未执行** | 复现 |

> 因第 1 环是**无条件**的，第 4–5 环的污染也是**无条件**的 —— 不存在「偶尔才坏」。

## 2. 爆炸半径：恰好是 PASS 路径（同一输入只改 driver 结论）

方法：**逐字抽取 shipped 函数**（`log`/`note`/`fail_harness`/`fail_display`/`display_evidence_verdict`/`record_display_evidence_attempt`/`assert_display_evidence`），仅以桩替换 `set_conclusion`/`exit_now`（非被测对象，如实声明）。输入 = 磁盘上真实归档运行目录。

```
输入：.archive/20260916T170431Z-2270421（xvfb，distinct md5 = 2/5）

driver_conclusion=PASS          → HARNESS_ERROR  exit=4     ← 关闭了唯一成功路径
driver_conclusion=LINK_FAILURE  → 正常返回（note 分支）
driver_conclusion=HARNESS_ERROR → 正常返回（note 分支）
返回后 DISPLAY_EVIDENCE_ACTION  = ''（父 shell 初值，非 verdict）
```

全归档扫描（10 个真实归档 × `reuse`/`xvfb` 两模式 = **20/20**）：凡 driver 判 `PASS` 者**全部** `HARNESS_ERROR`/4。

## 3. 为何四个 reviewer 与模块层 spec 全部漏过

`apps/vscode-dsh/tests/display-evidence.spec.ts` 头部自述：

> These cases drive the shipped module (`layer-v-support/display-evidence.cjs`), **not a copy of its logic**.

即 spec 与 4 个 reviewer 都在**模块层**验证「模块给出的 verdict 是否正确」，而
**「shell 侧如何消费该 verdict」这一契约无任何测试覆盖**。
`reviewer-correctness` 给出 `PASS`（0🔴）时，验证的是模块；消费侧从未被驱动。

→ 这与本 Phase 的核心原则「可失败性」有关，但被施加在**错误的层**：
模块自身的可失败性成立，**模块→shell 的集成**却不可失败（也从失败）。

## 4. 性质裁定

| 问题 | 裁定 |
|---|---|
| 是设计问题还是实现问题？ | **实现问题**（消费契约的实现缺陷）。但暴露了一个**设计层缺口**：AC 未要求「模块 verdict → shell 动作」这条路径可被驱动 |
| 是否 fail-open？ | **否**。方向是 fail-closed（无假 PASS），但**把 PASS 路径一并关闭** ⇒ 功能完全不可用 |
| 是否阻塞 HG-3？ | **是**。DEBT-017/R2 是本轮用户裁定的修复项之一，其消费侧不可运行 ⇒ 该修复项不成立 |

## 5. 连带需处理

- `tech-debt-registry.md` 已将 `DEBT-017` 记为**「已解决」** —— 在消费侧修复并验证前**不成立**，须回退/保留为未决。
- `DEBT-014` 同理（只覆盖 app 半区，用户裁定 U-b 补全后才可移入「已解决」）。
