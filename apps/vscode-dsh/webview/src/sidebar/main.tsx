/**
 * History sidebar entry: mounts SidebarApp and binds the sidebar frame sink
 * (feature: sidebar-history).
 */

import { createRoot } from 'react-dom/client'
import { createMessageBridge } from '../bridge/message-bridge.ts'
import { SidebarApp } from './SidebarApp.tsx'
import { applySidebarFrame } from './sidebar-store.ts'
import type { SidebarIntent } from './sidebar-protocol.ts'
import '../styles/tokens.css'
import '../styles/sidebar.css'

const bridge = createMessageBridge<SidebarIntent>({ frameSink: applySidebarFrame })
const rootEl = document.getElementById('root')
if (rootEl) {
  createRoot(rootEl).render(<SidebarApp bridge={bridge} />)
}
