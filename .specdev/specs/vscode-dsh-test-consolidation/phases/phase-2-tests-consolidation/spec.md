# Phase 2: tests 归并、编号与筛选

## 目标

把 61 个整合前 spec 按 10 个能力域归并为 `cap-<domain>.spec.ts|tsx`，逐用例判定 keep/drop 并建立 `CAP-<DOMAIN>-<NNN>` 编号，逐行填 `assertion-map.md` 台账，回填 `capability-domains.json` 的 `entryAssertions.caps`。

## 前置条件

- 依赖 spec 文件：`design.md`（能力域定稿清单 + 筛选执行方案 + 命名编号方案）、`phase-plan.md`。
- 已完成的 Phase：`phase-1-baseline-domain-inventory`（`capability-domains.json` + `assertion-map.md` 骨架 + 基线）。
- 运行环境：Node 24.3.0，命令 `env PATH="/usr/local/n/versions/node/24.3.0/bin:$PATH" <cmd>`。
- Git 分支：`impl-phase-2-tests-consolidation`（从 `new/vscode-dsh` 切出）。

## 验收标准

| 编号 | 内容 |
|------|------|
| AC-1 | 整合后每个 spec 文件名匹配 `cap-<domain>.spec.ts\|tsx`，无 `phase<数字>`/`gap-<数字>`/`spike-` 命名，无 `verifier-phase<数字>` 目录 |
| AC-3 | 每域 spec 含顶层 `describe('cap:<domain> — ')`，全树 `cap:` 域 id 集合 = 清单域 id 集合 |
| AC-6 | 每个 `it`/`test` 标题含恰好一个 `CAP-<DOMAIN>-<NNN>` |
| AC-7 | `CAP-` 编号全树唯一（`uniq -d` 为空） |
| AC-8 | 编号格式合法且域段与文件一致（reviewer-correctness 复核留痕） |
| AC-9 | `assertion-map.md` 逐条记录整合前每个用例声明（keep/drop + 理由码 + 字段完整），双向差集为空 |
| AC-10 | 编号体系迁移到 `CAP-`；`it`/`test` 标题无裸 `AC-<数字>`，旧引用只在带工作流限定注释中 |
| AC-11 | 每域 `entryAssertions` 非空，`entrypoint`→`caps` 映射可判定（reviewer-correctness 核对 src 真实路径） |
| AC-12 | 每条 drop 恰命中一个 D1–D4，且所指对象字段完整 |
| AC-13 | 域文件验证为完整文件运行（非只跑新增块） |
| AC-24 | 不修改生产代码（`src/**`/`webview/**`/`packages/**`） |
| AC-25 | 不产生旧产物第二份副本（不建 `.archive/`、不留 `*-old.spec.ts`） |
| AC-26 | spike/gap 5 文件归入对应域，每条断言台账有明确处置 |
| AC-27 | 台账每行 `keepChecks`（K1/K2/K3 三 bool），K=true 行给 `路径:行号` 依据 |
| AC-28 | drop 行理由码恰一 D（0 或 ≥2 均不通过） |
| AC-29 | 筛选硬约束：不以 D1/D2 删 K 命中项；D2 给私有符号名；弱化断言标 `weakened` 且不计入 `entryAssertions` |

## 验证策略

| AC | 验证类型 | 验证方法 | 预期结果 |
|----|---------|---------|---------|
| AC-1 | 静态检查 | `find apps/vscode-dsh/tests -type f \( -name '*.spec.ts' -o -name '*.spec.tsx' \) \| grep -E 'phase[0-9]\|gap-[0-9]\|spike-\|verifier-phase'` | 输出为空 |
| AC-3 | 静态检查 | 逐域 `grep -c "^describe('cap:<domain> — " <spec>` | ≥ 1；全树 `describe('cap:...` 域 id 集合 = 清单域 id 集合 |
| AC-6 | 静态检查 | 逐标题 `grep -oE 'CAP-[A-Z0-9-]+-[0-9]{3}'` 计数 | 每个 `it`/`test` 标题恰好 1 |
| AC-7 | 静态检查 | `grep -rhoE 'CAP-[A-Z0-9-]+-[0-9]{3}' apps/vscode-dsh/tests --include='*.spec.ts' --include='*.spec.tsx' \| sort \| uniq -d` | 为空 |
| AC-8 | 静态检查 | 全树编号格式 + 域段与文件一致性（reviewer-correctness 复核） | 无格式非法 / 域段不符 |
| AC-9 | 静态检查 | 台账行并集 vs Phase 1 冻结用例声明集双向差集；每条 keep 新编号可 grep；drop 理由码合法 | 双向差集为空，字段完整 |
| AC-10 | 静态检查 | `grep -rnE '\\bAC-[0-9]+\\b' apps/vscode-dsh/tests --include='*.spec.ts' --include='*.spec.tsx'` | 仅出现在带工作流限定注释中 |
| AC-11 | 静态检查 | 逐域 `entryAssertions` 非空，`caps` 每个编号满足 AC-11 三条件；reviewer-correctness 核对 entrypoint→src 路径 | 映射可判定 |
| AC-12 | 静态检查 | 逐条 drop 行理由码 = 恰一 D；D3 有 `replacementCap`、D4 有关闭依据、D2 有私有符号 | 字段完整，无空/多理由码 |
| AC-13 | 运行时验证 | 验证记录含 `vitest run apps/vscode-dsh/tests/cap-<domain>.spec.ts` 完整域文件运行命令与输出 | 完整域文件运行 |
| AC-24 | 静态检查 | `git diff --name-only <base>..HEAD \| grep -E '^(apps/vscode-dsh/(src\|webview)\|packages)/'` | 为空 |
| AC-25 | 静态检查 | 新增 spec 与任一整合前文件行数比 >0.9 且内容高度重合者 | 不存在 |
| AC-26 | 静态检查 | 5 个 spike/gap 文件在 `absorbed` 各有归属，其全部用例标题在台账有处置 | 全部可查到 |
| AC-27/28/29 | 静态检查 | reviewer-correctness 逐条复核 K 依据路径存在、D 理由码、weakened 不计入 caps | 通过（见 review.md 留痕） |

## 约束（来自 design.md）

- 域归属以「主 SUT / 最特化的被测能力」为准（见 `design.md` 能力域定稿清单）。
- 按域保留独立顶层 `describe`，不拍平 `beforeEach`/`vi.mock`（R-1）。
- `webview` 域拆独立 `.spec.tsx`，不与其他 `.ts` 域混文件（R-4/R-7）。
- 动态拼接标题改为字面量（R-5）。
- `buildThinChatHtml` 废弃引用改为 `buildEditorChatSpaHtml` 或移除 fixture 路径（AC-24 补充条款）。
- 每条 drop 的 D1/D4 依据、D3 替代覆盖、`weakened` 等价性属语义判断，归 `reviewer-correctness`。

## 产出清单

- `apps/vscode-dsh/tests/cap-{session-host,conversation,timeline,interaction,code-context,change-list,search,chat-panel,webview,test-harness}.spec.ts|tsx`（新增，替换 61 个旧 spec）
- `apps/vscode-dsh/tests/assertion-map.md`（填实）
- `apps/vscode-dsh/tests/capability-domains.json`（`entryAssertions.caps` 回填）
- `.specdev/specs/vscode-dsh-test-consolidation/phases/phase-2-tests-consolidation/implementation.md`（含偏差章节，AC-29 ③ 弱化项）
