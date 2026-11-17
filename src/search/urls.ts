import ipaddr from 'ipaddr.js'
import type { Provider } from './types.js'

const IMAGE_DOMAINS: Record<Provider, readonly string[]> = {
  baidu: ['baidu.com', 'bdimg.com'],
  so360: ['qhimgs.com', 'qhimgs1.com', 'qhimg.com'],
  bing: ['bing.net'],
  wikimedia: ['upload.wikimedia.org', 'thumb.wikimedia.org'],
}

/** 校验公网 HTTP 来源链接，拒绝凭据、内网和特殊协议。 */
export const sourceUrl = (value: string): string | undefined => {
  try {
    const url = new URL(value)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port)
      return undefined
    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
    if (
      host === 'localhost' ||
      !host.includes('.') ||
      host.endsWith('.local') ||
      host.endsWith('.internal')
    )
      return undefined
    if (ipaddr.isValid(host) && ipaddr.process(host).range() !== 'unicast') return undefined
    return url.href
  } catch (_invalidUrl) {
    return undefined
  }
}

/** 限制下载到所属搜索来源的 HTTPS CDN，避免抓取任意网页提供的 URL。 */
export const imageUrl = (value: string, provider: Provider): string | undefined => {
  const candidate = sourceUrl(value)
  if (candidate === undefined) return undefined
  const url = new URL(candidate)
  if (url.protocol !== 'https:') return undefined
  return IMAGE_DOMAINS[provider].some(
    (domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`),
  )
    ? url.href
    : undefined
}
