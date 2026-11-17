import { expect, it } from 'vitest'
import type { HttpOptions } from '../src/http.js'
import { allowedAddress, readHttp } from '../src/http.js'

const options: HttpOptions = { maxBytes: 1024, timeoutMs: 10, allowUrl: () => false }

it('rejects non-HTTPS URLs, disallowed hosts, and cancellation before connecting', async () => {
  await expect(
    readHttp('http://example.com/a', new AbortController().signal, {
      ...options,
      allowUrl: () => true,
    }),
  ).rejects.toThrow('Unsupported image source URL')
  await expect(
    readHttp('https://example.com/a', new AbortController().signal, options),
  ).rejects.toThrow('Unsupported image source URL')
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
])('always rejects private and special addresses: %s', (address) => {
  expect(allowedAddress(address)).toBe(false)
  expect(allowedAddress(address, true)).toBe(false)
})

it('allows only the specified additional ranges for Fake-IP compatibility', () => {
  for (const address of ['198.18.0.211', '2001:2::c9']) {
    expect(allowedAddress(address)).toBe(false)
    expect(allowedAddress(address, true)).toBe(true)
  }
  expect(allowedAddress('8.8.8.8')).toBe(true)
  expect(allowedAddress('203.0.113.1', true)).toBe(false)
})
