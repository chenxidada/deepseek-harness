// AC-15 双向差集校验脚本：tsconfig.json `include` glob 匹配集合 vs tests 目录实际 .ts/.tsx 清单
// 独立验证：不采信 implementer 自报，直接读 tsconfig + 遍历文件系统。
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../../../../..'); // test-scripts -> ... -> deepseek-harness（6 层 up）
const testsDir = join(repoRoot, 'apps/vscode-dsh/tests');
const tsconfigPath = join(testsDir, 'tsconfig.json');

const raw = readFileSync(tsconfigPath, 'utf8');
// tsconfig.json 带注释（JSONC），用宽松解析：抽取 include 数组字面量
const m = raw.match(/"include"\s*:\s*\[([\s\S]*?)\]/);
if (!m) { console.error('FAIL: 未找到 include 数组'); process.exit(1); }
const includeGlobs = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
console.log('include globs:', JSON.stringify(includeGlobs));

// 确认 include 无逐文件白名单（不得含具体文件名）
const fileLikeGlob = includeGlobs.some((g) => !g.includes('*'));
if (fileLikeGlob) {
  console.error('FAIL: include 含非 glob 的具体文件名（逐文件白名单）');
  process.exit(1);
}

// 遍历 tests 目录，收集所有 .ts / .tsx 文件（含子目录，排除 node_modules）
function walk(dir, out) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === '.git') continue;
      walk(p, out);
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      out.push(p);
    }
  }
}
const actualFiles = [];
walk(testsDir, actualFiles);
const actualRel = actualFiles.map((p) => relative(testsDir, p).replace(/\\/g, '/')).sort();

// 简单 glob 匹配：**/*.ts / **/*.tsx 语义 = 递归匹配所有对应后缀文件
function matchGlob(glob, relPath) {
  const suffix = glob.slice(glob.lastIndexOf('*') + 1); // '.ts' / '.tsx'
  return relPath.endsWith(suffix);
}
const matchedRel = [];
for (const f of actualRel) {
  for (const g of includeGlobs) {
    if (matchGlob(g, f)) { matchedRel.push(f); break; }
  }
}
matchedRel.sort();

const actualSet = new Set(actualRel);
const matchedSet = new Set(matchedRel);
const onlyActual = actualRel.filter((f) => !matchedSet.has(f)); // 实际有但 glob 没覆盖
const onlyGlob = matchedRel.filter((f) => !actualSet.has(f));     // glob 覆盖但实际不存在

console.log(`实际 .ts/.tsx 文件数: ${actualRel.length}`);
console.log(`glob 匹配文件数: ${matchedRel.length}`);
console.log('仅在实际清单(glob 未覆盖):', JSON.stringify(onlyActual, null, 2));
console.log('仅在 glob 集合(实际不存在):', JSON.stringify(onlyGlob, null, 2));

const ok = onlyActual.length === 0 && onlyGlob.length === 0 && actualRel.length === matchedRel.length;
if (ok) {
  console.log('PASS: 双向差集为空，glob 覆盖全目录');
  process.exit(0);
} else {
  console.error('FAIL: 双向差集非空');
  process.exit(1);
}
