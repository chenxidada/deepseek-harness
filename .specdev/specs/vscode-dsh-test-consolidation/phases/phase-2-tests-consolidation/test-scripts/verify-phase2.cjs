'use strict';
// Phase 2 verifier independent script.
// Checks AC-1/2/3/6/7/8/9/10/11/12/26/27/28/29 against the frozen Phase 1 baseline.
// Interpreter: any node works (plain JS, no deps). Run with the repo root as cwd.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../../../../..');
const TESTS = path.join(ROOT, 'apps/vscode-dsh/tests');

// --- Frozen baseline (Phase 1 implementation.md §1), relative to apps/vscode-dsh/tests/ ---
const FROZEN_61 = [
  'artifact-index.spec.ts', 'auto-start-orchestrator.spec.ts', 'build-freshness.spec.ts',
  'chat-ready-regression.spec.ts', 'chat-ux-activity-stream.spec.ts', 'chat-ux-fork-retry-branch.spec.ts',
  'chat-ux-refs-changes-diff.spec.ts', 'chat-ux-session-search.spec.ts', 'chat-ux-streaming-cancel-follow.spec.ts',
  'conversation-registry.spec.ts', 'display-evidence-shell.spec.ts', 'display-evidence.spec.ts',
  'editor-chat-panel.lifecycle.spec.ts', 'gap-003-004-debt-fix.spec.ts', 'gap-005-009-debt-fix.spec.ts',
  'host-diagnostics.spec.ts', 'interaction-approval-resolution.spec.ts', 'interaction-fail-closed.e2e.spec.ts',
  'interaction-fail-closed.integration.spec.ts', 'layer-a/activity-stream.spec.ts', 'layer-a/foundation-render-probe.spec.ts',
  'layer-a/protocol-decision-smoke.spec.ts', 'layer-a/refs-changes-diff.spec.ts', 'layer-a/streaming-cancel-follow.spec.ts',
  'layer-a-rtl/editor-chat-phase2.spec.tsx', 'layer-a-rtl/editor-chat-shell.spec.tsx', 'layer-v-capabilities-phase3.spec.ts',
  'layer-v-capability-runner.spec.ts', 'layer-v-inject-disconnect.spec.ts', 'message-store-index.spec.ts',
  'multi-tab-dispose.e2e.spec.ts', 'multi-tab-session.integration.spec.ts', 'node-env-guard.spec.ts',
  'panel-close-delete.e2e.spec.ts', 'panel-l2-l3-protocol.spec.ts', 'phase1-auto-start.spec.ts',
  'phase1-code-context.spec.ts', 'phase2-auto-ready.spec.ts', 'phase2-change-list-display.spec.ts',
  'phase2-history-delete-host.spec.ts', 'phase2-multitab-history-replay.spec.ts', 'phase3-chat-ui-chassis.spec.ts',
  'phase3-restart-continue.spec.ts', 'phase3-review-revert-replay.spec.ts', 'phase4-new-conversation-chrome.spec.ts',
  'phase4-subagent-enter-pin.spec.ts', 'phase5-should-polish.spec.ts', 'replaceability-interaction-ui.spec.ts',
  'sandbox-clean-state.spec.ts', 'session-host-preflight.spec.ts', 'session-host.spec.ts',
  'spike-attribution-snapshot.spec.ts', 'spike-t0a-replay-rebuild.spec.ts', 'spike-t0b-continue-capability.spec.ts',
  'timeline-diff.e2e.spec.ts', 'timeline-diff.integration.spec.ts', 'timeline-projector.spec.ts',
  'verifier-phase1/layer-a-rtl.spec.tsx', 'verifier-phase1/layer-b-lifecycle.spec.ts', 'verifier-phase2/layer-a-rtl.spec.tsx',
  'verifier-phase2/layer-b-host.spec.ts',
];
const FROZEN_SET = new Set(FROZEN_61);

// The 5 spike/gap files (AC-26)
const SPIKE_GAP_5 = new Set([
  'gap-003-004-debt-fix.spec.ts', 'gap-005-009-debt-fix.spec.ts', 'spike-attribution-snapshot.spec.ts',
  'spike-t0a-replay-rebuild.spec.ts', 'spike-t0b-continue-capability.spec.ts',
]);

function listSpecFiles() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.spec.ts') || e.name.endsWith('.spec.tsx')) out.push(p);
    }
  };
  walk(TESTS);
  return out.map((p) => p.replace(TESTS + '/', '')).sort();
}

const CAP_RE = /CAP-[A-Z0-9-]+-[0-9]{3}/g;

let pass = true;
const problems = [];
function check(cond, msg) {
  if (!cond) { pass = false; problems.push(msg); }
  console.log(`${cond ? 'PASS' : 'FAIL'} | ${msg}`);
}

// ---------- AC-1: file naming ----------
console.log('=== AC-1 file naming ===');
const specFiles = listSpecFiles();
const badName = specFiles.filter((f) => /phase[0-9]|gap-[0-9]|spike-|verifier-phase/.test(f));
check(badName.length === 0, `AC-1 no phase/gap/spike/verifier-phase spec names (bad=${JSON.stringify(badName)})`);
const allCapNamed = specFiles.every((f) => /^cap-[a-z0-9-]+(\.dom)?\.spec\.tsx?$/.test(f));
check(allCapNamed, `AC-1 all spec files match cap-<domain>.spec.ts|tsx (${specFiles.length} files)`);

// ---------- AC-2: absorbed union == frozen 61 ----------
console.log('\n=== AC-2 absorbed bidirectional ===');
const json = JSON.parse(fs.readFileSync(path.join(TESTS, 'capability-domains.json'), 'utf8'));
const domains = json.domains;
const absorbed = new Set();
const absorbedDup = [];
for (const d of domains) for (const a of d.absorbed) { if (absorbed.has(a)) absorbedDup.push(a); absorbed.add(a); }
const missing = FROZEN_61.filter((f) => !absorbed.has(f));
const extra = [...absorbed].filter((f) => !FROZEN_SET.has(f));
check(missing.length === 0, `AC-2 missing from absorbed: ${JSON.stringify(missing)}`);
check(extra.length === 0, `AC-2 extra in absorbed: ${JSON.stringify(extra)}`);
check(absorbedDup.length === 0, `AC-2 duplicate absorbed: ${JSON.stringify(absorbedDup)}`);
check(absorbed.size === 61, `AC-2 absorbed union = 61 (got ${absorbed.size})`);

// ---------- AC-26: 5 spike/gap files each absorbed ----------
console.log('\n=== AC-26 spike/gap absorbed ===');
const absorbedSetFor26 = absorbed;
const sgMissing = [...SPIKE_GAP_5].filter((f) => !absorbedSetFor26.has(f));
check(sgMissing.length === 0, `AC-26 all 5 spike/gap files absorbed: ${JSON.stringify(sgMissing)}`);

// ---------- Build tree CAP set + per-file domain ----------
console.log('\n=== tree CAP collection ===');
const treeCaps = new Map(); // CAP -> file
const perFileCaps = {};
for (const f of specFiles) {
  const src = fs.readFileSync(path.join(TESTS, f), 'utf8');
  const caps = src.match(CAP_RE) || [];
  perFileCaps[f] = caps;
  for (const c of caps) {
    if (treeCaps.has(c)) problems.push(`AC-7 duplicate ${c} in ${treeCaps.get(c)} and ${f}`);
    treeCaps.set(c, f);
  }
}

// ---------- AC-7: uniqueness ----------
console.log('\n=== AC-7 uniqueness ===');
const allCaps = [...treeCaps.keys()];
check(treeCaps.size === 556, `AC-7 unique CAPs = 556 (got ${treeCaps.size})`);
const dup = allCaps.filter((c, i) => allCaps.indexOf(c) !== i);
check(dup.length === 0, `AC-7 no duplicate CAPs (dup=${JSON.stringify(dup)})`);

// ---------- AC-3: top-level describe ----------
console.log('\n=== AC-3 describe ===');
const domainIdSet = new Set(domains.map((d) => d.id));
const capDescribeDomains = new Set();
for (const f of specFiles) {
  const src = fs.readFileSync(path.join(TESTS, f), 'utf8');
  const m = src.match(/^describe\('cap:([a-z0-9-]+)/gm) || [];
  const domain = f.replace(/^cap-/, '').replace(/\.spec\.tsx?$/, '').replace(/\.dom$/, '');
  const topLevel = (src.match(/^describe\('cap:/gm) || []).length;
  if (topLevel < 1) problems.push(`AC-3 ${f} missing top-level describe('cap:`);
  for (const line of m) capDescribeDomains.add(line.replace(/^describe\('cap:/, ''));
  check(topLevel >= 1, `AC-3 ${f}: top-level describe('cap: count=${topLevel}`);
}
const domDiff = [...capDescribeDomains].filter((d) => !domainIdSet.has(d));
const domainMissing = [...domainIdSet].filter((d) => !capDescribeDomains.has(d));
check(domDiff.length === 0, `AC-3 describe domains not in manifest: ${JSON.stringify(domDiff)}`);
check(domainMissing.length === 0, `AC-3 manifest domains missing describe: ${JSON.stringify(domainMissing)}`);

// ---------- AC-6 / AC-8: exactly one CAP per title + domain segment consistency ----------
console.log('\n=== AC-6/AC-8 title CAP + domain segment ===');
const domainForFile = (f) => {
  const domain = f.replace(/^cap-/, '').replace(/\.spec\.tsx?$/, '').replace(/\.dom$/, '');
  return domain.toUpperCase().replace(/[^A-Z0-9]+/g, '-');
};
let titleProblems = 0;
let totalIt = 0;
for (const f of specFiles) {
  const src = fs.readFileSync(path.join(TESTS, f), 'utf8');
  const lines = src.split('\n');
  const expectedDomain = domainForFile(f);
  for (const line of lines) {
    const m = line.match(/^\s*(?:it|test)\s*\(/);
    if (!m) continue;
    totalIt++;
    const caps = line.match(CAP_RE) || [];
    if (caps.length !== 1) { titleProblems++; problems.push(`AC-6 ${f}: it/test with ${caps.length} CAPs: ${line.trim().slice(0, 80)}`); }
    else if (!caps[0].startsWith(`CAP-${expectedDomain}-`)) { titleProblems++; problems.push(`AC-8 ${f}: ${caps[0]} domain != ${expectedDomain}`); }
  }
}
check(totalIt === 556, `AC-6 total it/test declarations = 556 (got ${totalIt})`);
check(titleProblems === 0, `AC-6/8 title CAP count + domain segment violations = 0 (got ${titleProblems})`);

// ---------- AC-10: no bare AC-[0-9] ----------
console.log('\n=== AC-10 no bare AC ===');
const acBare = [];
for (const f of specFiles) {
  const src = fs.readFileSync(path.join(TESTS, f), 'utf8');
  const lines = src.split('\n');
  lines.forEach((line, i) => {
    if (/AC-[0-9]/.test(line)) acBare.push(`${f}:${i + 1}`);
  });
}
check(acBare.length === 0, `AC-10 no bare AC-[0-9] in tests (${acBare.length} hits)`);

// ---------- Parse assertion-map ----------
console.log('\n=== assertion-map parsing ===');
const am = fs.readFileSync(path.join(TESTS, 'assertion-map.md'), 'utf8');
const amLines = am.split('\n');
const headerIdx = amLines.findIndex((l) => l.startsWith('| 原文件'));
const headerCols = amLines[headerIdx].split(/(?<!\\)\|/).map((s) => s.trim()).filter((s) => s !== '');
const sepIdx = headerIdx + 1;
const dataRows = amLines.slice(sepIdx + 1).filter((l) => l.startsWith('|') && l.trim() !== '');
check(headerCols.length === 11, `AC-9 header 11 columns (got ${headerCols.length}: ${headerCols.join(',')})`);
check(dataRows.length === 556, `AC-9 data rows = 556 (got ${dataRows.length})`);

function parseRow(row) {
  // split on unescaped pipes (markdown `\|` is a literal pipe inside a cell)
  const cells = row.split(/(?<!\\)\|/).map((s) => s.trim());
  // strip leading/trailing empty from the outer pipes
  const c = cells.slice(1, -1);
  return {
    file: c[0], title: c[1], disposition: c[2], reason: c[3], keepChecks: c[4],
    kEvidence: c[5], privateSymbols: c[6], replacementCap: c[7], closure: c[8], newCap: c[9], weakened: c[10],
  };
}

// ---------- AC-9: 原文件 set == frozen 61 ----------
console.log('\n=== AC-9 bidirectional ===');
const mapFiles = new Set();
let keepCount = 0, dropCount = 0;
const keepNewCaps = new Set();
const keepRowsMissingCap = [];
const dropRows = [];
for (const row of dataRows) {
  const r = parseRow(row);
  mapFiles.add(r.file);
  if (r.disposition === 'keep') { keepCount++; } else if (r.disposition === 'drop') { dropCount++; dropRows.push(r); }
  else { problems.push(`AC-9 bad disposition "${r.disposition}" for ${r.file}`); }
}
const mapMissing = FROZEN_61.filter((f) => !mapFiles.has(f));
const mapExtra = [...mapFiles].filter((f) => !FROZEN_SET.has(f));
check(mapMissing.length === 0, `AC-9 原文件 missing vs frozen: ${JSON.stringify(mapMissing)}`);
check(mapExtra.length === 0, `AC-9 原文件 extra vs frozen: ${JSON.stringify(mapExtra)}`);
check(mapFiles.size === 61, `AC-9 distinct 原文件 = 61 (got ${mapFiles.size})`);

// keep rows' new CAP numbers grep-able
for (const row of dataRows) {
  const r = parseRow(row);
  if (r.disposition !== 'keep') continue;
  if (!r.newCap || r.newCap.trim() === '') { keepRowsMissingCap.push(r.file); continue; }
  for (const cap of r.newCap.split(/\s+/)) {
    if (!treeCaps.has(cap)) problems.push(`AC-9 keep new CAP ${cap} not in tree (${r.file})`);
    else keepNewCaps.add(cap);
  }
}
check(keepRowsMissingCap.length === 0, `AC-9 keep rows missing new CAP: ${JSON.stringify(keepRowsMissingCap)}`);
check(keepCount === 543 && dropCount === 13, `AC-9 keep=543 drop=13 (got keep=${keepCount} drop=${dropCount})`);
check(keepNewCaps.size === 556, `AC-9 keep new CAPs cover all 556 tree CAPs (got ${keepNewCaps.size})`);

// ---------- AC-12/28: drop rows exactly one D ----------
console.log('\n=== AC-12/28 drop rows ===');
const D_RE = /^D[1-4]$/;
let dropProblems = 0;
for (const r of dropRows) {
  if (!D_RE.test(r.reason)) { dropProblems++; problems.push(`AC-28 drop ${r.file} reason "${r.reason}" not single D`); }
  if (r.reason === 'D2' && (!r.privateSymbols || r.privateSymbols.trim() === '')) { dropProblems++; problems.push(`AC-29 D2 ${r.file} missing privateSymbols`); }
  if (r.reason === 'D3' && (!r.replacementCap || !treeCaps.has(r.replacementCap))) { dropProblems++; problems.push(`AC-12 D3 ${r.file} missing/invalid replacementCap`); }
  if (r.reason === 'D4' && (!r.closure || r.closure.trim() === '')) { dropProblems++; problems.push(`AC-12 D4 ${r.file} missing closure evidence`); }
}
check(dropProblems === 0, `AC-12/28 drop rows valid (problems=${dropProblems})`);

// ---------- AC-27: keepChecks K=true → keep; no drop with K=true ----------
console.log('\n=== AC-27 keepChecks ===');
let keepCheckProblems = 0;
for (const row of dataRows) {
  const r = parseRow(row);
  const kParts = (r.keepChecks || '').split('/');
  const kTrue = kParts.filter((p) => p.trim() === 'true').length;
  if (kTrue > 0 && r.disposition === 'drop') { keepCheckProblems++; problems.push(`AC-27 drop with K=true: ${r.file} | ${r.title.slice(0, 60)}`); }
  if (kTrue > 0 && r.disposition === 'keep' && (!r.kEvidence || !/:/.test(r.kEvidence))) { keepCheckProblems++; problems.push(`AC-27 keep K=true missing evidence: ${r.file} | ${r.title.slice(0, 60)}`); }
}
check(keepCheckProblems === 0, `AC-27 keepChecks violations = 0 (got ${keepCheckProblems})`);

// ---------- AC-11: entryAssertions ----------
console.log('\n=== AC-11 entryAssertions ===');
let entryProblems = 0;
for (const d of domains) {
  if (!Array.isArray(d.entryAssertions) || d.entryAssertions.length === 0) { entryProblems++; problems.push(`AC-11 ${d.id} empty entryAssertions`); continue; }
  for (const ea of d.entryAssertions) {
    if (!ea.entrypoint || typeof ea.entrypoint !== 'string') { entryProblems++; problems.push(`AC-11 ${d.id} empty entrypoint`); }
    if (!Array.isArray(ea.caps) || ea.caps.length === 0) { entryProblems++; problems.push(`AC-11 ${d.id} empty caps`); }
    for (const c of (ea.caps || [])) {
      if (!treeCaps.has(c)) { entryProblems++; problems.push(`AC-11 ${d.id} cap ${c} not in tree`); }
      const expected = d.id.toUpperCase().replace(/[^A-Z0-9]+/g, '-');
      if (!c.startsWith(`CAP-${expected}-`)) { entryProblems++; problems.push(`AC-11 ${d.id} cap ${c} domain != ${expected}`); }
    }
  }
}
check(entryProblems === 0, `AC-11 entryAssertions valid (problems=${entryProblems})`);

// ---------- AC-29: weakened not in entryAssertions ----------
console.log('\n=== AC-29 weakened ===');
let weakenedCount = 0;
const weakenedCaps = new Set();
for (const row of dataRows) {
  const r = parseRow(row);
  if (r.weakened === 'true') { weakenedCount++; if (r.newCap) for (const c of r.newCap.split(/\s+/)) weakenedCaps.add(c); }
}
const entryCaps = new Set();
for (const d of domains) for (const ea of d.entryAssertions) for (const c of ea.caps) entryCaps.add(c);
const weakenedInEntry = [...weakenedCaps].filter((c) => entryCaps.has(c));
check(weakenedInEntry.length === 0, `AC-29 weakened caps NOT in entryAssertions (bad=${JSON.stringify(weakenedInEntry)}, weakenedRows=${weakenedCount})`);

// ---------- summary ----------
console.log('\n=== SUMMARY ===');
console.log(`spec files: ${specFiles.length}`);
console.log(`tree CAPs: ${treeCaps.size}`);
console.log(`data rows: ${dataRows.length} (keep=${keepCount} drop=${dropCount})`);
console.log(`problems: ${problems.length}`);
if (problems.length) { console.log('\n--- problems ---'); for (const p of problems) console.log(' - ' + p); }
console.log(`\nFINAL: ${pass ? 'PASS' : 'FAIL'}`);
process.exit(pass ? 0 : 1);
