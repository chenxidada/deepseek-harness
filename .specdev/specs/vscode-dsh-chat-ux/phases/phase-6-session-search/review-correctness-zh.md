# 正确性审查 — phase-6-session-search

## 视角
**实现正确性** — 代码是否正确工作

## 判决
**PASS**

## 逐条 AC 验证

| AC | 描述 | 判定 | 证据摘要 |
|----|------|:--:|---------|
| AC-50 | 档 1 索引字段命中，非正文扫描 | ✅ | 仅匹配 title/firstUserPreview；MessageStore spy 未调用 |
| AC-51 | 档 2 path→session 反查与维护 | ✅ | persist/delete 同步 PathSessionIndex；层 B 命中与删除后更新正确 |
| AC-52 | 打开走历史/回放；不 Start | ✅ | openSearchHit→openFromHistory；Host.start spy 未调用 |
| AC-53 | 无档 3 / 不扫 JSONL 正文 | ✅ | TIER3 API=null；无全文入口；body-only 空结果 |

## 桩检测
- 已注册活跃桩：无
- 新发现未注册桩：无

## 约束
档 1 非正文 / 档 2 索引维护 / 打开不 Start / 无档 3 / 无新桩 / 未改 agent-loop — 全部 ✅

## Must-Fix / Should-Fix
无
