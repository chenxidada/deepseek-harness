# Phase 1: Profile + 双通道骨架 + 生命周期

## 目标

落地 `ide` profile（`dsh-base` + `sdk-app` + `ide-bridge`）、SDK stdio 驱动骨架、Host bridge 本机 socket 传输骨架、启动/shutdown 生命周期，以及与 Web 终端应答插件的组合互斥校验。证明 stdout 不被诊断污染，且 `initialize` 失败不会呈现假连接。

## 前置条件

- `requirements.md` HG-1 已确认
- `design.md` / `phase-plan.md` HG-2 已确认
- 依赖 Phase：无
- 技术债：registry 当前无活跃阻塞项

## 验收标准

从 `requirements.md` 提取：

**AC-1:** `[Must]` **事件驱动型** — **当** 开发者从扩展发起启动会话 **时**，系统 **必须** 以 `ide` profile（`dsh-base` + `sdk-app` + `ide-bridge`）启动 DSH 子进程，并完成 SDK `initialize` 后才接受 `session/prompt`。

**AC-2:** `[Must]` **普遍型** — 系统 **必须** 保证 ide profile 下 stdout 仅承载 newline-delimited JSON-RPC；诊断 **必须不** 写入 stdout。

**AC-3:** `[Must]` **事件驱动型** — **当** 开发者关闭会话宿主或卸载扩展 **时**，系统 **必须** 有序 `shutdown`、回收子进程，并更新 UI。

**AC-4:** `[Must]` **不期望行为型** — **如果** 握手前崩溃或 `initialize` 失败，**那么** 系统 **必须** 展示可诊断错误，**必须不** 呈现「已连接」假象。

**AC-5:** `[Must]` **不期望行为型** — **如果** ide profile 与 Web `ui-approval` / `ui-user-questions` 终端应答同挂争瀑布终点，**那么** 系统 **必须** 在组合/启动校验失败并明确报错，**必须不** 静默双挂。

**AC-18:** `[Must]` **普遍型** — Host bridge **必须** 使用非 stdout 通道，**必须不** 侵占 SDK JSON-RPC stdout。

**AC-32:** `[Must]` **普遍型** — 系统 **必须不** 将密钥明文写入扩展日志、spec 或提交物。

**AC-33:** `[Must]` 本 Phase 验证含 ≥1 真实组件集成测试与 ≥1 独立 e2e 场景。

## 约束（来自 design.md）

- AD-2：双通道；Q-2 默认 UDS/named pipe + NDJSON
- AD-3：ide profile 不得挂载 Web ui-approval / ui-user-questions
- 不修改 agent-loop；不在 SDK stdout 加入审批 RPC
- Constitution §1–§3：无空壳公开 API；敏感数据不进日志

## 产出清单

- `packages/bundle/ide/`（或等价）`cordis.patch.yml` + 包元数据
- `packages/ide/ide-bridge/` 插件骨架：连接 Host socket、暴露连接态；完整 answerer 可 `@STUB` 到 Phase 3 并登记 registry
- `apps/vscode-dsh/`：spawn/`initialize`/`shutdown`、错误 UI、bridge server listen
- 互斥校验（组合测试或 boot 断言）
- 集成测试 + e2e 场景文档/脚本
- 更新 `tech-debt-registry.md`（若留 stub）

## 不在范围内

- 多 Tab UI（Phase 2）
- 审批/提问完整闭环（Phase 3）
- 时间线完整投影与 Diff（Phase 4）
- Spec/hooks 产品化
