/** Image search providers and candidate metadata for tool selection. */
export type Provider = 'baidu' | 'so360' | 'bing' | 'wikimedia'

/** Download images only from known search CDNs; sourceUrl is for attribution only. */
export interface SearchImage {
  provider: Provider
  title: string
  imageUrl: string
  sourceUrl: string
  license: string
  author?: string
  licenseUrl?: string
}
