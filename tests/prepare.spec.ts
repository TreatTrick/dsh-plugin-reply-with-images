import { expect, it, vi } from 'vitest'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { resolveConfig } from '../src/config.js'
import type { Config } from '../src/config.js'
import type { HttpRead } from '../src/http.js'
import { ReplyImages } from '../src/replyImages.js'

const topic = (label = 'Lotus') => ({ topic: label, query: label, alt: `${label} | image` })
const scope = () => ({ owner: {}, turn: 1 })
const signal = () => new AbortController().signal
const fixture = (config: Config = {}, reader?: HttpRead) => {
  const saveImage = vi.fn(async () => ({
    attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`),
    bytes: 8,
    width: 2,
    height: 1,
    mediaType: 'image/png' as const,
  }))
  const read = vi.fn<HttpRead>(
    reader ??
      (async (url) =>
        url.includes('image.so.com')
          ? {
              contentType: 'application/json',
              data: Buffer.from(
                JSON.stringify({
                  list: [
                    {
                      title: 'Lotus',
                      thumb: 'https://p2.ssl.qhimgs1.com/lotus.png',
                      link: 'https://example.com/lotus',
                    },
                  ],
                }),
              ),
            }
          : { contentType: 'image/png', data: Buffer.from('89504e470d0a1a0a', 'hex') }),
  )
  const service = new ReplyImages(resolveConfig({ providers: ['so360'], ...config }), {
    read,
    attachments: { saveImage },
    baseUrl: () => 'https://harness.example',
  })
  return { service, read, saveImage }
}

it('prepares three ordered topics with safe single-line table Markdown and consumes both budgets', async () => {
  const f = fixture()
  const current = scope()
  const result = await f.service.prepare(
    current,
    [topic(), topic('Water lily'), topic('Garden')],
    signal(),
  )
  expect(result.topics.map((item) => item.topic)).toEqual(['Lotus', 'Water lily', 'Garden'])
  expect(f.saveImage).toHaveBeenCalledTimes(3)
  expect(result.topics[0]!.tableMarkdown).not.toContain('\n')
  expect(result.topics[0]!.tableMarkdown).toContain('Lotus \\| image')
  expect(result.topics[0]!.tableMarkdown).toContain('License unconfirmed')
  await expect(f.service.search(current, 'Lotus', signal())).rejects.toMatchObject({
    code: 'REPLY_IMAGES_BUDGET_EXCEEDED',
  })
  await expect(f.service.prepare(current, [topic()], signal())).rejects.toMatchObject({
    code: 'REPLY_IMAGES_BUDGET_EXCEEDED',
  })
  expect(f.read).toHaveBeenCalledTimes(6)
})

it.each([{ maxImagesPerTurn: 1 }, { maxSearchesPerTurn: 1 }])(
  'rejects the whole oversized batch before any network work: %j',
  async (config) => {
    const f = fixture(config)
    const current = scope()
    await expect(
      f.service.prepare(current, [topic(), topic('Garden')], signal()),
    ).rejects.toMatchObject({ code: 'REPLY_IMAGES_BUDGET_EXCEEDED' })
    expect(f.read).not.toHaveBeenCalled()
    expect(f.saveImage).not.toHaveBeenCalled()
    expect((await f.service.prepare(current, [topic()], signal())).topics[0]!.images).toHaveLength(
      1,
    )
  },
)

it('shares remaining budgets with the advanced tools and concurrent preparation', async () => {
  const f = fixture({ maxImagesPerTurn: 2 })
  const current = scope()
  const found = await f.service.search(current, 'Lotus', signal())
  await f.service.embed(current, [{ candidateId: found.images[0]!.candidateId }], signal())
  await expect(
    f.service.prepare(current, [topic(), topic('Garden')], signal()),
  ).rejects.toMatchObject({ code: 'REPLY_IMAGES_BUDGET_EXCEEDED' })
  const pending = f.service.prepare(current, [topic()], signal())
  await expect(f.service.prepare(current, [topic()], signal())).rejects.toMatchObject({
    code: 'REPLY_IMAGES_BUDGET_EXCEEDED',
  })
  expect((await pending).topics[0]!.images).toHaveLength(1)
  expect(f.saveImage).toHaveBeenCalledTimes(2)
})

it.each([
  { topics: [] },
  { topics: Array.from({ length: 4 }, () => topic()) },
  { topics: [topic(), { ...topic(), query: ' ' }] },
  { topics: [{ ...topic(), topic: 'x'.repeat(121) }] },
  { topics: [{ ...topic(), alt: '' }] },
])('validates every topic before consuming budget: %j', async ({ topics }) => {
  const f = fixture()
  const current = scope()
  await expect(f.service.prepare(current, topics, signal())).rejects.toMatchObject({
    code: 'INVALID_ARGS',
  })
  expect(f.read).not.toHaveBeenCalled()
  expect((await f.service.prepare(current, [topic()], signal())).topics[0]!.images).toHaveLength(1)
})

it('keeps successful topics and diagnoses empty search, provider errors, and storage failures independently', async () => {
  const f = fixture({}, async (url) => {
    if (url.includes('q=empty'))
      return { contentType: 'application/json', data: Buffer.from('{"list":[]}') }
    if (url.includes('q=error')) throw new Error('Provider unavailable')
    return url.includes('image.so.com')
      ? {
          contentType: 'application/json',
          data: Buffer.from(
            JSON.stringify({
              list: [
                {
                  title: 'Garden',
                  thumb: 'https://p2.ssl.qhimgs1.com/garden.png',
                  link: 'https://example.com/garden',
                },
              ],
            }),
          ),
        }
      : { contentType: 'image/png', data: Buffer.from('89504e470d0a1a0a', 'hex') }
  })
  const result = await f.service.prepare(
    scope(),
    [topic('empty'), topic('Garden'), topic('error')],
    signal(),
  )
  expect(result.topics.map((item) => item.images.length)).toEqual([0, 1, 0])
  expect(result.warnings.join()).toContain('No usable image result')
  expect(result.warnings.join()).toContain('Provider unavailable')
  expect(result.markdown).toContain('Image source:')
  const failed = fixture()
  failed.saveImage.mockRejectedValueOnce(new Error('Storage full'))
  const mixed = await failed.service.prepare(scope(), [topic(), topic('Garden')], signal())
  expect(mixed.topics.map((item) => item.images.length)).toEqual([0, 1])
  expect(mixed.warnings.join()).toContain('Storage full')
})

it('propagates request cancellation and unload while draining an active attachment write', async () => {
  const f = fixture()
  let release = () => {}
  let started = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const saving = new Promise<void>((resolve) => {
    started = resolve
  })
  const ref = await f.saveImage()
  f.saveImage.mockClear()
  f.saveImage.mockImplementationOnce(async () => {
    started()
    await gate
    return ref
  })
  const pending = f.service.prepare(scope(), [topic(), topic('Garden')], signal())
  const rejected = expect(pending).rejects.toMatchObject({ code: 'REPLY_IMAGES_CLOSED' })
  await saving
  let disposed = false
  const closing = f.service.dispose().then(() => {
    disposed = true
  })
  await Promise.resolve()
  expect(disposed).toBe(false)
  release()
  await closing
  await rejected
  expect(f.saveImage).toHaveBeenCalledTimes(1)
  expect(f.read).toHaveBeenCalledTimes(2)
  const canceled = fixture()
  const controller = new AbortController()
  controller.abort(new Error('Canceled by user'))
  await expect(canceled.service.prepare(scope(), [topic()], controller.signal)).rejects.toThrow(
    'Canceled by user',
  )
  expect(canceled.read).not.toHaveBeenCalled()
})
