# Phase 1 实现摘要（中文）— phase-1-shell-tabs-basic-history

详见同目录 `implementation.md`（英文结构 + 完整表格）。要点：

- 主面改为编辑器区 React+Vite SPA Panel；侧栏降级为迁移提示（切断 Host attach）。
- MessageBridge + DOM 契约 + `__dshProbes`；顶栏 Tab / 面板内历史骨架 / 最小可聊。
- Q-5：关 Panel×running 仅提示不 cancel；Q-7：activate 不自动弹 Panel。
- 本 feature UI PASS = `tests/layer-a-rtl/*` + 层 B lifecycle；旧 `buildThinChatHtml` 层 A 不作证据。
- P2 延期项已写入 `tech-debt-registry.md`。
