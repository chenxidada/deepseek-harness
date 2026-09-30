/**
 * Browser session identity of the calling conversation. One conversation maps
 * to one browser session, so follow-up tool calls reach the same page; the key
 * is opaque to the seam, which only uses it for reuse and teardown.
 * @module @deepseek-ai/dsh-tool-browser/key
 */

import { brandString } from '@deepseek-ai/dsh-brand'
import type { BrowserSessionKey } from '@deepseek-ai/dsh-browser'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'

/**
 * Derive the browser session key of the calling conversation.
 * @param exec - the tool execution carrying its owning agent.
 * @returns the session key for the owning conversation.
 */
export function sessionKeyOf(exec: ToolRunContext): BrowserSessionKey {
  const agent = exec.agent
  if (agent === undefined) {
    // A browser session belongs to a conversation; without an owning agent the
    // call has nowhere to store it, and inventing a key would leak a browser.
    throw new Error('browser tools require an owning agent session')
  }
  return brandString<BrowserSessionKey>(String(agent.session.id))
}
