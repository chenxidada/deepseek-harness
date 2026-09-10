# 正确性审查 — Phase 1（phase-1-code-context）

## 视角
**实现正确性** — 代码是否真正按预期工作

## 判决
**SHOULD-FIX**

## 逐条 AC 验证

| AC | 描述 | 实现位置 | 判定 | 证据 |
|----|------|---------|:--:|------|
| AC-1 | 脏保存→指针预填；失败不生成；空格 `@"…"`；无正文/`languageId`；replay→live | `selection-ask.ts:143-195`；`extension.ts:runAskAboutSelection`；`chat-panel-host.ts:prefillComposer` | ✅ | 脏文档先 `save()`，失败 banner 且不预填；成功走官方 `@`/`@"…"` +「的 N-M 行」；无选区正文；replay 时新建 live 再 prefill。L2 覆盖脏保存成败、空格路径、replay→live |
| AC-2 | 空选区不生成引用 + 轻量提示 | `selection-ask.ts:149-151` | ✅ | 空选区 notify「请先选中代码再试。」且不预填 |
| AC-3 | `@` 提取/校验；仅三 reason；原样纳入；禁止读盘拼正文 | `at-path.ts`；`chat-panel-host.ts:sendPrompt` | ✅ | 仅存在性探测；无 `unreadable`；`acceptSend(trimmed)` 原样；正文密钥不进入 prompt |
| AC-3a | 去重 path 的覆盖性 read（L2 stub） | `ref-read-coverage.ts`；phase1 夹具①–⑤ | ⚠️ | 覆盖判定逻辑真实且夹具齐全；缺「stub ≠ 真模型」文档注明 |
| AC-3b | ide 预挂载 FILE_REFERENCE；不改 agent-loop；idle 观测 | ide `cordis.patch.yml` + implementation idle 表 | ✅ | 预挂载与依赖已落地；`read` 存在时挂 prompt；idle 代理观测已记 |
| AC-4 | 引用卡；权威无正文；打开用 meta 行号 | provider ref-card；`openReferencePath`；`SelectionMetaStore` | ⚠️ | 引用卡与 meta 打开逻辑真实；多 root 相对 path 打开仅拼 preferred 根（边界缺口） |
| P1-1…3 / P2 / P2-A / P2-3 | 契约落点 | 见英文报告对应行 | ✅ | covering-path、无 unreadable、空格文法、`file_path`、整文件 read 声明、ide 具备 read 均满足 |

## 桩代码检测

### 已注册桩
GAP-CCD-010 / GAP-CCD-011 / DEBT-CCD-001 — 均目标 phase-2，本 Phase 未触碰。

### 新发现未注册桩
无。AC-3a 的 `assertEveryRefReadBeforeFinalAnswer` 为规格要求的 L2 stub 判定函数，不是产品空壳。

## 关键发现

### 🔴 Must-Fix
- （无）

### 🟡 Should-Fix
1. 多 root 下 `openReferencePath` 只拼 preferred 根，可能打不开门禁已放行的另一 root 文件。
2. AC-3a 缺「stub ≠ 真模型」文档注明。
3. 缺打开引用卡时使用 SelectionMeta 行号的 L2 行为夹具。

### 🟢 Observations
- `languageId` 子串防泄漏可能极少数误杀；idle 为模块加载代理（已声明偏差）。
- 独立重跑 21/21 通过。
