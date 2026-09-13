# 设计一致性审查 — Phase 1（phase-1-code-context）

## 视角
**设计一致性** — 实现是否遵循架构设计

## 判决
**SHOULD-FIX**

## 架构决策对照

| design.md 决策 | 实现是否遵循 | 证据 | 判定 |
|:---|:---|------|:--:|
| AD-CCD-11 · 仅指针；禁止正文注入（VOID） | 是 | `askAboutSelection` → `buildPointerText`；`sendPrompt` 校验后 `acceptSend(trimmed)`，无读盘拼接 | ✅ |
| AD-CCD-11 · 拒绝原因仅三类；禁止 `unreadable` | 是 | `AtPathRejectReason` 三类；`existsSync` 不读字节 | ✅ |
| AD-CCD-11 · 官方 `@` 文法 + 空格引号 | 是 | `formatFileMention` / 全句扫描；自然语言后缀不并入 path | ✅ |
| AD-CCD-11 · 多 root 解析策略 | 是 | preferred → folders；0/`ambiguous-root` 拒发 | ✅ |
| AD-CCD-12 · 脏保存失败不预填 | 是 | `selection-ask.ts` 保存失败则 banner 并返回 | ✅ |
| AD-CCD-13 · ide 预挂载；不改 agent-loop | 是 | ide `cordis.patch.yml` insert + 依赖；agent-loop 无改动 | ✅ |
| AD-CCD-13 · P2-C 预挂载时序等价 | 是 | spawn ide 自带引导；扩展侧无假 system 注入 | ✅ |
| AD-CCD-13 · P2-2 idle 观测 | 部分 | implementation 有代理观测；非完整 ide idle | ⚠️ |
| AD-CCD-14 · covering / N-2 锚点 | 是 | `file_path` 入参映射；最后一条 `assistant/message` | ✅ |
| AD-CCD-14 · P2-A 回写 AD | 代码是 / 设计文档否 | 主字段 `file_path` 已实现；`design.md` 未更新 | 🟡 |
| AD-CCD-15 · 接受整文件 read | 是 | 模块注释 + 防御断言；无选区内联 | ✅ |
| AD-CCD-7 · 主落 vscode-dsh | 是 | 仅 vscode-dsh + ide 配置面；无 change/ | ✅ |
| Constitution §2.4 | 是 | 指针模型；未改 agent-loop | ✅ |

## 模块/命名/结构审查

### 目录合理性
| 新文件 | 所在目录 | 是否合理 | 说明 |
|--------|---------|:--:|------|
| `code-context/*` | `apps/vscode-dsh/src/code-context/` | ✅ | 与 design 产出计划一致 |
| ide patch / deps | `packages/bundle/ide/` | ✅ | AD-CCD-13 |
| `change/*` | — | ✅ | 未创建，无 ChangeList 蔓延 |

### 命名规范审查
| 文件/符号 | 判定 |
|-----------|:--:|
| kebab-case 模块文件、协议帧、`dsh.askAboutSelection` | ✅ |

### Constitution §2 检查
| 条款 | 是否违反 | 说明 |
|------|:--:|------|
| §2.1–§2.3 | ✅ | 职责分离、依赖方向、deps/协议隔离 |
| §2.4 | ✅ | 指针 + 禁 agent-loop + meta 仅扩展本地 |

## 范围蔓延检查

| 检查项 | 结果 |
|--------|------|
| 无 ChangeList / 归属 / 撤销 | ✅ |
| 无 agent-loop 编辑 | ✅ |
| 无正文注入 | ✅ |
| Webview 不做路径 IO 拼正文 | ✅ |

## 关键发现

### 🔴 Must-Fix
（无）

### 🟡 Should-Fix
1. **P2-A / AD-CCD-14**：实现已用 `file_path`，但 `design.md` 仍写 `path`/`file`/`target` 为主例。应由**调度者**补丁 design（implementer 不得改设计文档）。无需改产品代码。

### 🟢 Observations
1. idle 观测为模块加载代理，非完整 ide 进程采样（已记偏差）。
2. 模块/协议/ide mount/命令接线与 design 与 phase-1 产出清单对齐。
3. AD-CCD-15 已在代码注释中声明。
