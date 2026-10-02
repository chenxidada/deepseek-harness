import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import { createMessageBridge } from './bridge/message-bridge.ts'
import { mountDshProbes } from './probes.ts'
// KaTeX emits every formula twice: the visual `.katex-html` tree and a
// `.katex-mathml` copy for assistive technology. Only KaTeX's own stylesheet
// hides the MathML copy and lays out the visual tree (`.vlist`, `.mspace`, the
// radical's `svg.hide-tail`), so omitting it renders each formula twice — the
// MathML copy at native size, with bare radicals and overlines.
import 'katex/dist/katex.min.css'
import './styles/tokens.css'
import './styles/v2-enhancements.css'

mountDshProbes()

const bridge = createMessageBridge()
const rootEl = document.getElementById('root')
if (rootEl) {
  createRoot(rootEl).render(<App bridge={bridge} />)
}
