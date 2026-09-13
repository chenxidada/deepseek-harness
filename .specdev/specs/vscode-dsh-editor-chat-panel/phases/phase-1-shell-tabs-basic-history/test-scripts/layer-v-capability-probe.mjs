#!/usr/bin/env node
/**
 * Layer V capability probe — documents whether a real VS Code host is available
 * and performs static/build proxies for §9 Phase 1 checklist items that can be
 * checked without a GUI. Does NOT claim human visual PASS (AC-40/42).
 */
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '../../../../../../')
const webview = join(repoRoot, 'apps/vscode-dsh/webview')
const outDir = join(here, '../screenshots')
mkdirSync(outDir, { recursive: true })

const results = []
function check(id, ok, detail) {
  results.push({ id, ok: !!ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}: ${detail}`)
}

const hasCode = spawnSync('which', ['code'], { encoding: 'utf8' }).status === 0
const hasCursor = spawnSync('which', ['cursor'], { encoding: 'utf8' }).status === 0
const hasDisplay = !!(process.env.DISPLAY || process.env.WAYLAND_DISPLAY)
check('V-env-vscode-cli', hasCode || hasCursor, hasCode || hasCursor
  ? 'VS Code/Cursor CLI present'
  : 'no `code`/`cursor` CLI — real host Layer V unavailable')
check('V-env-display', hasDisplay, hasDisplay ? `display=${process.env.DISPLAY || process.env.WAYLAND_DISPLAY}` : 'no DISPLAY/WAYLAND — headless; cannot open VS Code GUI')

const tokens = readFileSync(join(webview, 'src/styles/tokens.css'), 'utf8')
const chrome = tokens.match(/--dsh-chrome-height:\s*(\d+)px/)
check('V-static-chrome-height', chrome && Number(chrome[1]) <= 40, chrome ? `--dsh-chrome-height=${chrome[1]}px` : 'missing chrome height')
check('V-static-theme-tokens', /--vscode-foreground/.test(tokens) && /--vscode-editor-background/.test(tokens), 'theme-first --vscode-* bindings')
check('V-static-hover-focus', /focus-visible/.test(tokens) && /:hover/.test(tokens), 'UI-AC-50 basic hover/focus rules present')
check('V-static-no-cdn-fonts', !/fonts\.googleapis|cdn\.jsdelivr|@import\s+url\(\s*['"]?https?:/.test(tokens), 'no external font/CDN in tokens.css')

const distAssets = join(webview, 'dist/assets')
const distOk = existsSync(distAssets) && readdirSync(distAssets).some(n => n.endsWith('.js'))
check('V-build-spa-dist', distOk, distOk ? `dist assets: ${readdirSync(distAssets).join(', ')}` : 'webview/dist missing — run webview:build')

if (distOk) {
  const cssName = readdirSync(distAssets).find(n => n.endsWith('.css'))
  const jsName = readdirSync(distAssets).find(n => n.endsWith('.js'))
  if (cssName) {
    const css = readFileSync(join(distAssets, cssName), 'utf8')
    check('V-build-css-no-cdn', !/fonts\.googleapis|cdn\./.test(css), `${cssName} has no CDN refs`)
  }
  if (jsName) {
    const js = readFileSync(join(distAssets, jsName), 'utf8')
    check('V-build-dom-contract-strings',
      ['editor-chat-root', 'tab-chrome', 'btn-history', 'history-panel', 'composer', 'messages-empty', 'status']
        .every(s => js.includes(s)),
      'SPA bundle embeds Phase 1 DOM testids')
  }
}

const section9 = [
  'Panel 打开后可见顶栏 Tab chrome（非 TreeView）；chrome ≤40px',
  '活动 Tab 可区分；新建/历史/搜索入口可见；溢出不挤爆消息区',
  '消息区空态/loading（UI-AC-24）',
  '历史入口 → 面板内列表或 loading/空态（非空窗、非仅 QuickPick）',
  'Composer sticky 底栏；主题 light/dark 可读',
  'P1 已交付控件基础 hover/focus（UI-AC-50）',
]

const realHost = hasCode || hasCursor
const checklist = {
  generatedAt: new Date().toISOString(),
  realHostAvailable: realHost,
  displayAvailable: hasDisplay,
  section9Phase1: section9.map(item => ({
    item,
    status: realHost && hasDisplay ? 'REQUIRES_MANUAL_HOST' : 'BLOCKED_NO_HOST',
    notes: realHost && hasDisplay
      ? 'Run Extension Development Host; verify visually; dual theme light/dark'
      : 'Cannot execute human Layer V in this environment',
  })),
  exemptionsNotChecked: [
    '完整四态人眼可分（UI-AC-30）→ P2',
    'Stop 完整（UI-AC-32 / AC-33b）→ P2',
    'MD settle 精修（UI-AC-20/23）→ P2',
  ],
  staticProxies: results,
  verdictHint: realHost && hasDisplay ? 'RUN_MANUAL_LAYER_V' : 'LAYER_V_GAP → Phase verdict must be PARTIAL (AC-40/42)',
}

const reportPath = join(outDir, 'layer-v-capability-report.json')
writeFileSync(reportPath, JSON.stringify(checklist, null, 2))
console.log(`\nWrote ${reportPath}`)

const staticFails = results.filter(r => !r.ok && (r.id.startsWith('V-static') || r.id.startsWith('V-build')))
const envBlocked = !realHost || !hasDisplay
if (staticFails.length) {
  console.error(`Static/build proxy failures: ${staticFails.length}`)
  process.exit(1)
}
if (envBlocked) {
  console.log('\nLAYER_V_STATUS=BLOCKED_NO_HOST (expected PARTIAL at Phase gate)')
  process.exit(0) // probe succeeded; gap is environmental
}
console.log('\nLAYER_V_STATUS=HOST_AVAILABLE_NEEDS_MANUAL')
process.exit(0)
