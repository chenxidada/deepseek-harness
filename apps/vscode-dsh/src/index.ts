/**
 * Public library entry for the VS Code ide session host.
 * @module @deepseek-ai/dsh-vscode-dsh
 */

export { IdeSessionHost, type IdeSessionHostStartOptions, type IdeSessionHostStatus } from './session-host.ts'
export { buildIdeChildEnv, type IdeChildEnvOptions } from './env.ts'
export { redactSecrets } from './redact.ts'
