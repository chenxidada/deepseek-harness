'use strict';
// Phase 1 verifier independent script: AC-2 bidirectional diff + counts + JSON schema validation.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../../../../../..'); // repo root
const TESTS = path.join(ROOT, 'apps/vscode-dsh/tests');

function run(cmd) {
  return execSync(cmd, { encoding: 'utf8', cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
}

// 1. find file set (relative to tests/)
const findOut = run(`find apps/vscode-dsh/tests -type f \\( -name '*.spec.ts' -o -name '*.spec.tsx' \\) | sort`);
const findFiles = findOut.trim().split('\n').filter(Boolean);
// normalize to relative-to-tests path
const findRel = new Set(findFiles.map((f) => f.replace(/^apps\/vscode-dsh\/tests\//, '')));
console.log('=== 1. FILE SET ===');
console.log('find total:', findFiles.length);
console.log('.spec.ts:', findFiles.filter((f) => f.endsWith('.spec.ts')).length);
console.log('.spec.tsx:', findFiles.filter((f) => f.endsWith('.spec.tsx')).length);

// 2. parse capability-domains.json
const json = JSON.parse(fs.readFileSync(path.join(TESTS, 'capability-domains.json'), 'utf8'));
const domains = json.domains;
console.log('\n=== 2. DOMAINS ===');
console.log('domain count:', domains.length);
console.log('domain ids:', domains.map((d) => d.id).join(', '));

const absorbedUnion = [];
const absorbedSet = new Set();
for (const d of domains) {
  for (const a of d.absorbed) {
    absorbedUnion.push(a);
    if (absorbedSet.has(a)) {
      console.log('DUPLICATE absorbed:', a);
    }
    absorbedSet.add(a);
  }
}
console.log('absorbed union count:', absorbedSet.size);

// bidirectional diff
const inFindNotAbsorbed = [...findRel].filter((f) => !absorbedSet.has(f)).sort();
const inAbsorbedNotFind = [...absorbedSet].filter((f) => !findRel.has(f)).sort();
console.log('\n=== 3. BIDIRECTIONAL DIFF ===');
console.log('missing (in find, not absorbed):', JSON.stringify(inFindNotAbsorbed));
console.log('extra (in absorbed, not find):', JSON.stringify(inAbsorbedNotFind));

// 3. it/test declaration counts per file
console.log('\n=== 4. DECLARATION COUNTS ===');
const declRe = /(?:^|\s)(?:it|test)(?:\.[a-zA-Z]+)*\s*\(\s*(['"`])/g;
// Also count it.each / test.each explicitly (they may not match above if using template; but .each(...)(...))
let totalRegular = 0;
let totalEach = 0;
const perFile = {};
for (const rel of [...findRel].sort()) {
  const abs = path.join(TESTS, rel);
  const src = fs.readFileSync(abs, 'utf8');
  const lines = src.split('\n');
  let regular = 0;
  let each = 0;
  for (const line of lines) {
    // it.each / test.each (static declaration, one row)
    if (/^\s*(?:it|test)\.each\s*\(/.test(line) || /^\s*(?:it|test)\.each\s*\(\[/.test(line)) {
      each++;
      continue;
    }
    // it('...' or it.skip('...' etc. — the opening paren with string literal on same line
    if (/^\s*(?:it|test)(?:\.[a-zA-Z]+)*\s*\(\s*(['"`])/.test(line)) {
      regular++;
    }
  }
  perFile[rel] = { regular, each };
  totalRegular += regular;
  totalEach += each;
}
console.log('total regular it/test declarations:', totalRegular);
console.log('total it.each/test.each declarations:', totalEach);
console.log('total static declarations:', totalRegular + totalEach);
console.log('files with nonzero it.each:', JSON.stringify(Object.entries(perFile).filter(([, v]) => v.each > 0)));

// 4. assertion-map.md data row count + header schema
console.log('\n=== 5. ASSERTION-MAP ===');
const am = fs.readFileSync(path.join(TESTS, 'assertion-map.md'), 'utf8');
const amLines = am.split('\n');
const headerLine = amLines.find((l) => l.startsWith('| 原文件'));
const sepLine = amLines[amLines.indexOf(headerLine) + 1];
console.log('header columns (pipe-split count):', headerLine.split('|').filter((s) => s.trim() !== '').length);
console.log('header raw:', headerLine);
const hasSuyu = headerLine.includes('所属域');
console.log('contains "所属域" column:', hasSuyu);
const dataRows = amLines.slice(amLines.indexOf(sepLine) + 1).filter((l) => l.startsWith('|') && l.trim() !== '');
console.log('assertion-map data rows:', dataRows.length);

// check data row column counts (detect truncation)
const colCounts = {};
for (const row of dataRows) {
  const n = row.split('|').filter((s) => s.trim() !== '').length;
  colCounts[n] = (colCounts[n] || 0) + 1;
}
console.log('data row column-count distribution:', JSON.stringify(colCounts));

// 5. groupMapping vs layer-v-capabilities.json groups
console.log('\n=== 6. GROUPMAPPING ===');
const capsJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/vscode-dsh/test-scripts/layer-v-capabilities.json'), 'utf8'));
const manifestGroups = new Set();
function collectGroups(node) {
  if (Array.isArray(node)) {
    for (const item of node) {
      if (item && typeof item === 'object') collectGroups(item);
    }
  } else if (node && typeof node === 'object') {
    if (node.group) manifestGroups.add(node.group);
    for (const k of Object.keys(node)) collectGroups(node[k]);
  }
}
collectGroups(capsJson);
console.log('manifest groups:', [...manifestGroups].sort().join(', '));
const gmKeys = Object.keys(json.groupMapping);
console.log('groupMapping keys:', gmKeys.sort().join(', '));
console.log('manifest groups NOT in groupMapping:', [...manifestGroups].filter((g) => !gmKeys.includes(g)));
const domainIds = new Set(domains.map((d) => d.id));
const gmValuesInvalid = Object.entries(json.groupMapping).filter(([, v]) => !domainIds.has(v));
console.log('groupMapping values not a domain id:', JSON.stringify(gmValuesInvalid));
console.log('groupMapping value count:', gmKeys.length);

// 6. schema: required fields per domain
console.log('\n=== 7. DOMAIN SCHEMA ===');
for (const d of domains) {
  const missing = [];
  if (!d.id) missing.push('id');
  if (!d.spec) missing.push('spec');
  if (!Array.isArray(d.scripts)) missing.push('scripts');
  if (!Array.isArray(d.absorbed)) missing.push('absorbed');
  if (!Array.isArray(d.entryAssertions)) missing.push('entryAssertions');
  if (!('verifierSources' in d)) missing.push('verifierSources');
  const specOk = d.spec && new RegExp(`^cap-${d.id}\\.spec\\.(ts|tsx)$`).test(d.spec);
  if (!specOk) console.log(`  ${d.id}: spec mismatch -> "${d.spec}"`);
  if (missing.length) console.log(`  ${d.id}: MISSING fields: ${missing.join(', ')}`);
}
console.log('schema check done.');

console.log('\n=== SUMMARY ===');
console.log('bidirectional diff empty:', inFindNotAbsorbed.length === 0 && inAbsorbedNotFind.length === 0);
