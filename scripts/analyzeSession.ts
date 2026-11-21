import { readFile, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { zstdDecompressSync, type ZstdDecompress } from 'node:zlib'
import { defaultDiagnosticsPath } from '../src/diagnostics.js'

const SESSION_FILE = 'session.v4.jsonl.zstd'
const sessionsRoot = join(homedir(), '.dsh', 'sessions')

export const decompressSession = (compressed: Buffer) => {
  const frames: Buffer[] = []
  for (let offset = 0; offset < compressed.length;) {
    // Node returns one frame at a time. Use consumed input bytes because a payload can contain the magic number.
    // The Node 22 types omit the runtime's info result for Zstd.
    const { buffer, engine } = zstdDecompressSync(compressed.subarray(offset), {
      info: true,
    }) as unknown as { buffer: Buffer; engine: ZstdDecompress }
    if (engine.bytesWritten <= 0) throw new Error(`Incomplete Zstd frame at byte ${offset}`)
    offset += engine.bytesWritten
    frames.push(buffer)
  }
  return Buffer.concat(frames).toString('utf8')
}

const findSession = async (input?: string) => {
  if (input) {
    const path = resolve(input)
    const info = await stat(path).catch(() => undefined)
    if (info?.isFile()) return path
    if (info?.isDirectory()) return join(path, SESSION_FILE)
    if (/[\\/]/.test(input) || input.endsWith('.zstd'))
      throw new Error(`Session file not found: ${path}`)
  }
  const entries = await readdir(sessionsRoot, { recursive: true, withFileTypes: true })
  const paths = entries
    .filter((entry) => entry.isFile() && entry.name === SESSION_FILE)
    .filter((entry) => !input || [input, `session-${input}`].includes(basename(entry.parentPath)))
    .map((entry) => join(entry.parentPath, entry.name))
  const files = await Promise.all(
    paths.map(async (path) => ({ path, modified: (await stat(path)).mtimeMs })),
  )
  const latest = files.sort((left, right) => right.modified - left.modified)[0]
  if (!latest)
    throw new Error(
      input ? `Session ID not found: ${input}` : `No sessions found in ${sessionsRoot}`,
    )
  return latest.path
}

interface ContentBlock {
  type: string
  text?: string
}

interface SessionRecord {
  type: string
  id?: string
  createdAt?: number
  time?: number
  data?: {
    turn?: number
    source?: { kind?: string }
    content?: ContentBlock[]
    callId?: string
    name?: string
    arguments?: string
    message?: { content?: ContentBlock[]; toolCallId?: string; isError?: boolean }
  }
}

interface DiagnosticRecord {
  event: string
  ts: string
  sessionTurn?: { sessionId: string; turn: number }
  callId?: string
}

const jsonLines = <T>(text: string): T[] =>
  text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as T)

const parseJson = (text: string) => {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

const markdownImages = (text: string) => {
  const images: { alt: string; destination: string; layout: string; group?: string }[] = []
  for (const line of text
    .replace(/^\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s*\1\s*$/gm, '')
    .split('\n')) {
    for (const image of line.matchAll(
      /(?<!\\)!\[((?:\\.|[^\]\\])*)\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["']([^"']*)["'])?\s*\)/g,
    )) {
      const rawAlt = image[1] ?? ''
      const altLayout = rawAlt.endsWith('\u200B\u200C')
        ? 'collage'
        : rawAlt.endsWith('\u200B\u200D')
          ? 'strip'
          : undefined
      const alt = rawAlt.replace(/[\u200B-\u200D]+$/u, '')
      const destination = image[2] ?? image[3] ?? ''
      const hash = destination.indexOf('#')
      const mark = new URLSearchParams(hash === -1 ? '' : destination.slice(hash + 1))
      const title = new URLSearchParams(image[4]?.trim())
      const requested = mark.get('dsh-layout') ?? title.get('dsh-layout') ?? altLayout
      const group = mark.get('group') ?? title.get('group')
      const layout =
        requested === 'collage' || requested === 'strip'
          ? requested
          : /^\s*\|/.test(line)
            ? 'table'
            : 'single'
      images.push({ alt, destination, layout, ...(group ? { group } : {}) })
    }
  }
  return images
}

const readDiagnostics = async (path: string) => {
  const text = await readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT' && error.code !== 'EACCES' && error.code !== 'EPERM') throw error
    return ''
  })
  // An active plugin may still be appending the last line.
  return text.split(/\r?\n/).flatMap((line) => {
    const row = parseJson(line) as DiagnosticRecord | string | null
    return row && typeof row === 'object' && row.event && row.ts ? [row] : []
  })
}

export const analyzeSession = async (path: string, diagnosticsPath = defaultDiagnosticsPath) => {
  const rows = jsonLines<SessionRecord>(decompressSession(await readFile(path)))
  const header = rows[0]
  if (header?.type !== 'session') throw new Error('Expected a DSH v4 session header')
  const sessionId = header.id ?? basename(dirname(path))
  const posts = rows.filter(({ type }) => type === 'assistant/message')
  const userQuestions = rows
    .filter(
      ({ type, data }) =>
        type === 'user/message' && (!data?.source?.kind || data.source.kind === 'user'),
    )
    .flatMap(({ data }) => data?.content ?? [])
    .filter(({ type }) => type === 'text')
    .map(({ text }) => text)
  const reasoning = posts.flatMap(({ data }) =>
    (data?.message?.content ?? [])
      .filter(({ type }) => type === 'reasoning')
      .flatMap(({ text }) => {
        const excerpts = (text ?? '')
          .split(/(?<=[。！？.!?])\s*|\n+/u)
          .filter((line) =>
            /\b(?:images?|photos?|illustrat\w*|collage|reply_image\w*)\b|配图|插图|图片|照片|拼贴|图集/i.test(
              line,
            ),
          )
          .slice(0, 4)
          .map((line) => line.trim().slice(0, 400))
        return excerpts.length ? [{ turn: data?.turn, excerpts }] : []
      }),
  )
  const toolResults = new Map(
    rows
      .filter(({ type }) => type === 'tool/result')
      .map(({ data }) => [data?.message?.toolCallId, data?.message] as const),
  )
  const toolCalls = rows
    .filter(({ type, data }) => type === 'tool/call' && /^reply_images?_/.test(data?.name ?? ''))
    .map(({ data }) => {
      const result = toolResults.get(data?.callId)
      const warnings = (result?.content ?? []).flatMap(({ text }) => {
        const value = parseJson(text ?? '')
        return value &&
          typeof value === 'object' &&
          'warnings' in value &&
          Array.isArray(value.warnings)
          ? value.warnings.filter((warning): warning is string => typeof warning === 'string')
          : result?.isError && text
            ? [text]
            : []
      })
      return {
        turn: data?.turn,
        callId: data?.callId,
        tool: data?.name,
        arguments: parseJson(data?.arguments ?? ''),
        warnings,
      }
    })
  const images = posts.flatMap(({ data }) =>
    (data?.message?.content ?? [])
      .filter(({ type }) => type === 'text')
      .flatMap(({ text }) => markdownImages(text ?? '')),
  )
  const layoutCounts = { single: 0, table: 0, collage: 0, strip: 0 }
  for (const image of images) {
    const layout = image.layout as keyof typeof layoutCounts
    layoutCounts[layout]++
  }
  const start = header.createdAt ?? rows.find(({ time }) => time !== undefined)?.time ?? 0
  const end = rows.reduce((last, { time }) => time ?? last, start)
  const callIds = new Set(toolCalls.map(({ callId }) => callId))
  const diagnostics = [
    ...(await readDiagnostics(`${diagnosticsPath}.1`)),
    ...(await readDiagnostics(diagnosticsPath)),
  ].filter(({ sessionTurn, callId, ts }) => {
    if (sessionTurn?.sessionId) return sessionTurn.sessionId === sessionId
    if (callId) return callIds.has(callId)
    const time = Date.parse(ts)
    return time >= start && time <= end
  })
  return {
    sessionId,
    path,
    userQuestions,
    reasoning,
    toolCalls,
    embedded: { total: images.length, layoutCounts, images },
    diagnostics,
  }
}

const main = async () => {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { log: { type: 'string' }, help: { type: 'boolean' } },
  })
  if (values.help) {
    console.log(
      'Usage: npm run analyze:session -- [session ID or file path] [--log diagnostics.jsonl]',
    )
    return
  }
  if (positionals.length > 1) throw new Error('Expected at most one session ID or file path')
  const report = await analyzeSession(await findSession(positionals[0]), values.log)
  console.log(JSON.stringify(report, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
