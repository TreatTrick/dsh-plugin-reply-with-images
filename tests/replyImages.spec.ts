import { beforeEach, expect, it, vi } from 'vitest'
import { AttachmentId, type AttachmentStore } from '@deepseek-ai/dsh-attachment'
import { resolveConfig } from '../src/config.js'
import type { Config } from '../src/config.js'
import { ReplyImages } from '../src/replyImages.js'
import type { HttpRead } from '../src/http.js'

const scope = { owner: {}, turn: 1 }
const imageBytes = Buffer.from('89504e470d0a1a0a', 'hex')
const saveImage = vi.fn<AttachmentStore['saveImage']>(async () => ({
  attachmentId: AttachmentId(`sha256:${'c'.repeat(64)}`),
  bytes: 8,
  width: 2,
  height: 1,
  mediaType: 'image/png',
}))
const read: HttpRead = async (url) =>
  url.includes('image.so.com')
    ? {
        contentType: 'application/json',
        data: Buffer.from(
          JSON.stringify({
            list: [1, 2, 3].map((id) => ({
              title: `Lotus ${id}`,
              thumb: `https://p2.ssl.qhimgs1.com/${id}.jpg`,
              link: 'https://example.com/lotus',
            })),
          }),
        ),
      }
    : { contentType: 'image/png', data: imageBytes }
const setup = (reader = read, config: Config = {}) =>
  new ReplyImages(resolveConfig({ providers: ['so360'], ...config }), {
    read: reader,
    attachments: { saveImage },
    baseUrl: () => 'https://harness.example',
  })
const signal = () => new AbortController().signal
beforeEach(() => {
  saveImage.mockClear()
})

it('preserves attribution through search, saving, and inline Markdown while blocking a third image', async () => {
  const service = setup(read, { maxImagesPerTurn: 2 })
  const found = await service.search(scope, 'Lotus', signal())
  const result = await service.embed(
    scope,
    found.images.slice(0, 2).map((row) => ({ candidateId: row.candidateId })),
    signal(),
  )
  expect(result.images).toHaveLength(2)
  expect(result.markdown).toContain('https://harness.example/api/reply-images?')
  expect(result.markdown).toContain('example.com')
  expect(result.markdown).toContain('License unconfirmed')
  await expect(
    service.embed(scope, [{ candidateId: found.images[2]!.candidateId }], signal()),
  ).rejects.toMatchObject({ code: 'REPLY_IMAGES_BUDGET_EXCEEDED' })
})

it('keeps successful images after partial failure and returns text-fallback diagnostics when all fail', async () => {
  const service = setup(async (url, abort, options) => {
    if (url.includes('/1.jpg')) throw new Error('Image unavailable')
    return read(url, abort, options)
  })
  const found = await service.search(scope, 'Lotus', signal())
  const result = await service.embed(scope, found.images.slice(0, 2), signal())
  expect(result.images).toHaveLength(1)
  expect(result.warnings).toHaveLength(1)
  const unavailable = setup(async (url, abort, options) =>
    url.includes('image.so.com')
      ? read(url, abort, options)
      : Promise.reject(new Error('Download failed')),
  )
  const candidates = await unavailable.search(scope, 'Lotus', signal())
  expect(await unavailable.embed(scope, candidates.images.slice(0, 1), signal())).toMatchObject({
    images: [],
    markdown: '',
    warnings: [expect.stringContaining('Download failed')],
  })
})

it('propagates cancellation without text fallback or new attachment writes', async () => {
  const service = setup()
  const found = await service.search(scope, 'Lotus', signal())
  const controller = new AbortController()
  controller.abort(new Error('Stopped by user'))
  const count = saveImage.mock.calls.length
  await expect(service.embed(scope, found.images.slice(0, 1), controller.signal)).rejects.toThrow(
    'Stopped by user',
  )
  expect(saveImage.mock.calls).toHaveLength(count)
})

it.each(['', '   ', 'x'.repeat(201)])(
  'rejects invalid search queries before network access: %s',
  async (query) => {
    const reader = vi.fn<HttpRead>(read)
    await expect(setup(reader).search(scope, query, signal())).rejects.toMatchObject({
      code: 'INVALID_ARGS',
    })
    expect(reader).not.toHaveBeenCalled()
  },
)

it.each([
  ['PNG', '89504e470d0a1a0a', 'image/png'],
  ['JPEG', 'ffd8ffe000104a464946', 'image/jpeg'],
  ['WebP', '524946460000000057454250', 'image/webp'],
  ['GIF87a', '474946383761', 'image/gif'],
  ['GIF89a', '474946383961', 'image/gif'],
])(
  'infers format from %s signatures when Content-Type is missing or wrong, then validates through attachments',
  async (_name, hex, mediaType) => {
    const service = setup(async (url, abort, options) =>
      url.includes('image.so.com')
        ? read(url, abort, options)
        : { contentType: 'application/octet-stream', data: Buffer.from(hex, 'hex') },
    )
    const found = await service.search(scope, 'Lotus', signal())
    expect((await service.embed(scope, found.images.slice(0, 1), signal())).images).toHaveLength(1)
    expect(saveImage).toHaveBeenCalledWith(expect.objectContaining({ mediaType }))
  },
)

it('rejects CAPTCHA HTML as an image and prevents repeated downloads of failed candidates', async () => {
  const service = setup(async (url, abort, options) =>
    url.includes('image.so.com')
      ? read(url, abort, options)
      : { contentType: 'text/html', data: Buffer.from('<html>captcha</html>') },
  )
  const found = await service.search(scope, 'Lotus', signal())
  const selected = found.images.slice(0, 1)
  expect(await service.embed(scope, selected, signal())).toMatchObject({
    images: [],
    markdown: '',
    warnings: [expect.stringContaining('format')],
  })
  expect(saveImage).not.toHaveBeenCalled()
  await expect(service.embed(scope, selected, signal())).rejects.toMatchObject({
    code: 'REPLY_IMAGES_CANDIDATE_INVALID',
  })
})

it('preserves licenses, authors, and custom alt text without letting Markdown metacharacters create images', async () => {
  const service = new ReplyImages(resolveConfig({ providers: ['wikimedia'] }), {
    attachments: { saveImage },
    baseUrl: () => 'https://harness.example/',
    read: async (url, _abort, options) => {
      expect(options.allowUrl(url)).toBe(true)
      expect(options.allowUrl('https://evil.example/image.png')).toBe(false)
      return url.includes('commons.wikimedia.org')
        ? {
            contentType: 'application/json',
            data: Buffer.from(
              JSON.stringify({
                query: {
                  pages: {
                    '1': {
                      title: 'File:Lotus.jpg',
                      imageinfo: [
                        {
                          thumburl: 'https://upload.wikimedia.org/lotus.jpg',
                          descriptionurl: 'https://commons.wikimedia.org/wiki/File:Lotus.jpg',
                          extmetadata: {
                            Artist: { value: '<b>Photographer</b>' },
                            LicenseShortName: { value: 'CC BY-SA 4.0' },
                            LicenseUrl: {
                              value: 'https://creativecommons.org/licenses/by-sa/4.0/',
                            },
                          },
                        },
                      ],
                    },
                  },
                },
              }),
            ),
          }
        : { contentType: 'image/png', data: imageBytes }
    },
  })
  const found = await service.search(scope, 'Lotus', signal())
  const result = await service.embed(
    scope,
    [{ candidateId: found.images[0]!.candidateId, alt: '<b>Lotus</b> [Example] !' }],
    signal(),
  )
  expect(result.markdown).toContain('![Lotus \\[Example\\] \\!]')
  expect(result.markdown).toContain(
    'Photographer · [CC BY-SA 4.0](<https://creativecommons.org/licenses/by-sa/4.0/>)',
  )
  expect(found.images[0]).not.toHaveProperty('imageUrl')
})

it('reserves budgets before concurrent embedding and avoids duplicate candidate downloads', async () => {
  let release = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const reader = vi.fn<HttpRead>(async (url, abort, options) => {
    if (!url.includes('image.so.com')) await gate
    return read(url, abort, options)
  })
  const service = setup(reader)
  const found = await service.search(scope, 'Lotus', signal())
  const selected = found.images.slice(0, 1)
  const first = service.embed(scope, selected, signal())
  await expect(service.embed(scope, selected, signal())).rejects.toMatchObject({
    code: 'REPLY_IMAGES_CANDIDATE_INVALID',
  })
  release()
  expect((await first).images).toHaveLength(1)
  expect(reader).toHaveBeenCalledTimes(2)
})

it('cancels active searches on unload and rejects subsequent operations', async () => {
  const service = setup(
    async (_url, abort) =>
      new Promise((_resolve, reject) => {
        abort.addEventListener('abort', () => reject(abort.reason), { once: true })
      }),
  )
  const pending = service.search(scope, 'Lotus', signal())
  const rejected = expect(pending).rejects.toMatchObject({ code: 'REPLY_IMAGES_CLOSED' })
  await service.dispose()
  await rejected
  await expect(service.search(scope, 'Lotus', signal())).rejects.toMatchObject({
    code: 'REPLY_IMAGES_CLOSED',
  })
})

it('drains attachment writes on unload and does not publish Markdown after cancellation', async () => {
  let release = () => {}
  let started = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const saving = new Promise<void>((resolve) => {
    started = resolve
  })
  const service = new ReplyImages(resolveConfig({ providers: ['so360'] }), {
    read,
    baseUrl: () => '',
    attachments: {
      saveImage: async (input) => {
        started()
        await gate
        return saveImage(input)
      },
    },
  })
  const found = await service.search(scope, 'Lotus', signal())
  const pending = service.embed(scope, found.images.slice(0, 1), signal())
  const rejected = expect(pending).rejects.toMatchObject({ code: 'REPLY_IMAGES_CLOSED' })
  await saving
  let disposed = false
  const closing = service.dispose().then(() => {
    disposed = true
  })
  await Promise.resolve()
  expect(disposed).toBe(false)
  release()
  await closing
  await rejected
  expect(saveImage).toHaveBeenCalledOnce()
})

it('prevents embedding old candidates after Agent cleanup', async () => {
  const service = setup()
  const found = await service.search(scope, 'Lotus', signal())
  service.clear(scope.owner)
  await expect(service.embed(scope, found.images.slice(0, 1), signal())).rejects.toMatchObject({
    code: 'REPLY_IMAGES_CANDIDATE_INVALID',
  })
})

it('propagates attachment backend AbortError instead of treating it as an ordinary image failure', async () => {
  const error = new DOMException('Save canceled', 'AbortError')
  const service = new ReplyImages(resolveConfig({ providers: ['so360'] }), {
    read,
    baseUrl: () => '',
    attachments: {
      saveImage: async () => {
        throw error
      },
    },
  })
  const found = await service.search(scope, 'Lotus', signal())
  await expect(service.embed(scope, found.images.slice(0, 1), signal())).rejects.toBe(error)
})

it('bounds non-Error exceptions to a safe unknown-error diagnostic', async () => {
  const service = new ReplyImages(resolveConfig({ providers: ['so360'] }), {
    read: async (url, abort, options) =>
      url.includes('image.so.com')
        ? read(url, abort, options)
        : Promise.reject('Sensitive upstream response'),
    baseUrl: () => '',
    attachments: { saveImage },
  })
  const found = await service.search(scope, 'Lotus', signal())
  const result = await service.embed(scope, found.images.slice(0, 1), signal())
  expect(result.warnings).toEqual([expect.stringContaining('Unknown error')])
  expect(result.warnings.join()).not.toContain('Sensitive upstream response')
})
