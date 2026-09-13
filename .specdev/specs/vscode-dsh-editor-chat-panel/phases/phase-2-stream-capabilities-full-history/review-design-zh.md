# 设计一致性审查 — phase-2-stream-capabilities-full-history

> Q-6 Tab 右键删除回路复审（前次：PASS；本回路补齐顶栏右键入口）

## 视角
**设计一致性** — 实现是否遵循架构设计

## 判决
**PASS**

## 架构决策对照（摘要）

| 决策 | 判定 |
|:---|:--:|
| AD-ECP-6：统一后端 + 单一 webview modal | ✅ |
| Q-6：顶栏右键 **与** 溢出均提供「删除会话」 | ✅ |
| 关 Tab ≠ 删除 | ✅ |
| AC-60：顶栏↔历史同确认/同后端 | ✅ |
| 右键菜单与溢出菜单视觉密度一致 | ✅ |

## 关键发现

### 🔴 Must-Fix
无。

### 🟡 Should-Fix
无。

### 🟢 观察
- 右键 / 溢出菜单壳层 inline 样式重复，密度已由 `.dsh-menu-item` 统一。
- Host 仍保留旧 `action/delete` 通道；React 主路径不走，不破坏 AD-ECP-6。
- 前次「仅溢出、缺右键」缺口已关闭（GAP-ECP-008）。

## 结论
AD-ECP-6 单 modal 路径完整；Q-6 双入口（右键 + 溢出）与历史共用确认栈；菜单密度与溢出一致。判决 **PASS**。

英文全文：`review-design.md`
