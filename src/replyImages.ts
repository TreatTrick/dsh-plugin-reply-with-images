import type { AttachmentStore, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import { ToolArgsError } from '@deepseek-ai/dsh-tools'
import { CandidateStore, ReplyImagesError, type ReplyScope } from './candidates.js'
import type { ResolvedConfig } from './config.js'
import { readHttp, type HttpRead } from './http.js'
import { mediaUrl } from './media.js'
import { plainText } from './search/providers.js'
import { searchImages } from './search/search.js'
import { imageUrl } from './search/urls.js'

/** 存储及网络是核心流程唯一的外部依赖。 */
export interface ReplyImagesDependencies {
  attachments: Pick<AttachmentStore, 'saveImage'>
  baseUrl: () => string
  read?: HttpRead
}
export interface ImageSelection {
  candidateId: string
  alt?: string
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
const escapeText = (value: string): string => plainText(value).replace(/[\\`*_{}\[\]<>~!]/g, '\\$&')

/** 搜索、候选预算及图片保存；关闭时取消网络并等待已开始的写入结束。 */
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
      throw new ReplyImagesError('配图插件已卸载。', 'REPLY_IMAGES_CLOSED')
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

  /** 按有限次数搜图，候选只对当前 Agent 的当前轮次有效。 */
  search(scope: ReplyScope, query: string, signal: AbortSignal) {
    return this.run(signal, async (abort) => {
      const trimmed = query.trim()
      if (!trimmed || trimmed.length > 200) throw new ToolArgsError(['搜索词需要 1–200 个字符。'])
      this.candidates.reserveSearch(scope, this.config.maxSearchesPerTurn)
      const found = await searchImages(trimmed, {
        config: this.config,
        read: this.read,
        signal: abort,
      })
      abort.throwIfAborted()
      return {
        images: this.candidates
          .add(scope, found.images)
          .map(({ imageUrl: _download, ...candidate }) => candidate),
        warnings: found.warnings,
      }
    })
  }

  /** 先预留全部图片预算，再按顺序下载和保存；逐张失败通过 warnings 返回。 */
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
      const baseUrl = this.dependencies.baseUrl()
      for (let index = 0; index < chosen.length; index += 1) {
        const candidate = chosen[index]!
        abort.throwIfAborted()
        try {
          const downloaded = await this.read(candidate.imageUrl, abort, {
            maxBytes: this.config.maxImageBytes,
            timeoutMs: this.config.requestTimeoutMs,
            allowFakeIpDns: this.config.allowFakeIpDns,
            allowUrl: (value) => imageUrl(value, candidate.provider) !== undefined,
          })
          abort.throwIfAborted()
          const mediaType = mediaTypeOf(downloaded.contentType, downloaded.data)
          if (mediaType === undefined) throw new Error('不是支持的图片格式')
          const ref = await this.dependencies.attachments.saveImage({
            data: downloaded.data,
            mediaType,
            name: `${candidate.title.slice(0, 80)}.${mediaType.slice(6)}`,
          })
          abort.throwIfAborted()
          const title = escapeText(selections[index]?.alt?.trim() || candidate.title)
          const licenseText =
            candidate.license === 'unknown' ? '许可未确认' : escapeText(candidate.license)
          const license = candidate.licenseUrl
            ? `[${licenseText}](<${candidate.licenseUrl}>)`
            : licenseText
          const author = candidate.author ? ` · ${escapeText(candidate.author)}` : ''
          const markdown = `![${title}](<${mediaUrl(baseUrl, ref)}>)\n\n*图片来源：[${new URL(candidate.sourceUrl).hostname}](<${candidate.sourceUrl}>)${author} · ${license}*`
          images.push({
            title: candidate.title,
            markdown,
            sourceUrl: candidate.sourceUrl,
            license: candidate.license,
            attachmentId: ref.attachmentId,
          })
        } catch (error) {
          abort.throwIfAborted()
          if (error instanceof Error && error.name === 'AbortError') throw error
          warnings.push(
            `${candidate.title}: 图片下载或保存失败（${error instanceof Error ? error.message.slice(0, 120) : '未知错误'}）`,
          )
        }
      }
      return { markdown: images.map((row) => row.markdown).join('\n\n'), images, warnings }
    })
  }

  /** Agent 销毁时移除候选，附件仍由 Harness 持久化。 */
  clear(owner: object): void {
    this.candidates.clear(owner)
  }

  /** 拒绝新操作，取消网络，并等待附件写入结束。 */
  async dispose(): Promise<void> {
    this.shutdown.abort(new ReplyImagesError('配图插件已卸载。', 'REPLY_IMAGES_CLOSED'))
    await Promise.allSettled(this.operations)
  }
}
