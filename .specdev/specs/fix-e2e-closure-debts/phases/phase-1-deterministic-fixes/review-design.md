# Design Consistency Review — Phase 1 (phase-1-deterministic-fixes)

## 视角
**Design Consistency** — 代码是否遵循架构设计（design.md / constitution §2 / 代码库既有约定）

## 判决
**PASS**

## 架构决策对照

| design.md 决策 | 实现是否遵循 | 证据 | 判定 |
|:---|:---|------|:--:|
| DEBT-9：完整 token 判定（两侧均非 `[A-Za-z0-9._-]` 才判泄漏），禁用裸子串 `includes` 与正则 `\b` | 是 | `selection-ask.ts:147-161` 新增 `isLanguageIdTokenLeaked`，逐字符判 `isPathTokenChar`，空 languageId 返回 false；`:206` 改为 `isLanguageIdTokenLeaked(pointerText, doc.languageId)` | ✅ |
| DEBT-9 配套：探针文件 `src/index.ts` → `package.json` | 是 | `layer-v-capabilities.json:423-424` `open-editor-selection`/`ask-about-selection` 均用 `apps/vscode-dsh/package.json` | ✅ |
| DEBT-8：`cap-history-panel` 照抄 `cap-history-list` 范式（sendPrompt→closed-turn→listHistory 断言 firstUserPreview） | 是 | `layer-v-capabilities.json:36-52` 步骤含 `send-prompt`→`closed-turn`(`$assistantClosed`)→`history-panel-lists-the-real-session`(`listHistory` 断言 `0.firstUserPreview $contains`) | ✅ |
| DEBT-8：`cap-message-list-streaming` 照抄 `cap-message-store-stream-patch` 流式范式（`$assistantContains`, intervalMs:150, requireIncrement:true） | 是 | `layer-v-capabilities.json:55-70` `streamed-message` 步 `$assistantContains`, `intervalMs:150`, `requireIncrement:true` | ✅ |
| DEBT-8：两项 `requiresModel` false→true | 是 | `:40` 与 `:59` 均 `requiresModel: true` | ✅ |
| DEBT-11：删除脚本 + 更新 4 处守卫 | 是 | 脚本 `D`；`cap-test-harness.spec.ts` 无 `chat-ready-regression` 残留、imports 已清 `existsSync`/`resolve`；`check-test-scripts-syntax.sh` pinned 仅剩 2 项；`capability-domains.json` 两处已清；README/README.zh 无 `run-chat-ready-regression` 引用 | ✅ |
| 不改退出码/`closedLoop`/`classifyAssertionStrength`/断言原语 | 是 | 本 Phase 无改动 `capability-runner.cjs`/驱动逻辑，仅改 manifest 数据与守卫 | ✅ |
| 本 Phase 不新增 `VSCODE_DSH_TEST=1` 门控 hook（DEBT-7/10/12 属 Phase 2） | 是 | `git status` 无 `extension.ts`/`chat-panel`/`webview`/`conversation-controller` 改动 | ✅ |
| AC-1 范围：唯一 `src/` 产品逻辑改动是 `selection-ask.ts` | 是（见 🟢 观察 1） | `git diff --name-only` 的 `src/` 改动仅 `code-context/selection-ask.ts` + `code-context/index.ts`（纯 barrel 导出，无产品逻辑） | ✅ |

## 模块/命名/结构审查

### 目录合理性
| 新文件/改动 | 所在目录 | 是否合理 | 说明 |
|--------|---------|:--:|------|
| `isLanguageIdTokenLeaked`（新增纯函数） | `apps/vscode-dsh/src/code-context/selection-ask.ts` | ✅ | 与 `askAboutSelection`/`buildPointerText` 同模块同文件，职责单一 |
| barrel 导出 | `apps/vscode-dsh/src/code-context/index.ts` | ✅ | 遵循该包「所有 code-context 公开符号经 index.ts 导出」的既有约定（repo-exploration §6 约束 6） |
| DEBT-9 单测 | `apps/vscode-dsh/tests/cap-code-context.spec.ts` | ✅ | 既有 `askAboutSelection` 测试宿主文件（repo-exploration §6 约束 5），非新建独立文件 |
| DEBT-8/9 manifest | `apps/vscode-dsh/test-scripts/layer-v-capabilities.json` | ✅ | 数据即该文件 |

### 命名规范审查
| 文件/符号 | 实际命名 | 应遵循规范 | 判定 |
|-----------|---------|-----------|:--:|
| 函数 | `isLanguageIdTokenLeaked` | camelCase + 动词短语，与既有 `buildPointerText`/`toWorkspaceRelativePath` 一致 | ✅ |
| 测试用例 | `CAP-CODE-CONTEXT-024~028` | 沿用既有 `CAP-CODE-CONTEXT-xxx` 编号序列，未越界 | ✅ |
| DEBT-8 marker | `LAYER-V-CAP-41-OK` / `LAYER-V-CAP-42-OK` | 沿用 `LAYER-V-CAP-<NN>-OK` 范式，41/42 与已用 14–40 无冲突（grep 复核，仅出现在这两步） | ✅ |
| 步骤名 | `history-panel-lists-the-real-session` / `streamed-message` | kebab-case，与既有 `new-conversation`/`closed-turn` 一致 | ✅ |

### Constitution §2 检查
| 条款 | 内容 | 是否违反 | 说明 |
|------|------|:--:|------|
| §2.1 单一职责 | 每个模块只做一件事 | ✅ | 新函数是 `code-context` 内纯判定，不新增模块 |
| §2.2 依赖方向 | 核心不依赖外围 | ✅ | 无新增依赖；`selection-ask.ts` 仍只依赖同层 `at-path.ts`/`selection-meta.ts` |
| §2.3 接口隔离 | 模块经明确接口交互 | ✅ | 纯函数经 barrel 导出，无跨模块直接调用内部实现 |

### 代码库既有约定（AGENTS.md）抽查
| 约定 | 是否遵循 | 说明 |
|------|:--:|------|
| ESM + 本地相对导入带 `.ts` | ✅ | `selection-ask.ts` 导入 `./at-path.ts` 带扩展名 |
| comment 不 restate code / 解释「为什么」 | ✅ | 新函数 JSDoc 解释「完整 token 边界语义」（为什么 `package.json` 不误判），非复述代码 |
| 导出有 `@param`/`@returns` JSDoc | ✅ | `isLanguageIdTokenLeaked` 完整标注 |
| 无硬编码 tunable | ✅ | marker 41/42 是测试数据非插件配置项；`intervalMs:150` 沿用参考范式（DEBT-3 时序调整属 Phase 2） |
| 测试描述行为 | ✅ | 5 条测试均为词边界行为正反例，非「正确性」断言 |

## 关键发现

### 🔴 Must-Fix
- 无。

### 🟡 Should-Fix
- 无。

### 🟢 Observations
- **[AC-1 字面 vs 实现]** AC-1 验证策略原文为「确认 `src/` 下仅 `selection-ask.ts` 一处改动」，但实现同时改动了 `code-context/index.ts`。该改动是**纯 barrel 再导出**（仅新增 `isLanguageIdTokenLeaked` 一行导出），零产品逻辑、遵循包既有导出约定，且已由 phase 级 repo-exploration（§5「Export helper for unit test」+ 附录 A）明确预测并授权——AC-2 单测经 barrel 导入该函数，必须导出。建议调度者/HG-3 时一句措辞对齐：将 AC-1 校验措辞明确为「唯一 `src/` 产品逻辑改动是 `selection-ask.ts`；`index.ts` 仅纯导出」。**不影响功能、不违反架构**，故不计入判决。
- **[DEBT-11 守卫④ 偏差，更彻底]** implementer 移除 README/README.zh 的整个「Chat-ready Feature 回归」节（而非仅替换 :22 命令行为 vitest）。理由充分：该节的「等价 vitest 文件清单」同样引用 10 个已不存在测试文件，保留单行替换会残留同类 stale 引用。此偏差已在 implementation.md 偏差 #1 透明声明，且被 repo-exploration:201「自行决定整节删除或仅替换命令行」显式授权。属 AC-11「不再引用不存在文件」的更彻底实现，非越界。
- **[DEBT-8 步骤名措辞]** design.md §DEBT-8 写的步骤为 `assistant-replied`，实现用的是 `closed-turn`（`$assistantClosed` 断言）。后者与 repo-exploration 附录 B（`cap-history-list` 参考范式）的「copy shapes」一致，是更权威、更精确的范式，非设计漂移。
- **[范围外残留，已知且正确处置]** `run-layer-v-smoke.sh:89` 注释仍提及已删脚本——这是注释非守卫（`test-scripts/` ≠ `scripts/`），不在 AC-11 守卫范围，implementer 已在 implementation.md「说明（非偏差）」如实标注。设计上正确：不扩大本 Phase 范围。

## 结论

三条债务（DEBT-9 / DEBT-8 / DEBT-11）的实现**严格遵循 design.md 指定的算法与范式**：DEBT-9 用完整 token 判定（非 `\b` 非 `includes`），DEBT-8 逐字照抄 `cap-history-list` / `cap-message-store-stream-patch` 的既有范式，DEBT-11 删脚本 + 穷尽更新 4 处守卫。AC-1 范围边界未被突破（唯一产品逻辑改动是 `selection-ask.ts`，`index.ts` 仅纯导出）。Constitution §2 与 AGENTS.md 既有约定均满足。无 MUST-FIX、无 SHOULD-FIX。
