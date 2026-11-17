import { expect, it, vi } from 'vitest'
import { searchImages } from '../../src/search/search.js'
import { resolveConfig } from '../../src/config.js'
import type { HttpRead } from '../../src/http.js'

it('falls back from Wikimedia and Baidu failures to mainland results without duplicates', async () => {
  const calls: string[] = []
  const read: HttpRead = async (url) => {
    calls.push(url)
    if (url.includes('wikimedia')) throw new Error('Network unavailable')
    if (url.includes('baidu')) throw new Error('限流')
    return {
      data: Buffer.from(
        JSON.stringify({
          list: [
            {
              title: '荷花',
              thumb: 'https://p2.ssl.qhimgs1.com/a.jpg',
              link: 'https://example.com/a',
            },
            {
              title: '重复',
              thumb: 'https://p2.ssl.qhimgs1.com/a.jpg',
              link: 'https://example.com/a',
            },
          ],
        }),
      ),
      contentType: 'application/json',
    }
  }
  const result = await searchImages('荷花', {
    config: resolveConfig({ maxCandidates: 1 }),
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

it('候选去重后不足上限继续搜索，并逐项应用同源网络约束', async () => {
  const visited: string[] = []
  const read: HttpRead = async (url, _signal, options) => {
    visited.push(url)
    expect(options.allowUrl(url)).toBe(true)
    expect(options.allowUrl('https://evil.example/a')).toBe(false)
    if (url.includes('image.so.com'))
      return {
        contentType: 'application/json',
        data: Buffer.from(
          JSON.stringify({
            list: [1, 2].map(() => ({
              title: '荷花',
              thumb: 'https://p2.ssl.qhimgs1.com/a.jpg',
              link: 'https://example.com/a',
            })),
          }),
        ),
      }
    return { contentType: 'text/html', data: Buffer.from('<html>验证码</html>') }
  }
  const result = await searchImages('荷花 & 花', {
    config: resolveConfig({ providers: ['so360', 'bing'] }),
    read,
    signal: new AbortController().signal,
  })
  expect(result.images).toHaveLength(1)
  expect(result.warnings).toEqual([expect.stringContaining('bing')])
  expect(new URL(visited[1]!).searchParams.get('q')).toBe('荷花 & 花')
})

it('Wikimedia 只有显式配置时才请求，取消时不会继续回退', async () => {
  const controller = new AbortController()
  const read = vi.fn<HttpRead>(async (url) => {
    expect(new URL(url).hostname).toBe('commons.wikimedia.org')
    controller.abort(new Error('停止搜索'))
    throw controller.signal.reason
  })
  await expect(
    searchImages('荷花', {
      config: resolveConfig({ providers: ['wikimedia', 'bing'] }),
      read,
      signal: controller.signal,
    }),
  ).rejects.toThrow('停止搜索')
  expect(read).toHaveBeenCalledOnce()
})

it('依赖抛出的 AbortError 保持取消语义，不转换为来源失败', async () => {
  const error = new DOMException('请求被取消', 'AbortError')
  const read = vi.fn<HttpRead>(async () => {
    throw error
  })
  await expect(
    searchImages('荷花', { config: resolveConfig(), read, signal: new AbortController().signal }),
  ).rejects.toBe(error)
  expect(read).toHaveBeenCalledOnce()
})
