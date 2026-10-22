import { describe, expect, it } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ToolExecution, ToolExecutionToken } from '@deepseek-ai/dsh-tools'
import { shellPolicy } from '../src/shell-policy.ts'

/** One admitted tool call shaped for the pure shell policy. */
function execution(name: string, args: unknown): ToolExecution {
  const id = ToolCallId(`shell-${name}`)
  return {
    callId: id,
    rootCallId: id,
    name,
    arguments: args,
    signal: new AbortController().signal,
    token: Symbol('execution') as ToolExecutionToken,
  }
}

describe('SpecDev shell policy rules', () => {
  it('asks for git commit and push, including common option prefixes', () => {
    expect(shellPolicy(execution('bash', { command: 'git commit -m test' }))).toMatchObject({ kind: 'ask' })
    expect(shellPolicy(execution('bash', { command: 'git push origin HEAD' }))).toMatchObject({ kind: 'ask' })
    expect(shellPolicy(execution('bash', { command: 'git -C repo commit -m test' }))).toMatchObject({ kind: 'ask' })
    expect(shellPolicy(execution('bash', { command: 'git -c user.name=x push' }))).toMatchObject({ kind: 'ask' })
  })

  it('denies git stash', () => {
    expect(shellPolicy(execution('bash', { command: 'git stash' }))).toMatchObject({
      kind: 'deny',
      reason: expect.stringContaining('git stash'),
    })
    expect(shellPolicy(execution('bash', { command: 'git -C repo stash drop' }))).toMatchObject({ kind: 'deny' })
  })

  it('denies destructive root removals and fork bombs', () => {
    expect(shellPolicy(execution('bash', { command: 'rm -rf /' }))).toMatchObject({ kind: 'deny' })
    expect(shellPolicy(execution('bash', { command: 'sudo rm -fr /' }))).toMatchObject({ kind: 'deny' })
    expect(shellPolicy(execution('bash', { command: ':(){ :|:& };:' }))).toMatchObject({ kind: 'deny' })
  })

  it('leaves benign commands and other tools to the rest of the pipeline', () => {
    expect(shellPolicy(execution('bash', { command: 'git status' }))).toBeUndefined()
    expect(shellPolicy(execution('bash', { command: 'rm -rf ./build' }))).toBeUndefined()
    expect(shellPolicy(execution('write', { command: 'git commit -m test' }))).toBeUndefined()
  })

  it('ignores malformed argument bags', () => {
    expect(shellPolicy(execution('bash', {}))).toBeUndefined()
    expect(shellPolicy(execution('bash', null))).toBeUndefined()
    expect(shellPolicy(execution('bash', []))).toBeUndefined()
    expect(shellPolicy(execution('bash', { command: 42 }))).toBeUndefined()
    expect(shellPolicy(execution('bash', { command: '   ' }))).toBeUndefined()
  })
})
