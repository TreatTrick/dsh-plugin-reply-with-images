import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolsService, { type ToolRunContext, validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'
import type { Agent } from '@deepseek-ai/dsh-agent'
import * as plugin from '../src/index.js'
import { readHttp, type HttpRead } from '../src/http.js'
import type { Config } from '../src/config.js'
import type { ReplyImages, EmbedResult } from '../src/replyImages.js'

vi.mock('../src/http.js', () => ({ readHttp: vi.fn() }))
const roots: Context[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await root.fiber.dispose()
  vi.resetAllMocks()
})
const ref = {
  attachmentId: AttachmentId(`sha256:${'b'.repeat(64)}`),
  mediaType: 'image/png' as const,
  bytes: 8,
  width: 2,
  height: 1,
}
const netRead: HttpRead = async (url) =>
  url.includes('image.so.com')
    ? {
        data: Buffer.from(
          JSON.stringify({
            list: [1, 2, 3].map((id) => ({
              title: `荷花 ${id}`,
              thumb: `https://p2.ssl.qhimgs1.com/${id}.jpg`,
              link: 'https://example.com/lotus',
            })),
          }),
        ),
        contentType: 'application/json',
      }
    : { data: Buffer.from('89504e470d0a1a0a', 'hex'), contentType: 'image/png' }

const fixture = async (
  config: Config = {},
  profile = 'web',
  imagePath: string | undefined = undefined,
) => {
  const ctx = new Context()
  roots.push(ctx)
  const routes = new Map<string, ConnectionFetchRoute>()
  const owner = { id: 'session-a', session: {} } as Agent
  let turn = 1
  let turnOpen = true
  ctx.provide('attachments', {
    saveImage: vi.fn(async () => ref),
    readImage: vi.fn(async () => ({ ref, data: Uint8Array.of(1, 2, 3) })),
    imageHostPath: vi.fn(() => imagePath),
  })
  ctx.provide('profileContext', { name: profile })
  ctx.provide('webServer', { getOrigin: () => 'https://harness.example' })
  ctx.provide('agents', {
    turnBoundaryOf: () => ({ lastTurn: turn, openTurnStartSeq: turnOpen ? turn : null }),
  })
  ctx.provide('connection', {
    fetch: {
      register: (route: ConnectionFetchRoute) => {
        routes.set(route.path, route)
        return async () => {
          routes.delete(route.path)
        }
      },
    },
  })
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolsService)
  ctx.tools.setExecutor({
    describe: (definitions) => ({ schemas: definitions }),
    execute: async () => {
      throw new Error('unused')
    },
  })
  vi.mocked(readHttp).mockImplementation(netRead)
  const mounted = await ctx.plugin(plugin, { providers: ['so360'], ...config })
  const execute = async (name: string, args: unknown, agent: Agent | null = owner) => {
    const definition = ctx.tools.get(name)!
    const execution: ToolRunContext = {
      name,
      arguments: args,
      ...(agent ? { agent } : {}),
      callId: 'call-1' as ToolRunContext['callId'],
      rootCallId: 'call-1' as ToolRunContext['rootCallId'],
      token: Symbol() as ToolRunContext['token'],
      signal: new AbortController().signal,
      concludeTurn: () => undefined,
      deferContext: () => undefined,
    }
    const result = await definition.execute(args, execution)
    expect(validateJsonSchemaValue(definition.output.schema, result)).toEqual([])
    return result
  }
  const search = () =>
    execute('reply_image_search', { query: '荷花' }) as ReturnType<ReplyImages['search']>
  const embed = (ids: string[]) =>
    execute('reply_images_embed', {
      candidates: ids.map((candidateId) => ({ candidateId })),
    }) as Promise<EmbedResult>
  return {
    ctx,
    routes,
    mounted,
    search,
    embed,
    execute,
    nextTurn: () => {
      turn += 1
    },
    closeTurn: () => {
      turnOpen = false
    },
  }
}

it('真实 Cordis 注册工具、保存附件并返回合法的持久正文 Markdown', async () => {
  const f = await fixture()
  const found = await f.search()
  const result = await f.embed(found.images.slice(0, 2).map((row) => row.candidateId))
  expect(result.images).toHaveLength(2)
  expect(result.markdown).toContain('https://harness.example/api/reply-images?')
  expect(result.markdown).toContain('许可未确认')
  expect(f.ctx.attachments.saveImage).toHaveBeenCalledTimes(2)
  expect(f.routes.get('/api/reply-images')?.methods).toEqual(['GET', 'HEAD'])
})

it('uses official Desktop attachment paths with native image authentication independent of the Host port', async () => {
  const path = 'C:\\Users\\Test \u{1f33f} User\\.dsh\\attachments\\cat#100%?.png'
  const f = await fixture({}, 'desktop', path)
  const found = await f.search()
  const result = await f.embed([found.images[0]!.candidateId])
  expect(result.images).toHaveLength(1)
  expect(result.markdown).toContain(
    '(<C:/Users/Test%20%F0%9F%8C%BF%20User/.dsh/attachments/cat%23100%25%3F.png>)',
  )
  expect(result.markdown).not.toContain('/api/reply-images')
  expect(f.ctx.attachments.imageHostPath).toHaveBeenCalledWith(ref)
})

it('reports a missing Desktop attachment path without generating an unauthenticated link', async () => {
  const f = await fixture({}, 'desktop')
  const found = await f.search()
  const result = await f.embed([found.images[0]!.candidateId])
  expect(result.images).toEqual([])
  expect(result.markdown).toBe('')
  expect(result.warnings[0]).toContain(
    'Desktop images require a local image path from the attachment provider',
  )
})

it('没有 Agent 或没有打开的轮次时拒绝搜图', async () => {
  const f = await fixture()
  await expect(f.execute('reply_image_search', { query: '荷花' }, null)).rejects.toMatchObject({
    code: 'TOOL_CONTEXT_UNAVAILABLE',
  })
  f.closeTurn()
  await expect(f.search()).rejects.toMatchObject({ code: 'TOOL_CONTEXT_UNAVAILABLE' })
  expect(readHttp).not.toHaveBeenCalled()
})

it('工具输出可序列化并重放，调用卡片只依赖输入', async () => {
  const f = await fixture({ publicBaseUrl: 'https://public.example' })
  const found = await f.search()
  const result = await f.embed([found.images[0]!.candidateId])
  const search = f.ctx.tools.get('reply_image_search')!
  const embed = f.ctx.tools.get('reply_images_embed')!
  const searchArgs = { query: '荷花' }
  const embedArgs = { candidates: [{ candidateId: found.images[0]!.candidateId }] }
  expect(search.output.render(searchArgs, found)).toEqual([
    { type: 'text', text: JSON.stringify(found) },
  ])
  const renderable = {
    markdown: result.markdown,
    images: result.images.map((image) => ({ ...image })),
    warnings: [...result.warnings],
  }
  expect(embed.output.render(embedArgs, renderable)).toEqual([
    { type: 'text', text: JSON.stringify(renderable) },
  ])
  expect(search.presentCall?.(searchArgs)).toMatchObject({ title: '搜索配图', rawInput: '荷花' })
  expect(embed.presentCall?.(embedArgs)).toMatchObject({
    title: '保存正文配图',
    rawInput: '1 张图片',
  })
  expect(result.markdown).toContain('https://public.example/api/reply-images?')
})

it('展示预算按张数累计，只有新轮次重新获得预算', async () => {
  const f = await fixture()
  const found = await f.search()
  await f.embed(found.images.slice(0, 2).map((row) => row.candidateId))
  await expect(f.embed([found.images[2]!.candidateId])).rejects.toMatchObject({
    code: 'REPLY_IMAGES_BUDGET_EXCEEDED',
  })
  f.nextTurn()
  await expect(f.embed([found.images[2]!.candidateId])).rejects.toMatchObject({
    code: 'REPLY_IMAGES_CANDIDATE_INVALID',
  })
  const next = await f.search()
  expect((await f.embed([next.images[0]!.candidateId])).images).toHaveLength(1)
})

it('按配置限制搜索且显式请求模式的提示词不自动搜图', async () => {
  const f = await fixture({ maxSearchesPerTurn: 1, automatic: false })
  await f.search()
  await expect(f.search()).rejects.toMatchObject({ code: 'REPLY_IMAGES_BUDGET_EXCEEDED' })
  expect(vi.mocked(readHttp)).toHaveBeenCalledTimes(1)
  const prompt = (await f.ctx.systemPrompt.assemble()).sections.map((row) => row.text).join('\n')
  expect(prompt).toContain('only when the user explicitly asks')
})

it('allows in-chat previews with unknown licenses and preserves the republication warning', async () => {
  const f = await fixture()
  const prompt = (await f.ctx.systemPrompt.assemble()).sections.map((row) => row.text).join('\n')
  expect(prompt).toContain('Unknown licenses do not prevent an in-chat reference preview')
  expect(prompt).toContain('Do not claim that an image is licensed for republication')
  expect(prompt).toContain('Use a concise subject-first search query')
})

it('工具 schema 拒绝不合法参数', async () => {
  const f = await fixture()
  await expect(f.execute('reply_image_search', { query: 4 })).rejects.toMatchObject({
    code: 'INVALID_ARGS',
  })
  await expect(
    f.execute('reply_images_embed', { candidates: [{ candidateId: 4 }] }),
  ).rejects.toMatchObject({ code: 'INVALID_ARGS' })
  expect(readHttp).not.toHaveBeenCalled()
})

it('全部来源失败时输出有限诊断并允许纯文字回答', async () => {
  const f = await fixture()
  vi.mocked(readHttp).mockRejectedValue(new Error('限流'))
  expect(await f.search()).toMatchObject({
    images: [],
    warnings: [expect.stringContaining('限流')],
  })
})

it('卸载后工具、提示词和媒体路由全部移除', async () => {
  const f = await fixture()
  expect(f.ctx.tools.get('reply_image_search')).toBeDefined()
  await f.mounted.dispose()
  expect(f.ctx.tools.get('reply_image_search')).toBeUndefined()
  expect(f.ctx.tools.get('reply_images_embed')).toBeUndefined()
  expect(f.routes.size).toBe(0)
  expect(
    (await f.ctx.systemPrompt.assemble()).sections.find(
      (row) => row.name === 'tool:reply-with-images',
    ),
  ).toBeUndefined()
})
