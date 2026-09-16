/**
 * Verifier round 3 — positive control for the `lint (staged)` profile.
 *
 * The three rewritten files lint clean (empty output, exit 0). That result is
 * only meaningful if the same command can *fail*: this file re-introduces the
 * pre-fix forms verbatim and is expected to be reported. It is deliberately not
 * part of the product tree, and it is never imported.
 *
 * HOW TO RUN (the `scripts/` location is required, not cosmetic): every rules
 * block in `.oxlintrc.json` is scoped to `packages/*`, `apps/*`, `examples/`,
 * `scripts/`, or `website/` globs. A file under `.specdev/` matches none of
 * them, so linting a control *in place* reports nothing and proves nothing —
 * a first attempt at this control did exactly that. Copy it into `scripts/`,
 * run, then delete:
 *
 *   cp .specdev/specs/vscode-dsh-usable-loop/phases/phase-2-host-fail-loud-diagnostics/test-scripts/verifier-lint-control-phase3.ts \
 *      scripts/zzz-verifier-lint-control.ts
 *   PATH=/usr/local/n/versions/node/24.3.0/bin:$PATH node_modules/.bin/tsx \
 *     scripts/run-oxlint.ts --config .oxlintrc.staged.json \
 *     scripts/zzz-verifier-lint-control.ts
 *   rm scripts/zzz-verifier-lint-control.ts
 *
 * Expected: non-zero exit with `typescript/no-non-null-assertion` diagnostics
 * (the rule at `.oxlintrc.json:160`, which governs `apps/*/src/**`).
 */

export function preFixTailSelection(more: string[]): string | undefined {
  if (more.length > 0) {
    const next = more[more.length - 1]!
    return next
  }
  return undefined
}

export function preFixInsertIndex(queue: { state: string }[]): number {
  let insertAt = 0
  while (insertAt < queue.length) {
    const current = queue[insertAt]!
    if (current.state === 'presented') {
      insertAt += 1
      continue
    }
    break
  }
  return insertAt
}

export function preFixForwardDeclaration(): (v: boolean) => void {
  let setConnected!: (v: boolean) => void
  return setConnected
}
