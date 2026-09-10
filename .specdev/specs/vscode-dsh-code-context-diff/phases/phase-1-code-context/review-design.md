# Design Consistency Review — Phase 1 (phase-1-code-context) · polish re-review

## 视角
**Design Consistency** — 代码是否遵循架构设计

## 判决
**PASS**

## 本轮焦点（polish）

| 焦点 | 结论 | 证据 |
|------|:----:|------|
| 多 root open ≡ AD-CCD-11 门禁 resolve | ✅ | `planReferenceOpen` → `resolveAtPathInWorkspace`（preferred 未命中则扫全部 folder）；`openReferencePath` 改用该计划；L2 `planReferenceOpen scans all roots like the send gate` |
| prefill 重放不破坏 pointer-only | ✅ | `pendingPrefill` 仅缓冲/重放既有 `composer/prefill` 文本；不读盘、不拼正文、不带 `languageId` / selection body |
| stub ≠ 真模型文档义务 | ✅ | `ref-read-coverage.ts` 模块头 + phase1 test header + `implementation.md`；DEBT-CCD-002 → 已解决 |
| 无 ChangeList 范围蔓延 | ✅ | 无 `apps/vscode-dsh/src/change/`；无 `change-list` / `ChangeStore` / attribution / revert 协议帧 |

## 架构决策对照

| design.md 决策 | 实现是否遵循 | 证据 | 判定 |
|:---|:---|------|:--:|
| AD-CCD-11 · 指针 only；禁止正文注入（VOID） | 是 | 预填仍走 `buildPointerText`；`pendingPrefill` 只转发同一指针字符串；`sendPrompt` 门禁后原样 `text` | ✅ |
| AD-CCD-11 · 多 root：preferred → 顺序；0/歧义拒发 | 是 | 门禁与 **引用卡打开** 共用 `resolveAtPathInWorkspace`（GAP-CCD-012 闭合） | ✅ |
| AD-CCD-11 · reject reason 仅三类；禁止 `unreadable` | 是 | `AtPathRejectReason` 未扩；open 失败映射三类 reason 文案 | ✅ |
| AD-CCD-11 · 官方 `@` 文法 + 空格引号 | 是（沿用） | `formatOfficialAtPath` / `extractAtPathTokens` | ✅ |
| AD-CCD-12 · 脏保存失败不预填 | 是（沿用） | `selection-ask.ts` | ✅ |
| 附录 B · 回放 Tab → live 预填 | 是（沿用） | cold-start 缓冲属 Host 投递时序，不改变 live/readonly 分流 | ✅ |
| AD-CCD-13 · ide 预挂载；不改 agent-loop | 是（沿用） | 本轮未改 bundle / agent-loop | ✅ |
| AD-CCD-14 · covering + stub ≠ 真模型 | 是 | 模块注释显式声明 L2 stub ≠ live-model 保证（DEBT-CCD-002） | ✅ |
| AD-CCD-14 · P2-A 主字段 `file_path` | 是 | 代码 `pathsFromReadToolArgs`；`design.md` 修订记录 `Phase1-P2A-file_path` 已锁定主字段（上轮 SHOULD-FIX 文档面已闭合） | ✅ |
| AD-CCD-15 · 接受整文件 read；禁回退内联 | 是 | `ref-read-coverage.ts` / `selection-ask.ts` 注释与防御 | ✅ |
| AD-CCD-7 · 主落 vscode-dsh；phase-1 无 change/ | 是 | polish 仅 `code-context/` + Host prefill 缓冲 + tests | ✅ |
| Constitution §2.4 指针模型 / 禁改 agent-loop | 是 | 权威 user 仍为指针文本；agent-loop 未改 | ✅ |

## 模块/命名/结构审查

### 目录合理性
| 新/改文件 | 所在目录 | 是否合理 | 说明 |
|--------|---------|:--:|------|
| `open-reference.ts` | `apps/vscode-dsh/src/code-context/` | ✅ | AC-4 打开计划抽出；复用门禁 resolve，职责单一 |
| `at-path.ts`（`abs`） | 同上 | ✅ | 成功 resolve 附带 abs 供 `showTextDocument`；仍无内容读 |
| `chat-panel-host.ts`（`pendingPrefill`） | `chat-panel/` | ✅ | Host 投递时序，非协议语义膨胀 |
| `change/*` | — | ✅ | **仍未创建** — 无范围蔓延 |

### 命名规范审查
| 文件/符号 | 实际命名 | 应遵循规范 | 判定 |
|-----------|---------|-----------|:--:|
| `planReferenceOpen` | Pascal/camel 动词短语 | vscode-dsh 导出函数惯例 | ✅ |
| `ReferenceOpenPlan` | 结果联合类型 | 与 `AtPathResolve` 风格一致 | ✅ |
| `pendingPrefill` | Host 私有字段 | 描述缓冲语义 | ✅ |

### Constitution §2 检查
| 条款 | 内容 | 是否违反 | 说明 |
|------|------|:--:|------|
| §2.1 单一职责 | 打开计划 vs 门禁 vs 预填投递分离 | ✅ | |
| §2.2 依赖方向 | Host → code-context；core 不依赖外围 | ✅ | |
| §2.3 接口隔离 | `ResolveAtPathOptions` / `ReferenceOpenPlan` | ✅ | |
| §2.4 Feature 专属 | 指针；禁 agent-loop；禁双通道权威 | ✅ | meta 仍仅扩展本地；无快照入日志 |

## 范围蔓延检查（本轮）

| 检查项 | 结果 |
|--------|------|
| 无 ChangeList / ChangeAttributor / SnapshotStore / revert | ✅ |
| 无 agent-loop 编辑 | ✅ |
| 无旧 AD-CCD-11 正文注入 | ✅ prefill 重放路径仍无 body |
| Webview 不做路径 IO 拼正文 | ✅ open resolve 在 Extension Host |

## 关键发现

### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
（无）

> 上轮 SHOULD-FIX（调度者回写 `design.md` AD-CCD-14 主字段=`file_path`）已在 design 修订表 `Phase1-P2A-file_path` 闭合；本轮不再重复开单。`implementation.md` 偏差 1 文案仍写「未编辑 design.md」，与当前 design 正文不一致——属实现摘要陈旧，**不**构成代码违设，可不阻塞 PASS。

### 🟢 Observations
1. `AtPathResolve` 成功态相对 design 类型草图多了 `abs`：仅服务打开/绝对定位，不进入权威 user 正文，符合「禁止 content」精神。
2. `open-reference.ts` 未出现在 design「文件产出计划」初稿列表，但落在指定的 `code-context/` 模块内，且对齐附录 B / AC-4 打开契约。
3. GAP-CCD-012 / 013 / DEBT-CCD-002 已迁入 registry「已解决」；phase-2 目标债（010/011/001）本 Phase 未触碰，正确。

## 详细依据（只读）
- `design.md`（AD-CCD-11…15、附录 B）
- `phases/phase-1-code-context/{spec,implementation,repo-exploration}.md`
- `tech-debt-registry.md`
- `apps/vscode-dsh/src/code-context/{at-path,open-reference,ref-read-coverage,selection-ask}.ts`
- `apps/vscode-dsh/src/{extension,chat-panel/chat-panel-host}.ts`
