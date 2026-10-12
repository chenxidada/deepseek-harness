import { describe, expect, it } from 'vitest'
import {
  confinedModeRefusal,
  normalizeTerminalOutput,
  stripCommandEcho,
  TerminalOutputBuffer,
} from '../src/index.ts'

describe('bash-ide-terminal utilities', () => {
  describe('confinedModeRefusal', () => {
    it('mentions the mode and both resolution actions', () => {
      const msg = confinedModeRefusal('workspace-write')
      expect(msg).toContain('workspace-write')
      expect(msg).toContain('danger-full-access')
      expect(msg).toContain('settings page')
    })

    it('mentions read-only mode when given', () => {
      expect(confinedModeRefusal('read-only')).toContain('read-only')
    })
  })

  describe('normalizeTerminalOutput', () => {
    it('strips ANSI color sequences', () => {
      expect(normalizeTerminalOutput('\u001B[32mgreen\u001B[0m')).toBe('green')
    })

    it('normalizes CRLF and CR to LF', () => {
      expect(normalizeTerminalOutput('a\r\nb\rc')).toBe('a\nb\nc')
    })

    it('strips C0 controls but preserves newline and tab', () => {
      // NUL is stripped, not replaced; newline and tab survive
      expect(normalizeTerminalOutput('a\tb\u0000c\nd')).toBe('a\tbc\nd')
      // BEL, BS stripped
      expect(normalizeTerminalOutput('\u0007\u0008text')).toBe('text')
    })

    it('strips OSC sequences', () => {
      expect(normalizeTerminalOutput('\u001B]0;title\u0007rest')).toBe('rest')
    })

    it('returns empty string for purely control input', () => {
      expect(normalizeTerminalOutput('\u001B[31m\u001B[0m')).toBe('')
    })
  })

  describe('stripCommandEcho', () => {
    it('removes the echoed command from the start of the first chunk', () => {
      const result = stripCommandEcho('ls -la\r\nfile1\nfile2\n', 'ls -la')
      expect(result).not.toContain('ls -la')
      expect(result).toContain('file1')
    })

    it('returns the chunk unchanged when the command is not echoed', () => {
      const result = stripCommandEcho('file1\nfile2\n', 'ls -la')
      expect(result).toBe('file1\nfile2\n')
    })

    it('strips echo followed by LF', () => {
      const result = stripCommandEcho('echo hi\nhi\n', 'echo hi')
      expect(result).toBe('hi\n')
    })

    it('strips echo with no trailing newline', () => {
      const result = stripCommandEcho('pwd', 'pwd')
      expect(result).toBe('')
    })
  })

  describe('TerminalOutputBuffer', () => {
    it('collects text within the byte limit', () => {
      const buf = new TerminalOutputBuffer(1024)
      buf.append('hello ')
      buf.append('world')
      const collected = buf.toCollected()
      expect(collected.text).toBe('hello world')
      expect(collected.truncated).toBe(false)
    })

    it('truncates when exceeding the byte limit', () => {
      const buf = new TerminalOutputBuffer(10)
      buf.append('abcdefghijklmnop') // 16 bytes, limit is 10
      const collected = buf.toCollected()
      expect(collected.truncated).toBe(true)
      expect(Buffer.byteLength(collected.text, 'utf8')).toBeLessThanOrEqual(10)
    })

    it('readFrom reports offset and lossy status', () => {
      const buf = new TerminalOutputBuffer(1024)
      buf.append('hello')
      const read = buf.readFrom(0)
      expect(read.text).toBe('hello')
      expect(read.nextOffset).toBeGreaterThan(0)
      expect(read.lossy).toBe(false)
    })

    it('readFrom with offset reads only new data', () => {
      const buf = new TerminalOutputBuffer(1024)
      buf.append('hello')
      const first = buf.readFrom(0)
      buf.append(' world')
      const second = buf.readFrom(first.nextOffset)
      expect(second.text).toBe(' world')
    })

    it('readFrom marks lossy when prior data was trimmed', () => {
      const buf = new TerminalOutputBuffer(5)
      buf.append('abcdefghij') // 10 bytes, only last ~5 retained
      const read = buf.readFrom(0)
      expect(read.lossy).toBe(true)
    })

    it('append is a no-op for empty string', () => {
      const buf = new TerminalOutputBuffer(1024)
      buf.append('')
      const collected = buf.toCollected()
      expect(collected.text).toBe('')
      expect(collected.truncated).toBe(false)
    })
  })
})
