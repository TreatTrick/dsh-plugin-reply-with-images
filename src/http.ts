import { lookup } from 'node:dns'
import { get } from 'node:https'
import ipaddr from 'ipaddr.js'

/** Network response with a byte limit enforced before parsing upstream data. */
export interface HttpResult {
  data: Uint8Array
  contentType: string
}
export interface HttpOptions {
  maxBytes: number
  timeoutMs: number
  allowUrl: (url: string) => boolean
  allowFakeIpDns?: boolean
}
export type HttpRead = (
  url: string,
  signal: AbortSignal,
  options: HttpOptions,
) => Promise<HttpResult>

const isFakeIpAddress = (parsed: ipaddr.IPv4 | ipaddr.IPv6): boolean =>
  parsed.kind() === 'ipv4'
    ? parsed.match(ipaddr.parse('198.18.0.0'), 15)
    : parsed.match(ipaddr.parse('2001:2::'), 48)

/** Allow public unicast addresses, plus proxy Fake-IP ranges when enabled; other special addresses remain blocked. */
export const allowedAddress = (address: string, allowFakeIpDns = false): boolean => {
  const parsed = ipaddr.process(address)
  if (parsed.range() === 'unicast') return true
  return allowFakeIpDns && isFakeIpAddress(parsed)
}

const deniedAddressError = (addresses: readonly string[], allowFakeIpDns?: boolean): Error =>
  !allowFakeIpDns &&
  addresses.length > 0 &&
  addresses.every((address) => allowedAddress(address, true))
    ? new Error(
        'Access to Fake-IP DNS addresses is disabled; set allowFakeIpDns: true to allow proxy Fake-IP resolution',
      )
    : new Error('Access to private network addresses is denied')

/** Pin HTTPS downloads to validated public DNS results and revalidate every redirect. */
export const readHttp: HttpRead = async (address, signal, options) => {
  const read = async (url: string, remaining: number): Promise<HttpResult> => {
    signal.throwIfAborted()
    const target = new URL(url)
    if (
      !options.allowUrl(url) ||
      target.protocol !== 'https:' ||
      target.username ||
      target.password ||
      target.port
    )
      throw new Error('Unsupported image source URL')
    const literalHost = target.hostname.replace(/^\[|\]$/g, '')
    if (ipaddr.isValid(literalHost) && !allowedAddress(literalHost, options.allowFakeIpDns))
      throw deniedAddressError([literalHost], options.allowFakeIpDns)
    return new Promise((resolve, reject) => {
      const request = get(
        url,
        {
          signal,
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            Referer: `${target.origin}/`,
            Accept: '*/*',
            'Accept-Encoding': 'identity',
          },
          lookup: (hostname, dnsOptions, callback) => {
            lookup(hostname, { ...dnsOptions, all: true }, (error, addresses) => {
              if (error) {
                callback(error, [])
                return
              }
              const publicAddresses = addresses.filter((value) =>
                allowedAddress(value.address, options.allowFakeIpDns),
              )
              if (publicAddresses.length !== addresses.length || publicAddresses.length === 0) {
                callback(
                  deniedAddressError(
                    addresses.map((value) => value.address),
                    options.allowFakeIpDns,
                  ),
                  [],
                )
                return
              }
              if (dnsOptions.all) callback(null, publicAddresses)
              else callback(null, publicAddresses[0]!.address, publicAddresses[0]!.family)
            })
          },
        },
        (response) => {
          response.on('error', reject)
          const status = response.statusCode ?? 0
          if ([301, 302, 303, 307, 308].includes(status)) {
            response.resume()
            if (!response.headers.location || remaining === 0) {
              reject(new Error('Too many upstream redirects'))
              return
            }
            try {
              void read(new URL(response.headers.location, url).href, remaining - 1).then(
                resolve,
                reject,
              )
            } catch (error) {
              reject(error)
            }
            return
          }
          if (status !== 200) {
            response.resume()
            reject(new Error(`Upstream returned HTTP ${status}`))
            return
          }
          const declared = Number(response.headers['content-length'] ?? 0)
          if (declared > options.maxBytes) {
            response.destroy()
            reject(new Error('Response exceeds the size limit'))
            return
          }
          const chunks: Uint8Array[] = []
          let bytes = 0
          response.on('data', (chunk: Buffer) => {
            bytes += chunk.byteLength
            if (bytes > options.maxBytes) {
              response.destroy(new Error('Response exceeds the size limit'))
              return
            }
            chunks.push(chunk)
          })
          response.on('end', () =>
            resolve({
              data: Buffer.concat(chunks),
              contentType: response.headers['content-type']?.split(';')[0]?.trim() ?? '',
            }),
          )
        },
      )
      const deadline = setTimeout(
        () => request.destroy(new Error('Network request timed out')),
        options.timeoutMs,
      )
      request.once('close', () => clearTimeout(deadline))
      request.once('error', reject)
    })
  }
  return read(address, 2)
}
