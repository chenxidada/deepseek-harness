/**
 * Resolution probe: proves which plane (source vs built lib) this harness loads,
 * so every evidence row in verification.md names the artifact actually exercised.
 */
const client = await import('@deepseek-ai/dsh-sdk-client')
const guard = await import('/workspace/chendecheng/code/need/deepseek/deepseek-harness/apps/vscode-dsh/src/node-env-guard.ts')

console.log('sdk-client module url  :', import.meta.resolve('@deepseek-ai/dsh-sdk-client'))
console.log('sdk-client exports    :', ['resolveNodeExecutableSpec', 'resolveDshLaunch'].filter(k => k in client).join(','))
console.log('guard module url      :', guard.EXPECTED_NODE_RANGE)
