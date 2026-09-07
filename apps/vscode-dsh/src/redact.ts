/**
 * Redact credential-shaped values before any Extension log or error UI copy.
 * @module @deepseek-ai/dsh-vscode-dsh/redact
 */

import { SENSITIVE_ENV_PATTERN } from '@deepseek-ai/dsh-subprocess'

/**
 * Whether an env key is treated as credential-shaped for Extension diagnostics.
 * @param key - environment variable name.
 * @returns true when the key matches the shared sensitive pattern or `DSH_*`.
 */
function isCredentialShapedKey(key: string): boolean {
  return SENSITIVE_ENV_PATTERN.test(key) || key.toUpperCase().startsWith('DSH_')
}

/**
 * Replace one bag's credential-shaped values that appear in `result`.
 * @param result - text being scrubbed.
 * @param bag - env-like map of candidate secret values.
 * @returns text with matching values replaced by `[redacted:<key>]`.
 */
function redactBag(result: string, bag: NodeJS.ProcessEnv): string {
  let next = result
  for (const key of Object.keys(bag)) {
    if (!isCredentialShapedKey(key)) continue
    const value = bag[key]
    if (value === undefined || value.length < 4) continue
    if (next.includes(value)) {
      next = next.split(value).join(`[redacted:${key}]`)
    }
  }
  return next
}

/**
 * Strip credential-like substrings and `DSH_*` assignment fragments from text
 * destined for Extension logs or status messages (AC-32).
 *
 * Scans Extension `process.env` and an optional credentials bag so secrets
 * injected only via session-host credentials (and absent from parent env) are
 * still removed before any log or `showErrorMessage`.
 * @param text - raw diagnostic text that may embed env or credentials values.
 * @param credentials - optional bag merged into the child env (never logged).
 * @returns a copy safe for user-visible diagnostics.
 */
export function redactSecrets(
  text: string,
  credentials?: NodeJS.ProcessEnv,
): string {
  let result = redactBag(text, process.env)
  if (credentials !== undefined) {
    result = redactBag(result, credentials)
  }
  return result
}
