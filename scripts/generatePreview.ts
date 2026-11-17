import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import { resolveConfig } from '../src/config.js'
import { ReplyImages } from '../src/replyImages.js'

const root = new URL('../', import.meta.url)
const previewHome = fileURLToPath(new URL('.preview/attachments', root))
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (letter) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[letter]!,
  )
const examples = [
  {
    query: '荷花',
    title: '荷花：先看叶片有没有离开水面',
    text: '荷花的成熟叶片和花朵常常挺出水面。辨认时先看整体生长姿态，再结合叶片和莲蓬判断，通常比只看花色更可靠。',
  },
  {
    query: '睡莲',
    title: '睡莲：叶片通常浮在水面',
    text: '睡莲的叶片通常贴着水面展开，叶缘可见通向叶柄的缺口。两者都能开出粉色或白色的花，因此颜色适合作为辅助线索。',
  },
]
const ctx = new Context()
await mkdir(previewHome, { recursive: true })
await ctx.plugin(LocalAttachmentStore, { dshHome: previewHome })
const dataUrls = new Map<string, string>()
const service = new ReplyImages(
  resolveConfig({
    allowFakeIpDns: process.argv.includes('--allow-fake-ip-dns'),
    maxCandidates: 4,
  }),
  {
    baseUrl: () => 'https://preview.invalid',
    attachments: {
      saveImage: async (input) => {
        const ref = await ctx.attachments.saveImage(input)
        const saved = await ctx.attachments.readImage(ref)
        dataUrls.set(
          ref.attachmentId,
          `data:${saved.ref.mediaType};base64,${Buffer.from(saved.data).toString('base64')}`,
        )
        return ref
      },
    },
  },
)

try {
  const sections: string[] = []
  const evidence: unknown[] = []
  for (const [index, example] of examples.entries()) {
    const scope = { owner: {}, turn: 1 }
    const found = await service.search(scope, example.query, new AbortController().signal)
    if (!found.images[0]) throw new Error(`${example.query}: ${found.warnings.join('; ')}`)
    const result = await service.embed(
      scope,
      [{ candidateId: found.images[0].candidateId }],
      new AbortController().signal,
    )
    const image = result.images[0]
    if (!image) throw new Error(result.warnings.join('; '))
    const dataUrl = dataUrls.get(image.attachmentId)
    if (!dataUrl) throw new Error('预览附件未读取')
    sections.push(
      `<section class="answer-section"><h2>${index + 1}. ${escapeHtml(example.title)}</h2><p>${escapeHtml(example.text)}</p><figure><button class="image-open" aria-label="放大${escapeHtml(example.query)}图片"><img src="${dataUrl}" alt="搜索结果：${escapeHtml(image.title)}" decoding="async" /></button><figcaption>图片来源：<a href="${escapeHtml(image.sourceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(new URL(image.sourceUrl).hostname)}</a><span> · ${image.license === 'unknown' ? '许可未确认' : escapeHtml(image.license)}</span></figcaption></figure></section>`,
    )
    evidence.push({ query: example.query, candidate: found.images[0], result })
  }
  const template = await readFile(new URL('scripts/preview.template.html', root), 'utf8')
  const html = template
    .replace('{{CONTENT}}', sections.join('\n'))
    .replace('{{GENERATED_AT}}', new Date().toISOString())
  await writeFile(new URL('preview.html', root), html)
  await writeFile(new URL('.preview/evidence.json', root), `${JSON.stringify(evidence, null, 2)}\n`)
  process.stdout.write(
    '已生成 preview.html：使用真实搜图、官方附件保存和读取的图片；诊断保存在 .preview/evidence.json\n',
  )
} finally {
  await service.dispose()
  await ctx.fiber.dispose()
}
