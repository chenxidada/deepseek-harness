# Design Consistency Review — Phase 4

## 视角
**Design Consistency** — 代码是否遵循架构设计

## 判决
**SHOULD-FIX**

## 架构决策对照

| design.md 决策/约束 | 实现是否遵循 | 证据 | 判定 |
|:---|:---|------|:--:|
| 决策 5：`include` 改 glob（`["**/*.ts", "**/*.tsx"]` 或等价可扩展形式） | 是 | `apps/vscode-dsh/tests/tsconfig.json:25-28` 现为 `["**/*.ts", "**/*.tsx"]`，无逐文件白名单 | ✅ |
| lint 归零方案 §1：删除逐文件白名单 | 是 | git diff 显示 12 个逐文件路径全部替换为 glob | ✅ |
| lint 归零方案 §2：删除「目录过大不可作为 program」注释 | 是 | 新头部注释不再含该陈述，改述 glob 口径 + 残留 tsc 记 registry | ✅ |
| lint 归零方案 §3：203 条缺陷在测试资产内修，不改 `src/**`（AC-24） | 是 | git diff 无 `src/**` / `webview/**` / `packages/**` / `scripts/**` 改动 | ✅ |
| 约束：不新增门禁脚本，只让既有门禁通过 | 是 | git diff 无 `scripts/**` 改动，无新增脚本/门禁 | ✅ |
| 约束：tsc 归零非验收条件，「未归零」显式记录（AC-18 / DEBT-019） | 是 | registry 新增 `DEBT-019` 完整条目 | ✅ |
| R-4：oxlint 基线「1184→203」未独立复测，不得当已确认实测值 | 是 | 实现复测真实起点 145 并留档 D-2，未盲用 203 | ✅ |

## 模块/命名/结构审查

### 目录合理性
| 新文件/改动 | 所在目录 | 是否合理 | 说明 |
|--------|---------|:--:|------|
| `tsconfig.json`（include glob + jsx） | `apps/vscode-dsh/tests/` | ✅ | 属 tests 写面（design §范围覆盖） |
| 10 个 `cap-*.spec.ts|tsx` lint 修复 | `apps/vscode-dsh/tests/` | ✅ | 属测试资产写面 |
| `DEBT-019` 登记 | `.specdev/specs/<slug>/tech-debt-registry.md` | ✅ | 属 design 指定的 registry 写面 |

### 命名规范审查
| 文件/符号 | 实际命名 | 应遵循规范 | 判定 |
|-----------|---------|-----------|:--:|
| 债务 ID | `DEBT-019` | 表头注释 `DEBT-xxx`（无 slug） | ✅（design §lint 归零方案 §5 亦命名 `DEBT-019`） |

> 说明：registry 内既有 `DEBT-1/4/5@vscode-dsh-e2e-closure` 带 `@slug` 后缀，属另一工作流（e2e-closure）混入的历史条目；`DEBT-019` 严格符合本文件表头声明的 `DEBT-xxx` 格式，且与 design 文本一致，不构成命名偏离。

### 依赖方向检查
本 Phase 未新增模块依赖；所有改动为测试资产内 lint 修复 + tsconfig 配置 + registry 记录，不引入任何 `src/` ↔ 外围依赖倒置。

### Constitution §2 检查
| 条款 | 内容 | 是否违反 | 说明 |
|------|------|:--:|------|
| 写面边界 | 仅 tests/test-scripts/registry | ✅ | git diff 无生产代码改动 |
| 无产品行为新增 | 纯测试重组 | ✅ | 无 `src/**` 改动 |

## 关键发现

### 🔴 Must-Fix
无。

### 🟡 Should-Fix

**S-1：design.md 未回写「jsx flag 补全」的修订记录（D-1 仅记于 implementation.md）**

- 实现除 `include` 改 glob 外，额外在 `compilerOptions` 加 `"jsx": "react-jsx"`（`tsconfig.json:22`）。design.md §决策 5 / §lint 归零方案 §1 只写 `include` glob，未提 jsx flag。
- **定性**：属**合理补全**，非未经批准的架构偏离 —— glob 化后 `cap-webview.spec.tsx` 进入 program，而 `tsconfig.base.json` 无 `jsx` 字段会触发 35 条 `TS17004` config 假错误；加 `jsx: react-jsx` 与 `apps/vscode-dsh/webview/tsconfig.json:7` 完全一致（复用既有约定，非新造值），是实现「glob 覆盖全目录含 .tsx」这一 design 意图的必要前置。不构成 MUST-FIX。
- **但**：该补全未写入 design.md §设计修订记录（现有仅 R-1、R-2）。design 是「唯一真相源」，实现偏离 design 文字却未回写会漂移。应追加一条修订记录（如 R-3），注明「决策 5 / lint 归零方案 §1 补充 jsx: react-jsx」。

**S-2：design.md 仍以「203 条」为 lint 缺陷数，未回写实测 145**

- design.md §架构摘要、§决策 5、§lint 归零方案 §3 多处字面写「203 条真实 lint 缺陷」；实现实测 glob 化后真实起点为 **145**（D-2 已留档于 implementation.md）。
- **定性**：实现**符合** R-4 口径（design §lint 归零方案 §6 已显式声明「203 未独立复测、不得当已确认值」，实现据此复测、未盲用 203）——这一点是对的，判 ✅。但 design.md 除 R-4 那条警示外，其余章节仍把 203 当既成事实陈述，形成 design 内部张力（§决策 5「203 条真实」 vs §6「203 未确认」）。应追加修订记录，把「203」更正为「Phase 4 实测 145（glob 化后起点）」。
- **不影响 AC-16**：AC-16 只断言最终 `run-oxlint` exit 0，与起点数无关。

### 🟢 Observations

**O-1 `[文档保真]` registry `DEBT-019` 的「类型」字段填「类型占位」**

- `DEBT-019` 13 列全部齐全（ID/源Phase/模块/文件:函数:行号/当前行为/预期行为/类型/标签/依赖它的模块/目标Phase/阻塞/来源/注册日期），字段规范 ✅，标签含必填 `module:`+`type:` ✅，且 design 明确「归属 DEBT-019 tests 段口径」，一致 ✅。
- 唯一可商榷：`类型` 填「类型占位」，而该债更贴近字段规范枚举中的「已知缺陷」（已知 tsc 类型错误、刻意不归零、🟡 非阻塞）。「类型占位」通常指桩代码里的类型占位符。二者皆在允许枚举内，不构成字段规范违反；供参考，不参与判决。

**O-2 `oxlint --fix` 机械修复引入局部格式不齐（`cap-webview.spec.tsx`）**

- 自动修复 `no-confusing-void-expression` 产生的 `await waitFor(() =>{  expect(...) })`（`=>{` 缺空格、后随双空格），与代码库既有 `=> { ... }` 单空格风格不一致。属格式化层面，不属本视角七维度（设计一致性），仅记录，建议由 correctness 视角或后续 format 收口，不计入判决。

## 结论

实现严格遵循 design.md 的全部架构决策与硬约束：glob 化（含等价形式）、测试资产内修 lint、不改 `src/**`、不新增门禁、tsc 未归零显式登记、R-4 口径正确执行。唯一瑕疵是**两处「实现已补全/已实测、design.md 却未回写」的真相源漂移**（jsx flag + 145 基线），属 SHOULD-FIX，均应追加到 design.md §设计修订记录，不涉及交付物功能缺陷。
