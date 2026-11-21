import { appendFile, mkdir, rename, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { ResolvedConfig } from './config.js'

const MAX_BYTES = 2 * 1024 * 1024
const MAX_PENDING = 512
export const defaultDiagnosticsPath = join(
  homedir(),
  '.dsh',
  'cache',
  'reply-with-images',
  'diagnostics.jsonl',
)

export type DiagnosticSink = (event: string, fields: Record<string, unknown>) => void

/** Serialize writes and rotation off the tool path. A failed log must never fail a tool. */
export const createDiagnostics = (
  config: Pick<ResolvedConfig, 'debugLog' | 'debugLogPath'>,
  summarize?: (event: string) => void,
) => {
  const path = config.debugLogPath || defaultDiagnosticsPath
  let queue = Promise.resolve()
  let pending = 0
  const log: DiagnosticSink = (event, fields) => {
    if (!config.debugLog) return
    try {
      summarize?.(event)
    } catch {
      // Host loggers can disappear during shutdown.
    }
    if (pending >= MAX_PENDING) return
    let line: string
    try {
      line = `${JSON.stringify({ ...fields, ts: new Date().toISOString(), event })}\n`
    } catch {
      return
    }
    const bytes = Buffer.byteLength(line)
    if (bytes > MAX_BYTES) return
    pending++
    queue = queue.then(async () => {
      try {
        await mkdir(dirname(path), { recursive: true, mode: 0o700 })
        const file = await stat(path).catch(() => undefined)
        if (file && file.size + bytes > MAX_BYTES) await rename(path, `${path}.1`)
        await appendFile(path, line, { mode: 0o600 })
      } catch {
        // Diagnostics are best-effort, including inaccessible paths and rotation races.
      } finally {
        pending--
      }
    })
  }
  return Object.assign(log, { flush: () => queue })
}

/** Keep upstream errors bounded and avoid recording URLs with credentials or query parameters. */
export const diagnosticError = (error: unknown) =>
  error instanceof Error
    ? error.message
        .replace(/https?:\/\/[^\s)]+/gi, '[URL]')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 160)
    : 'Unknown error'
