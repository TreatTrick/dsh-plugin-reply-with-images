import { expect, it, vi } from 'vitest'
import { AttachmentId, AttachmentError, type ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { createMediaResource, mediaUrl } from '../src/media.js'

const ref: ImageAttachmentRef = {
  attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`),
  mediaType: 'image/png',
  bytes: 3,
  width: 2,
  height: 1,
}

it('reconstructs image references from saved Markdown URLs and reads them through a recreated route', async () => {
  const readImage = vi.fn(async (value: ImageAttachmentRef) => ({
    ref: value,
    data: Uint8Array.of(1, 2, 3),
  }))
  const url = mediaUrl('https://harness.example/app', ref)
  expect(url).toContain('https://harness.example/app/api/reply-images?')
  const resource = createMediaResource({ readImage })
  const response = await resource(new Request(url))
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toBe('image/png')
  expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3])
  expect(readImage.mock.calls[0]?.[0]).toEqual(ref)
  const head = await createMediaResource({ readImage })(new Request(url, { method: 'HEAD' }))
  expect(await head.text()).toBe('')
})

it.each([
  ['ATTACHMENT_NOT_FOUND', 404],
  ['ATTACHMENT_READ_FAILED', 409],
] as const)(
  'returns attachment backend error %s as HTTP %s and disables caching',
  async (code, status) => {
    const resource = createMediaResource({
      readImage: async () => {
        throw new AttachmentError('Read failed', code)
      },
    })
    const response = await resource(new Request(mediaUrl('https://example.com', ref)))
    expect(response.status).toBe(status)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  },
)

it('propagates unexpected attachment failures and cancellation', async () => {
  const resource = createMediaResource({
    readImage: async () => {
      throw new Error('Disk failure')
    },
  })
  await expect(resource(new Request(mediaUrl('https://example.com', ref)))).rejects.toThrow(
    'Disk failure',
  )
  const controller = new AbortController()
  controller.abort(new Error('Request closed'))
  await expect(
    resource(new Request(mediaUrl('https://example.com', ref), { signal: controller.signal })),
  ).rejects.toThrow('Request closed')
})

it('rejects tampered types, invalid IDs, dimensions, and incorrect methods', async () => {
  const readImage = vi.fn()
  const resource = createMediaResource({ readImage })
  for (const query of [
    'id=../../secret',
    'id=sha256:bad',
    `id=sha256:${'a'.repeat(64)}&type=text/html&bytes=3&width=2&height=1`,
  ]) {
    expect(
      (await resource(new Request(`https://example.com/api/reply-images?${query}`))).status,
    ).toBe(400)
  }
  expect(
    (await resource(new Request(mediaUrl('https://example.com', ref), { method: 'POST' }))).status,
  ).toBe(405)
  expect(readImage).not.toHaveBeenCalled()
})
