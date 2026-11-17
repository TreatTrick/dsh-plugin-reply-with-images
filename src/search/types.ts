/** 搜图来源及供工具筛选的候选信息。 */
export type Provider = 'baidu' | 'so360' | 'bing' | 'wikimedia'

/** 图片只从已知搜索 CDN 下载；sourceUrl 仅用于引用。 */
export interface SearchImage {
  provider: Provider
  title: string
  imageUrl: string
  sourceUrl: string
  license: string
  author?: string
  licenseUrl?: string
}
