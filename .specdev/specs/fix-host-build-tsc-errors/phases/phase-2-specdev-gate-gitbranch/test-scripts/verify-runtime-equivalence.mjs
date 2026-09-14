#!/usr/bin/env node
/**
 * 独立验证脚本 — Phase 2 specdev-gate gitBranch 条件展开的运行时等价性。
 *
 * 目的：证明「条件展开省略键」与「显式 undefined」在 `actual === undefined`
 * 判断下运行时等价，从而 fail-closed 语义保持（AC-4 回归验证）。
 *
 * 验证矩阵（镜像 check.ts 的 evaluateImplementer fail-closed 分支）：
 *   1. role !== 'implementer' → 键省略 → options.gitBranch === undefined → 拒绝 (SPECDEV_BRANCH_UNKNOWN)
 *   2. role === 'implementer' 且 git 返回 null → 键存在值为 null → 拒绝 (SPECDEV_BRANCH_UNKNOWN)
 *   3. role === 'implementer' 且 branch === expected → 允许
 *   4. role === 'implementer' 且 branch !== expected → 拒绝 (SPECDEV_BRANCH_MISMATCH)
 *   5. 关键差异：省略键时 `'gitBranch' in obj === false`，显式 undefined 时 `in obj === true`
 *      —— 但 check.ts 只用 `actual === undefined` 判断，不依赖 `in`，故二者等价。
 */

const gitReader = (branch) => (cwd) => (branch === null ? null : `impl-${branch}`)
const EXPECTED = 'impl-phase-2-specdev-gate-gitbranch'

// 条件展开（本 Phase 修复后的形态）
function buildOptions(role, gitBranchValue) {
  return {
    ...(role === 'implementer' ? { gitBranch: gitBranchValue } : {}),
  }
}

// 旧形态（显式 undefined）
function buildOptionsLegacy(role, gitBranchValue) {
  return {
    gitBranch: role === 'implementer' ? gitBranchValue : undefined,
  }
}

// check.ts evaluateImplementer 的 fail-closed 矩阵（只含 gitBranch 部分）
function evaluateImplementerBranch(actual) {
  if (actual === undefined) return 'SPECDEV_BRANCH_UNKNOWN' // 省略=拒绝
  if (actual === null || actual.length === 0) return 'SPECDEV_BRANCH_UNKNOWN' // null/空=拒绝
  if (actual !== EXPECTED) return 'SPECDEV_BRANCH_MISMATCH' // 分支不匹配=拒绝
  return 'ALLOW'
}

let pass = 0
let fail = 0
function assert(cond, msg) {
  if (cond) {
    pass++
    console.log(`  ✅ ${msg}`)
  } else {
    fail++
    console.error(`  ❌ ${msg}`)
  }
}

console.log('== 场景 1：role !== implementer，省略键 vs 显式 undefined 语义等价 ==')
const newOmit = buildOptions('reviewer', undefined)
const legacyUndef = buildOptionsLegacy('reviewer', undefined)
assert(newOmit.gitBranch === undefined, '新形态：省略键 → options.gitBranch === undefined')
assert(legacyUndef.gitBranch === undefined, '旧形态：显式 undefined → options.gitBranch === undefined')
assert(
  evaluateImplementerBranch(newOmit.gitBranch) === 'SPECDEV_BRANCH_UNKNOWN',
  '新形态省略键 → fail-closed 拒绝 (SPECDEV_BRANCH_UNKNOWN)',
)
assert(
  evaluateImplementerBranch(legacyUndef.gitBranch) === 'SPECDEV_BRANCH_UNKNOWN',
  '旧形态显式 undefined → 同样 fail-closed 拒绝',
)
assert(
  evaluateImplementerBranch(newOmit.gitBranch) === evaluateImplementerBranch(legacyUndef.gitBranch),
  '新旧形态判定结果一致（运行时等价）',
)

console.log('== 场景 2：role === implementer，git 返回 null → 拒绝 ==')
const newNull = buildOptions('implementer', null)
assert(newNull.gitBranch === null, '新形态：git null → options.gitBranch === null')
assert(
  evaluateImplementerBranch(newNull.gitBranch) === 'SPECDEV_BRANCH_UNKNOWN',
  'null → fail-closed 拒绝',
)

console.log('== 场景 3：role === implementer，分支匹配 → 允许 ==')
const newMatch = buildOptions('implementer', EXPECTED)
assert(newMatch.gitBranch === EXPECTED, '分支匹配 → options.gitBranch === expected')
assert(
  evaluateImplementerBranch(newMatch.gitBranch) === 'ALLOW',
  '分支匹配 → ALLOW',
)

console.log('== 场景 4：role === implementer，分支不匹配 → 拒绝 ==')
const newMismatch = buildOptions('implementer', 'impl-wrong-branch')
assert(
  evaluateImplementerBranch(newMismatch.gitBranch) === 'SPECDEV_BRANCH_MISMATCH',
  '分支不匹配 → SPECDEV_BRANCH_MISMATCH',
)

console.log('== 场景 5：关键差异只在于 `in` 操作符（check.ts 不使用）==')
assert('gitBranch' in newOmit === false, '省略键：`gitBranch in obj` === false')
assert('gitBranch' in legacyUndef === true, '显式 undefined：`gitBranch in obj` === true')
assert(
  evaluateImplementerBranch(newOmit.gitBranch) === evaluateImplementerBranch(legacyUndef.gitBranch),
  '但二者 `actual === undefined` 判定一致 → 运行时等价成立',
)

console.log(`\n结果：${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
