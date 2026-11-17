import { lookup } from 'node:dns'
import { get } from 'node:https'
import ipaddr from 'ipaddr.js'

/** 网络读取结果；上游数据在解析前有字节上限。 */
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

/** Fake-IP 仅适用于明确启用的代理 DNS，其他特殊地址始终拒绝。 */
export const allowedAddress = (address: string, allowFakeIpDns = false): boolean => {
  const parsed = ipaddr.process(address)
  if (parsed.range() === 'unicast') return true
  return (
    allowFakeIpDns &&
    (parsed.kind() === 'ipv4'
      ? parsed.match(ipaddr.parse('198.18.0.0'), 15)
      : parsed.match(ipaddr.parse('2001:2::'), 48))
  )
}

/** HTTPS 下载固定到经校验的公网 DNS 结果；每次重定向重新验证。 */
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
      throw new Error('图片来源地址不受支持')
    if (
      ipaddr.isValid(target.hostname.replace(/^\[|\]$/g, '')) &&
      !allowedAddress(target.hostname.replace(/^\[|\]$/g, ''), options.allowFakeIpDns)
    )
      throw new Error('拒绝访问内网地址')
    return new Promise((resolve, reject) => {
      const request = get(
        url,
        {
          signal,
          headers: {
            'User-Agent': 'Mozilla/5.0',
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
                callback(new Error('拒绝访问内网地址'), [])
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
              reject(new Error('上游重定向次数过多'))
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
            reject(new Error(`上游返回 HTTP ${status}`))
            return
          }
          const declared = Number(response.headers['content-length'] ?? 0)
          if (declared > options.maxBytes) {
            response.destroy()
            reject(new Error('响应超过大小限制'))
            return
          }
          const chunks: Uint8Array[] = []
          let bytes = 0
          response.on('data', (chunk: Buffer) => {
            bytes += chunk.byteLength
            if (bytes > options.maxBytes) {
              response.destroy(new Error('响应超过大小限制'))
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
        () => request.destroy(new Error('网络请求超时')),
        options.timeoutMs,
      )
      request.once('close', () => clearTimeout(deadline))
      request.once('error', reject)
    })
  }
  return read(address, 2)
}
