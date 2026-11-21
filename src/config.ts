import Schema from '@deepseek-ai/schemastery'
import { z } from 'zod'

const providerSchema = z.enum(['baidu', 'so360', 'bing', 'wikimedia'])
const DEFAULT_PROVIDERS: z.infer<typeof providerSchema>[] = ['bing', 'so360', 'baidu', 'wikimedia']
const positive = z.number().int().positive()
const budgets = {
  images: { default: 12, max: 20 },
  searches: { default: 8, max: 16 },
  candidates: { default: 10, max: 20 },
}
const configSchema = z
  .object({
    providers: z.array(providerSchema).min(1).max(4).default(DEFAULT_PROVIDERS),
    maxImagesPerTurn: positive.max(budgets.images.max).default(budgets.images.default),
    maxSearchesPerTurn: positive.max(budgets.searches.max).default(budgets.searches.default),
    maxCandidates: positive.max(budgets.candidates.max).default(budgets.candidates.default),
    requestTimeoutMs: positive.max(60000).default(8000),
    maxImageBytes: positive.max(20 * 1024 * 1024).default(5 * 1024 * 1024),
    maxSearchBytes: positive.max(10 * 1024 * 1024).default(3 * 1024 * 1024),
    automatic: z.boolean().default(true),
    allowFakeIpDns: z.boolean().default(false),
    publicBaseUrl: z.string().default(''),
    debugLog: z.boolean().default(true),
    debugLogPath: z.string().default(''),
  })
  .superRefine((value, context) => {
    if (new Set(value.providers).size !== value.providers.length)
      context.addIssue({ code: 'custom', message: 'providers must not contain duplicates' })
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
          message:
            'publicBaseUrl must be an HTTP(S) URL without credentials, a query, or a fragment',
        })
      }
    }
  })

/** Validate all deployment settings at plugin load without test-only configuration. */
export type ResolvedConfig = z.infer<typeof configSchema>
export type Config = Partial<ResolvedConfig>

/** Configuration entry point for the Cordis settings panel and YAML. */
export const Config: Schema<Config> = Schema.object({
  providers: Schema.array(Schema.union(['baidu', 'so360', 'bing', 'wikimedia']))
    .default(DEFAULT_PROVIDERS)
    .description(
      'Try Bing and mainland providers first, with Wikimedia as a licensed-source fallback',
    ),
  maxImagesPerTurn: Schema.number()
    .default(budgets.images.default)
    .description(`Maximum images displayed per turn (1–${budgets.images.max})`),
  maxSearchesPerTurn: Schema.number()
    .default(budgets.searches.default)
    .description(`Maximum image searches per turn (1–${budgets.searches.max})`),
  maxCandidates: Schema.number()
    .default(budgets.candidates.default)
    .description(`Maximum candidates returned per search (1–${budgets.candidates.max})`),
  requestTimeoutMs: Schema.number()
    .default(8000)
    .description('Timeout per network request in milliseconds'),
  maxImageBytes: Schema.number()
    .default(5 * 1024 * 1024)
    .description('Maximum downloaded image size in bytes'),
  maxSearchBytes: Schema.number()
    .default(3 * 1024 * 1024)
    .description('Maximum search response size in bytes'),
  automatic: Schema.boolean()
    .default(true)
    .description('Add images automatically when they aid understanding'),
  allowFakeIpDns: Schema.boolean()
    .default(false)
    .description(
      'Support proxy Fake-IP DNS by additionally allowing only 198.18.0.0/15 and 2001:2::/48',
    ),
  debugLog: Schema.boolean().default(true).description('Write local JSONL image diagnostics'),
  debugLogPath: Schema.string()
    .default('')
    .description('Override the default local image diagnostics path'),
  publicBaseUrl: Schema.string()
    .default('')
    .description('Browser-facing Harness URL for reverse-proxy deployments'),
})

/** Resolve the full configuration, rejecting duplicate providers and invalid limits. */
export const resolveConfig = (value: Config = {}): ResolvedConfig => configSchema.parse(value)
