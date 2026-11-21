import { mkdtemp, rmdir, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import { expect, it } from 'vitest'
import { analyzeSession } from '../scripts/analyzeSession.js'

it('reads consecutive frames and reports only the matching tool calls, image layouts and log records', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'reply-images-session-'))
  const path = join(folder, 'session.v4.jsonl.zstd')
  const log = join(folder, 'diagnostics.jsonl')
  const jsonl = (...rows: unknown[]) => rows.map((row) => `${JSON.stringify(row)}\n`).join('')
  const time = Date.parse('2026-01-01T12:00Z')
  const frames = [
    jsonl(
      { type: 'session', id: 'session-test', createdAt: time },
      {
        type: 'user/message',
        time,
        data: {
          source: { kind: 'user' },
          content: [{ type: 'text', text: 'Show me lotus photos.' }],
        },
      },
      {
        type: 'user/message',
        time,
        data: {
          source: { kind: 'skill-catalog' },
          content: [{ type: 'text', text: '<system-reminder>skill list</system-reminder>' }],
        },
      },
    ),
    jsonl(
      {
        type: 'assistant/message',
        time,
        data: {
          turn: 1,
          message: {
            content: [{ type: 'reasoning', text: 'Use a photo of the lotus. Skip extra context.' }],
          },
        },
      },
      {
        type: 'tool/call',
        time,
        data: { turn: 1, callId: 'c1', name: 'reply_images_prepare', arguments: '{"topics":[]}' },
      },
      {
        type: 'tool/result',
        time,
        data: {
          message: {
            toolCallId: 'c1',
            content: [{ type: 'text', text: '{"warnings":["No third image"]}' }],
          },
        },
      },
    ),
    jsonl({
      type: 'assistant/message',
      time,
      data: {
        turn: 1,
        message: {
          content: [
            {
              type: 'text',
              text: '![One\u200B\u200C](<C:/Images/1.png>)\n![Two](<https://example.com/2.png#dsh-layout=strip&group=web>)\n| ![Three](3.png) | Table |\n![Four](4.png)\n```md\n![Example](ignored.png)\n```',
            },
          ],
        },
      },
    }),
  ]
  try {
    await writeFile(
      path,
      Buffer.concat(frames.map((frame) => zstdCompressSync(Buffer.from(frame)))),
    )
    const ts = new Date(time).toISOString()
    await writeFile(
      `${log}.1`,
      jsonl({ event: 'prepare.start', ts, sessionTurn: { sessionId: 'session-test', turn: 1 } }),
    )
    await writeFile(
      log,
      jsonl(
        { event: 'prepare.done', ts, callId: 'c1' },
        { event: 'prepare.done', ts, sessionTurn: { sessionId: 'other', turn: 1 } },
        { event: 'plugin.loaded', ts },
        { event: 'old', ts: '2020-01-01' },
      ) + 'incomplete',
    )
    const report = await analyzeSession(path, log)
    expect(report.userQuestions).toEqual(['Show me lotus photos.'])
    expect(report.reasoning).toEqual([{ turn: 1, excerpts: ['Use a photo of the lotus.'] }])
    expect(report.toolCalls).toMatchObject([
      { arguments: { topics: [] }, warnings: ['No third image'] },
    ])
    expect(report.embedded).toMatchObject({
      total: 4,
      layoutCounts: { single: 1, table: 1, collage: 1, strip: 1 },
    })
    expect(report.diagnostics.map(({ event }) => event)).toEqual([
      'prepare.start',
      'prepare.done',
      'plugin.loaded',
    ])
  } finally {
    await Promise.all([path, log, `${log}.1`].map((file) => unlink(file).catch(() => {})))
    await rmdir(folder)
  }
})
