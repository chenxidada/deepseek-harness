# Phase 1 审查报告：类型层一致性修复

## 判决：PASS

全部 11 条验收标准（AC-1~11）静态层面逐一满足；diff 改动与 `spec.md` / `design.md` §7 精确一致（除 1 处 design 示例笔误已正确修正）；运行时行为零变化已从消费方判断逻辑逐处确认；无桩代码、无未注册债务。仅 AC-1/AC-2（编译 0 错误、vitest 93 用例）依赖 implementer 声称的实测结果，需 verifier 独立复跑实证，但不构成 must-fix。

---

## 逐条验收标准审查

| AC | 结论 | 审查依据（已实际读源码核对） |
|----|:--:|------|
| AC-1 `tsc -b` 0 错误 | ✅ | diff 全部为类型层最小一致性修复，方向正确；implementer 声称 Node 24.3.0 下退出码 0。**待 verifier 独立复跑实证** |
| AC-2 vitest 无回归 | ✅ | 改动 5 文件均为类型注解/条件展开，无运行时逻辑变更；implementer 声称 9 文件 93 用例通过。**待 verifier 独立复跑** |
| AC-3 `matchTier` 单数无残留 | ✅ | `rg '\bmatchTier\b' apps/vscode-dsh` 全目录 No matches；src/webview/src/tests 均为 `matchTiers` 复数 |
| AC-4 tier 字段名 Host/Webview 一致 | ✅ | `session-search.ts:31` 改复数后，消费方 `extension.ts:711/712`、线契约 `chat-panel-host.ts:131`、`protocol.ts:179`、Webview `TabChrome.tsx:382/406`、`chat-ui-store.ts:84/567` 全部 `matchTiers` |
| AC-5 `requestSearchSessions` 无 `as` 断言 | ✅ | `extension.ts:1403-1407` 直接 `return controller.searchSessions(query)`，与 `chat-panel-host.ts:124-135` 返回契约（含 `matchTiers: Array<1\|2>`）精确兼容 |
| AC-6 `Thenable` 无残留 | ✅ | `rg '\bThenable\b' apps/vscode-dsh/src` No matches；7 处全部替换为 `PromiseLike<T>` |
| AC-7 `save()` 三种返回均接受 | ✅ | `selection-ask.ts:22` 改 `PromiseLike<boolean> \| Promise<boolean> \| boolean`；`PromiseLike` 比 `Promise` 更宽，同步/`Promise`/thenable 均被 `Promise.resolve(doc.save())`（`selection-ask.ts:156`）接受 |
| AC-8 6 个调用点条件展开 | ✅ | diff 确认全部 6 处：`revert.ts:278`、`conversation-controller.ts:1173/1203-1207/1798/1799`、`extension.ts:2091` |
| AC-9 `skipWrite` 默认写盘不变 | ✅ | 消费方 `revert.ts:199` `if (options.skipWrite !== true)`；省略 ≡ 显式 `undefined`，均走默认写盘 |
| AC-10 `confirmGate` 取消语义不变 | ✅ | 消费方 `revert.ts:263` `if (options.confirmGate !== undefined)`；缺失时 `cancelled=true` → `{ ok:false, reason:'cancelled', cancelled:true }` |
| AC-11 `turn` 字段省略兼容 | ✅ | `conversation-controller.ts:223` 类型 `{ messageId: string; turn?: number }`；条件展开后 `turn` 省略与可选属性兼容，字段集合与修复前一致 |

---

## 偏差审查结论

**偏差 1（design.md §7 spread 位置笔误）—— 接受，改法正确，无需正式 Amendment。**

- **偏差内容**：`design.md` §7 对 `revert.ts:278` 与 `conversation-controller.ts:1173` 两处 `executeRevert` 单对象调用给出的示例把条件展开 `...` 写在函数调用参数位置（`executeRevert(deps, changeId, ...cond ? {} : { skipWrite })`）。函数调用参数位的 spread 要求可迭代对象，普通对象 `{} | { skipWrite }` 不可迭代，会触发 TS2488。
- **implementer 实际改法**：对象字面量内部展开 `executeRevert(deps, changeId, { ...(cond ? {} : { skipWrite }) })`（diff 已核对，`revert.ts:278-280`、`conversation-controller.ts:1173-1175` 均为此写法）。
- **一致性判断**：该改法与 `design.md` §3/§7 对 `turn`（1798/1799）、`confirmGate`/`skipWrite`（1203-1207）、`asRelativePath`（2091-2096）的写法**完全一致**，是 design 自身手法在「单对象调用」场景的正确落地，仅修正示例的机械笔误位置。
- **运行时语义等价**：`{ ...(x === undefined ? {} : { x }) }` 在 `x` 非 `undefined` 时携带 `x`、在 `undefined` 时省略，与 design 意图（不改字段集合与默认行为）等价。消费方 `skipWrite !== true` / `confirmGate !== undefined` 判断结果不变。
- **结论**：这是对 design 文档示例笔误的修正，不改变任何 AC 或需求边界；`spec.md` 无 Amendments 章节，本偏差不属于「偏离 spec 的 amendment」，故不新增 amendment 登记，仅在实现摘要中如实记录（已由 implementer 完成）。

---

## 桩检测报告

对 5 个改动文件逐一核对，**未发现任何桩信号**：

- 无 `@STUB`、`TODO: wire`、`FIXME` 桩标记（`rg` 无匹配）。
- 无空壳函数体、无硬编码 `return []` / `return true` 假实现。
- 所有改动均为「类型注解替换」或「对象字面量条件展开」，函数体原有真实逻辑未被触碰。

`tech-debt-registry.md` 保持为空（符合 spec 约束「修复即完成，不留债」）。

---

## 集成连通性验证结果

| 数据路径 | 连通性 |
|---------|:--:|
| `SearchHit.matchTiers`（接口）→ `session-search.ts` 实现 → `extension.ts:711/712` 消费 → `chat-panel-host.ts:131` / `protocol.ts:179` 线契约 → Webview `TabChrome.tsx` / `chat-ui-store.ts` 读取 | ✅ 全链字段名统一 `matchTiers` |
| `requestSearchSessions` 契约（`chat-panel-host.ts:124`）← `extension.ts:1403` 回调返回 `controller.searchSessions()` | ✅ 无 `as` 断言，类型闭合 |
| `executeRevertMany`（`revert.ts:278`）→ `executeRevert(deps, changeId, { skipWrite? })` 消费 | ✅ `skipWrite` 省略/携带语义一致 |
| `conversation-controller.ts` → `executeRevert`/`executeRevertMany` 单对象/批量调用 | ✅ `confirmGate`/`skipWrite` 条件展开正确 |
| `streamingAssistant` Map 写入/读取 `{ messageId, turn? }` | ✅ `turn` 条件展开，类型 `turn?: number` 兼容 |

---

## 发现的问题

### 🔴 must-fix
无。

### 🟡 should-fix
无。

### 🟢 optional
- 无。

> 说明：`revert.ts` / `conversation-controller.ts` 的条件展开在 `options.skipWrite === undefined` 时，运行时对象由 `{ skipWrite: undefined }` 变为 `{}`（字段省略）。这是本次修复的**目的本身**（消除显式传 `undefined`），消费方 `!== true` 判断对两者读值均为 `undefined`，默认写盘行为零变化，不构成语义偏差。

---

## Registry 对照

- 活跃债务：空。本修复不产生新债务。
- 未注册债务：无（未发现任何桩）。
- 可关闭的已解决条目：无。

---

## 验证命令建议（给 verifier）

verifier 应独立复跑以下命令，实证 AC-1/AC-2（reviewer 未亲自运行，避免信任 implementer 自报结果）：

1. **编译门禁（AC-1/5/6/7/8）**：

```sh
export PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH
cd apps/vscode-dsh && ../../node_modules/.bin/tsc -b
# 期望：退出码 0，无 error TS 输出
```

2. **静态检查（AC-3/6）**：

```sh
rg -n '\bmatchTier\b' apps/vscode-dsh/src apps/vscode-dsh/webview/src apps/vscode-dsh/tests  # 无匹配
rg -n '\bThenable\b' apps/vscode-dsh/src                                                     # 无匹配
```

3. **运行时回归（AC-2/4/7/9/10/11）**：

```sh
./node_modules/.bin/vitest run \
  apps/vscode-dsh/tests/chat-ux-session-search.spec.ts \
  apps/vscode-dsh/tests/layer-a-rtl/editor-chat-phase2.spec.tsx \
  apps/vscode-dsh/tests/verifier-phase2/layer-a-rtl.spec.tsx \
  apps/vscode-dsh/tests/verifier-phase2/layer-b-host.spec.ts \
  apps/vscode-dsh/tests/phase1-code-context.spec.ts \
  apps/vscode-dsh/tests/phase3-review-revert-replay.spec.ts \
  apps/vscode-dsh/tests/chat-ux-streaming-cancel-follow.spec.ts \
  apps/vscode-dsh/tests/chat-ux-activity-stream.spec.ts \
  apps/vscode-dsh/tests/layer-a/activity-stream.spec.ts
# 期望：9 files / 93 tests 全部通过，无新增失败
```

4. **行为等价性重点抽查（AC-9/10/11）**：
   - revert 用例中 `skipWrite === undefined` 场景：确认仍走默认写盘（非跳过写盘）。
   - `confirmGate` 缺失场景：确认未确认 gate 返回 `{ ok:false, reason:'cancelled', cancelled:true }`。
   - streaming 用例中 `turn === undefined` 场景：确认 `streamingAssistant` 中对象无 `turn` 键、读取 `.turn` 为 `undefined`。
