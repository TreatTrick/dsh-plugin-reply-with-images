import { expect, it } from 'vitest'
import { Config, resolveConfig } from '../src/config.js'

it('defaults to Wikimedia first and retains bounded image and network budgets', () => {
  const config = resolveConfig()
  expect(config.providers).toEqual(['wikimedia', 'baidu', 'so360', 'bing'])
  expect(config.maxImagesPerTurn).toBe(3)
  expect(config.maxSearchesPerTurn).toBe(3)
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
])('rejects invalid configuration at load time: %j', (invalid) => {
  expect(() => resolveConfig(invalid as Parameters<typeof resolveConfig>[0])).toThrow()
})
