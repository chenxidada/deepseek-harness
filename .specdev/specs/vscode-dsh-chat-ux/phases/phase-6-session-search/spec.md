# Phase 6: 会话搜索档 1 + 档 2 path 索引

## 目标

交付会话搜索档 1（标题 + 预览元数据，字段已 READY）与档 2（path→session 反查索引，基于变更元数据、**不**建正文库）；从结果打开走既有历史/回放或激活已有 Tab，**不**因此 Start 新会话；明确不提供档 3。

## 前置条件

- 依赖 Phase：`phase-1-foundation-render-probe`（可与 phase-2+ 并行）
- X7；AD-CUX-9；ExtensionIndex `title` / `firstUserPreview` 已存在

## 验收标准（裁剪自 requirements）

- [ ] **AC-50** 搜索档 1 返回匹配列表；层 B 断言命中来自索引字段而非全文扫描冒充
- [ ] **AC-51** 按变更路径查询档 2；path→session 反查；层 B 断言反查结果
- [ ] **AC-52** 从搜索结果打开 → 历史/回放或已有 Tab；不 Start（除非用户随后显式 Continue/重试/编辑/分叉）
- [ ] **AC-53** 不提供档 3 或第二正文库；不静默扫 JSONL 正文冒充搜索

## 验证策略

| AC | 验证类型 | 验证方法 | 预期结果 |
|----|---------|---------|---------|
| AC-50 | 层 B | 索引写入已知 title/preview；查询 | 命中；spy 无正文扫描 |
| AC-51 | 层 B | 写入 path→session 索引；按 path 查 | 返回正确 sessionIds |
| AC-52 | 层 B | 打开命中会话 | 走 openHistory/replay 或激活 Tab；无 auto Start |
| AC-53 | 静态+层 B | 无全文 API；否定用例 | 无档 3 入口 |

## 约束

- 档 2 索引从 Change index / 变更元数据派生维护（写入/删除会话时更新）
- 不建第二正文库；不扫权威 JSONL 正文
- 打开路径复用 conversation-ui 历史/回放，禁止新开 live Start
- Out：fork 产品（phase-5）；流式/活动项

## 产出清单

- 搜索 UI 或命令面板入口
- `path-session-index` 模块 + 持久化
- 档 1 查询实现（ExtensionIndex 字段）
- 层 B 测试（命中来源、打开不 Start、无档 3）

## Out of scope（本 Phase）

- 正文全文搜索（档 3）
- 多窗口；重做多 Tab
- thinking UI
