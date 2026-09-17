#!/usr/bin/env python3
"""Round-3 (terminal) verifier probe.

Independently challenges the scheduler's lint-attribution method for Phase 3.

The scheduler used "per file, rule-name set difference". This probe implements a
strictly stronger method and runs it against the same two trees:

  A. explicit-path invocation in BOTH trees  -> immune to build-artifact drift
     (the whole-repo gate is NOT comparable across the two trees: the current
     worktree carries untracked .d.ts/.js build twins that the base worktree
     lacks, which is why `oxlint .` reports 10370 vs 2218 errors).
  B. MULTISET per (file, rule)               -> catches count growth for a rule
     whose name is unchanged (rule-level set difference is blind to this).
  C. line-level attribution via `git diff -U0 <baseline> -- <file>`
                                             -> separates "newly introduced in
     changed code" from "pre-existing, merely shifted or re-counted".
  D. per-rule family buckets                 -> "pre-existing at base" vs
     "rule absent at base" (operational definition of newly introduced rule),
     plus an explicit no-unsafe-* tally.

Read-only with respect to the repository (git is used read-only).
"""

from __future__ import annotations

import collections
import os
import re
import subprocess
import sys

CUR = '/workspace/chendecheng/code/need/deepseek/deepseek-harness'
BASE = '/tmp/dsh-base-check'
BASELINE = '300f492f84b4c9467eb2c0b483c25dd5cc384cde'
NODE_BIN = '/usr/local/n/versions/node/24.3.0/bin'

MODIFIED = [
    'apps/vscode-dsh/src/extension.ts',
    'apps/vscode-dsh/src/host-diagnostics.ts',
    'apps/vscode-dsh/src/interaction-coordinator.ts',
    'apps/vscode-dsh/src/session-host.ts',
    'apps/vscode-dsh/tests/host-diagnostics.spec.ts',
    'apps/vscode-dsh/tests/node-env-guard.spec.ts',
    'apps/vscode-dsh/tests/session-host.spec.ts',
]
ADDED = [
    'apps/vscode-dsh/tests/interaction-approval-resolution.spec.ts',
    'apps/vscode-dsh/tests/layer-v-inject-disconnect.spec.ts',
]
NON_TS = [
    'apps/vscode-dsh/test-scripts/run-layer-v-smoke.sh',
    'apps/vscode-dsh/test-scripts/layer-v-shadow-preset.sh',
    'apps/vscode-dsh/test-scripts/layer-v-driver/extension.cjs',
    'apps/vscode-dsh/test-scripts/layer-v-driver/package.json',
]

DIAG = re.compile(
    r'^(?P<path>\S+?):(?P<line>\d+):(?P<col>\d+): '
    r'(?P<sev>error|warning) (?P<plugin>[A-Za-z0-9_@/.-]+)\((?P<rule>[A-Za-z0-9_-]+)\):'
)
HUNK = re.compile(r'^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@')


def run(root: str, paths: list[str]) -> tuple[str, int]:
    env = dict(os.environ)
    env['PATH'] = NODE_BIN + os.pathsep + env['PATH']
    proc = subprocess.run(
        ['node_modules/.bin/tsx', 'scripts/run-oxlint.ts', *paths],
        cwd=root, env=env, capture_output=True, text=True,
    )
    return proc.stdout + proc.stderr, proc.returncode


def parse(text: str) -> list[tuple[str, int, int, str, str]]:
    out = []
    for line in text.splitlines():
        m = DIAG.match(line)
        if m:
            out.append((m.group('path'), int(m.group('line')), int(m.group('col')), m.group('sev'), m.group('rule')))
    return out


def tracked(path: str) -> bool:
    p = subprocess.run(['git', 'ls-files', '--error-unmatch', path], cwd=CUR, capture_output=True, text=True)
    return p.returncode == 0


def changed_ranges(path: str) -> list[tuple[int, int]] | str:
    if not tracked(path):
        return 'all-new'
    p = subprocess.run(['git', 'diff', '-U0', BASELINE, '--', path], cwd=CUR, capture_output=True, text=True)
    ranges = []
    for line in p.stdout.splitlines():
        m = HUNK.match(line)
        if m:
            start = int(m.group(1))
            count = int(m.group(2) or 1)
            if count:
                ranges.append((start, start + count - 1))
    return ranges


def line_text(root: str, path: str, n: int) -> str | None:
    try:
        with open(os.path.join(root, path), encoding='utf-8', errors='replace') as handle:
            for i, raw in enumerate(handle, 1):
                if i == n:
                    return raw.rstrip('\n').strip()
    except FileNotFoundError:
        return None
    return None


def in_ranges(ranges, n: int) -> bool:
    if ranges == 'all-new':
        return True
    return any(lo <= n <= hi for lo, hi in ranges)


def main() -> int:
    present_in_base = [f for f in MODIFIED if os.path.exists(os.path.join(BASE, f))]
    absent_in_base = [f for f in MODIFIED if f not in present_in_base]

    print('== SECTION 1: TS/TSX candidate set, both trees, explicit paths ==')
    base_out, base_rc = run(BASE, present_in_base)
    base_diags = parse(base_out)
    print(f'base  ({len(present_in_base)} files): exit={base_rc} diagnostics={len(base_diags)}')
    if absent_in_base:
        print(f'  WARNING: modified files missing from base worktree: {absent_in_base}')

    cur_files = MODIFIED + ADDED
    cur_out, cur_rc = run(CUR, cur_files)
    cur_diags = parse(cur_out)
    print(f'cur   ({len(cur_files)} files): exit={cur_rc} diagnostics={len(cur_diags)}')

    base_by_file = collections.defaultdict(list)
    for rec in base_diags:
        base_by_file[rec[0]].append(rec)
    cur_by_file = collections.defaultdict(list)
    for rec in cur_diags:
        cur_by_file[rec[0]].append(rec)

    print('\n-- per-file totals (multiset, not set) --')
    for f in cur_files:
        b, c = len(base_by_file.get(f, [])), len(cur_by_file.get(f, []))
        mark = 'NEW FILE' if f in ADDED else ('same' if b == c else 'CHANGED')
        print(f'  {f}: base={b} cur={c}  delta={c - b:+d}  [{mark}]')

    print('\n-- same-rule count growth (the blind spot of a rule-name set difference) --')
    findings = []
    for f in cur_files:
        bcnt = collections.Counter(r[4] for r in base_by_file.get(f, []))
        ccnt = collections.Counter(r[4] for r in cur_by_file.get(f, []))
        for rule in sorted(set(bcnt) | set(ccnt)):
            d = ccnt[rule] - bcnt[rule]
            if d > 0:
                print(f'  GROWTH {f} :: {rule}: {bcnt[rule]} -> {ccnt[rule]} ({d:+d})')
                findings.append((f, rule, bcnt[rule], ccnt[rule]))
            elif d < 0:
                print(f'  shrink {f} :: {rule}: {bcnt[rule]} -> {ccnt[rule]} ({d:+d})')

    print('\n-- line-level attribution of every diagnostic present now but not at base --')
    base_pairs = collections.Counter((r[0], r[4], line_text(BASE, r[0], r[1])) for r in base_diags)
    buckets = collections.Counter()
    new_lines_in_diff = []
    new_lines_untouched = []
    for rec in sorted(cur_diags, key=lambda r: (r[0], r[1], r[4])):
        key = (rec[0], rec[4], line_text(CUR, rec[0], rec[1]))
        if base_pairs[key] > 0:
            base_pairs[key] -= 1
            continue
        ranges = changed_ranges(rec[0])
        if in_ranges(ranges, rec[1]):
            buckets['new-in-diff'] += 1
            new_lines_in_diff.append(rec)
        else:
            buckets['new-on-untouched-line'] += 1
            new_lines_untouched.append(rec)

    print(f'  new-in-diff            = {buckets["new-in-diff"]}')
    print(f'  new-on-untouched-line  = {buckets["new-on-untouched-line"]}  <-- misattribution risk')
    for rec in new_lines_in_diff:
        print(f'    [in-diff] {rec[0]}:{rec[1]} {rec[4]}  | {line_text(CUR, rec[0], rec[1])}')
    for rec in new_lines_untouched:
        print(f'    [untouched] {rec[0]}:{rec[1]} {rec[4]}  | {line_text(CUR, rec[0], rec[1])}')

    print('\n-- rule families --')
    base_rules = {r[4] for r in base_diags}
    new_rules = collections.Counter(r[4] for r in cur_diags if r[4] not in base_rules)
    print(f'  rule names present at base: {len(base_rules)}')
    print(f'  rule names absent at base but present now: {dict(new_rules)}')
    unsafe_cur = sum(1 for r in cur_diags if r[4].startswith('no-unsafe-'))
    unsafe_base = sum(1 for r in base_diags if r[4].startswith('no-unsafe-'))
    print(f'  no-unsafe-* (cur scope): base={unsafe_base} cur={unsafe_cur} delta={unsafe_cur - unsafe_base:+d}')

    print('\n== SECTION 2: non-TS assets of this Phase, explicit paths, real exit codes ==')
    for f in NON_TS:
        exists_cur = os.path.exists(os.path.join(CUR, f))
        if not exists_cur:
            print(f'  {f}: MISSING in current tree')
            continue
        out, rc = run(CUR, [f])
        first = [ln for ln in out.splitlines() if ln.strip()][:1]
        print(f'  {f}: exit={rc} bytes={len(out)} first_line={first[0] if first else "<no output>"}')

    print('\n== SECTION 3: does the whole-repo gate see build twins? ==')
    twins = subprocess.run(
        ['git', 'status', '--porcelain', '--untracked-files=all'],
        cwd=CUR, capture_output=True, text=True,
    ).stdout.splitlines()
    twin_files = [ln[3:] for ln in twins if ln.startswith('?? ') and re.search(r'\.(d\.ts|js|js\.map|d\.ts\.map)$', ln)]
    twin_base = subprocess.run(
        ['git', 'status', '--porcelain', '--untracked-files=all'],
        cwd=BASE, capture_output=True, text=True,
    ).stdout.splitlines()
    twin_base_files = [ln[3:] for ln in twin_base if ln.startswith('?? ') and re.search(r'\.(d\.ts|js)$', ln)]
    print(f'  untracked build twins in current tree: {len(twin_files)}')
    print(f'  untracked build twins in base worktree: {len(twin_base_files)}')
    print('  => `oxlint .` is NOT comparable across the two trees; explicit-path comparison (SECTION 1) is.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
