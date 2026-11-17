import type { Context } from '@deepseek-ai/cordis'
import { installImageEnhancements } from './images.js'

export const inject: string[] = []

/** 浏览器入口只管理展示资源，所有图片获取和持久化仍经过 Host 工具。 */
export const apply = (ctx: Context): void => {
  ctx.effect(() => installImageEnhancements(document), 'reply-images: client display')
}
