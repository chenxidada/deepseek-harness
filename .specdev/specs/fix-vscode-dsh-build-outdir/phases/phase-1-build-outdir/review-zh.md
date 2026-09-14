# Phase 1 审查报告（中文镜像）

<!--
  slug: fix-vscode-dsh-build-outdir
  phase-id: phase-1-build-outdir
  reviewer: 单视角（/bugfix 流程）
  镜像：review.md（canonical）
-->

## 判决：PASS

所有 AC 功能性判据均满足，运行时零变更（implementer 自身改动仅限 4 个配置文件 + 1 个 Skill 回填），偏差 D-1 / D-2 合理且已记录。存在 2 个非阻塞改进点，均不阻断进入 verifier 阶段。

## 逐条验收标准审查

| AC | 判定 | 结论 |
|----|:----:|------|
| AC-1 | ✅ | 四字段与落盘产物一一对应，无错位 |
| AC-2 | ⚠️→✅ | main 入口为 re-export，字面 grep 自身命中 0，但共享 chunk 含 editor-chat-panel（8 处符号），功能成立（见 D-1） |
| AC-3 | ✅ | 库入口与 main 同源同次构建，共享 chunk，不分裂 |
| AC-4 | ✅ | 两个 `.d.ts` 由 tsc 生成且真实存在 |
| AC-5 | ✅ | `lib/*.js` glob 覆盖 3 个 `.js`（入口 + 共享 chunk） |
| AC-6 | ✅ | Node smoke 证明 editor-chat-panel 符号可达 |
| AC-7 | ✅ | `tsc -b` 0 错误，tsconfig 未改动 |
| AC-8 | ⚠️→✅ | 6 失败均预先存在，无新增失败（见 D-2） |
| AC-9 | ✅ | 干净树可完整重建 |
| AC-10 | ✅ | 幂等（两次 md5 一致） |
| AC-11 | ✅ | 构建不依赖 DEEPSEEK_API_KEY / 网络 |

## 桩检测

0 桩。本次为纯构建配置改动，无函数实现；registry 为空，无未注册桩。

## 集成连通性

构建链路三跳连通（tsc → lib/types 中间态 → tsdown → lib/*.js → VS Code 加载 main → activate → createEditorChatPanelController）。跨包依赖保持 bare import external，与 apps/cli 一致。

## 发现的问题

- 🔴 must-fix：无。
- 🟡 should-fix：
  - S-1：AC-2 判据措辞未覆盖「入口 re-export + 共享 chunk」结构，建议补 Amendment A1。
  - S-2：工作区有既有的 `webview/dist` 未提交改动（非本 bugfix 引入），HG-3 提交需只 add 本 Phase 文件。
- 🟢 optional：G-1（`clean: false` 下旧产物冗余，非债务，AC-9 后消失）。

## 偏差结论

- D-1：合理，功能正确性成立（re-export + chunk 是 tsdown 正常结构，AC-6 已证）。
- D-2：合理，6 个失败为既有测试债，与本 bugfix 无关。

## 给 verifier 的建议

补足 main 入口（`lib/extension.js`）的端到端 smoke；可选 `vsce package` 复核 `lib/*.js` 覆盖共享 chunk；干净树重建 + 幂等复验。
