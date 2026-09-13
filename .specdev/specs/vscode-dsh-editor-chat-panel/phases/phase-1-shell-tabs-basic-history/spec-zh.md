# Phase 1（中文镜像）: React 壳 + 顶栏 Tab + 基础历史 + 最小可聊

> Canonical：[`spec.md`](./spec.md)。phase-id：`phase-1-shell-tabs-basic-history`。

## 目标

WebviewPanel + React SPA；顶栏 Tab；Q-5/Q-7；基础历史非空窗；最小可聊；Bridge/探针/CSP/RTL 层 A。

## 关键约束

- AD-ECP-8：生产 HTML = React，非 `buildThinChatHtml`
- AD-ECP-10-P1：契约表 + `__dshProbes` + CSP 冒烟；禁内联假绿

## 验收

功能 AC-1…5、10–16（除 13c/14a/14b）、40/42/43、50/50a/51/52/58；UI-AC-1–3/10–13/40–41/60–61。详见 canonical。

## 层 V

ui-visual-spec §9 Phase1 + AC-1e 提示 + SPA 可加载。
