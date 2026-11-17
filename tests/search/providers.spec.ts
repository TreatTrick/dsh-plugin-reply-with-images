import { describe, expect, it } from 'vitest'
import { parseSearchResponse } from '../../src/search/providers.js'
import { imageUrl, sourceUrl } from '../../src/search/urls.js'

describe('搜索结果解析', () => {
  it('单条损坏记录不影响其他 360 结果，空标题有可访问标签', () => {
    expect(
      parseSearchResponse(
        'so360',
        JSON.stringify({
          list: [
            null,
            {},
            { title: '', thumb: 'https://p2.ssl.qhimgs1.com/t.jpg', link: 'https://example.com/a' },
            {
              title: '不安全',
              thumb: 'https://p2.ssl.qhimgs1.com/t.jpg',
              link: 'javascript:alert(1)',
            },
          ],
        }),
      ),
    ).toMatchObject([{ title: '图片' }])
  })

  it('Bing 过滤损坏元数据并从链接文字补全缺失标题', () => {
    const metadata = JSON.stringify({
      turl: 'https://tse1.mm.bing.net/th?id=one',
      purl: 'https://example.com/panda',
    })
    expect(
      parseSearchResponse(
        'bing',
        `<a class="iusc"></a><a class="iusc" m="{}"></a><a class="iusc" m='${metadata}'>熊猫</a>`,
      ),
    ).toMatchObject([{ title: '熊猫' }])
  })

  it('Commons 无结果、无图片或缺少许可元数据时可正常降级', () => {
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

  it('百度允许缩略图和跳转来源字段，但过滤类型不合法的记录', () => {
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
              fromPageTitle: '备用标题',
            },
            { thumbURL: 'https://img1.baidu.com/b', fromURL: 'https://example.com/b' },
          ],
        }),
      ),
    ).toMatchObject([{ title: '备用标题' }, { title: '图片' }])
  })
  it('从百度结果选取可下载的缩略图并保留来源', () => {
    const results = parseSearchResponse(
      'baidu',
      JSON.stringify({
        data: [
          {
            middleURL: 'https://img1.baidu.com/it/u=1',
            fromPageTitleEnc: '熊猫',
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
        title: '熊猫',
        imageUrl: 'https://img1.baidu.com/it/u=1',
        sourceUrl: 'https://example.com/panda',
        license: 'unknown',
      },
    ])
  })

  it('还原百度来源页，缺少真实来源时不伪造站点首页', () => {
    const results = parseSearchResponse(
      'baidu',
      JSON.stringify({
        data: [
          {
            middleURL: 'https://img1.baidu.com/it/u=1',
            fromPageTitleEnc: '熊猫',
            fromURL: 'ippr_z2C$qAzdH3FAzdH3Fkwt3twiw5_z&e3Bkwt17_z&e3Bv54AzdH3Ff?t1=8',
          },
          { middleURL: 'https://img1.baidu.com/it/u=2', fromURLHost: 'example.com' },
        ],
      }),
    )
    expect(results).toHaveLength(1)
    expect(results[0]?.sourceUrl).toBe('http://baijiahao.baidu.com/s?id=1')
  })

  it('解析 360 的候选并拒绝原图站点作为下载源', () => {
    expect(
      parseSearchResponse(
        'so360',
        JSON.stringify({
          list: [
            {
              title: '<b>荷花</b>',
              thumb: 'https://p2.ssl.qhimgs1.com/t.jpg',
              link: 'https://example.com/lotus',
              img: 'http://127.0.0.1/private',
            },
          ],
        }),
      ),
    ).toMatchObject([
      {
        title: '荷花',
        imageUrl: 'https://p2.ssl.qhimgs1.com/t.jpg',
        sourceUrl: 'https://example.com/lotus',
      },
    ])
  })

  it('解析 Bing 的 HTML 实体和可选 Commons 的许可', () => {
    expect(
      parseSearchResponse(
        'bing',
        '<a class="iusc" m="{&quot;turl&quot;:&quot;https://tse1.mm.bing.net/th?id=one&quot;,&quot;purl&quot;:&quot;https://example.com/panda&quot;,&quot;t&quot;:&quot;熊猫&quot;}"></a>',
      ),
    ).toMatchObject([{ provider: 'bing', title: '熊猫' }])
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
                      Artist: { value: '<a>摄影者</a>' },
                    },
                  },
                ],
              },
            },
          },
        }),
      ),
    ).toMatchObject([{ license: 'CC BY-SA 4.0', author: '摄影者' }])
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

  it('拒绝格式损坏响应并过滤不安全图片地址', () => {
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
    expect(parseSearchResponse('bing', '<html>验证码</html>')).toEqual([])
  })
})
