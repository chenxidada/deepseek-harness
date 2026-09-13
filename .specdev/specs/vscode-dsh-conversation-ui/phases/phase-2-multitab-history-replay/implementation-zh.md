# Phase 2 实现摘要（MUST-FIX loop 1）

## 变更清单（文件列表）

- `apps/vscode-dsh/src/extension.ts` — `resolveWorkspaceIndex()`；History TreeView / `listHistory` / `getIndex` 无 Host 绑定仍读 workspaceState；`dsh.openHistory` 文案与列表/回放分离；产品 `dsh.deleteHistory`；unbind 后 `historyRefresh`
- `apps/vscode-dsh/package.json` — 注册 `dsh.deleteHistory`；History 右键菜单改挂产品命令
- `apps/vscode-dsh/tests/phase2-multitab-history-replay.spec.ts` — AC-63 无 conversations 绑定时仍能 list / getIndex / TreeView；openHistory 不再虚报 “History list is visible”
- `.cursor/skills/project-test/SKILL.md` / `.cursor/skills/project-build/SKILL.md` — 记录 MUST-FIX 验证结果

## 对每个验收标准的实现说明

| AC | 本轮说明 |
|----|----------|
| **AC-63**（Must-Fix） | `resolveWorkspaceIndex()`：有 `conversations` 用 live index；否则 `new ExtensionIndex(workspaceKey, workspaceState)` 冷读。TreeView `getRows`、`dsh.test.listHistory`、`dsh.test.getIndex` 均走该路径。`dsh.openHistory` 可先从索引挑会话，无 Host 时明确要求先连接，不再声称 “History list is visible”。 |
| AC-28/29 | 行为不变；列表数据源仍为 workspace 作用域索引 |
| Should-Fix：删除入口 | History 菜单改为 `dsh.deleteHistory`；`dsh.test.deleteHistory` 保留为同实现别名 |
| Should-Fix：冷读 L2（无 events） | 未新增独立用例（可选，本轮未做） |
| GAP-001 | 未做 |

## 测试结果（命令 + 输出）

```text
# FAIL-first（修复前）
vitest run .../phase2-multitab-history-replay.spec.ts -t "AC-63"
→ expected [] to deeply equal ['hist-cold-1']

# 修复后
bash .../run-phase2-l2-l3.sh
→ Test Files 3 passed; Tests 27 passed

vitest run apps/vscode-dsh/tests
→ Test Files 18 passed; Tests 67 passed

tsc -p apps/vscode-dsh/tsconfig.json --noEmit
→ tsc_exit=0
```

## 偏差记录

无相对本 Phase Must-Fix / AC-63 的新偏差。打开回放仍需要 Host（与设计「列表可独立、打开需 hydrate」一致）。
