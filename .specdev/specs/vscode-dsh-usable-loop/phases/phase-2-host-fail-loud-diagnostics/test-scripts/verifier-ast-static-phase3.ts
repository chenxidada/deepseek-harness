/**
 * Verifier round 3 — static (AST-level) evidence for the four lint-driven rewrites.
 * Complementary to `verifier-independent-phase3.spec.ts`: this script runs in place
 * (no copy into the repo test tree) and asserts *shape*, not behavior.
 *
 *   PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH node_modules/.bin/tsx \
 *     .specdev/specs/vscode-dsh-usable-loop/phases/phase-2-host-fail-loud-diagnostics/test-scripts/verifier-ast-static-phase3.ts
 *
 * Exits non-zero on the first failed assertion. Proves nothing about runtime
 * behavior on its own; it exists to pin the mechanical claims (no `this` in the
 * detached method, old forms gone, arrow parens binding-neutral).
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const repoRoot = fileURLToPath(new URL('../../../../../../', import.meta.url))
const read = (relative: string): string => readFileSync(new URL(relative, `file://${repoRoot}`), 'utf8')

let failures = 0
const check = (label: string, ok: boolean, detail = ''): void => {
  if (!ok) failures += 1
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === '' ? '' : `  — ${detail}`}\n`)
}

const parse = (source: string, name: string): ts.SourceFile =>
  ts.createSourceFile(name, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS)

function walk(node: ts.Node, visit: (n: ts.Node) => void): void {
  visit(node)
  node.forEachChild(child => { walk(child, visit) })
}

const SPEC = 'apps/vscode-dsh/tests/auto-start-orchestrator.spec.ts'
const ORCH = 'apps/vscode-dsh/src/auto-start-orchestrator.ts'
const COORD = 'apps/vscode-dsh/src/interaction-coordinator.ts'

// --- 1. the spec helper: `setConnected` is receiver-independent -------------
{
  const source = read(SPEC)
  const file = parse(source, SPEC)
  const methods: ts.MethodDeclaration[] = []
  walk(file, node => {
    if (ts.isMethodDeclaration(node) && node.name.getText(file) === 'setConnected') methods.push(node)
  })
  check('spec: exactly one `setConnected` method declared', methods.length === 1, `found ${methods.length}`)
  let thisExpressions = 0
  let closureWrites = 0
  for (const method of methods) {
    walk(method, node => {
      if (node.kind === ts.SyntaxKind.ThisKeyword) thisExpressions += 1
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) closureWrites += 1
    })
  }
  check('spec: `setConnected` body has no `this` (so dropping `.bind` is inert)', thisExpressions === 0, `this=${thisExpressions}`)
  check('spec: `setConnected` body still assigns a closure variable', closureWrites > 0, `assignments=${closureWrites}`)
  check('spec: no forward declaration `let setConnected` remains', !/let\s+setConnected\s*!/.test(source))
  check('spec: no `.bind(port)` remains', !/\.bind\(\s*port\s*\)/.test(source))
  const directCalls = source.match(/port\.setConnected\(/g) ?? []
  check('spec: every call site goes through the returned port object', directCalls.length === 6, `found ${directCalls.length}`)
  let bareCalls = 0
  walk(file, node => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
      && node.expression.getText(file) === 'setConnected') bareCalls += 1
  })
  check('spec: no bare `setConnected(...)` call remains', bareCalls === 0, `found ${bareCalls}`)
}

// --- 2. the orchestrator finally block: old forms gone ---------------------
{
  const source = read(ORCH)
  check('orch: `more.at(-1)` hoisted before the guard', /const next = more\.at\(-1\)\s*\n\s*if \(next !== undefined/.test(source))
  check('orch: the removed length check is gone', !/more\.length > 0/.test(source))
  check('orch: the removed asserted index read is gone', !/more\[more\.length - 1\]!/.test(source))
  const file = parse(source, ORCH)
  let ifWithUndefinedCheck = 0
  walk(file, node => {
    if (ts.isIfStatement(node) && /next !== undefined/.test(node.expression.getText(file))) ifWithUndefinedCheck += 1
  })
  check('orch: exactly one guard tests `next !== undefined`', ifWithUndefinedCheck === 1, `found ${ifWithUndefinedCheck}`)
}

// --- 3. the coordinator enqueue: for..of, no indexed read -----------------
{
  const source = read(COORD)
  const file = parse(source, COORD)
  const enqueues: ts.MethodDeclaration[] = []
  walk(file, node => {
    if (ts.isMethodDeclaration(node) && node.name.getText(file) === 'enqueue') enqueues.push(node)
  })
  check('coord: exactly one `enqueue` method declared', enqueues.length === 1, `found ${enqueues.length}`)
  const enqueue = enqueues[0]
  let forOf = 0
  let whileLoops = 0
  let indexedQueueReads = 0
  if (enqueue !== undefined) {
    walk(enqueue, node => {
      if (ts.isForOfStatement(node)) forOf += 1
      if (ts.isWhileStatement(node)) whileLoops += 1
      if (ts.isElementAccessExpression(node) && node.expression.getText(file) === 'this.queue') indexedQueueReads += 1
    })
  }
  check('coord: `enqueue` iterates with for..of', forOf === 1, `forOf=${forOf}`)
  check('coord: `enqueue` has no while loop', whileLoops === 0, `while=${whileLoops}`)
  check('coord: `enqueue` has no `this.queue[index]` read', indexedQueueReads === 0, `reads=${indexedQueueReads}`)
  check('coord: the old asserted indexed read is gone', !/const current = this\.queue\[insertAt\]!/.test(source))
  check('coord: the insertion index is still spliced at', /this\.queue\.splice\(insertAt, 0, entry\)/.test(source))
}

// --- 4. arrow-parens are binding-neutral ----------------------------------
{
  const parenthesized = parse('const f = (r) => r\n', 'a.ts')
  const bare = parse('const f = r => r\n', 'b.ts')
  const dump = (file: ts.SourceFile): string => {
    const out: string[] = []
    walk(file, node => { out.push(String(ts.SyntaxKind[node.kind])) })
    return out.join('>')
  }
  check('ast: `(r) => r` and `r => r` produce the same node-kind sequence', dump(parenthesized) === dump(bare))
  for (const [label, path] of [['spec', SPEC], ['coord', COORD]] as const) {
    const source = read(path)
    const file = parse(source, path)
    // A single plain identifier parameter carries no annotation, default, rest, or
    // destructuring, so the parentheses around it are pure style: `(r)` and `r`
    // bind identically. Count them so the claim is not vacuous.
    let parentNeutralParams = 0
    walk(file, node => {
      if (!ts.isArrowFunction(node)) return
      if (node.parameters.length !== 1) return
      const parameter = node.parameters[0]
      if (parameter === undefined || !ts.isIdentifier(parameter.name)) return
      if (parameter.initializer !== undefined || parameter.type !== undefined
        || parameter.questionToken !== undefined || parameter.dotDotDotToken !== undefined) return
      parentNeutralParams += 1
    })
    check(`ast: ${label} has paren-neutral single-identifier arrow params`, parentNeutralParams > 0,
      `params=${parentNeutralParams}`)
  }
}

process.stdout.write(failures === 0 ? '\nALL STATIC CHECKS PASSED\n' : `\n${failures} STATIC CHECK(S) FAILED\n`)
process.exit(failures === 0 ? 0 : 1)
