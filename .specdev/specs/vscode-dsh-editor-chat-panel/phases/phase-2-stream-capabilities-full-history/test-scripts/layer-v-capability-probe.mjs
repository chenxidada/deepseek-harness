#!/usr/bin/env node
/**
 * Layer V capability probe — Phase 2 (vscode-dsh-editor-chat-panel).
 * Documents whether a real VS Code host is available and runs static/build
 * proxies for ui-visual-spec §9 Phase 2 checklist. Does NOT claim human visual PASS (AC-40/42).
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
check('V-env-display', hasDisplay, hasDisplay
  ? `display=${process.env.DISPLAY || process.env.WAYLAND_DISPLAY}`
  : 'no DISPLAY/WAYLAND — headless; cannot open VS Code GUI')

const tokens = readFileSync(join(webview, 'src/styles/tokens.css'), 'utf8')
check('V-static-theme-tokens', /--vscode-foreground/.test(tokens) && /--vscode-editor-background/.test(tokens), 'theme-first --vscode-* bindings')
check('V-static-hover-focus', /focus-visible/.test(tokens) && /:hover/.test(tokens), 'UI-AC-50 hover/focus rules')
check('V-static-reduced-motion', /prefers-reduced-motion/.test(tokens), 'UI-AC-51 reduced-motion')
check('V-static-no-cdn-fonts', !/fonts\.googleapis|cdn\.jsdelivr|@import\s+url\(\s*['"]?https?:/.test(tokens), 'no external font/CDN in tokens.css')
check('V-static-no-neon-glass', !/glassmorphism|neon-glow|backdrop-filter:\s*blur\(2[0-9]/.test(tokens), 'no glass/neon showpiece path')

const panelTs = readFileSync(join(repoRoot, 'apps/vscode-dsh/src/chat-panel/editor-chat-panel.ts'), 'utf8')
check('V-static-spa-not-thin', /buildEditorChatSpaHtml/.test(panelTs) && !/buildThinChatHtml/.test(panelTs), 'production panel uses SPA builder only')

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
    const contracts = [
      'editor-chat-root',
      'data-composer-state',
      'data-follow-state',
      'btn-stop',
      'btn-edit-resend',
      'btn-branch',
      'btn-continue',
      'delete-confirm-modal',
      'activity-row',
      'ref-card',
      'change-list',
      'btn-copy',
      'history-parent',
      'msg-md',
    ]
    const missing = contracts.filter(s => !js.includes(s))
    check('V-build-dom-contract-strings', missing.length === 0,
      missing.length === 0 ? 'SPA bundle embeds Phase 2 DOM contracts' : `missing: ${missing.join(', ')}`)
  }
}

const section9 = [
  'user/assistant 层级 §5.2；MD settle 后代码块可读+复制可见',
  '活动/引用/变更视觉权重正确',
  'composer 四态人眼可分；禁用有原因位',
  '历史行含标题/时间/预览；Continue/删除可发现；父子可读',
  '能力入口可发现且非「演示按钮墙」',
  'focus/hover/reduced-motion 底线 UI-AC-50–52',
  '删除两处一致的 webview modal',
  'Stop / 停止中可见（无 thinking）',
  '双主题抽检 light/dark',
]

const realHost = hasCode || hasCursor
const checklist = {
  generatedAt: new Date().toISOString(),
  phase: 'phase-2-stream-capabilities-full-history',
  realHostAvailable: realHost,
  displayAvailable: hasDisplay,
  section9Phase2: section9.map(item => ({
    item,
    status: realHost && hasDisplay ? 'REQUIRES_MANUAL_HOST' : 'BLOCKED_NO_HOST',
    notes: realHost && hasDisplay
      ? 'Run Extension Development Host; verify visually; dual theme light/dark'
      : 'Cannot execute human Layer V in this environment (AC-42 → Phase must not PASS)',
  })),
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
  console.log('\nLAYER_V_STATUS=BLOCKED_NO_HOST (expected PARTIAL at Phase gate per AC-42)')
  process.exit(0)
}
console.log('\nLAYER_V_STATUS=HOST_AVAILABLE_NEEDS_MANUAL')
process.exit(0)
