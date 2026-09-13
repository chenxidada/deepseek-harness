# Phase 2 实现摘要（Q-6 Tab 右键删除回路）

## 变更清单

- `TabChrome.tsx`：Tab 右键打开 in-webview 菜单「删除会话」→ 与溢出共用 `DeleteConfirmModal`
- Store / protocol / Host：`panel/tabs` 携带 `sessionId`，供按 Tab 删除
- RTL：contextmenu → menu → modal；取消不发 intent；确认发 `ui/delete-request`
- `tech-debt-registry`：关闭 GAP-ECP-008（Q-6 右键缺口）

## 验收

| ID | 结果 |
|----|------|
| Q-6 | ✅ 右键 **与** 溢出均有「删除会话」 |
| AC-13c / 14a / 60 / AD-ECP-6 | ✅ 同一 webview modal → `ui/delete-request` → `deleteSession({confirmed:true})` |

## 测试

- phase2 RTL + delete host：**14/14** 通过
- verifier phase2 + shell：**20/20** 通过
- webview rebuild：成功

## 偏差

无。

## 债务

GAP-ECP-008 已解决；无新桩。
