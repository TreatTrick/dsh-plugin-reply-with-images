import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, expect, it, vi } from 'vitest'
import { readHttp, type HttpOptions } from '../src/http.js'

const mocks = vi.hoisted(() => ({ get: vi.fn(), lookup: vi.fn() }))
vi.mock('node:https', () => ({ get: mocks.get }))
vi.mock('node:dns', () => ({ lookup: mocks.lookup }))
afterEach(() => {
  vi.useRealTimers()
  vi.resetAllMocks()
})

class RequestStub extends EventEmitter {
  destroy(error?: Error): this {
    queueMicrotask(() => {
      if (error) this.emit('error', error)
      this.emit('close')
    })
    return this
  }
}
interface DnsAddress {
  address: string
  family: number
}
interface RequestOptions {
  signal: AbortSignal
  lookup: (
    host: string,
    options: { all: boolean },
    callback: (error: Error | null, result?: DnsAddress[] | string, family?: number) => void,
  ) => void
}
const options: HttpOptions = {
  maxBytes: 4,
  timeoutMs: 100,
  allowUrl: (url) => url.startsWith('https://img1.baidu.com/'),
}
const response = (statusCode = 200, headers: Record<string, string> = {}) =>
  Object.assign(new PassThrough(), { statusCode, headers })
const mount = (
  answer: (res: ReturnType<typeof response>) => void,
  status = 200,
  headers: Record<string, string> = {},
) => {
  const request = new RequestStub()
  mocks.get.mockImplementation(
    (
      _url: string,
      _options: RequestOptions,
      callback: (res: ReturnType<typeof response>) => void,
    ) => {
      queueMicrotask(() => {
        const res = response(status, headers)
        res.once('close', () => request.emit('close'))
        callback(res)
        answer(res)
      })
      return request
    },
  )
  return request
}

it('limits streamed bytes and preserves media types without parameters', async () => {
  mount(
    (res) => {
      res.write(Buffer.from([1, 2]))
      res.end(Buffer.from([3]))
    },
    200,
    { 'content-type': 'image/png; charset=binary' },
  )
  const result = await readHttp('https://img1.baidu.com/a', new AbortController().signal, options)
  expect([...result.data]).toEqual([1, 2, 3])
  expect(result.contentType).toBe('image/png')
})

it.each([true, false])('rejects excessive declared or streamed response sizes: %s', (declared) => {
  mount((res) => res.end(Buffer.alloc(5)), 200, declared ? { 'content-length': '5' } : {})
  return expect(
    readHttp('https://img1.baidu.com/a', new AbortController().signal, options),
  ).rejects.toThrow('size limit')
})

it('preserves response errors and rejects non-200 upstream responses as images', async () => {
  mount((res) => res.end(), 403)
  await expect(
    readHttp('https://img1.baidu.com/a', new AbortController().signal, options),
  ).rejects.toThrow('403')
  mount((res) => res.destroy(new Error('Stream interrupted')))
  await expect(
    readHttp('https://img1.baidu.com/a', new AbortController().signal, options),
  ).rejects.toThrow('Stream interrupted')
})

it.each(['http://127.0.0.1/private', 'https://evil.example/a', 'http://[invalid'])(
  'revalidates redirects and rejects invalid destinations: %s',
  (location) => {
    mount((res) => res.end(), 302, { location })
    return expect(
      readHttp('https://img1.baidu.com/a', new AbortController().signal, options),
    ).rejects.toThrow()
  },
)

it('allows same-origin redirects while limiting loops', async () => {
  const original = response(302, { location: '/b' })
  const next = response(200)
  mocks.get
    .mockImplementationOnce(
      (_url: string, _options: RequestOptions, callback: (res: typeof original) => void) => {
        const request = new RequestStub()
        queueMicrotask(() => {
          callback(original)
          original.end()
          request.emit('close')
        })
        return request
      },
    )
    .mockImplementationOnce(
      (_url: string, _options: RequestOptions, callback: (res: typeof next) => void) => {
        const request = new RequestStub()
        queueMicrotask(() => {
          callback(next)
          next.end(Buffer.from([1]))
          next.once('end', () => request.emit('close'))
        })
        return request
      },
    )
  expect([
    ...(await readHttp('https://img1.baidu.com/a', new AbortController().signal, options)).data,
  ]).toEqual([1])
  mount((res) => res.end(), 302, { location: '/loop' })
  await expect(
    readHttp('https://img1.baidu.com/a', new AbortController().signal, options),
  ).rejects.toThrow('upstream redirects')
})

it('destroys timed-out requests and clears timers', async () => {
  vi.useFakeTimers()
  const request = new RequestStub()
  mocks.get.mockReturnValue(request)
  const pending = readHttp('https://img1.baidu.com/a', new AbortController().signal, options)
  const assertion = expect(pending).rejects.toThrow('timed out')
  await vi.advanceTimersByTimeAsync(100)
  await assertion
  expect(vi.getTimerCount()).toBe(0)
})

it('rejects mixed public/private DNS results to prevent private-network rebinding', async () => {
  mocks.lookup.mockImplementation(
    (
      _host: string,
      _options: object,
      callback: (error: Error | null, values: DnsAddress[]) => void,
    ) =>
      callback(null, [
        { address: '8.8.8.8', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ]),
  )
  mocks.get.mockImplementation((_url: string, requestOptions: RequestOptions) => {
    const request = new RequestStub()
    queueMicrotask(() =>
      requestOptions.lookup('img1.baidu.com', { all: true }, (error) =>
        request.destroy(error ?? new Error('DNS should reject')),
      ),
    )
    return request
  })
  await expect(
    readHttp('https://img1.baidu.com/a', new AbortController().signal, options),
  ).rejects.toThrow('private network')
})

it.each([true, false])(
  'passes only validated DNS addresses to HTTPS connections (all=%s)',
  async (all) => {
    const addresses = [
      { address: '8.8.8.8', family: 4 },
      { address: '2606:4700:4700::1111', family: 6 },
    ]
    mocks.lookup.mockImplementation(
      (
        _host: string,
        _options: object,
        callback: (error: Error | null, values: DnsAddress[]) => void,
      ) => callback(null, addresses),
    )
    mocks.get.mockImplementation(
      (
        _url: string,
        requestOptions: RequestOptions,
        callback: (res: ReturnType<typeof response>) => void,
      ) => {
        const request = new RequestStub()
        queueMicrotask(() =>
          requestOptions.lookup('img1.baidu.com', { all }, (error, result, family) => {
            expect(error).toBeNull()
            expect(result).toEqual(all ? addresses : '8.8.8.8')
            expect(family).toBe(all ? undefined : 4)
            const res = response()
            res.once('close', () => request.emit('close'))
            callback(res)
            res.end(Buffer.from([1]))
          }),
        )
        return request
      },
    )
    expect(
      (await readHttp('https://img1.baidu.com/a', new AbortController().signal, options)).data,
    ).toEqual(Buffer.from([1]))
  },
)

it('propagates DNS resolution errors without handling a response', async () => {
  mocks.lookup.mockImplementation(
    (_host: string, _options: object, callback: (error: Error, values: DnsAddress[]) => void) =>
      callback(new Error('DNS failure'), []),
  )
  mocks.get.mockImplementation((_url: string, requestOptions: RequestOptions) => {
    const request = new RequestStub()
    queueMicrotask(() =>
      requestOptions.lookup('img1.baidu.com', { all: true }, (error) => request.destroy(error!)),
    )
    return request
  })
  await expect(
    readHttp('https://img1.baidu.com/a', new AbortController().signal, options),
  ).rejects.toThrow('DNS failure')
})
