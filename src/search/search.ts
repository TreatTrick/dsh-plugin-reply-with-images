import type { ResolvedConfig } from '../config.js'
import { diagnosticError, type DiagnosticSink } from '../diagnostics.js'
import { readHttp, type HttpRead } from '../http.js'
import { parseSearchResponse } from './providers.js'
import { rankCandidates } from './rank.js'
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

const allowedSearchOrigin = (provider: Provider, url: string, candidate: string): boolean => {
  const origin = new URL(candidate).origin
  return origin === new URL(url).origin || (provider === 'bing' && origin === 'https://cn.bing.com')
}

interface SearchOptions {
  config: ResolvedConfig
  signal: AbortSignal
  read?: HttpRead
  trace?: DiagnosticSink
}

/** Query in configured order; a provider failure adds diagnostics without blocking other providers. */
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
    const started = performance.now()
    try {
      const response = await read(url, options.signal, {
        maxBytes: options.config.maxSearchBytes,
        timeoutMs: options.config.requestTimeoutMs,
        allowFakeIpDns: options.config.allowFakeIpDns,
        allowUrl: (value) => allowedSearchOrigin(provider, url, value),
      })
      const results = parseSearchResponse(provider, new TextDecoder().decode(response.data))
      options.trace?.('search.provider', {
        query,
        provider,
        elapsedMs: Math.round(performance.now() - started),
        count: results.length,
        titles: results.slice(0, 5).map(({ title }) => title),
      })
      for (const image of results) {
        if (seen.has(image.imageUrl)) continue
        seen.add(image.imageUrl)
        images.push(image)
      }
      if (results.length === 0)
        warnings.push(`${provider}: No usable results; possible rate limit or page format change`)
      if (images.length >= options.config.maxCandidates) break
    } catch (error) {
      options.signal.throwIfAborted()
      if (error instanceof Error && error.name === 'AbortError') throw error
      const reason = diagnosticError(error)
      options.trace?.('search.provider', {
        query,
        provider,
        elapsedMs: Math.round(performance.now() - started),
        count: 0,
        error: reason,
      })
      warnings.push(`${provider}: Search temporarily unavailable (${reason})`)
    }
  }
  const ranked = rankCandidates(query, images)
  options.trace?.('search.ranked', {
    query,
    top: ranked.slice(0, 5).map(({ image, score, scores }) => ({
      provider: image.provider,
      title: image.title,
      score,
      scores,
    })),
  })
  return {
    images: ranked.slice(0, options.config.maxCandidates).map(({ image }) => image),
    warnings,
  }
}
