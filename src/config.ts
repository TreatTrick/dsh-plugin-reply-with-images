import Schema from '@deepseek-ai/schemastery'
import { z } from 'zod'

const providerSchema = z.enum(['baidu', 'so360', 'bing', 'wikimedia'])
const positive = z.number().int().positive()
const configSchema = z
  .object({
    providers: z
      .array(providerSchema)
      .min(1)
      .max(4)
      .default(['wikimedia', 'baidu', 'so360', 'bing']),
    maxImagesPerTurn: positive.max(8).default(2),
    maxSearchesPerTurn: positive.max(10).default(2),
    maxCandidates: positive.max(20).default(6),
    requestTimeoutMs: positive.max(60000).default(8000),
    maxImageBytes: positive.max(20 * 1024 * 1024).default(5 * 1024 * 1024),
    maxSearchBytes: positive.max(10 * 1024 * 1024).default(3 * 1024 * 1024),
    automatic: z.boolean().default(true),
    allowFakeIpDns: z.boolean().default(false),
    publicBaseUrl: z.string().default(''),
  })
  .superRefine((value, context) => {
    if (new Set(value.providers).size !== value.providers.length)
      context.addIssue({ code: 'custom', message: 'providers 不能重复' })
    if (value.publicBaseUrl) {
      const parsed = z.url().safeParse(value.publicBaseUrl)
      if (
        !parsed.success ||
        !/^https?:$/.test(new URL(value.publicBaseUrl).protocol) ||
        new URL(value.publicBaseUrl).username ||
        new URL(value.publicBaseUrl).password ||
        new URL(value.publicBaseUrl).search ||
        new URL(value.publicBaseUrl).hash
      ) {
        context.addIssue({
          code: 'custom',
          message: 'publicBaseUrl 必须是不带凭据、查询或片段的 HTTP(S) 地址',
        })
      }
    }
  })

/** 部署配置全部在插件加载时校验，不依赖测试专用配置。 */
export type ResolvedConfig = z.infer<typeof configSchema>
export type Config = Partial<ResolvedConfig>

/** Cordis 设置面板与 YAML 的配置入口。 */
export const Config: Schema<Config> = Schema.object({
  providers: Schema.array(Schema.union(['baidu', 'so360', 'bing', 'wikimedia']))
    .default(['wikimedia', 'baidu', 'so360', 'bing'])
    .description(
      'Try Wikimedia with license metadata first, then fall back to mainland and Bing providers',
    ),
  maxImagesPerTurn: Schema.number().default(2).description('每轮最多展示图片数'),
  maxSearchesPerTurn: Schema.number().default(2).description('每轮最多搜图次数'),
  maxCandidates: Schema.number().default(6).description('每次返回候选数'),
  requestTimeoutMs: Schema.number().default(8000).description('单次网络请求超时毫秒数'),
  maxImageBytes: Schema.number()
    .default(5 * 1024 * 1024)
    .description('单张下载图片字节上限'),
  maxSearchBytes: Schema.number()
    .default(3 * 1024 * 1024)
    .description('搜索响应字节上限'),
  automatic: Schema.boolean().default(true).description('在图片有助于理解时主动配图'),
  allowFakeIpDns: Schema.boolean()
    .default(false)
    .description('兼容代理 Fake-IP DNS，仅额外允许 198.18.0.0/15 和 2001:2::/48'),
  publicBaseUrl: Schema.string()
    .default('')
    .description('浏览器访问 Harness 的地址，反向代理部署时填写'),
})

/** 解析完整配置，并拒绝重复图源和无效的上限。 */
export const resolveConfig = (value: Config = {}): ResolvedConfig => configSchema.parse(value)
