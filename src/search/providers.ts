import { load } from 'cheerio'
import { z } from 'zod'
import { imageUrl, sourceUrl } from './urls.js'
import type { Provider, SearchImage } from './types.js'

const baiduItem = z.object({
  middleURL: z.string().optional(),
  thumbURL: z.string().optional(),
  fromPageTitleEnc: z.string().optional(),
  fromPageTitle: z.string().optional(),
  fromURL: z.string().optional(),
  fromURLHost: z.string().optional(),
  fromJumpUrl: z.string().optional(),
})

const BAIDU_CHARACTERS: Record<string, string> = Object.fromEntries(
  [...'wkv1ju2it3hs4g5rq6fp7eo8dn9cm0bla'].map((letter, index) => [
    letter,
    'abcdefghijklmnopqrstuvw1234567890'[index] ?? letter,
  ]),
)
const baiduSource = (value: string): string => {
  if (/^https?:\/\//.test(value)) return value
  return value
    .replace(/_z2C\$q/g, ':')
    .replace(/_z&e3B/g, '.')
    .replace(/AzdH3F/g, '/')
    .replace(/[a-z0-9]/g, (letter) => BAIDU_CHARACTERS[letter] ?? letter)
}
const soItem = z.object({ title: z.string(), thumb: z.string(), link: z.string() })
const bingItem = z.object({ turl: z.string(), purl: z.string(), t: z.string().optional() })
const wikiInfo = z.object({
  thumburl: z.string(),
  descriptionurl: z.string(),
  extmetadata: z
    .object({
      LicenseShortName: z.object({ value: z.string() }).optional(),
      LicenseUrl: z.object({ value: z.string() }).optional(),
      Artist: z.object({ value: z.string() }).optional(),
    })
    .optional(),
})

const candidate = (
  provider: Provider,
  title: string,
  image: string,
  source: string,
  license = 'unknown',
): SearchImage[] => {
  const download = imageUrl(image, provider)
  const citation = sourceUrl(source)
  return download && citation
    ? [
        {
          provider,
          title: plainText(title) || '图片',
          imageUrl: download,
          sourceUrl: citation,
          license: plainText(license),
        },
      ]
    : []
}

/** 外部 HTML 的文字不可作为指令或原样 Markdown 输出。 */
export const plainText = (text: string): string =>
  load(text)
    .text()
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240)

/** 将来源响应解析为可筛选的安全候选；格式变化抛错供搜索层回退。 */
export const parseSearchResponse = (provider: Provider, text: string): SearchImage[] => {
  if (provider === 'so360') {
    const response = z.object({ list: z.array(z.unknown()) }).parse(JSON.parse(text))
    return response.list.flatMap((item) => {
      const parsed = soItem.safeParse(item)
      return parsed.success
        ? candidate(provider, parsed.data.title, parsed.data.thumb, parsed.data.link)
        : []
    })
  }
  if (provider === 'bing') {
    const $ = load(text)
    return $('a.iusc')
      .toArray()
      .flatMap((node) => {
        let raw: unknown
        try {
          raw = JSON.parse($(node).attr('m') ?? '')
        } catch (_invalidMetadata) {
          return []
        }
        const parsed = bingItem.safeParse(raw)
        return parsed.success
          ? candidate(provider, parsed.data.t ?? $(node).text(), parsed.data.turl, parsed.data.purl)
          : []
      })
  }
  if (provider === 'wikimedia') {
    const response = z
      .object({
        query: z
          .object({
            pages: z.record(
              z.string(),
              z.object({ title: z.string(), imageinfo: z.array(z.unknown()).optional() }),
            ),
          })
          .optional(),
      })
      .parse(JSON.parse(text))
    return Object.values(response.query?.pages ?? {}).flatMap((page) => {
      const parsed = wikiInfo.safeParse(page.imageinfo?.[0])
      if (!parsed.success) return []
      const info = parsed.data
      return candidate(
        provider,
        page.title.replace(/^File:/, ''),
        info.thumburl,
        info.descriptionurl,
        info.extmetadata?.LicenseShortName?.value ?? 'unknown',
      ).map((row) => {
        const licenseUrl = sourceUrl(info.extmetadata?.LicenseUrl?.value ?? '')
        return {
          ...row,
          ...(info.extmetadata?.Artist ? { author: plainText(info.extmetadata.Artist.value) } : {}),
          ...(licenseUrl ? { licenseUrl } : {}),
        }
      })
    })
  }
  const response = z.object({ data: z.array(z.unknown()) }).parse(JSON.parse(text))
  return response.data.flatMap((item) => {
    const parsed = baiduItem.safeParse(item)
    if (!parsed.success) return []
    const row = parsed.data
    const image = imageUrl(row.middleURL ?? row.thumbURL ?? '', provider)
    const source = sourceUrl(baiduSource(row.fromURL ?? row.fromJumpUrl ?? ''))
    if (!image || !source) return []
    return [
      {
        provider,
        title: plainText(row.fromPageTitleEnc ?? row.fromPageTitle ?? '图片'),
        imageUrl: image,
        sourceUrl: source,
        license: 'unknown',
      },
    ]
  })
}
