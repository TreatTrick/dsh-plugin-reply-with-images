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
export interface ImageTopic {
  topic: string
  query: string
  alt: string
}
export interface PreparedImageTopic {
  topic: string
  markdown: string
  tableMarkdown: string
  images: EmbeddedImage[]
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
    return this.run(signal, (abort) => this.searchReserved(scope, query, abort, true))
  }

  /** 单次准备对应正文主题的 Markdown，并在网络工作前预留全部额度。 */
  prepare(scope: ReplyScope, topics: readonly ImageTopic[], signal: AbortSignal) {
    return this.run(signal, async (abort) => {
      if (topics.length < 1 || topics.length > 3)
        throw new ToolArgsError(['Prepare 1–3 image topics per call.'])
      const normalized = topics.map((item) => {
        const topic = item.topic.trim()
        const query = item.query.trim()
        const alt = item.alt.trim()
        if (
          !topic ||
          topic.length > 120 ||
          !query ||
          query.length > 200 ||
          !alt ||
          alt.length > 160
        )
          throw new ToolArgsError([
            'Each topic needs a label (1–120 characters), query (1–200), and alt text (1–160).',
          ])
        return { topic, query, alt }
      })
      this.candidates.reservePreparation(
        scope,
        normalized.length,
        this.config.maxSearchesPerTurn,
        this.config.maxImagesPerTurn,
      )
      const prepared: PreparedImageTopic[] = []
      for (const item of normalized) {
        abort.throwIfAborted()
        const found = await this.searchReserved(scope, item.query, abort, false)
        const candidate = found.images[0]
        if (!candidate) {
          prepared.push({
            topic: item.topic,
            markdown: '',
            tableMarkdown: '',
            images: [],
            warnings: [
              ...found.warnings,
              `${item.topic}: No usable image result; continue with text.`,
            ],
          })
          continue
        }
        const result = await this.embedReserved(
          scope,
          [{ candidateId: candidate.candidateId, alt: item.alt }],
          abort,
          false,
        )
        prepared.push({
          topic: item.topic,
          markdown: result.markdown,
          tableMarkdown: result.markdown.replace(/\n+/g, ' '),
          images: result.images,
          warnings: [...found.warnings, ...result.warnings],
        })
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

  private async searchReserved(
    scope: ReplyScope,
    query: string,
    signal: AbortSignal,
    reserve: boolean,
  ) {
    const trimmed = query.trim()
    if (!trimmed || trimmed.length > 200)
      throw new ToolArgsError(['Search queries must contain 1–200 characters.'])
    if (reserve) this.candidates.reserveSearch(scope, this.config.maxSearchesPerTurn)
    const found = await searchImages(trimmed, {
      config: this.config,
      read: this.read,
      signal,
    })
    signal.throwIfAborted()
    return {
      images: this.candidates
        .add(scope, found.images)
        .map(({ imageUrl: _download, ...candidate }) => candidate),
      warnings: found.warnings,
    }
  }

  /** Reserve the entire image budget before downloading and saving sequentially; report individual failures as warnings. */
  embed(
    scope: ReplyScope,
    selections: readonly ImageSelection[],
    signal: AbortSignal,
  ): Promise<EmbedResult> {
    return this.run(signal, (abort) => this.embedReserved(scope, selections, abort, true))
  }

  private async embedReserved(
    scope: ReplyScope,
    selections: readonly ImageSelection[],
    signal: AbortSignal,
    reserve: boolean,
  ): Promise<EmbedResult> {
    const chosen = reserve
      ? this.candidates.claim(
          scope,
          selections.map((row) => row.candidateId),
          this.config.maxImagesPerTurn,
        )
      : this.candidates.claimPrepared(
          scope,
          selections.map((row) => row.candidateId),
        )
    const images: EmbeddedImage[] = []
    const warnings: string[] = []
    const baseUrl = this.dependencies.baseUrl()
    for (let index = 0; index < chosen.length; index += 1) {
      const candidate = chosen[index]!
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
        const title = escapeText(selections[index]?.alt?.trim() || candidate.title)
        const licenseText =
          candidate.license === 'unknown' ? 'License unconfirmed' : escapeText(candidate.license)
        const license = candidate.licenseUrl
          ? `[${licenseText}](<${candidate.licenseUrl}>)`
          : licenseText
        const author = candidate.author ? ` · ${escapeText(candidate.author)}` : ''
        const destination = this.dependencies.imageDestination?.(ref) ?? mediaUrl(baseUrl, ref)
        const markdown = `![${title}](<${destination}>)\n\n*Image source: [${new URL(candidate.sourceUrl).hostname}](<${candidate.sourceUrl}>)${author} · ${license}*`
        images.push({
          title: candidate.title,
          markdown,
          sourceUrl: candidate.sourceUrl,
          license: candidate.license,
          attachmentId: ref.attachmentId,
        })
      } catch (error) {
        signal.throwIfAborted()
        if (error instanceof Error && error.name === 'AbortError') throw error
        warnings.push(
          `${candidate.title}: Image download or save failed (${error instanceof Error ? error.message.slice(0, 120) : 'Unknown error'})`,
        )
      }
    }
    return { markdown: images.map((row) => row.markdown).join('\n\n'), images, warnings }
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
