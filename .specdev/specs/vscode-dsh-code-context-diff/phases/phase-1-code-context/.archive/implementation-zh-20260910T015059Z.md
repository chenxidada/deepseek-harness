# Phase 1 实现摘要 — phase-1-code-context（中文）

> 与 `implementation.md` 同步。

## 变更清单

新增 `apps/vscode-dsh/src/code-context/`（at-path / selection-meta / selection-ask / ref-read-coverage），并接线 chat-panel 协议/Host/Webview、extension 命令与右键菜单，以及 ide bundle 预挂载 `file-reference-local`。

## 验收覆盖

- AC-1/2：脏保存失败不预填；非空选区预填官方 `@`/`@"…"` + 自然语言行范围；空选区提示；replay → 新 live。
- AC-3：发送门禁校验路径；原样指针；无正文注入；无 `unreadable`。
- AC-3a：L2 stub 覆盖单缺读 / 双 path 漏读 / 全覆盖 / 同 path 去重 / 假入参。
- AC-3b：ide patch 预挂载 + 依赖；`FILE_REFERENCE_PROMPT` 由 file-reference-local 在 read 存在时组装；idle 代理观测见英文版。
- AC-4：引用卡 + 本地 meta 行号打开。
- AD-CCD-15：接受整文件 read，禁止回退内联选区。

## 测试

`phase1-code-context.spec.ts` + `ide.spec.ts` → 21 passed；panel 回归 6 passed；file-reference-local prompt 组装 1 passed。

## 偏差

P2-A 未改 design.md（角色约束），规则写入代码与 implementation.md。Idle 观测为模块加载代理。

## 债务

无新增桩；phase-2 归属/快照债保持推迟。
