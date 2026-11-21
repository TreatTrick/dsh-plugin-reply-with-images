import { createHash } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { resolveConfig } from '../src/config.js'
import type { Config } from '../src/config.js'
import type { HttpRead } from '../src/http.js'
import { ReplyImages, type ReplyImagesDependencies } from '../src/replyImages.js'

const topic = (label = 'Lotus') => ({ topic: label, query: label, alt: `${label} | image` })
const scope = () => ({ owner: {}, turn: 1 })
const signal = () => new AbortController().signal
const fixture = (
  config: Config = {},
  reader?: HttpRead,
  imageDestination?: ReplyImagesDependencies['imageDestination'],
) => {
  const saveImage = vi.fn(async ({ data }: { data: Uint8Array }) => ({
    attachmentId: AttachmentId(`sha256:${createHash('sha256').update(data).digest('hex')}`),
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
                      thumb: `https://p2.ssl.qhimgs1.com/lotus.png?${new URL(url).searchParams.get('q')}`,
                      link: 'https://example.com/lotus',
                    },
                  ],
                }),
              ),
            }
          : { contentType: 'image/png', data: Buffer.from(url) }),
  )
  const service = new ReplyImages(resolveConfig({ providers: ['so360'], ...config }), {
    read,
    attachments: { saveImage },
    baseUrl: () => 'https://harness.example',
    ...(imageDestination ? { imageDestination } : {}),
  })
  return { service, read, saveImage }
}

it('prepares three ordered topics with safe single-line table Markdown and consumes both budgets', async () => {
  const f = fixture({ maxImagesPerTurn: 3, maxSearchesPerTurn: 3 })
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
  const pending = f.service.prepare(current, [topic('Garden')], signal())
  await expect(f.service.prepare(current, [topic()], signal())).rejects.toMatchObject({
    code: 'REPLY_IMAGES_BUDGET_EXCEEDED',
  })
  expect((await pending).topics[0]!.images).toHaveLength(1)
  expect(f.saveImage).toHaveBeenCalledTimes(2)
})

it.each([
  { topics: [] },
  { topics: Array.from({ length: 6 }, () => topic()) },
  { topics: [topic(), { ...topic(), query: ' ' }] },
  { topics: [{ ...topic(), topic: 'x'.repeat(121) }] },
  { topics: [{ ...topic(), alt: '' }] },
  { topics: [{ ...topic(), count: 0 }] },
  { topics: [{ ...topic(), count: 1.5 }] },
  { topics: [{ ...topic(), count: 6 }] },
  { topics: [{ topic: 'Empty', items: [] }] },
  { topics: [{ topic: 'Over limit', items: Array.from({ length: 6 }, () => topic()) }] },
  { topics: [{ topic: 'Missing alt', query: 'Lotus' }] },
  { topics: [{ ...topic(), items: [topic()] }] },
  { topics: [{ topic: 'Mixed', count: 2, items: [topic()] }] },
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
  expect(result.topics.map((item) => item.placement)).toEqual([
    'No image was prepared for this topic; use its warning and continue without an image.',
    expect.stringContaining('section about "Garden"'),
    'No image was prepared for this topic; use its warning and continue without an image.',
  ])
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
  const ref = await f.saveImage({ data: Buffer.from('pending') })
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

const galleryReader: HttpRead = async (url) => {
  const { searchParams, pathname } = new URL(url)
  if (url.includes('image.so.com')) {
    const query = searchParams.get('q')!
    return {
      contentType: 'application/json',
      data: Buffer.from(
        JSON.stringify({
          list: query.split(',').map((key) => ({
            title: key,
            thumb: `https://p2.ssl.qhimgs1.com/${key}.png`,
            link: `https://example.com/${key}`,
          })),
        }),
      ),
    }
  }
  if (pathname === '/broken.png') throw new Error('Bad image')
  return { contentType: 'image/png', data: Buffer.from(pathname.replace('/copy.png', '/a.png')) }
}

it('prepares table, collage, strip, and legacy sections with ordered sources and group fragments', async () => {
  const f = fixture({ maxImagesPerTurn: 10, maxSearchesPerTurn: 7 }, galleryReader)
  const { topics } = await f.service.prepare(
    scope(),
    [
      {
        topic: 'Directory',
        layout: 'table',
        items: [
          { query: 'portrait', alt: 'Portrait', caption: 'Role | description' },
          { query: 'broken', alt: 'Unavailable portrait' },
        ],
      },
      { topic: 'Event', layout: 'collage', items: [topic('hero'), topic('side1'), topic('side2')] },
      { topic: 'Angles', layout: 'strip', query: 'a,b,c,d', alt: 'Other views', count: 4 },
      topic('independent'),
    ],
    signal(),
  )
  expect(topics.map(({ layout, images }) => [layout, images.length])).toEqual([
    ['table', 1],
    ['collage', 3],
    ['strip', 4],
    ['single', 1],
  ])
  expect(topics[0]!.markdown).toMatch(/^\| Image \| Description \| Source and license \|/)
  expect(topics[0]!.markdown).toContain('Role \\| description')
  expect(topics[0]!.warnings.join()).toContain('Bad image')
  expect(topics[0]!.images[0]!.tableMarkdown).toMatch(/Portrait.*License unconfirmed/)
  for (const group of topics.slice(1, 3)) {
    const [images, sources] = group.markdown.split('\n\n')
    const tokens = [...images!.matchAll(/#dsh-layout=(\w+)&group=([\w-]+)/g)]
    expect(tokens).toHaveLength(group.images.length)
    expect(new Set(tokens.map((match) => match[2])).size).toBe(1)
    expect(tokens[0]![1]).toBe(group.layout)
    expect(sources!.match(/License unconfirmed/g)).toHaveLength(group.images.length)
    expect(group.tableMarkdown).not.toContain('#dsh-layout')
  }
  expect(topics[3]!.markdown).not.toContain('#dsh-layout')
  expect(f.read.mock.calls.filter(([url]) => url.includes('image.so.com'))).toHaveLength(7)
})

it('skips bad and duplicate candidates across groups and calls while reserving one search for a strip', async () => {
  const f = fixture({ maxSearchesPerTurn: 2, maxImagesPerTurn: 4 }, galleryReader)
  const current = scope()
  const first = await f.service.prepare(current, [topic('a')], signal())
  const {
    topics: [strip],
  } = await f.service.prepare(
    current,
    [{ topic: 'Angles', layout: 'strip', query: 'broken,copy,b,c,d,extra', alt: 'Other views' }],
    signal(),
  )
  expect(strip!.images.map(({ title }) => title)).toEqual(['b', 'c', 'd'])
  expect(
    strip!.images.some(
      ({ attachmentId }) => attachmentId === first.topics[0]!.images[0]!.attachmentId,
    ),
  ).toBe(false)
  expect(strip!.warnings.join()).toMatch(/Bad image.*duplicate/i)
  expect(f.read.mock.calls.some(([url]) => url.endsWith('/extra.png'))).toBe(false)
  await expect(f.service.search(current, 'extra', signal())).rejects.toMatchObject({
    code: 'REPLY_IMAGES_BUDGET_EXCEEDED',
  })
})

it.each([
  ['collage', 'a,copy,b', 'strip', 2],
  ['collage', 'a,copy', 'single', 1],
  ['strip', 'a', 'single', 1],
] as const)(
  'downgrades %s with candidates %s to %s',
  async (layout, query, expectedLayout, count) => {
    const {
      topics: [result],
    } = await fixture({}, galleryReader).service.prepare(
      scope(),
      [{ topic: 'Views', layout, query, alt: 'View' }],
      signal(),
    )
    expect(result).toMatchObject({ layout: expectedLayout })
    expect(result!.images).toHaveLength(count)
    expect(result!.markdown.includes('#dsh-layout=strip')).toBe(count === 2)
    expect(result!.warnings.join()).toContain(`Prepared ${count} of 3`)
  },
)

it('keeps Desktop paths unchanged and attributes every image in a group', async () => {
  const {
    topics: [result],
  } = await fixture(
    {},
    galleryReader,
    (ref) => `C:/Images/${ref.attachmentId.slice(7)}.png`,
  ).service.prepare(
    scope(),
    [{ topic: 'Views', layout: 'collage', query: 'a,b,c', alt: 'View' }],
    signal(),
  )
  expect(result!.markdown.match(/<C:\/Images\//g)).toHaveLength(3)
  expect(result!.markdown).not.toContain('#dsh-layout')
  expect(result!.markdown.match(/License unconfirmed/g)).toHaveLength(3)
})
