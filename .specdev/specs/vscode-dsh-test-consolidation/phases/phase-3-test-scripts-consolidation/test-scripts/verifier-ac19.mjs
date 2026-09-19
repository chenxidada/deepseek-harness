// Independent AC-19 verification: four-class bidirectional diff + group→domain mapping validity.
// Usage: node verifier-ac19.mjs  (run from repo root, Node 24.3.0)
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const cd = JSON.parse(readFileSync(join(root, 'apps/vscode-dsh/tests/capability-domains.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(join(root, 'apps/vscode-dsh/test-scripts/layer-v-capabilities.json'), 'utf8'));

function walk(dir, base) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, base));
    else out.push(relative(base, p));
  }
  return out;
}

const tsRoot = join(root, 'apps/vscode-dsh/test-scripts');
const actual = walk(tsRoot, tsRoot).sort();
const listed = cd.testScripts.map((t) => t.path).sort();

const onlyActual = actual.filter((p) => !listed.includes(p));
const onlyListed = listed.filter((p) => !actual.includes(p));

const validCats = new Set(['entry-orchestration', 'shared-primitives', 'capability-manifest-data', 'support-resources']);
const badCats = cd.testScripts.filter((t) => !validCats.has(t.category)).map((t) => `${t.path}:${t.category}`);

const domainIds = new Set(cd.domains.map((d) => d.id));
const badDomains = cd.testScripts.filter((t) => !domainIds.has(t.domain)).map((t) => `${t.path}:${t.domain}`);

const gmKeys = Object.keys(cd.groupMapping);
const gmValues = Object.values(cd.groupMapping);
const badMapValues = gmValues.filter((v) => !domainIds.has(v));

function collectGroups(obj, acc) {
  if (Array.isArray(obj)) obj.forEach((o) => collectGroups(o, acc));
  else if (obj && typeof obj === 'object') {
    if (typeof obj.group === 'string') acc.add(obj.group);
    for (const k in obj) collectGroups(obj[k], acc);
  }
}
const mgroups = new Set();
collectGroups(manifest, mgroups);
const manifestGroups = [...mgroups].sort();
const missingKeys = manifestGroups.filter((g) => !(g in cd.groupMapping));

const checks = {
  'actual file count': actual.length,
  'testScripts listed count': cd.testScripts.length,
  'onlyActual (dir only)': JSON.stringify(onlyActual),
  'onlyListed (list only)': JSON.stringify(onlyListed),
  'bad categories': JSON.stringify(badCats),
  'bad domains': JSON.stringify(badDomains),
  'groupMapping keys count': gmKeys.length,
  'groupMapping values not in domains': JSON.stringify(badMapValues),
  'manifest group set': JSON.stringify(manifestGroups),
  'manifest groups missing from mapping': JSON.stringify(missingKeys),
};

let pass = true;
console.log('=== AC-19 independent checks ===');
for (const [k, v] of Object.entries(checks)) {
  console.log(`${k}: ${v}`);
}
if (actual.length !== listed.length || onlyActual.length || onlyListed.length) { console.log('FAIL: bidirectional diff not empty'); pass = false; }
if (badCats.length) { console.log('FAIL: bad categories'); pass = false; }
if (badDomains.length) { console.log('FAIL: bad domains'); pass = false; }
if (badMapValues.length) { console.log('FAIL: mapping value outside domain ids'); pass = false; }
if (missingKeys.length) { console.log('FAIL: manifest group missing from mapping'); pass = false; }
console.log(pass ? 'AC-19 VERDICT: PASS' : 'AC-19 VERDICT: FAIL');
process.exit(pass ? 0 : 1);
