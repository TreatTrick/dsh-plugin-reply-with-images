import { expect, it } from 'vitest'
import { rankCandidates } from '../../src/search/rank.js'
import type { SearchImage } from '../../src/search/types.js'

const candidates = (titles: string[]): SearchImage[] =>
  titles.map((title, i) => ({
    title,
    provider: 'bing',
    imageUrl: `https://tse1.mm.bing.net/${i}`,
    sourceUrl: 'https://example.com/',
    license: 'unknown',
  }))

it('ranks current subject photographs above old images and decorative results', () => {
  const titles = [
    '2026 Jensen Huang logo',
    '2024 Jensen Huang',
    '2026 Jensen Huang keynote',
    'Unrelated 2026',
  ]
  const ranked = rankCandidates('Jensen Huang 2026', candidates(titles))
  expect(ranked[0]?.image.title).toBe(titles[2])
  expect(ranked.find((row) => row.image.title === titles[0])?.scores.noise).toBeLessThan(0)
})

it('matches unspaced Chinese titles, respects requested noise words, and preserves ties', () => {
  expect(
    rankCandidates('杭州西湖 2026', candidates(['杭州会展', '杭州西湖2026晨景']))[0]?.image.title,
  ).toBe('杭州西湖2026晨景')
  const ranked = rankCandidates('Lotus logo', candidates(['Lotus logo A', 'Lotus logo B']))
  expect(ranked.map(({ image, scores }) => [image.title, scores.noise])).toEqual([
    ['Lotus logo A', 0],
    ['Lotus logo B', 0],
  ])
  expect(
    rankCandidates('??????????', candidates(['a', 'b'])).map((row) => row.image.title),
  ).toEqual(['a', 'b'])
})

it('segments unspaced Chinese queries, handles single Han characters, and checks word boundaries for prefix penalty', () => {
  const zh = rankCandidates(
    '黄仁勋英伟达总部',
    candidates(['黄山风景', '英伟达创始人黄仁勋参观圣克拉拉总部']),
  )
  expect(zh[0]?.image.title).toBe('英伟达创始人黄仁勋参观圣克拉拉总部')
  expect(zh[0]?.scores.relevance).toBeGreaterThan(zh[1]?.scores.relevance ?? 0)
  expect(rankCandidates('猫', candidates(['风景', '橘猫']))[0]?.image.title).toBe('橘猫')
  const boundary = rankCandidates('ai', candidates(['A very long train history of AI']))
  expect(boundary[0]?.scores.prefix).toBe(-2)
})

const fromSources = (rows: [string, string][]): SearchImage[] =>
  candidates(rows.map(([title]) => title)).map((image, i) => ({
    ...image,
    sourceUrl: rows[i]![1],
  }))

it('ranks Wikipedia ahead of watermarked stock images and includes source in the total', () => {
  const ranked = rankCandidates(
    'Anthropic logo',
    fromSources([
      ['Anthropic logo', 'https://www.dreamstime.com/anthropic-logo'],
      ['Anthropic logo', 'https://zh.wikipedia.org/wiki/Anthropic'],
    ]),
  )
  expect(ranked.map(({ image }) => new URL(image.sourceUrl).hostname)).toEqual([
    'zh.wikipedia.org',
    'www.dreamstime.com',
  ])
  expect(ranked.map(({ scores }) => scores)).toMatchObject([{ source: 4 }, { source: -8 }])
  for (const { score, scores } of ranked)
    expect(score).toBe(Object.values(scores).reduce((sum, value) => sum + value, 0))
})

it('ranks ABC News portraits above SEO gossip farms', () => {
  const ranked = rankCandidates(
    'Dario Amodei',
    fromSources([
      ['Dario Amodei Religion: Jewish Heritage', 'https://religion-info.com/dario-amodei'],
      ['Dario Amodei interview', 'https://abcnews.go.com/Technology/dario-amodei'],
    ]),
  )
  expect(ranked.map(({ scores }) => scores)).toMatchObject([{ source: 3 }, { source: -5 }])
  expect(ranked[0]?.image.sourceUrl).toContain('abcnews.go.com')
})

it.each([
  ['Anthropic headquarters', 'https://news.anthropic.com/company'],
  ['Nvidia keynote', 'https://www.nvidia.com/events'],
  ['Claude Code interface', 'https://claude.com/product'],
  ['Claude Code interface', 'https://www.anthropic.com/claude'],
  ['Example headquarters', 'https://example.co.uk/about'],
])('boosts exact subject domains for %s', (query, sourceUrl) => {
  const ranked = rankCandidates(
    query,
    fromSources([
      [query, sourceUrl],
      [query, 'https://blog.test/'],
    ]),
  )
  expect(ranked.map(({ scores }) => scores)).toMatchObject([{ source: 5 }, { source: 0 }])
})

it.each([
  'https://anthropic.com.evil.test/',
  'https://anthropic.evil.test/',
  'https://notanthropic.com/',
  'https://evil.test/anthropic.com',
  'https://evil.test/?source=https://anthropic.com',
  'https://wikipedia.org.evil.test/',
  'https://notdreamstime.com/',
  'not a URL',
])('does not confuse lookalike hosts or URL text with source domains: %s', (sourceUrl) => {
  expect(
    rankCandidates('Anthropic logo', fromSources([['Anthropic logo', sourceUrl]]))[0]?.scores,
  ).toMatchObject({ source: 0 })
})

it.each([
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
])('downranks stock and aggregation hosts including subdomains: %s', (domain) => {
  expect(
    rankCandidates(
      'Dario Amodei',
      fromSources([['Dario Amodei', `https://www.${domain.toUpperCase()}./photo`]]),
    )[0]?.scores,
  ).toMatchObject({ source: -8 })
})

it.each([
  'religion',
  'net worth',
  'biography',
  'bio',
  'height',
  'weight',
  'wife',
  'husband',
  'how old',
  'age and height',
  'age, weight',
  'age and bio',
  'age, wife',
  'age and husband',
  'salary',
  'dating',
  'ethnicity',
  'nationality',
  '身高',
  '体重',
  '身价',
  '净资产',
  '宗教信仰',
])('only penalizes unrequested SEO title terms: %s', (term) => {
  const rows = fromSources([[`Dario Amodei ${term}`, 'https://example.test/person']])
  expect(rankCandidates('Dario Amodei', rows)[0]?.scores).toMatchObject({ source: -5 })
  expect(rankCandidates(`Dario Amodei ${term}`, rows)[0]?.scores).toMatchObject({ source: 0 })
})

it.each([
  "Entering the Age of AI: Anthropic's Dario Amodei",
  'Golden Age of AI',
  'Dario Amodei on the age of artificial intelligence',
  'The Bronze Age: a history of technology',
])('preserves the authority bonus for ordinary age-related reporting: %s', (title) => {
  expect(
    rankCandidates('Dario Amodei', fromSources([[title, 'https://www.reuters.com/technology']]))[0]
      ?.scores,
  ).toMatchObject({ source: 3 })
})

it.each(['religion-info', 'celebsdaily', 'famousbirthdays', 'biographypedia', 'thefamouspeople'])(
  'penalizes farm domains unless the query requests biographical details: %s',
  (label) => {
    const rows = fromSources([['Dario Amodei', `https://www.${label}.com/profile`]])
    expect(rankCandidates('Dario Amodei', rows)[0]?.scores).toMatchObject({ source: -5 })
    expect(rankCandidates('Dario Amodei biography', rows)[0]?.scores).toMatchObject({ source: 0 })
  },
)

it('combines independent source penalties and never matches SEO substrings within words', () => {
  expect(
    rankCandidates(
      'Dario Amodei',
      fromSources([['Dario Amodei net worth', 'https://dreamstime.com/person']]),
    )[0]?.scores,
  ).toMatchObject({ source: -13 })
  expect(
    rankCandidates(
      'Dario Amodei height',
      fromSources([['Dario Amodei height and net worth', 'https://example.test/']]),
    )[0]?.scores,
  ).toMatchObject({ source: -5 })
  expect(
    rankCandidates(
      'Lotus',
      fromSources([['Lotus image in a biosphere', 'https://example.test/']]),
    )[0]?.scores,
  ).toMatchObject({ source: 0 })
})

it.each([
  ['https://commons.wikimedia.org/photo', 4],
  ['https://britannica.com/topic', 4],
  ['https://www.reuters.com/world', 3],
  ['https://www.bbc.co.uk/news', 3],
  ['https://techcrunch.com/story', 3],
  ['https://www.gov.cn/news', 3],
])('boosts trusted sources: %s', (sourceUrl, source) => {
  expect(rankCandidates('Lotus', fromSources([['Lotus', sourceUrl]]))[0]?.scores).toMatchObject({
    source,
  })
})
