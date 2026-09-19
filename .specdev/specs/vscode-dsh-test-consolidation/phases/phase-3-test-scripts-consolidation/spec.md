# Phase 3: test-scripts 整合与去重

## 目标

把 `apps/vscode-dsh/test-scripts/` 按四类分层（入口编排 / 共享原语 / 能力清单数据 / 支撑资源），抽取 `layer-v-support/primitives.cjs` 共享 19 项镜像原语消除 `DEBT-1`，更新本工作流 registry（DEBT-1 已解决、DEBT-4/5 显式不关闭）。

## 前置条件

- 依赖 spec 文件：`design.md`（DEBT-1 去重方案 + 19 项镜像原语清单 + 3 参签名统一 + 四类归类）、`phase-plan.md`。
- 已完成的 Phase：`phase-1-baseline-domain-inventory`（脚本退出码基线）。
- 运行环境：Node 24.3.0，命令 `env PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" <cmd>`。
- Git 分支：`impl-phase-3-test-scripts-consolidation`（从 `new/vscode-dsh` 切出）。

## 验收标准

| 编号 | 内容 |
|------|------|
| AC-19 | `test-scripts/` 每个文件归类为四类之一并记录归属域（域 id 取自 `capability-domains.json`）；`layer-v-capabilities.json` 每个 `group` 映射到某域 id，映射表落盘 |
| AC-20 | 19 项镜像原语在 `test-scripts/**` 内定义处数各为 1，两个 driver 经共享模块引用 |
| AC-21 | 本工作流 registry「已解决」表含 `DEBT-1@vscode-dsh-e2e-closure`（验证命令可复算）；`DEBT-4/5` 显式「不关闭 + 理由 + 承接方」 |
| AC-22 | `pnpm run check:test-scripts-syntax` 退出码 0 |
| AC-23 | Node 24.3.0 无凭证环境下 `run-layer-v-smoke.sh` / `run-layer-v-capabilities.sh` 退出码与 Phase 1 基线一致 |

## 验证策略

| AC | 验证类型 | 验证方法 | 预期结果 |
|----|---------|---------|---------|
| AC-19 | 静态检查 | `test-scripts` 目录文件数与四类清单条目数双向差集；manifest `group` 集合 ⊆ 映射表键集合，映射值 ∈ 域 id 集合 | 双向差集为空，映射合法 |
| AC-20 | 静态检查 | 逐 19 项 `grep -rnE "(function\|const)\s+<name>\b" apps/vscode-dsh/test-scripts` 计数 | 每项 = 1 |
| AC-20 | 静态检查 | 确认两个 driver `require` 共享模块而非内联定义（grep `require.*primitives`） | 引用存在 |
| AC-21 | 静态检查 | 读本工作流 registry「已解决」表，确认 `DEBT-1@…` 条目 + 验证命令；「活跃」表含 `DEBT-4/5` 不关闭条目 | 字段完整可复算 |
| AC-22 | 运行时验证 | `pnpm run check:test-scripts-syntax` | 退出码 0 |
| AC-23 | fixture dry-run | Node 24.3.0 无凭证环境运行两个 smoke/capabilities 脚本，退出码 vs Phase 1 基线 | 逐脚本一致 |

## 约束（来自 design.md）

- 19 项镜像原语清单以 `design.md` §DEBT-1 去重方案为准（非 AC-20 的 9 项基线）。
- `captureScreenshot` 统一为 3 参 `(capture, fileName, artifactDir)`；`extension.cjs` 调用点传其模块级 `ARTIFACT_DIR`。
- `pollForStream` 是 runner 单侧原语（本就 1 处），可随共享模块抽取但非 AC-20 判定对象。
- 抽取是纯搬移，不改函数体语义；AC-23 保证退出码不变。
- `DEBT-4/5` 明确**不关闭**（真机覆盖缺口，本工作流范围外），只登记承接方。
- 不修改 `.oxlintrc*.json`、`scripts/run-gates.ts`（不新增门禁）。

## 产出清单

- `apps/vscode-dsh/test-scripts/layer-v-support/primitives.cjs`（新增，19 项镜像原语）
- `apps/vscode-dsh/test-scripts/layer-v-driver/extension.cjs`（改为 `require` 共享模块）
- `apps/vscode-dsh/test-scripts/layer-v-capability-driver/capability-runner.cjs`（改为 `require` 共享模块）
- `test-scripts` 四类归类清单 + group→domain 映射表（落盘于 `capability-domains.json` 或独立清单文件，位置由实现定）
- `.specdev/specs/vscode-dsh-test-consolidation/tech-debt-registry.md`（DEBT-1 已解决、DEBT-4/5 不关闭）
- `.specdev/specs/vscode-dsh-test-consolidation/phases/phase-3-test-scripts-consolidation/implementation.md`
