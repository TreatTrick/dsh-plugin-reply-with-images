import { expect, it } from 'vitest'
import { Config, resolveConfig } from '../src/config.js'

it('defaults to Bing first and retains bounded image and network budgets', () => {
  const config = resolveConfig()
  expect(config.providers).toEqual(['bing', 'so360', 'baidu', 'wikimedia'])
  expect(config.maxImagesPerTurn).toBe(12)
  expect(config.maxSearchesPerTurn).toBe(8)
  expect(config.maxCandidates).toBe(10)
  expect(config).toMatchObject({ debugLog: true, debugLogPath: '' })
  expect(resolveConfig(Config({ debugLog: false, debugLogPath: './diag.jsonl' }))).toMatchObject({
    debugLog: false,
    debugLogPath: './diag.jsonl',
  })
  expect(config.allowFakeIpDns).toBe(true)
  expect(resolveConfig(Config({ allowFakeIpDns: false })).allowFakeIpDns).toBe(false)
  expect(resolveConfig(Config({}))).toEqual(config)
})

it('accepts each legal maximum through both configuration entry points', () => {
  const limits = { maxImagesPerTurn: 20, maxSearchesPerTurn: 16, maxCandidates: 20 }
  expect(resolveConfig(limits)).toMatchObject(limits)
  expect(resolveConfig(Config(limits))).toMatchObject(limits)
})

it.each([
  { providers: [] },
  { providers: ['baidu', 'baidu'] },
  { providers: ['unknown'] },
  { maxImagesPerTurn: 0 },
  { maxImagesPerTurn: 21 },
  { maxSearchesPerTurn: 17 },
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
