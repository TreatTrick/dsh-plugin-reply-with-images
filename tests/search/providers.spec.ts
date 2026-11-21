import { describe, expect, it } from 'vitest'
import { parseSearchResponse } from '../../src/search/providers.js'
import { imageUrl, sourceUrl } from '../../src/search/urls.js'

describe('search response parsing', () => {
  it('ignores malformed 360 records and gives empty titles an accessible label', () => {
    expect(
      parseSearchResponse(
        'so360',
        JSON.stringify({
          list: [
            null,
            {},
            { title: '', thumb: 'https://p2.ssl.qhimgs1.com/t.jpg', link: 'https://example.com/a' },
            {
              title: 'Unsafe',
              thumb: 'https://p2.ssl.qhimgs1.com/t.jpg',
              link: 'javascript:alert(1)',
            },
          ],
        }),
      ),
    ).toMatchObject([{ title: 'Image' }])
  })

  it('filters malformed Bing metadata and fills missing titles from link text', () => {
    const metadata = JSON.stringify({
      turl: 'https://tse1.mm.bing.net/th?id=one',
      purl: 'https://example.com/panda',
    })
    expect(
      parseSearchResponse(
        'bing',
        `<a class="iusc"></a><a class="iusc" m="{}"></a><a class="iusc" m='${metadata}'>Panda</a>`,
      ),
    ).toMatchObject([{ title: 'Panda' }])
  })

  it('handles Commons responses without results, images, or license metadata', () => {
    expect(parseSearchResponse('wikimedia', '{}')).toEqual([])
    expect(
      parseSearchResponse(
        'wikimedia',
        JSON.stringify({ query: { pages: { '1': { title: 'File:Empty' } } } }),
      ),
    ).toEqual([])
    expect(
      parseSearchResponse(
        'wikimedia',
        JSON.stringify({
          query: {
            pages: {
              '1': {
                title: 'File:Panda.jpg',
                imageinfo: [
                  {
                    thumburl: 'https://upload.wikimedia.org/panda.jpg',
                    descriptionurl: 'https://commons.wikimedia.org/wiki/File:Panda.jpg',
                  },
                ],
              },
            },
          },
        }),
      ),
    ).toEqual([expect.objectContaining({ license: 'unknown' })])
  })

  it('accepts Baidu thumbnails and redirect-source fields while filtering invalid record types', () => {
    expect(
      parseSearchResponse(
        'baidu',
        JSON.stringify({
          data: [
            null,
            { middleURL: 4 },
            {
              thumbURL: 'https://img1.baidu.com/a',
              fromJumpUrl: 'https://example.com/a',
              fromPageTitle: 'Fallback title',
            },
            { thumbURL: 'https://img1.baidu.com/b', fromURL: 'https://example.com/b' },
          ],
        }),
      ),
    ).toMatchObject([{ title: 'Fallback title' }, { title: 'Image' }])
  })
  it('selects downloadable Baidu thumbnails and preserves their sources', () => {
    const results = parseSearchResponse(
      'baidu',
      JSON.stringify({
        data: [
          {
            middleURL: 'https://img1.baidu.com/it/u=1',
            fromPageTitleEnc: 'Panda',
            fromURLHost: 'example.com',
            fromURL: 'https://example.com/panda',
            width: 640,
            height: 480,
          },
          { middleURL: 'javascript:alert(1)' },
          {},
        ],
      }),
    )
    expect(results).toMatchObject([
      {
        provider: 'baidu',
        title: 'Panda',
        imageUrl: 'https://img1.baidu.com/it/u=1',
        sourceUrl: 'https://example.com/panda',
        license: 'unknown',
      },
    ])
  })

  it('decodes Baidu source pages without inventing a homepage when the real source is missing', () => {
    const results = parseSearchResponse(
      'baidu',
      JSON.stringify({
        data: [
          {
            middleURL: 'https://img1.baidu.com/it/u=1',
            fromPageTitleEnc: 'Panda',
            fromURL: 'ippr_z2C$qAzdH3FAzdH3Fkwt3twiw5_z&e3Bkwt17_z&e3Bv54AzdH3Ff?t1=8',
          },
          { middleURL: 'https://img1.baidu.com/it/u=2', fromURLHost: 'example.com' },
        ],
      }),
    )
    expect(results).toHaveLength(1)
    expect(results[0]?.sourceUrl).toBe('http://baijiahao.baidu.com/s?id=1')
  })

  it('parses 360 candidates and rejects original-image sites as download sources', () => {
    expect(
      parseSearchResponse(
        'so360',
        JSON.stringify({
          list: [
            {
              title: '<b>Lotus</b>',
              thumb: 'https://p2.ssl.qhimgs1.com/t.jpg',
              link: 'https://example.com/lotus',
              img: 'http://127.0.0.1/private',
            },
          ],
        }),
      ),
    ).toMatchObject([
      {
        title: 'Lotus',
        imageUrl: 'https://p2.ssl.qhimgs1.com/t.jpg',
        sourceUrl: 'https://example.com/lotus',
      },
    ])
  })

  it('parses Bing HTML entities and optional Commons licenses', () => {
    expect(
      parseSearchResponse(
        'bing',
        '<a class="iusc" m="{&quot;turl&quot;:&quot;https://tse1.mm.bing.net/th?id=one&quot;,&quot;purl&quot;:&quot;https://example.com/panda&quot;,&quot;t&quot;:&quot;Panda&quot;}"></a>',
      ),
    ).toMatchObject([{ provider: 'bing', title: 'Panda' }])
    expect(
      parseSearchResponse(
        'wikimedia',
        JSON.stringify({
          query: {
            pages: {
              '1': {
                title: 'File:Panda.jpg',
                imageinfo: [
                  {
                    thumburl: 'https://upload.wikimedia.org/panda.jpg',
                    descriptionurl: 'https://commons.wikimedia.org/wiki/File:Panda.jpg',
                    extmetadata: {
                      LicenseShortName: { value: 'CC BY-SA 4.0' },
                      Artist: { value: '<a>Photographer</a>' },
                    },
                  },
                ],
              },
            },
          },
        }),
      ),
    ).toMatchObject([{ license: 'CC BY-SA 4.0', author: 'Photographer' }])
  })

  it('accepts current Wikimedia thumbnail hosts and keeps their license metadata', () => {
    expect(
      parseSearchResponse(
        'wikimedia',
        JSON.stringify({
          query: {
            pages: {
              '1': {
                title: 'File:Maine Coon.jpg',
                imageinfo: [
                  {
                    thumburl:
                      'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/b/cat.jpg/960px-cat.jpg',
                    descriptionurl: 'https://commons.wikimedia.org/wiki/File:Maine_Coon.jpg',
                    extmetadata: {
                      LicenseShortName: { value: 'CC BY-SA 4.0' },
                      LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0' },
                      Artist: { value: '<a>Photographer</a>' },
                    },
                  },
                ],
              },
            },
          },
        }),
      ),
    ).toMatchObject([
      {
        title: 'Maine Coon.jpg',
        imageUrl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/b/cat.jpg/960px-cat.jpg',
        license: 'CC BY-SA 4.0',
        licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
        author: 'Photographer',
      },
    ])
  })

  it('ignores unrelated numeric Commons metadata without dropping a licensed image', () => {
    expect(
      parseSearchResponse(
        'wikimedia',
        JSON.stringify({
          query: {
            pages: {
              '1': {
                title: 'File:Maine Coon.jpg',
                imageinfo: [
                  {
                    thumburl: 'https://upload.wikimedia.org/cat.jpg',
                    descriptionurl: 'https://commons.wikimedia.org/wiki/File:Maine_Coon.jpg',
                    extmetadata: {
                      CommonsMetadataExtension: { value: 1.2 },
                      LicenseShortName: { value: 'Public domain' },
                    },
                  },
                ],
              },
            },
          },
        }),
      ),
    ).toMatchObject([{ license: 'Public domain' }])
  })

  it('rejects malformed responses and filters unsafe image URLs', () => {
    expect(() => parseSearchResponse('baidu', '{broken')).toThrow()
    expect(() => parseSearchResponse('so360', '{}')).toThrow()
    for (const value of [
      'file:///secret',
      'http://127.0.0.1/a',
      'https://localhost/a',
      'https://user:pass@img1.baidu.com/a',
      'https://img1.baidu.com.evil.org/a',
      'https://img1.baidu.com:888/a',
    ]) {
      expect(imageUrl(value, 'baidu')).toBeUndefined()
    }
    expect(sourceUrl('http://[::1]/private')).toBeUndefined()
    expect(parseSearchResponse('bing', '<html>CAPTCHA</html>')).toEqual([])
  })
})

it.each(['<html>blocked</html>', '{}', '{"antiFlag":1,"data":[]}', '{"errno":4,"data":[]}'])(
  'reports a single-line Baidu response error for %s',
  (body) => {
    expect(() => parseSearchResponse('baidu', body)).toThrow(/^Baidu: [^\n]+$/)
  },
)

it('uses only allowlisted Baidu fallback thumbnails, including hoverURL and replaceUrl', () => {
  const fromURL = 'https://example.com/story'
  const hoverURL = 'https://img1.baidu.com/hover.png'
  const replacement = 'https://img2.baidu.com/replacement.png'
  const data = [
    { fromURL, middleURL: 'https://example.com/pixel', hoverURL },
    { fromURL, replaceUrl: [{ ObjURL: 'https://example.com/original', ObjUrl: replacement }] },
    { fromURL, hoverURL: 'https://example.com/pixel' },
    {},
  ]
  expect(parseSearchResponse('baidu', JSON.stringify({ data })).map((row) => row.imageUrl)).toEqual(
    [hoverURL, replacement],
  )
  expect(
    parseSearchResponse(
      'baidu',
      JSON.stringify({ status: 200, code: '200', antiFlag: 0, errno: 0, data }),
    ).map((row) => row.imageUrl),
  ).toEqual([hoverURL, replacement])
})
