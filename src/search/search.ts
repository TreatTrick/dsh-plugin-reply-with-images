import type { ResolvedConfig } from '../config.js'
import { readHttp, type HttpRead } from '../http.js'
import { parseSearchResponse } from './providers.js'
import type { Provider, SearchImage } from './types.js'

const endpoint = (provider: Provider, query: string): string => {
  const q = encodeURIComponent(query)
  switch (provider) {
    case 'baidu':
      return `https://image.baidu.com/search/acjson?tn=resultjson_com&logid=&ipn=rj&ct=201326592&fp=result&queryWord=${q}&word=${q}&pn=0&rn=20`
    case 'so360':
      return `https://image.so.com/j?q=${q}&src=srp&sn=20&pn=0`
    case 'bing':
      return `https://www.bing.com/images/search?q=${q}&form=HDRSC3&safeSearch=Strict`
    case 'wikimedia':
      return `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=12&gsrsearch=${q}&prop=imageinfo&iiprop=url%7Cextmetadata&iiurlwidth=960`
  }
}

interface SearchOptions {
  config: ResolvedConfig
  signal: AbortSignal
  read?: HttpRead
}

/** 按部署顺序查询；一个来源失败只增加诊断，不阻止其他来源。 */
export const searchImages = async (
  query: string,
  options: SearchOptions,
): Promise<{ images: SearchImage[]; warnings: string[] }> => {
  const images: SearchImage[] = []
  const warnings: string[] = []
  const seen = new Set<string>()
  const read = options.read ?? readHttp
  for (const provider of options.config.providers) {
    options.signal.throwIfAborted()
    const url = endpoint(provider, query)
    try {
      const response = await read(url, options.signal, {
        maxBytes: options.config.maxSearchBytes,
        timeoutMs: options.config.requestTimeoutMs,
        allowFakeIpDns: options.config.allowFakeIpDns,
        allowUrl: (value) => new URL(value).origin === new URL(url).origin,
      })
      const results = parseSearchResponse(provider, new TextDecoder().decode(response.data))
      for (const image of results) {
        if (seen.has(image.imageUrl)) continue
        seen.add(image.imageUrl)
        images.push(image)
        if (images.length === options.config.maxCandidates) return { images, warnings }
      }
      if (results.length === 0) warnings.push(`${provider}: 暂无可用结果，可能限流或页面格式变化`)
    } catch (error) {
      options.signal.throwIfAborted()
      if (error instanceof Error && error.name === 'AbortError') throw error
      warnings.push(
        `${provider}: 搜索暂不可用（${error instanceof Error ? error.message.slice(0, 160) : '上游错误'}）`,
      )
    }
  }
  return { images, warnings }
}
