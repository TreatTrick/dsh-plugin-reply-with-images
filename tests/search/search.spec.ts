import { expect, it, vi } from 'vitest'
import { searchImages } from '../../src/search/search.js'
import { resolveConfig } from '../../src/config.js'
import type { HttpRead } from '../../src/http.js'

it('falls back from Wikimedia and Baidu failures to mainland results without duplicates', async () => {
  const calls: string[] = []
  const read: HttpRead = async (url) => {
    calls.push(url)
    if (url.includes('wikimedia')) throw new Error('Network unavailable')
    if (url.includes('baidu')) throw new Error('Rate limited')
    return {
      data: Buffer.from(
        JSON.stringify({
          list: [
            {
              title: 'Lotus',
              thumb: 'https://p2.ssl.qhimgs1.com/a.jpg',
              link: 'https://example.com/a',
            },
            {
              title: 'Duplicate',
              thumb: 'https://p2.ssl.qhimgs1.com/a.jpg',
              link: 'https://example.com/a',
            },
          ],
        }),
      ),
      contentType: 'application/json',
    }
  }
  const result = await searchImages('Lotus', {
    config: resolveConfig({ providers: ['wikimedia', 'baidu', 'so360', 'bing'], maxCandidates: 1 }),
    read,
    signal: new AbortController().signal,
  })
  expect(result.images).toHaveLength(1)
  expect(result.warnings).toEqual([
    expect.stringContaining('wikimedia'),
    expect.stringContaining('baidu'),
  ])
  expect(calls).toHaveLength(3)
  expect(new URL(calls[0]!).hostname).toBe('commons.wikimedia.org')
})

it('continues searching below the deduplicated candidate limit and applies provider-specific network constraints', async () => {
  const visited: string[] = []
  const read: HttpRead = async (url, _signal, options) => {
    visited.push(url)
    expect(options.allowUrl(url)).toBe(true)
    expect(options.allowUrl('https://evil.example/a')).toBe(false)
    if (url.includes('www.bing.com'))
      expect(options.allowUrl('https://cn.bing.com/images/search?q=Lotus')).toBe(true)
    else expect(options.allowUrl('https://cn.bing.com/images/search?q=Lotus')).toBe(false)
    if (url.includes('image.so.com'))
      return {
        contentType: 'application/json',
        data: Buffer.from(
          JSON.stringify({
            list: [1, 2].map(() => ({
              title: 'Lotus',
              thumb: 'https://p2.ssl.qhimgs1.com/a.jpg',
              link: 'https://example.com/a',
            })),
          }),
        ),
      }
    return { contentType: 'text/html', data: Buffer.from('<html>CAPTCHA</html>') }
  }
  const result = await searchImages('Lotus & flower', {
    config: resolveConfig({ providers: ['so360', 'bing'] }),
    read,
    signal: new AbortController().signal,
  })
  expect(result.images).toHaveLength(1)
  expect(result.warnings).toEqual([expect.stringContaining('bing')])
  expect(new URL(visited[1]!).searchParams.get('q')).toBe('Lotus & flower')
})

it('queries Wikimedia only when configured and stops fallback on cancellation', async () => {
  const controller = new AbortController()
  const read = vi.fn<HttpRead>(async (url) => {
    expect(new URL(url).hostname).toBe('commons.wikimedia.org')
    controller.abort(new Error('Search stopped'))
    throw controller.signal.reason
  })
  await expect(
    searchImages('Lotus', {
      config: resolveConfig({ providers: ['wikimedia', 'bing'] }),
      read,
      signal: controller.signal,
    }),
  ).rejects.toThrow('Search stopped')
  expect(read).toHaveBeenCalledOnce()
})

it('preserves cancellation when a dependency throws AbortError instead of treating it as provider failure', async () => {
  const error = new DOMException('Request canceled', 'AbortError')
  const read = vi.fn<HttpRead>(async () => {
    throw error
  })
  await expect(
    searchImages('Lotus', { config: resolveConfig(), read, signal: new AbortController().signal }),
  ).rejects.toBe(error)
  expect(read).toHaveBeenCalledOnce()
})

it('ranks every candidate from the queried provider before truncating and logs top scores', async () => {
  const trace = vi.fn()
  const read: HttpRead = async () => ({
    contentType: 'application/json',
    data: Buffer.from(
      JSON.stringify({
        list: ['Lotus icon', 'Lotus garden'].map((title, i) => ({
          title,
          thumb: `https://p2.ssl.qhimgs1.com/${i}.jpg`,
          link: 'https://example.com/story',
        })),
      }),
    ),
  })
  const result = await searchImages('Lotus garden', {
    config: resolveConfig({ providers: ['so360'], maxCandidates: 1 }),
    signal: new AbortController().signal,
    read,
    trace,
  })
  expect(result.images[0]?.title).toBe('Lotus garden')
  expect(trace).toHaveBeenCalledWith(
    'search.provider',
    expect.objectContaining({ provider: 'so360', count: 2, elapsedMs: expect.any(Number) }),
  )
  expect(trace).toHaveBeenCalledWith(
    'search.ranked',
    expect.objectContaining({
      top: [
        expect.objectContaining({
          title: 'Lotus garden',
          score: expect.any(Number),
          scores: expect.objectContaining({ source: 0 }),
        }),
        expect.any(Object),
      ],
    }),
  )
})
