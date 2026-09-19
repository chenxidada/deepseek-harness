// Independent verification scenario (AC-4): runtime require resolution + export surface.
// The implementer verified via static grep + smoke/capabilities exit codes; this script
// independently loads the shared module and the pure-Node runner to prove the require chain
// resolves and the export surface consumed by existing tests is intact.
// Usage: node verifier-ac4-runtime.cjs  (Node 24.3.0, repo root)
'use strict';
const path = require('node:path');

const TS = path.join(process.cwd(), 'apps/vscode-dsh/test-scripts');
const PRIMITIVES = [
  'OVERSIZED_CAPTURE_AREA', 'StageError', 'linkFailure', 'harnessError',
  'skipNoCredentials', 'sleep', 'nowIso', 'truncate', 'safeJson', 'unwrap',
  'poll', 'assistantText', 'pngVerdict', 'sha256Of', 'runCapture',
  'outputFreeTemplateViolation', 'probeScreenSize', 'resolveCaptureTool', 'captureScreenshot',
];

const prim = require(path.join(TS, 'layer-v-support/primitives.cjs'));
const missing = PRIMITIVES.filter((n) => typeof prim[n] === 'undefined');
console.log('primitives.cjs missing exports:', JSON.stringify(missing));
console.log('primitives.cjs export count:', Object.keys(prim).length);
console.log('captureScreenshot.length (arity):', prim.captureScreenshot.length);

const runner = require(path.join(TS, 'layer-v-capability-driver/capability-runner.cjs'));
const runnerNeeded = ['runManifest', 'pollForStream', 'CONCLUSION_PRECEDENCE', 'captureScreenshot', 'assistantText', 'linkFailure', 'overallConclusion', 'selectCapabilities', 'resolvePath', 'deepEqual', 'MATCHERS'];
const runnerMissing = runnerNeeded.filter((n) => typeof runner[n] === 'undefined');
console.log('capability-runner.cjs missing exports:', JSON.stringify(runnerMissing));

let pass = missing.length === 0 && runnerMissing.length === 0 && prim.captureScreenshot.length === 3;
console.log('AC-4 runtime VERDICT:', pass ? 'PASS' : 'FAIL');
process.exit(pass ? 0 : 1);
