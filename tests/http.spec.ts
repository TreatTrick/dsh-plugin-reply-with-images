import { expect, it } from 'vitest'
import type { HttpOptions } from '../src/http.js'
import { allowedAddress, readHttp } from '../src/http.js'

const options: HttpOptions = { maxBytes: 1024, timeoutMs: 10, allowUrl: () => false }

it('在建立连接前拒绝非 HTTPS、未允许域名和取消信号', async () => {
  await expect(
    readHttp('http://example.com/a', new AbortController().signal, {
      ...options,
      allowUrl: () => true,
    }),
  ).rejects.toThrow('图片来源地址不受支持')
  await expect(
    readHttp('https://example.com/a', new AbortController().signal, options),
  ).rejects.toThrow('图片来源地址不受支持')
  const controller = new AbortController()
  controller.abort()
  await expect(
    readHttp('https://example.com/a', controller.signal, { ...options, allowUrl: () => true }),
  ).rejects.toThrow()
})

it.each([
  '127.0.0.1',
  '10.0.0.1',
  '169.254.169.254',
  '192.168.1.1',
  '::1',
  '::ffff:127.0.0.1',
  'fc00::1',
  '0.0.0.0',
])('始终拒绝内网及特殊地址 %s', (address) => {
  expect(allowedAddress(address)).toBe(false)
  expect(allowedAddress(address, true)).toBe(false)
})

it('Fake-IP 兼容只额外允许限定网段', () => {
  for (const address of ['198.18.0.211', '2001:2::c9']) {
    expect(allowedAddress(address)).toBe(false)
    expect(allowedAddress(address, true)).toBe(true)
  }
  expect(allowedAddress('8.8.8.8')).toBe(true)
  expect(allowedAddress('203.0.113.1', true)).toBe(false)
})
