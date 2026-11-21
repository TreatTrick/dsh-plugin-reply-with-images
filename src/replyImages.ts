import { randomUUID } from 'node:crypto'
import type {
  AttachmentStore,
  ImageAttachmentRef,
  ImageMediaType,
} from '@deepseek-ai/dsh-attachment'
import { ToolArgsError } from '@deepseek-ai/dsh-tools'
import { CandidateStore, ReplyImagesError, type ReplyScope } from './candidates.js'
import type { ResolvedConfig } from './config.js'
import { readHttp, type HttpRead } from './http.js'
import { mediaUrl } from './media.js'
import { plainText } from './search/providers.js'
import { searchImages } from './search/search.js'
import type { SearchImage } from './search/types.js'
import { imageUrl } from './search/urls.js'

/** Storage and network access are the only external dependencies of the core workflow. */
export interface ReplyImagesDependencies {
  attachments: Pick<AttachmentStore, 'saveImage'>
  baseUrl: () => string
  /** Use a compatible Markdown image destination when the client has a dedicated authentication channel. */
  imageDestination?: (ref: ImageAttachmentRef) => string
  read?: HttpRead
}
export interface ImageSelection {
  candidateId: string
  alt?: string
}
export const imageLayouts = ['single', 'table', 'collage', 'strip'] as const
export type ImageLayout = (typeof imageLayouts)[number]
export interface ImageTopicItem {
  query: string
  alt: string
  caption?: string
}
export interface ImageTopic {
  topic: string
  layout?: ImageLayout
  query?: string
  alt?: string
  count?: number
  items?: readonly ImageTopicItem[]
}
export interface PreparedImageTopic {
  topic: string
  layout: ImageLayout
  placement: string
  markdown: string
  tableMarkdown: string
  images: (EmbeddedImage & { tableMarkdown: string })[]
  warnings: string[]
}
export interface EmbeddedImage {
  title: string
  markdown: string
  sourceUrl: string
  license: string
  attachmentId: string
}
export interface EmbedResult {
  markdown: string
  images: EmbeddedImage[]
  warnings: string[]
}

const mediaTypeOf = (type: string, data: Uint8Array): ImageMediaType | undefined => {
  if (
    type === 'image/png' ||
    type === 'image/jpeg' ||
    type === 'image/webp' ||
    type === 'image/gif'
  )
    return type
  const head = Buffer.from(data.slice(0, 12))
  if (head.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png'
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg'
  if (head.subarray(0, 4).toString() === 'RIFF' && head.subarray(8, 12).toString() === 'WEBP')
    return 'image/webp'
  if (head.subarray(0, 6).toString() === 'GIF87a' || head.subarray(0, 6).toString() === 'GIF89a')
    return 'image/gif'
  return undefined
}
const escapeText = (value: string): string =>
  plainText(value).replace(/[\\`*_{}\[\]<>~!|]/g, '\\$&')

const normalizeTopic = (input: ImageTopic) => {
  const topic = input.topic.trim()
  const layout = input.layout ?? 'single'
  if (!topic || topic.length > 120 || !imageLayouts.includes(layout))
    throw new ToolArgsError(['Each topic needs a label (1–120 characters) and a valid layout.'])
  if (input.items !== undefined) {
    if (
      input.items.length < 1 ||
      input.items.length > 5 ||
      input.query !== undefined ||
      input.alt !== undefined ||
      input.count !== undefined
    )
      throw new ToolArgsError(['Use either query/alt/count or 1–5 items, not both.'])
  }
  const count = input.count ?? (layout === 'collage' || layout === 'strip' ? 3 : 1)
  if (!Number.isInteger(count) || count < 1 || count > 5)
    throw new ToolArgsError(['Image count must be an integer from 1 to 5.'])
  const searches = (
    input.items ?? [{ query: input.query, alt: input.alt, caption: undefined }]
  ).map(({ query, alt, caption }) => {
    const trimmedQuery = query?.trim()
    const trimmedAlt = alt?.trim()
    if (
      !trimmedQuery ||
      trimmedQuery.length > 200 ||
      !trimmedAlt ||
      trimmedAlt.length > 160 ||
      (caption?.length ?? 0) > 240
    )
      throw new ToolArgsError([
        'Each search needs a query (1–200 characters) and alt text (1–160); optional captions allow up to 240.',
      ])
    return {
      query: trimmedQuery,
      alt: trimmedAlt,
      caption: caption?.trim(),
      count: input.items ? 1 : count,
    }
  })
  return { topic, layout, searches, count: input.items?.length ?? count }
}

interface SavedImage {
  title: string
  sourceUrl: string
  license: string
  attachmentId: string
  destination: string
  alt: string
  source: string
}

const imageMarkdown = (image: SavedImage, destination = image.destination) =>
  `![${image.alt}](<${destination}>)`

const embedded = (image: SavedImage): EmbeddedImage => ({
  title: image.title,
  sourceUrl: image.sourceUrl,
  license: image.license,
  attachmentId: image.attachmentId,
  markdown: `${imageMarkdown(image)}\n\n*Image source: ${image.source}*`,
})

const tableCell = (text: string) => text.replace(/(?<!\\)\|/g, '\\|').replace(/\s*\n\s*/g, ' ')

const renderTopic = (
  topic: string,
  requested: ImageLayout,
  saved: { image: SavedImage; caption: string | undefined }[],
  warnings: string[],
): PreparedImageTopic => {
  const count = saved.length
  const layout =
    count === 0 || requested === 'table' || requested === 'single'
      ? requested
      : count === 1
        ? 'single'
        : requested === 'collage' && count === 3
          ? 'collage'
          : 'strip'
  const images = saved.map(({ image }) => ({
    ...embedded(image),
    tableMarkdown: tableCell(`${imageMarkdown(image)} *Image source: ${image.source}*`),
  }))
  let markdown = images.map((image) => image.markdown).join('\n\n')
  if (count && layout === 'table') {
    markdown = [
      '| Image | Description | Source and license |',
      '| --- | --- | --- |',
      ...saved.map(
        ({ image, caption }) =>
          `| ${tableCell(imageMarkdown(image))} | ${tableCell(caption ? escapeText(caption) : image.alt)} | ${tableCell(image.source)} |`,
      ),
    ].join('\n')
  } else if (count && (layout === 'collage' || layout === 'strip')) {
    const group = randomUUID()
    const row = saved
      .map(({ image }) => {
        if (!/^https?:\/\//i.test(image.destination)) return imageMarkdown(image)
        const url = new URL(image.destination)
        url.hash = `dsh-layout=${layout}&group=${group}`
        return imageMarkdown(image, url.href)
      })
      .join(' ')
    const sources = saved.map(({ image }, index) => `${index + 1}. ${image.source}`).join(' · ')
    markdown = `${row}\n\n*Image sources: ${sources}*`
  }
  return {
    topic,
    layout,
    placement: count
      ? `Insert this topic's image Markdown immediately after the answer section about "${topic}". Use tableMarkdown only inside a Markdown table cell.`
      : 'No image was prepared for this topic; use its warning and continue without an image.',
    markdown,
    tableMarkdown: images.map((image) => image.tableMarkdown).join(' · '),
    images,
    warnings,
  }
}

/** Search, manage candidate budgets, and save images; cancel network access and drain writes on shutdown. */
export class ReplyImages {
  private readonly candidates = new CandidateStore()
  private readonly shutdown = new AbortController()
  private readonly operations = new Set<Promise<unknown>>()
  private readonly read: HttpRead

  constructor(
    private readonly config: ResolvedConfig,
    private readonly dependencies: ReplyImagesDependencies,
  ) {
    this.read = dependencies.read ?? readHttp
  }

  private async run<T>(
    signal: AbortSignal,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (this.shutdown.signal.aborted)
      throw new ReplyImagesError('The image plugin has been unloaded.', 'REPLY_IMAGES_CLOSED')
    const combined = AbortSignal.any([signal, this.shutdown.signal])
    combined.throwIfAborted()
    const work = operation(combined)
    this.operations.add(work)
    try {
      return await work
    } finally {
      this.operations.delete(work)
    }
  }

  /** Limit searches and keep candidates scoped to the current Agent and turn. */
  search(scope: ReplyScope, query: string, signal: AbortSignal) {
    return this.run(signal, async (abort) => {
      const trimmed = query.trim()
      if (!trimmed || trimmed.length > 200)
        throw new ToolArgsError(['Search queries must contain 1–200 characters.'])
      this.candidates.reserveSearch(scope, this.config.maxSearchesPerTurn)
      const found = await this.findImages(trimmed, abort)
      return {
        images: this.candidates
          .add(scope, found.images)
          .map(({ imageUrl: _download, ...candidate }) => candidate),
        warnings: found.warnings,
      }
    })
  }

  /** 单次准备对应正文主题的 Markdown，并在网络工作前预留全部额度。 */
  prepare(scope: ReplyScope, topics: readonly ImageTopic[], signal: AbortSignal) {
    return this.run(signal, async (abort) => {
      if (topics.length < 1 || topics.length > 5)
        throw new ToolArgsError(['Prepare 1–5 image topics per call.'])
      const normalized = topics.map(normalizeTopic)
      this.candidates.reservePreparation(
        scope,
        normalized.reduce((total, item) => total + item.searches.length, 0),
        normalized.reduce((total, item) => total + item.count, 0),
        this.config.maxSearchesPerTurn,
        this.config.maxImagesPerTurn,
      )
      const prepared: PreparedImageTopic[] = []
      for (const { topic, layout, searches } of normalized) {
        const saved: { image: SavedImage; caption: string | undefined }[] = []
        const warnings: string[] = []
        for (const { query, alt, caption, count } of searches) {
          const found = await this.findImages(query, abort)
          warnings.push(...found.warnings)
          let accepted = 0
          for (const candidate of found.images) {
            const image = await this.saveCandidate(candidate, alt, abort, warnings)
            if (!image) continue
            if (!this.candidates.rememberAttachment(scope, image.attachmentId)) {
              warnings.push(`${candidate.title}: Skipped duplicate image content.`)
              continue
            }
            saved.push({ image, caption })
            if (++accepted === count) break
          }
          if (!accepted) warnings.push(`${query}: No usable image result; continue with text.`)
          else if (accepted < count)
            warnings.push(`${query}: Prepared ${accepted} of ${count} requested images.`)
        }
        prepared.push(renderTopic(topic, layout, saved, warnings))
      }
      return {
        topics: prepared,
        markdown: prepared
          .map((item) => item.markdown)
          .filter(Boolean)
          .join('\n\n'),
        warnings: prepared.flatMap((item) => item.warnings),
      }
    })
  }

  private async findImages(query: string, signal: AbortSignal) {
    const found = await searchImages(query, {
      config: this.config,
      read: this.read,
      signal,
    })
    signal.throwIfAborted()
    return found
  }

  /** Reserve the entire image budget before downloading and saving sequentially; report individual failures as warnings. */
  embed(
    scope: ReplyScope,
    selections: readonly ImageSelection[],
    signal: AbortSignal,
  ): Promise<EmbedResult> {
    return this.run(signal, async (abort) => {
      const chosen = this.candidates.claim(
        scope,
        selections.map((row) => row.candidateId),
        this.config.maxImagesPerTurn,
      )
      const images: EmbeddedImage[] = []
      const warnings: string[] = []
      for (const [index, candidate] of chosen.entries()) {
        const image = await this.saveCandidate(candidate, selections[index]?.alt, abort, warnings)
        if (!image) continue
        this.candidates.rememberAttachment(scope, image.attachmentId)
        images.push(embedded(image))
      }
      return { markdown: images.map((row) => row.markdown).join('\n\n'), images, warnings }
    })
  }

  private async saveCandidate(
    candidate: SearchImage,
    alt: string | undefined,
    signal: AbortSignal,
    warnings: string[],
  ): Promise<SavedImage | undefined> {
    signal.throwIfAborted()
    try {
      const downloaded = await this.read(candidate.imageUrl, signal, {
        maxBytes: this.config.maxImageBytes,
        timeoutMs: this.config.requestTimeoutMs,
        allowFakeIpDns: this.config.allowFakeIpDns,
        allowUrl: (value) => imageUrl(value, candidate.provider) !== undefined,
      })
      signal.throwIfAborted()
      const mediaType = mediaTypeOf(downloaded.contentType, downloaded.data)
      if (mediaType === undefined) throw new Error('Unsupported image format')
      const ref = await this.dependencies.attachments.saveImage({
        data: downloaded.data,
        mediaType,
        name: `${candidate.title.slice(0, 80)}.${mediaType.slice(6)}`,
      })
      signal.throwIfAborted()
      const licenseText =
        candidate.license === 'unknown' ? 'License unconfirmed' : escapeText(candidate.license)
      const license = candidate.licenseUrl
        ? `[${licenseText}](<${candidate.licenseUrl}>)`
        : licenseText
      const author = candidate.author ? ` · ${escapeText(candidate.author)}` : ''
      const destination =
        this.dependencies.imageDestination?.(ref) ?? mediaUrl(this.dependencies.baseUrl(), ref)
      return {
        title: candidate.title,
        alt: escapeText(alt?.trim() || candidate.title),
        destination,
        source: `[${new URL(candidate.sourceUrl).hostname}](<${candidate.sourceUrl}>)${author} · ${license}`,
        sourceUrl: candidate.sourceUrl,
        license: candidate.license,
        attachmentId: ref.attachmentId,
      }
    } catch (error) {
      signal.throwIfAborted()
      if (error instanceof Error && error.name === 'AbortError') throw error
      warnings.push(
        `${candidate.title}: Image download or save failed (${error instanceof Error ? error.message.slice(0, 120) : 'Unknown error'})`,
      )
    }
    return undefined
  }

  /** Remove candidates on Agent disposal while Harness retains persisted attachments. */
  clear(owner: object): void {
    this.candidates.clear(owner)
  }

  /** Reject new operations, cancel network requests, and wait for attachment writes. */
  async dispose(): Promise<void> {
    this.shutdown.abort(
      new ReplyImagesError('The image plugin has been unloaded.', 'REPLY_IMAGES_CLOSED'),
    )
    await Promise.allSettled(this.operations)
  }
}
