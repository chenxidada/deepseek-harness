import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import { createMessageBridge } from './bridge/message-bridge.ts'
import { mountDshProbes } from './probes.ts'
import './styles/tokens.css'

mountDshProbes()

const bridge = createMessageBridge()
const rootEl = document.getElementById('root')
if (rootEl) {
  createRoot(rootEl).render(<App bridge={bridge} />)
}
