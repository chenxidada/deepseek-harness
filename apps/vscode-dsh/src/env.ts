/**
 * Environment construction for the ide profile child: scrub, then re-inject
 * required `DSH_*` and credential keys the Extension owns.
 * @module @deepseek-ai/dsh-vscode-dsh/env
 */

import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import { IDE_BRIDGE_SOCK_ENV } from '@deepseek-ai/dsh-ide-bridge'

/** Options for building the complete child environment. */
export interface IdeChildEnvOptions {
  /** Absolute Host bridge socket path. */
  bridgeSock: string
  /** Optional Harness home for the child. */
  dshHome?: string
  /**
   * Explicit credential and non-DSH overrides merged after scrub.
   * Callers must not put secrets into log sinks.
   */
  credentials?: NodeJS.ProcessEnv
}

/**
 * Build the complete child `env` for {@link HarnessClient}: scrubbed parent
 * plus required `DSH_IDE_BRIDGE_SOCK` (and optional `DSH_HOME`) because
 * {@link scrubbedParentEnv} strips every `DSH_*` name.
 * @param options - bridge path and optional home/credentials.
 * @returns a complete process environment object.
 */
export function buildIdeChildEnv(options: IdeChildEnvOptions): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...scrubbedParentEnv(),
    ...options.credentials,
    [IDE_BRIDGE_SOCK_ENV]: options.bridgeSock,
  }
  if (options.dshHome !== undefined) {
    env.DSH_HOME = options.dshHome
  }
  return env
}
