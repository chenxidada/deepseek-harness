/**
 * Conversation activity copy derived from one tool call's raw arguments and its result.
 * Labels are content (the model's own description, or the exact input it named), never
 * product copy, so callers render them as-is.
 * @module @deepseek-ai/dsh-vscode-dsh/chat-panel/activity-digest
 */

/** Cap for the collapsed-row label. */
const SUMMARY_LIMIT = 120
/** Cap for the exact invocation text shown when the row expands. */
const INVOCATION_LIMIT = 600
/** Cap for the result preview shown when the row expands. */
const RESULT_LIMIT = 1_500
/** Result lines kept before the preview is cut. */
const RESULT_LINE_LIMIT = 20

/** Collapsed-row label plus the exact text of one tool call. */
export interface ToolCallDigest {
  /** What the call does: the model's own description, or the exact input it names. */
  summary: string
  /** Exact invocation, when it differs from {@link ToolCallDigest.summary}. */
  invocation?: string
}

/**
 * Project a `tool/call`'s raw arguments into conversation activity copy.
 * @param toolName - registered tool name (`bash`, `glob`, …).
 * @param rawArguments - the log's `arguments`: a JSON string, or an already-parsed object for PTC sub-calls.
 * @returns collapsed-row label and the invocation text for the expanded row.
 */
export function digestToolCall(toolName: string, rawArguments: unknown): ToolCallDigest {
  const args = asArguments(rawArguments)
  if (args === undefined) return { summary: toolName }

  switch (toolName) {
    case 'bash':
    case 'pwsh': {
      const command = readString(args, 'command')
      const description = readString(args, 'description')
      const summary = description ?? firstLine(command) ?? toolName
      // A command equal to its own description (short commands) adds nothing when expanded.
      return {
        summary: clip(summary, SUMMARY_LIMIT),
        ...command === undefined || command === summary
          ? {}
          : { invocation: clip(command, INVOCATION_LIMIT) },
      }
    }
    case 'glob':
    case 'grep': {
      const input = joinParts([readString(args, 'pattern'), readString(args, 'include')])
      return { summary: clip(input === '' ? toolName : input, SUMMARY_LIMIT) }
    }
    case 'read':
    case 'read_image': {
      const path = readString(args, 'file_path')
      if (path === undefined) return { summary: toolName }
      const window = joinParts([
        readNumber(args, 'offset') === undefined ? undefined : `offset=${readNumber(args, 'offset')}`,
        readNumber(args, 'limit') === undefined ? undefined : `limit=${readNumber(args, 'limit')}`,
      ])
      return {
        summary: clip(path, SUMMARY_LIMIT),
        ...window === '' ? {} : { invocation: clip(`${path} · ${window}`, INVOCATION_LIMIT) },
      }
    }
    case 'write':
    case 'edit':
      return { summary: clip(readString(args, 'file_path') ?? toolName, SUMMARY_LIMIT) }
    case 'str_replace_editor': {
      const path = readString(args, 'path')
      const command = readString(args, 'command')
      return {
        summary: clip(path ?? toolName, SUMMARY_LIMIT),
        ...command === undefined ? {} : { invocation: joinParts([path, command]) },
      }
    }
    case 'todo_write': {
      const todos = Array.isArray(args.todos) ? args.todos : []
      const head = todos
        .map(todo => readString(asArguments(todo) ?? {}, 'content'))
        .find(content => content !== undefined)
      if (head === undefined) return { summary: toolName }
      const rest = todos.length > 1 ? ` +${todos.length - 1}` : ''
      return { summary: clip(`${head}${rest}`, SUMMARY_LIMIT) }
    }
    case 'web_search': {
      const queries = Array.isArray(args.queries)
        ? args.queries.filter((entry): entry is string => typeof entry === 'string')
        : []
      return { summary: clip(queries.join(' · ') || toolName, SUMMARY_LIMIT) }
    }
    case 'web_fetch':
      return { summary: clip(readString(args, 'url') ?? toolName, SUMMARY_LIMIT) }
    case 'subagent':
    case 'subagent_fork': {
      const description = readString(args, 'description')
      const prompt = firstLine(readString(args, 'prompt'))
      return {
        summary: clip(description ?? prompt ?? toolName, SUMMARY_LIMIT),
        ...prompt === undefined || prompt === description
          ? {}
          : { invocation: clip(prompt, INVOCATION_LIMIT) },
      }
    }
    case 'run_code':
    case 'skill':
    case 'job_output':
    case 'job_kill': {
      const label = readString(args, 'description')
        ?? readString(args, 'name')
        ?? readString(args, 'job_id')
      return { summary: clip(label ?? toolName, SUMMARY_LIMIT) }
    }
    case 'ask_user_question': {
      const questions = Array.isArray(args.questions) ? args.questions : []
      const first = questions
        .map(question => readString(asArguments(question) ?? {}, 'question'))
        .find(question => question !== undefined)
      return { summary: clip(first ?? toolName, SUMMARY_LIMIT) }
    }
    default: {
      const invocation = clip(JSON.stringify(args), INVOCATION_LIMIT)
      return {
        summary: toolName,
        ...invocation === '{}' ? {} : { invocation },
      }
    }
  }
}

/**
 * Clip one rendered tool result into the expanded row's preview.
 * @param text - rendered result text (stdout, search hits, file window, …).
 * @returns leading lines within the preview budget, or undefined for an empty result.
 */
export function previewToolResult(text: string): string | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  const head = trimmed.split('\n').slice(0, RESULT_LINE_LIMIT).join('\n')
  const clipped = head.length <= RESULT_LIMIT ? head : head.slice(0, RESULT_LIMIT - 1)
  return clipped === trimmed ? clipped : `${clipped.trimEnd()}…`
}

/**
 * Parse the log's `arguments` field into a record.
 * @param raw - a JSON string, an already-parsed object (PTC sub-calls), or anything else.
 * @returns the argument record, or undefined when the payload carries none.
 */
function asArguments(raw: unknown): Record<string, unknown> | undefined {
  if (typeof raw === 'string') {
    if (raw.trim() === '') return undefined
    try {
      const parsed: unknown = JSON.parse(raw)
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : undefined
    } catch {
      // A malformed argument string is still the model's exact input; keep it as the label.
      return undefined
    }
  }
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : undefined
}

function readString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function readNumber(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function firstLine(text: string | undefined): string | undefined {
  const line = text?.split('\n').find(entry => entry.trim() !== '')
  return line?.trim()
}

function joinParts(parts: readonly (string | undefined)[]): string {
  return parts.filter((part): part is string => part !== undefined).join(' · ')
}

function clip(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`
}
