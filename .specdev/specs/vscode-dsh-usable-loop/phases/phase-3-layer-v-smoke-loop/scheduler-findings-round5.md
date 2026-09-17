# 调度者独立核验：round-3 design 复审 🟡 项（2026-09-17）

对 `review-design.md`（round-3，判决 SHOULD-FIX / 0🔴 3🟡 6🟢）中**会影响下一步 verifier 结论**的项做独立实证。

## 🟡-2 属实：注释指针悬空 + registry 关闭条件与真实契约相左

**① 悬空指针（已实证）**

`run-layer-v-smoke.sh:1174` 原文：

> `# \`apps/cli\` is left out on purpose — see the boundary note in implementation.md.`

而 `implementation.md` 中 `apps/cli` **0 命中**（`rg -c` 实测）⇒ 注释指向一份**不存在的留痕**。

**② 排除本身实质正确（已独立验证，非转述）**

排除理由的真实位置是「该路径走**源码**启动，`apps/cli/lib` 不被使用」：

| 证据 | 位置 |
|---|---|
| `hasSourceLaunch` 三要件由 `packageDir` 解析 | `packages/sdk/client/src/launch.ts:33-35` |
| 三要件**全部存在** | `apps/cli/src/bin.ts` ✓ / `apps/cli/src/sdk-source.cordis.patch.yml` ✓（242 B）/ `apps/cli/tsconfig.json` ✓ |
| 源码启动优先，`lib/` 只在源码不全时回落 | `launch.ts:100-111` |
| 该路径**不读** `apps/cli/lib` | `rg 'cli/lib' run-layer-v-smoke.sh` = 0 命中（`apps/cli` 仅出现在 :1174 注释） |

⇒ `hasSourceLaunch = TRUE` ⇒ 走 tsx + `src/bin.ts` ⇒ **`apps/cli/lib` 陈旧不影响本闭环** ⇒ 排除正确。
**注意**：`apps/cli/lib` **确实存在**（`bin.js` 等 5 项），故「无产物所以排除」**不是**正确理由；正确理由是**源码启动路径**。

**③ registry 关闭条件 (iii) 字面为假，会误导 verifier**

`tech-debt-registry.md` 现写：

> 关闭条件：(iii) 比较集 = `tsdown.config.ts` 的 workspace 集且**无成员落在比较之外**

字面为假：`tsdown.config.ts` 的 workspace = `['vendor/*', 'packages/*/*', 'apps/cli', 'apps/vscode-dsh']`，其中 `apps/cli` 与 `apps/vscode-dsh` **都在比较之外**。

真实契约（`build-freshness.spec.ts`）：

```359:369:apps/vscode-dsh/tests/build-freshness.spec.ts
  it('leaves no member of the tsdown workspace list outside the comparison', () => {
    const members = tsdownWorkspaceMembers()
    const uncovered = members.filter(
      member => !COMPARED_GLOBS.some(glob => matchesSingleSegmentGlob(glob, member)) && !OUTSIDE_THE_GLOBS.includes(member),
    )
    expect(uncovered).toEqual([])
  })
```

即「**每个成员要么落在比较 glob 内、要么被显式命名在 `OUTSIDE_THE_GLOBS`**」，而**不是**「无成员在外」。

> ⚠️ **风险**：verifier 若按现 (iii) 字面判，会得出「未满足」—— 与实现相反。**必须在派 verifier 前修正**。

## 🟢 调度者补充发现（reviewer 未提）：该契约是**自证循环**

`build-freshness.spec.ts:377` 的 `expect(smokeScript).toContain('apps/cli')` —— 而 `run-layer-v-smoke.sh` 中 `apps/cli` 的**唯一命中就是那条注释本身**（`:1174`）。

⇒ 该断言实际检验的是「**存在一句提到 apps/cli 的注释**」，而非「该排除带有可复核理由」。
它不是恒真（删注释会红），但**强度极低**，属 `DEBT-014/015/016/018` 同族的「防线弱于外观」。

**建议**（非阻塞）：把断言加强为「注释里给出可验证的理由指针，且该指针在指定文件内可命中」。

## 偏离裁定（§8.1 第 3 项）

`review-design` 独立判定：`owned` 数组形态属**等价或更强**实现，**无需升级用户重裁**。
调度者实测（`OXC_LOG=debug`）已证字面要求构成构造性矛盾（探针 `Got tsconfig: <none>`，`Total programs: 0`）。

**但**：该形态是对**用户明确裁定**的偏离，依 `CLAUDE.md` 冲突优先级（用户确认 > design.md），**仍须在 HG-3 向用户显式呈现并取得确认**，不得以「reviewer 已认可」替用户决定。
