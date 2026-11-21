import type { SearchImage } from './types.js'

const NOISE =
  /\b(?:logo|icon|vector|clip[ -]?art|wallpaper|qr[ -]?code|watermark|meme|screenshot)s?\b|图标|矢量|壁纸|二维码|水印|截图/gu
const STOCK_DOMAINS = [
  'dreamstime.com',
  'shutterstock.com',
  'gettyimages.com',
  'gettyimages.cn',
  'alamy.com',
  'istockphoto.com',
  '123rf.com',
  'depositphotos.com',
  'vecteezy.com',
  'stock.adobe.com',
  'vcg.com',
  'veer.com',
  'quanjing.com',
  'pinterest.com',
  'pinterest.jp',
  'clipartmax.com',
  'pngtree.com',
  'cleanpng.com',
  'freepngimg.com',
  'wallpapers.com',
  'wallpaperaccess.com',
  'wallpapercave.com',
]
const ENCYCLOPEDIA_DOMAINS = ['wikipedia.org', 'wikimedia.org', 'britannica.com']
const MEDIA_DOMAINS = [
  'reuters.com',
  'apnews.com',
  'bbc.com',
  'bbc.co.uk',
  'abcnews.go.com',
  'nytimes.com',
  'wsj.com',
  'ft.com',
  'bloomberg.com',
  'cnbc.com',
  'cnn.com',
  'theguardian.com',
  'washingtonpost.com',
  'techcrunch.com',
  'theverge.com',
  'wired.com',
  'arstechnica.com',
  'forbes.com',
  'time.com',
  'nature.com',
  'science.org',
  'nasa.gov',
  'gov.cn',
  'xinhuanet.com',
  'caixin.com',
  '36kr.com',
  'ithome.com',
  'github.com',
]
const SEO_TERMS =
  /\b(?:religion|net\s+worth|biography|bio|height|weight|wife|husband|how\s+old|age(?:\s+and\s+|\s*,\s*)(?:height|weight|bio|wife|husband)|salary|dating|ethnicity|nationality)\b|身高|体重|身价|净资产|宗教信仰/gu
const FARM_LABEL =
  /^(?:religion-info|celebs[\w-]*|famousbirthdays|biographypedia|thefamouspeople)$/u
const COMPOUND_SUFFIX = /^(?:co|com|org|net|gov|ac)\.(?:uk|cn|jp|au|nz|in|kr|za|br)$/u
const matchesDomain = (host: string, domains: readonly string[]) =>
  domains.some((domain) => host === domain || host.endsWith(`.${domain}`))
const HAN = /\p{Script=Han}/u
const segmenter = new Intl.Segmenter('zh', { granularity: 'word' })
const yearsIn = (text: string) =>
  [...text.matchAll(/(?<!\d)(?:19|20)\d{2}(?!\d)/g)].map(([year]) => Number(year))
const wordsIn = (text: string) => text.match(/[\p{Script=Han}]+|[\p{L}\p{N}]+/gu) ?? []
const queryTokens = (text: string): string[] => {
  const tokens: string[] = []
  for (const run of wordsIn(text)) {
    if (!HAN.test(run)) {
      if (!/^(?:19|20)\d{2}$/.test(run)) tokens.push(run)
      continue
    }
    const parts = [...segmenter.segment(run)]
      .filter((part) => part.isWordLike)
      .map((part) => part.segment)
    let singles = ''
    const flushSingles = () => {
      if (singles.length === 1) {
        if (parts.length === 1) tokens.push(singles)
      } else if (singles.length >= 2) {
        for (let i = 0; i < singles.length - 1; i += 1) tokens.push(singles.slice(i, i + 2))
      }
      singles = ''
    }
    for (const part of parts) {
      if (part.length === 1) {
        singles += part
      } else {
        flushSingles()
        tokens.push(part)
      }
    }
    flushSingles()
  }
  return [...new Set(tokens)]
}
const normalize = (text: string) => text.normalize('NFKC').toLowerCase()
const wordPositions = (title: string) => {
  const map = new Map<string, number>()
  for (const match of title.matchAll(/[\p{L}\p{N}]+/gu)) {
    if (match.index !== undefined && !map.has(match[0])) map.set(match[0], match.index)
  }
  return map
}
const hitPosition = (title: string, positions: Map<string, number>, word: string) =>
  HAN.test(word) ? title.indexOf(word) : (positions.get(word) ?? -1)

/** Scores are heuristic. Exact ties preserve provider order and the provider's own ranking. */
export const rankCandidates = (query: string, candidates: readonly SearchImage[]) => {
  const text = normalize(query)
  const years = yearsIn(text)
  const tokens = queryTokens(text)
  const requestedNoise = new Set(text.match(NOISE))
  const requestedSeo = new Set(text.match(SEO_TERMS)?.map((term) => term.replace(/\s+/g, ' ')))
  const officialTokens = new Set(tokens.filter((token) => /^[a-z]{4,}$/.test(token)))
  // Claude 产品图也可能来自其母公司的官网；仍要求匹配主域标签。
  if (officialTokens.has('claude')) officialTokens.add('anthropic')
  return candidates
    .map((image) => {
      const title = normalize(image.title)
      const positions = wordPositions(title)
      const hitIndices = tokens
        .map((word) => hitPosition(title, positions, word))
        .filter((index) => index >= 0)
      const relevance = tokens.length ? (12 * hitIndices.length) / tokens.length : 0
      const titleYears = yearsIn(title)
      const freshness = years.some((year) => titleYears.includes(year))
        ? 5
        : years.length && titleYears.length && Math.max(...titleYears) < Math.min(...years)
          ? -3
          : 0
      const noise =
        -4 * [...new Set(title.match(NOISE))].filter((word) => !requestedNoise.has(word)).length ||
        0
      const prefix = hitIndices.length && Math.min(...hitIndices) > title.length / 2 ? -2 : 0
      const host = URL.canParse(image.sourceUrl)
        ? new URL(image.sourceUrl).hostname.toLowerCase().replace(/\.$/, '')
        : ''
      const labels = host.split('.')
      // 仅匹配主域标签，避免 anthropic.evil.com 或路径中的品牌名获得官网加分。
      const subject = labels.at(COMPOUND_SUFFIX.test(labels.slice(-2).join('.')) ? -3 : -2)
      const authority = Math.max(
        subject && officialTokens.has(subject) ? 5 : 0,
        matchesDomain(host, ENCYCLOPEDIA_DOMAINS) ? 4 : 0,
        matchesDomain(host, MEDIA_DOMAINS) ? 3 : 0,
      )
      const seo =
        [...title.matchAll(SEO_TERMS)].some(
          ([term]) => !requestedSeo.has(term.replace(/\s+/g, ' ')),
        ) ||
        (!requestedSeo.size && labels.some((label) => FARM_LABEL.test(label)))
      const source = authority - (matchesDomain(host, STOCK_DOMAINS) ? 8 : 0) - (seo ? 5 : 0)
      return {
        image,
        score: relevance + freshness + noise + prefix + source,
        scores: { relevance, freshness, noise, prefix, source },
      }
    })
    .sort((a, b) => b.score - a.score)
}
