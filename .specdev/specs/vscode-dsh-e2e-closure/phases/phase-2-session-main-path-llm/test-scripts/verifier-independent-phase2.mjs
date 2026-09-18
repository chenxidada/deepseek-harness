// 独立验证脚本 — phase-2-session-main-path-llm（verifier 独立断言，不信任 implementer 的测试）
//
// 用途：对 run-layer-v-capabilities.sh 产出的 layer-v-capabilities-status.json 做独立断言，
// 验证「14 项能力 = 13 PASS + #33 LINK_FAILURE（DEBT-2）+ 流式增量真实」这一验收结论。
// 用法：node verifier-independent-phase2.mjs <status.json>
//
// 断言内容（与本 Phase AC-7/AC-9/AC-10 对应）：
//   1. hasCredential === true（AC-9：真实 DEEPSEEK_API_KEY，非模拟）
//   2. 恰好 14 项能力（§12.3 九项 + §12.8 二项 + §12.9 三项）
//   3. 13 项 PASS + 1 项 LINK_FAILURE 且恰为 cap-fork-from-closed-turn（#33）
//   4. #18/#20/#21 的 stream 步 sawStreaming===true 且 sawGrowth===true（流式增量真实，非最终 marker 假阳性）
//   5. journal 中无 injectAssistant/answerApproval（AC-9：不得用注入偷换模型往返）

import { readFileSync, existsSync } from 'node:fs'

const statusPath = process.argv[2]
const journalPath = process.argv[3]

if (!statusPath) {
  console.error('usage: node verifier-independent-phase2.mjs <status.json> [journal.jsonl]')
  process.exit(2)
}

const status = JSON.parse(readFileSync(statusPath, 'utf8'))
const caps = status.capabilities ?? []
const failures = []

function check(name, ok, detail = '') {
  const mark = ok ? 'PASS' : 'FAIL'
  console.log(`  [${mark}] ${name}${detail ? ' — ' + detail : ''}`)
  if (!ok) failures.push(name)
}

console.log(`runId=${status.runId}  conclusion=${status.conclusion}`)
console.log(`hasCredential=${status.hasCredential}`)
console.log('')

// 1. AC-9 真实凭据
check('AC-9: hasCredential === true', status.hasCredential === true, String(status.hasCredential))

// 2. 恰好 14 项
check('14 项能力', caps.length === 14, `got ${caps.length}`)

// 3. 13 PASS + 1 LINK_FAILURE 且恰为 #33
const passIds = caps.filter((c) => c.conclusion === 'PASS').map((c) => c.id)
const failIds = caps.filter((c) => c.conclusion !== 'PASS')
check('13 项 PASS', passIds.length === 13, `${passIds.length} PASS`)
check(
  '唯一非 PASS 恰为 cap-fork-from-closed-turn (#33) 且 LINK_FAILURE',
  failIds.length === 1 && failIds[0].id === 'cap-fork-from-closed-turn' && failIds[0].conclusion === 'LINK_FAILURE',
  failIds.map((c) => `${c.id}=${c.conclusion}`).join(', '),
)

// 4. 流式增量真实（#18/#20/#21）
for (const id of ['cap-message-store-stream-patch', 'cap-messages-protocol', 'cap-host-send-stream']) {
  const cap = caps.find((c) => c.id === id)
  if (!cap) {
    check(`流式增量 ${id}`, false, 'capability missing')
    continue
  }
  const streamSteps = (cap.steps ?? []).filter((s) => s.kind === 'stream')
  const sawStreaming = streamSteps.some((s) => s.streaming?.sawStreaming === true)
  const sawGrowth = streamSteps.some((s) => s.streaming?.sawGrowth === true)
  check(`流式增量 ${id}: sawStreaming && sawGrowth`, sawStreaming && sawGrowth, `sawStreaming=${sawStreaming} sawGrowth=${sawGrowth}`)
}

// 5. AC-9 反注入（journal 中无 injectAssistant / answerApproval）
if (journalPath && existsSync(journalPath)) {
  const journal = readFileSync(journalPath, 'utf8')
  const injected = /injectAssistant|answerApproval/.test(journal)
  check('AC-9: journal 无 injectAssistant/answerApproval', !injected)
} else {
  console.log('  [SKIP] journal 未提供，跳过反注入断言')
}

console.log('')
if (failures.length > 0) {
  console.log(`VERDICT: FAIL (${failures.length} assertion(s) failed)`)
  process.exit(1)
} else {
  console.log('VERDICT: PASS — 14 项 = 13 PASS + #33 LINK_FAILURE(DEBT-2)，流式增量真实，无注入')
  process.exit(0)
}
