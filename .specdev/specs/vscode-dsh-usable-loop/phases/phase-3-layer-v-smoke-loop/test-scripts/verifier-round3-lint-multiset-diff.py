#!/usr/bin/env python3
"""round-3 verifier: per-file x per-rule MULTISET diff of two oxlint captures.

Difference from a rule-level SET diff: a rule that already existed in the base
tree but whose COUNT grew is invisible to a set diff.  Counting occurrences per
(file, rule) pair makes those growths visible.

Usage:
  verifier-round3-lint-multiset-diff.py <base.txt> <cur.txt> [--focus-list FILE]

Diagnostic line grammar (oxlint default reporter):
  <path>:<line>:<col>: <severity> <plugin>(<rule>): <message>
"""

from __future__ import annotations

import collections
import re
import sys

LINE = re.compile(
    r'^(?P<path>.+?):(?P<line>\d+):(?P<col>\d+): '
    r'(?P<sev>error|warning) (?P<plugin>[@A-Za-z0-9_/-]+)\((?P<rule>[A-Za-z0-9_-]+)\):'
)


def parse(path: str) -> tuple[collections.Counter, collections.Counter]:
    per_file_rule: collections.Counter = collections.Counter()
    per_rule: collections.Counter = collections.Counter()
    with open(path, encoding='utf-8', errors='replace') as handle:
        for raw in handle:
            match = LINE.match(raw)
            if match is None:
                continue
            key = (match.group('path'), f"{match.group('plugin')}({match.group('rule')})")
            per_file_rule[key] += 1
            per_rule[key[1]] += 1
    return per_file_rule, per_rule


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    base_file, cur_file = sys.argv[1], sys.argv[2]
    focus: list[str] = []
    if '--focus-list' in sys.argv:
        with open(sys.argv[sys.argv.index('--focus-list') + 1], encoding='utf-8') as handle:
            focus = [line.strip() for line in handle if line.strip()]

    base_ff, base_r = parse(base_file)
    cur_ff, cur_r = parse(cur_file)

    print(f'# base  = {base_file}  diagnostics={sum(base_ff.values())}  rules={len(base_r)}')
    print(f'# cur   = {cur_file}  diagnostics={sum(cur_ff.values())}  rules={len(cur_r)}')
    print()

    print('## A. rule-level totals (cur - base), non-zero deltas only')
    for rule in sorted(set(base_r) | set(cur_r)):
        delta = cur_r[rule] - base_r[rule]
        if delta != 0:
            print(f'  {delta:+7d}  {rule}   (base={base_r[rule]} cur={cur_r[rule]})')
    print()

    print('## B. per-file rule MULTISET growth (cur_count - base_count > 0)')
    grown = collections.Counter()
    for (path, rule), count in cur_ff.items():
        delta = count - base_ff[(path, rule)]
        if delta > 0:
            grown[(path, rule)] = delta
    if not grown:
        print('  (none)')
    for (path, rule), delta in sorted(grown.items()):
        print(f'  +{delta:<4d} {rule:<45s} base={base_ff[(path, rule)]} cur={cur_ff[(path, rule)]}  {path}')
    print()

    print('## C. files with any growth, aggregated')
    per_path = collections.Counter()
    for (path, _rule), delta in grown.items():
        per_path[path] += delta
    for path, delta in sorted(per_path.items(), key=lambda kv: -kv[1]):
        print(f'  +{delta:<5d} {path}')
    print()

    if focus:
        print('## D. focus set: full per-file rule table (cur vs base)')
        for path in focus:
            rules = sorted({r for (p, r) in set(cur_ff) | set(base_ff) if p == path})
            total_cur = sum(cur_ff[(path, r)] for r in rules)
            total_base = sum(base_ff[(path, r)] for r in rules)
            print(f'  --- {path}  (base={total_base} cur={total_cur})')
            if not rules:
                print('      (no diagnostics in either tree)')
            for rule in rules:
                b, c = base_ff[(path, rule)], cur_ff[(path, rule)]
                marker = '  <-- GROWTH' if c > b else ('  <-- shrunk' if c < b else '')
                print(f'      base={b:<5d} cur={c:<5d} {rule}{marker}')
        print()

    return 0


if __name__ == '__main__':
    raise SystemExit(main())
