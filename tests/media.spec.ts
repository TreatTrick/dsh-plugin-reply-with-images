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

it('从保存的 Markdown URL 重建图片引用，重新创建路由仍可读取', async () => {
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
] as const)('附件后端错误 %s 返回 %s 并禁止缓存', async (code, status) => {
  const resource = createMediaResource({
    readImage: async () => {
      throw new AttachmentError('读取失败', code)
    },
  })
  const response = await resource(new Request(mediaUrl('https://example.com', ref)))
  expect(response.status).toBe(status)
  expect(response.headers.get('cache-control')).toBe('private, no-store')
})

it('附件服务意外故障和取消信号继续传播', async () => {
  const resource = createMediaResource({
    readImage: async () => {
      throw new Error('磁盘故障')
    },
  })
  await expect(resource(new Request(mediaUrl('https://example.com', ref)))).rejects.toThrow(
    '磁盘故障',
  )
  const controller = new AbortController()
  controller.abort(new Error('关闭请求'))
  await expect(
    resource(new Request(mediaUrl('https://example.com', ref), { signal: controller.signal })),
  ).rejects.toThrow('关闭请求')
})

it('拒绝篡改的类型、无效 ID、尺寸和错误方法', async () => {
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
