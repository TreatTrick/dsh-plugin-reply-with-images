import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createDiagnostics, defaultDiagnosticsPath } from '../src/diagnostics.js'

const dirs: string[] = []
const directory = async () => {
  const path = await mkdtemp(join(tmpdir(), 'reply-images-diag-'))
  dirs.push(path)
  return path
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

it('appends ordered JSON lines, rotates once, and emits only event names to the host logger', async () => {
  const path = join(await directory(), 'nested', 'diagnostics.jsonl')
  const summarize = vi.fn()
  const log = createDiagnostics({ debugLog: true, debugLogPath: path }, summarize)
  log('prepare.start', { sessionTurn: { sessionId: 's1', turn: 2 }, query: 'first\nsecond' })
  log('prepare.done', { elapsedMs: 1 })
  await log.flush()
  const rows = (await readFile(path, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  expect(rows).toMatchObject([
    { event: 'prepare.start', query: 'first\nsecond', sessionTurn: { sessionId: 's1', turn: 2 } },
    { event: 'prepare.done' },
  ])
  expect(rows[0].ts).toEqual(expect.any(String))
  expect(summarize.mock.calls.flat()).toEqual(['prepare.start', 'prepare.done'])
  await writeFile(path, 'x'.repeat(2 * 1024 * 1024))
  log('search.ranked', {})
  await log.flush()
  expect((await readFile(`${path}.1`)).length).toBe(2 * 1024 * 1024)
  expect(await readFile(path, 'utf8')).toContain('search.ranked')
  await writeFile(path, 'y'.repeat(2 * 1024 * 1024))
  log('candidate.saved', {})
  await log.flush()
  expect((await readFile(`${path}.1`))[0]).toBe(121)
})

it('ignores blocked paths and host logger errors and skips all work when disabled', async () => {
  const dir = await directory()
  const path = join(dir, 'file')
  const summarize = vi.fn(() => {
    throw new Error('logger gone')
  })
  await writeFile(path, 'occupied')
  const blocked = createDiagnostics({ debugLog: true, debugLogPath: join(path, 'log') }, summarize)
  blocked('plugin.loaded', {})
  await blocked.flush()
  expect(summarize).toHaveBeenCalledOnce()
  const disabled = createDiagnostics({ debugLog: false, debugLogPath: path }, summarize)
  disabled('plugin.loaded', {})
  await disabled.flush()
  expect(summarize).toHaveBeenCalledOnce()
  expect(await readFile(path, 'utf8')).toBe('occupied')
  expect(defaultDiagnosticsPath).toMatch(
    /[\\/]\.dsh[\\/]cache[\\/]reply-with-images[\\/]diagnostics\.jsonl$/,
  )
})
