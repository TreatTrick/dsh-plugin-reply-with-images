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
    query: 'lotus',
    title: 'Lotus: look for leaves above the water',
    text: 'Mature lotus leaves and flowers often rise above the water. Start with the overall growth habit, then check the leaves and seed pods; this is usually more reliable than flower color alone.',
  },
  {
    query: 'water lily',
    title: 'Water lily: leaves usually float on the surface',
    text: 'Water-lily leaves usually spread across the surface, with a notch leading toward the leaf stalk. Both plants can have pink or white flowers, so color is only a supporting clue.',
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
      [{ candidateId: found.images[0].candidateId, alt: example.query }],
      new AbortController().signal,
    )
    const image = result.images[0]
    if (!image) throw new Error(result.warnings.join('; '))
    const dataUrl = dataUrls.get(image.attachmentId)
    if (!dataUrl) throw new Error('Preview attachment was not read')
    sections.push(
      `<section class="answer-section"><h2>${index + 1}. ${escapeHtml(example.title)}</h2><p>${escapeHtml(example.text)}</p><figure><button class="image-open" aria-label="Enlarge ${escapeHtml(example.query)} image"><img src="${dataUrl}" alt="Search result: ${escapeHtml(example.query)}" decoding="async" /></button><figcaption>Image source: <a href="${escapeHtml(image.sourceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(new URL(image.sourceUrl).hostname)}</a><span> · ${image.license === 'unknown' ? 'License unconfirmed' : escapeHtml(image.license)}</span></figcaption></figure></section>`,
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
    'Generated preview.html using live image search and the official attachment store; diagnostics saved to .preview/evidence.json\n',
  )
} finally {
  await service.dispose()
  await ctx.fiber.dispose()
}
