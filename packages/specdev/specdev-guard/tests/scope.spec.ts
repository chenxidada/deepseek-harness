/**
 * SpecDev scope: path extraction, workspace containment, credential refusal,
 * and the allow / deny / ask verdict.
 */

import { describe, expect, it } from 'vitest'
import {
  classifyRoleWrites,
  classifyScope,
  commandScopePaths,
  credentialDenial,
  isInsideWorkspace,
  isRecursiveCommand,
  looksLikePath,
  pathsOfToolCall,
  roleWriteAllowed,
  roleWriteScopeDescription,
  type ScopeContext,
  type ScopeGrant,
} from '@deepseek-ai/dsh-specdev-guard'

const HOME = '/home/tester'
const WORKSPACE = '/work/project'

function context(grants: readonly ScopeGrant[] = []): ScopeContext {
  return { workspaceRoot: WORKSPACE, home: HOME, grants }
}

describe('looksLikePath', () => {
  it('accepts absolute, home, relative, and slash-bearing tokens', () => {
    expect(looksLikePath('/etc/hosts')).toBe(true)
    expect(looksLikePath('~/.ssh/id_rsa')).toBe(true)
    expect(looksLikePath('../other/file.txt')).toBe(true)
    expect(looksLikePath('./local')).toBe(true)
    expect(looksLikePath('src/index.ts')).toBe(true)
    expect(looksLikePath('C:\\Users\\me')).toBe(true)
  })

  it('rejects flags, URLs, and bare words', () => {
    expect(looksLikePath('-rf')).toBe(false)
    expect(looksLikePath('--recursive')).toBe(false)
    expect(looksLikePath('https://example.com/a')).toBe(false)
    expect(looksLikePath('file:///tmp/a')).toBe(false)
    expect(looksLikePath('name')).toBe(false)
    expect(looksLikePath('')).toBe(false)
  })
})

describe('isRecursiveCommand', () => {
  it('treats the traversal commands as recursive and reads their flags', () => {
    expect(isRecursiveCommand('find', [])).toBe(true)
    expect(isRecursiveCommand('tree', [])).toBe(true)
    expect(isRecursiveCommand('du', [])).toBe(true)
    expect(isRecursiveCommand('rg', [])).toBe(true)
    expect(isRecursiveCommand('grep', ['-r'])).toBe(true)
    expect(isRecursiveCommand('grep', ['-rn'])).toBe(true)
    expect(isRecursiveCommand('grep', ['--recursive'])).toBe(true)
    expect(isRecursiveCommand('grep', ['-n'])).toBe(false)
    expect(isRecursiveCommand('ls', ['-R'])).toBe(true)
    expect(isRecursiveCommand('ls', ['-lR'])).toBe(true)
    expect(isRecursiveCommand('ls', ['-l'])).toBe(false)
    expect(isRecursiveCommand('cat', ['-r'])).toBe(false)
  })
})

describe('commandScopePaths', () => {
  it('reads a whole-disk traversal as a recursive path', () => {
    expect(commandScopePaths('find / -name "*.log"')).toEqual([
      { path: '/', source: 'command', recursive: true },
    ])
  })

  it('reads absolute arguments of ordinary commands and pipes', () => {
    expect(commandScopePaths('cat /etc/passwd | head -n 5')).toEqual([
      { path: '/etc/passwd', source: 'command', recursive: false },
    ])
  })

  it('resolves and flags relative escapes under a recursive command', () => {
    expect(commandScopePaths('grep -rn TODO ../sibling')).toEqual([
      { path: '../sibling', source: 'command', recursive: true },
    ])
  })

  it('keeps a non-recursive command non-recursive', () => {
    expect(commandScopePaths('grep TODO ../sibling')).toEqual([
      { path: '../sibling', source: 'command', recursive: false },
    ])
  })

  it('reads a directory option value', () => {
    expect(commandScopePaths('git -C /other/repo status')).toEqual([
      { path: '/other/repo', source: 'command', recursive: false },
    ])
    expect(commandScopePaths('git --directory=/other/repo status')).toEqual([
      { path: '/other/repo', source: 'command', recursive: false },
    ])
  })

  it('ignores an option whose value is missing or is another flag', () => {
    expect(commandScopePaths('git -C')).toEqual([])
    expect(commandScopePaths('git -C --no-pager status')).toEqual([])
  })

  it('reads a path after a redirection and a `cd` target', () => {
    expect(commandScopePaths('echo hi > /tmp/out.txt')).toEqual([
      { path: '/tmp/out.txt', source: 'command', recursive: false },
    ])
    expect(commandScopePaths('cd /tmp && ls')).toEqual([
      { path: '/tmp', source: 'command', recursive: false },
    ])
  })

  it('keeps one entry per path and skips URLs', () => {
    expect(commandScopePaths('curl https://example.com/a /tmp/a /tmp/a')).toEqual([
      { path: '/tmp/a', source: 'command', recursive: false },
    ])
  })

  it('returns nothing for an empty command', () => {
    expect(commandScopePaths('')).toEqual([])
    expect(commandScopePaths('   ')).toEqual([])
  })
})

describe('isInsideWorkspace', () => {
  it('accepts the root itself and its descendants', () => {
    expect(isInsideWorkspace(WORKSPACE, WORKSPACE)).toBe(true)
    expect(isInsideWorkspace(WORKSPACE, `${WORKSPACE}/src/a.ts`)).toBe(true)
  })

  it('rejects a sibling with a shared prefix and a parent', () => {
    expect(isInsideWorkspace(WORKSPACE, `${WORKSPACE}-other/a.ts`)).toBe(false)
    expect(isInsideWorkspace(WORKSPACE, '/work')).toBe(false)
    expect(isInsideWorkspace(WORKSPACE, '/other/project')).toBe(false)
  })
})

describe('credentialDenial', () => {
  it('refuses the credential directories under home', () => {
    expect(credentialDenial(`${HOME}/.ssh/id_rsa`, HOME)).toContain('~/.ssh')
    expect(credentialDenial(`${HOME}/.aws/credentials`, HOME)).toContain('~/.aws')
    expect(credentialDenial(`${HOME}/.config/gh/hosts.yml`, HOME)).toContain('~/.config/gh')
  })

  it('refuses .env files by name, everywhere', () => {
    expect(credentialDenial(`${WORKSPACE}/.env`, HOME)).toContain('.env credential file')
    expect(credentialDenial(`${WORKSPACE}/nested/.env.local`, HOME)).toContain('.env credential file')
  })

  it('leaves ordinary paths alone', () => {
    expect(credentialDenial(`${HOME}/.sshrc`, HOME)).toBeUndefined()
    expect(credentialDenial(`${HOME}/.config/nvim/init.lua`, HOME)).toBeUndefined()
    expect(credentialDenial(`${WORKSPACE}/environment.ts`, HOME)).toBeUndefined()
  })
})

describe('pathsOfToolCall', () => {
  const sources = { workspaceRoot: WORKSPACE, workdir: WORKSPACE, home: HOME }

  it('resolves a file_path argument against the call workdir', () => {
    expect(pathsOfToolCall('read', { file_path: 'src/a.ts' }, sources))
      .toEqual({
        reads: [{ path: `${WORKSPACE}/src/a.ts`, source: 'argument', recursive: false }],
        writes: [],
        recursive: false,
      })
  })

  it('classifies mutating tools as writes', () => {
    expect(pathsOfToolCall('write', { file_path: '/tmp/a' }, sources))
      .toEqual({
        reads: [],
        writes: [{ path: '/tmp/a', source: 'argument', recursive: false }],
        recursive: false,
      })
    expect(pathsOfToolCall('edit', { file_path: '/tmp/a' }, sources).writes).toHaveLength(1)
    expect(pathsOfToolCall('str_replace_editor', { path: '/tmp/a' }, sources).writes).toHaveLength(1)
  })

  it('reads the path argument of the search and language tools', () => {
    expect(pathsOfToolCall('glob', { pattern: '**/*.ts', path: '/other' }, sources).reads)
      .toEqual([{ path: '/other', source: 'argument', recursive: false }])
    expect(pathsOfToolCall('grep', { pattern: 'x' }, sources).reads).toEqual([])
    expect(pathsOfToolCall('lsp', { file_path: '/tmp/a' }, sources).reads).toHaveLength(1)
    expect(pathsOfToolCall('read_image', { file_path: '/tmp/a' }, sources).reads).toHaveLength(1)
  })

  it('expands a leading tilde', () => {
    expect(pathsOfToolCall('read', { file_path: '~/.bashrc' }, sources).reads)
      .toEqual([{ path: `${HOME}/.bashrc`, source: 'argument', recursive: false }])
    expect(pathsOfToolCall('read', { file_path: '~' }, sources).reads)
      .toEqual([{ path: HOME, source: 'argument', recursive: false }])
  })

  it('reads the paths a shell command names', () => {
    expect(pathsOfToolCall('bash', { command: 'cat /tmp/x' }, sources).reads)
      .toEqual([{ path: '/tmp/x', source: 'command', recursive: false }])
    expect(pathsOfToolCall('bash', { command: 'cat ../../other/x' }, sources).reads)
      .toEqual([{ path: '/other/x', source: 'command', recursive: false }])
  })

  it('treats a command running outside the workspace as naming its own directory', () => {
    expect(pathsOfToolCall('bash', { command: 'cat rel.txt', workdir: '/other' }, sources).reads)
      .toEqual([{ path: '/other', source: 'command', recursive: false }])
    expect(pathsOfToolCall('pwsh', { command: 'cat rel.txt', cwd: '../other' }, sources).reads)
      .toEqual([{ path: '/work/other', source: 'command', recursive: false }])
    expect(pathsOfToolCall('bash', { command: 'cat rel.txt', workdir: 'sub' }, sources).reads)
      .toEqual([])
  })

  it('treats a session cwd outside the workspace as naming that directory', () => {
    expect(pathsOfToolCall('bash', { command: 'cat rel.txt' }, { ...sources, workdir: '/elsewhere' }).reads)
      .toEqual([{ path: '/elsewhere', source: 'command', recursive: false }])
  })

  it('marks a shell call that traverses', () => {
    const parsed = pathsOfToolCall('bash', { command: 'find / -maxdepth 2' }, sources)
    expect(parsed.recursive).toBe(true)
    expect(parsed.reads).toEqual([{ path: '/', source: 'command', recursive: true }])
  })

  it('returns nothing for a shell call without a command or an unknown tool', () => {
    expect(pathsOfToolCall('bash', { description: 'x' }, sources))
      .toEqual({ reads: [], writes: [], recursive: false })
    expect(pathsOfToolCall('todo_write', { todos: [] }, sources))
      .toEqual({ reads: [], writes: [], recursive: false })
    expect(pathsOfToolCall('read', { file_path: '' }, sources).reads).toEqual([])
  })
})

describe('classifyScope', () => {
  const inside = { path: `${WORKSPACE}/src/a.ts`, source: 'argument', recursive: false } as const
  const outside = { path: '/etc/hosts', source: 'argument', recursive: false } as const

  it('allows every path inside the workspace', () => {
    expect(classifyScope([inside], context())).toEqual({ kind: 'allow' })
  })

  it('allows a path inside an approved directory or under a session grant', () => {
    expect(classifyScope([outside], context([{ kind: 'directory', path: '/etc' }])))
      .toEqual({ kind: 'allow' })
    expect(classifyScope([outside], context([{ kind: 'session' }])))
      .toEqual({ kind: 'allow' })
  })

  it('refuses a credential path even inside the workspace', () => {
    const verdict = classifyScope(
      [{ path: `${WORKSPACE}/.env`, source: 'argument', recursive: false }],
      context(),
    )
    expect(verdict.kind).toBe('deny')
    expect(verdict).toMatchObject({ code: 'SPECDEV_SCOPE_CREDENTIAL' })
  })

  it('asks about only the paths outside the workspace', () => {
    const verdict = classifyScope([inside, outside], context())
    expect(verdict).toEqual({ kind: 'ask', paths: [outside], recursive: false })
  })

  it('carries the recursive flag into the request', () => {
    const verdict = classifyScope(
      [{ path: '/', source: 'command', recursive: true }],
      context(),
    )
    expect(verdict).toEqual({
      kind: 'ask',
      paths: [{ path: '/', source: 'command', recursive: true }],
      recursive: true,
    })
  })
})

describe('roleWriteAllowed', () => {
  const workflow = { workspaceRoot: WORKSPACE, slug: 'wf-1' }
  const specDir = `${WORKSPACE}/.specdev/specs/wf-1`

  it('lets the implementer write anywhere in the workspace, and nothing outside it', () => {
    expect(roleWriteAllowed('implementer', `${WORKSPACE}/src/a.ts`, workflow)).toBe(true)
    expect(roleWriteAllowed('implementer', `${WORKSPACE}/test-scripts/x.sh`, workflow)).toBe(true)
    expect(roleWriteAllowed('implementer', '/tmp/out.txt', workflow)).toBe(false)
  })

  it('keeps a read-only role inside its workflow directory and scratch directories', () => {
    expect(roleWriteAllowed('code-explorer', `${specDir}/phases/p1/repo-exploration.md`, workflow)).toBe(true)
    expect(roleWriteAllowed('verifier', `${WORKSPACE}/apps/x/test-scripts/probe.mts`, workflow)).toBe(true)
    expect(roleWriteAllowed('verifier', `${WORKSPACE}/src/a.ts`, workflow)).toBe(false)
    expect(roleWriteAllowed('verifier', `${WORKSPACE}/.specdev/specs/other/verification.md`, workflow)).toBe(false)
    expect(roleWriteAllowed('verifier', '/etc/hosts', workflow)).toBe(false)
  })

  it('gives the wiki role its documentation trees', () => {
    expect(roleWriteAllowed('wiki', `${WORKSPACE}/docs/wiki/index.md`, workflow)).toBe(true)
    expect(roleWriteAllowed('wiki', `${WORKSPACE}/.wiki-work/topic-plan.json`, workflow)).toBe(true)
    expect(roleWriteAllowed('wiki', `${WORKSPACE}/src/a.ts`, workflow)).toBe(false)
  })

  it('restricts an analysis role to its workflow directory', () => {
    expect(roleWriteAllowed('requirement-analyst', `${specDir}/requirements.md`, workflow)).toBe(true)
    expect(roleWriteAllowed('requirement-analyst', `${WORKSPACE}/test-scripts/x.ts`, workflow)).toBe(false)
  })

  it('leaves the orchestrator and role-less agents to their own restrictions', () => {
    expect(roleWriteAllowed('orchestrator', `${WORKSPACE}/src/a.ts`, workflow)).toBe(true)
    expect(roleWriteAllowed(undefined, '/etc/hosts', workflow)).toBe(true)
  })
})

describe('roleWriteScopeDescription', () => {
  const workflow = { workspaceRoot: WORKSPACE, slug: 'wf-1' }

  it('names the locations the role may write', () => {
    expect(roleWriteScopeDescription('implementer', workflow)).toBe('the whole workspace')
    expect(roleWriteScopeDescription('verifier', workflow))
      .toBe('.specdev/specs/wf-1/, any test-scripts/ directory')
    expect(roleWriteScopeDescription('wiki', workflow))
      .toBe('docs/wiki/, .wiki-work/, .specdev/specs/wf-1/')
    expect(roleWriteScopeDescription('orchestrator', workflow)).toBe('')
  })
})

describe('classifyRoleWrites', () => {
  const workflow = { workspaceRoot: WORKSPACE, slug: 'wf-1' }
  const specDir = `${WORKSPACE}/.specdev/specs/wf-1`

  it('allows every write inside the role scope', () => {
    const verdict = classifyRoleWrites(
      [{ path: `${specDir}/design.md`, source: 'argument', recursive: false }],
      { ...context(), role: 'verifier', ...workflow },
    )
    expect(verdict).toEqual({ kind: 'allow' })
  })

  it('asks about only the paths outside the role scope', () => {
    const offending = { path: `${WORKSPACE}/src/a.ts`, source: 'argument', recursive: false } as const
    const verdict = classifyRoleWrites(
      [{ path: `${specDir}/review.md`, source: 'argument', recursive: false }, offending],
      { ...context(), role: 'verifier', ...workflow },
    )
    expect(verdict).toEqual({ kind: 'ask', paths: [offending], recursive: false })
  })

  it('honours a scope the session already granted', () => {
    const verdict = classifyRoleWrites(
      [{ path: `${WORKSPACE}/src/a.ts`, source: 'argument', recursive: false }],
      { ...context([{ kind: 'session' }]), role: 'verifier', ...workflow },
    )
    expect(verdict).toEqual({ kind: 'allow' })
  })
})
