import { expect, it } from 'vitest'
import { Config, resolveConfig } from '../src/config.js'

it('默认国内图源、两张图片与有限网络预算，并与 Cordis 配置一致', () => {
  const config = resolveConfig()
  expect(config.providers).toEqual(['baidu', 'so360', 'bing'])
  expect(config.maxImagesPerTurn).toBe(2)
  expect(config.allowFakeIpDns).toBe(false)
  expect(resolveConfig(Config({}))).toEqual(config)
})

it.each([
  { providers: [] },
  { providers: ['baidu', 'baidu'] },
  { providers: ['unknown'] },
  { maxImagesPerTurn: 0 },
  { maxImagesPerTurn: 9 },
  { maxSearchesPerTurn: 1.5 },
  { requestTimeoutMs: -1 },
  { maxImageBytes: 0 },
  { maxCandidates: 21 },
  { publicBaseUrl: 'file:///tmp' },
  { publicBaseUrl: 'https://user:password@example.com' },
  { publicBaseUrl: 'https://example.com?token=secret' },
])('加载时拒绝无效配置 %j', (invalid) => {
  expect(() => resolveConfig(invalid as Parameters<typeof resolveConfig>[0])).toThrow()
})
