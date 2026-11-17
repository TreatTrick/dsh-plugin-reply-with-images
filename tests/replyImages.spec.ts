import { beforeEach, expect, it, vi } from 'vitest'
import { AttachmentId, type AttachmentStore } from '@deepseek-ai/dsh-attachment'
import { resolveConfig } from '../src/config.js'
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
              title: `荷花 ${id}`,
              thumb: `https://p2.ssl.qhimgs1.com/${id}.jpg`,
              link: 'https://example.com/lotus',
            })),
          }),
        ),
      }
    : { contentType: 'image/png', data: imageBytes }
const setup = (reader = read) =>
  new ReplyImages(resolveConfig({ providers: ['so360'] }), {
    read: reader,
    attachments: { saveImage },
    baseUrl: () => 'https://harness.example',
  })
const signal = () => new AbortController().signal
beforeEach(() => {
  saveImage.mockClear()
})

it('搜图、保存和正文 Markdown 保持来源信息并阻止第三张图片', async () => {
  const service = setup()
  const found = await service.search(scope, '荷花', signal())
  const result = await service.embed(
    scope,
    found.images.slice(0, 2).map((row) => ({ candidateId: row.candidateId })),
    signal(),
  )
  expect(result.images).toHaveLength(2)
  expect(result.markdown).toContain('https://harness.example/api/reply-images?')
  expect(result.markdown).toContain('example.com')
  expect(result.markdown).toContain('许可未确认')
  await expect(
    service.embed(scope, [{ candidateId: found.images[2]!.candidateId }], signal()),
  ).rejects.toMatchObject({ code: 'REPLY_IMAGES_BUDGET_EXCEEDED' })
})

it('部分下载失败保留成功图片，全部失败返回文字降级诊断', async () => {
  const service = setup(async (url, abort, options) => {
    if (url.includes('/1.jpg')) throw new Error('图片失效')
    return read(url, abort, options)
  })
  const found = await service.search(scope, '荷花', signal())
  const result = await service.embed(scope, found.images.slice(0, 2), signal())
  expect(result.images).toHaveLength(1)
  expect(result.warnings).toHaveLength(1)
  const unavailable = setup(async (url, abort, options) =>
    url.includes('image.so.com')
      ? read(url, abort, options)
      : Promise.reject(new Error('下载失败')),
  )
  const candidates = await unavailable.search(scope, '荷花', signal())
  expect(await unavailable.embed(scope, candidates.images.slice(0, 1), signal())).toMatchObject({
    images: [],
    markdown: '',
    warnings: [expect.stringContaining('下载失败')],
  })
})

it('取消继续传播，不产生文字降级或新附件写入', async () => {
  const service = setup()
  const found = await service.search(scope, '荷花', signal())
  const controller = new AbortController()
  controller.abort(new Error('用户停止'))
  const count = saveImage.mock.calls.length
  await expect(service.embed(scope, found.images.slice(0, 1), controller.signal)).rejects.toThrow(
    '用户停止',
  )
  expect(saveImage.mock.calls).toHaveLength(count)
})

it.each(['', '   ', '字'.repeat(201)])('无效搜索词在访问网络前被拒绝：%s', async (query) => {
  const reader = vi.fn<HttpRead>(read)
  await expect(setup(reader).search(scope, query, signal())).rejects.toMatchObject({
    code: 'INVALID_ARGS',
  })
  expect(reader).not.toHaveBeenCalled()
})

it.each([
  ['PNG', '89504e470d0a1a0a', 'image/png'],
  ['JPEG', 'ffd8ffe000104a464946', 'image/jpeg'],
  ['WebP', '524946460000000057454250', 'image/webp'],
  ['GIF87a', '474946383761', 'image/gif'],
  ['GIF89a', '474946383961', 'image/gif'],
])(
  '缺少正确 Content-Type 时从 %s 文件头推断格式并交给附件服务校验',
  async (_name, hex, mediaType) => {
    const service = setup(async (url, abort, options) =>
      url.includes('image.so.com')
        ? read(url, abort, options)
        : { contentType: 'application/octet-stream', data: Buffer.from(hex, 'hex') },
    )
    const found = await service.search(scope, '荷花', signal())
    expect((await service.embed(scope, found.images.slice(0, 1), signal())).images).toHaveLength(1)
    expect(saveImage).toHaveBeenCalledWith(expect.objectContaining({ mediaType }))
  },
)

it('验证码 HTML 不能作为图片保存，失败候选不能重复下载', async () => {
  const service = setup(async (url, abort, options) =>
    url.includes('image.so.com')
      ? read(url, abort, options)
      : { contentType: 'text/html', data: Buffer.from('<html>captcha</html>') },
  )
  const found = await service.search(scope, '荷花', signal())
  const selected = found.images.slice(0, 1)
  expect(await service.embed(scope, selected, signal())).toMatchObject({
    images: [],
    markdown: '',
    warnings: [expect.stringContaining('格式')],
  })
  expect(saveImage).not.toHaveBeenCalled()
  await expect(service.embed(scope, selected, signal())).rejects.toMatchObject({
    code: 'REPLY_IMAGES_CANDIDATE_INVALID',
  })
})

it('许可、作者和自定义替代文本被保留，Markdown 元字符不会创建新图片', async () => {
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
                            Artist: { value: '<b>摄影者</b>' },
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
  const found = await service.search(scope, '荷花', signal())
  const result = await service.embed(
    scope,
    [{ candidateId: found.images[0]!.candidateId, alt: '<b>荷花</b> [示例] !' }],
    signal(),
  )
  expect(result.markdown).toContain('![荷花 \\[示例\\] \\!]')
  expect(result.markdown).toContain(
    '摄影者 · [CC BY-SA 4.0](<https://creativecommons.org/licenses/by-sa/4.0/>)',
  )
  expect(found.images[0]).not.toHaveProperty('imageUrl')
})

it('并发展示先占用预算，不会重复下载同一个候选', async () => {
  let release = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const reader = vi.fn<HttpRead>(async (url, abort, options) => {
    if (!url.includes('image.so.com')) await gate
    return read(url, abort, options)
  })
  const service = setup(reader)
  const found = await service.search(scope, '荷花', signal())
  const selected = found.images.slice(0, 1)
  const first = service.embed(scope, selected, signal())
  await expect(service.embed(scope, selected, signal())).rejects.toMatchObject({
    code: 'REPLY_IMAGES_CANDIDATE_INVALID',
  })
  release()
  expect((await first).images).toHaveLength(1)
  expect(reader).toHaveBeenCalledTimes(2)
})

it('卸载取消进行中的搜索并拒绝后续操作', async () => {
  const service = setup(
    async (_url, abort) =>
      new Promise((_resolve, reject) => {
        abort.addEventListener('abort', () => reject(abort.reason), { once: true })
      }),
  )
  const pending = service.search(scope, '荷花', signal())
  const rejected = expect(pending).rejects.toMatchObject({ code: 'REPLY_IMAGES_CLOSED' })
  await service.dispose()
  await rejected
  await expect(service.search(scope, '荷花', signal())).rejects.toMatchObject({
    code: 'REPLY_IMAGES_CLOSED',
  })
})

it('卸载等待已经开始的附件写入结束，取消后不会发布 Markdown', async () => {
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
  const found = await service.search(scope, '荷花', signal())
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

it('清理 Agent 后旧候选不能继续展示', async () => {
  const service = setup()
  const found = await service.search(scope, '荷花', signal())
  service.clear(scope.owner)
  await expect(service.embed(scope, found.images.slice(0, 1), signal())).rejects.toMatchObject({
    code: 'REPLY_IMAGES_CANDIDATE_INVALID',
  })
})

it('附件后端抛出的 AbortError 继续传播，不作为普通图片失败', async () => {
  const error = new DOMException('保存被取消', 'AbortError')
  const service = new ReplyImages(resolveConfig({ providers: ['so360'] }), {
    read,
    baseUrl: () => '',
    attachments: {
      saveImage: async () => {
        throw error
      },
    },
  })
  const found = await service.search(scope, '荷花', signal())
  await expect(service.embed(scope, found.images.slice(0, 1), signal())).rejects.toBe(error)
})

it('非 Error 异常被界定为安全的未知失败诊断', async () => {
  const service = new ReplyImages(resolveConfig({ providers: ['so360'] }), {
    read: async (url, abort, options) =>
      url.includes('image.so.com') ? read(url, abort, options) : Promise.reject('敏感上游响应'),
    baseUrl: () => '',
    attachments: { saveImage },
  })
  const found = await service.search(scope, '荷花', signal())
  const result = await service.embed(scope, found.images.slice(0, 1), signal())
  expect(result.warnings).toEqual([expect.stringContaining('未知错误')])
  expect(result.warnings.join()).not.toContain('敏感上游响应')
})
