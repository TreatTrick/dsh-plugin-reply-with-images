import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rmdir, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
import type { ReplyImages, EmbedResult, ImageTopic } from '../src/replyImages.js'

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
              title: `Lotus ${id}`,
              thumb: `https://p2.ssl.qhimgs1.com/${id}.jpg${new URL(url).search}`,
              link: 'https://example.com/lotus',
            })),
          }),
        ),
        contentType: 'application/json',
      }
    : { data: Buffer.from(url), contentType: 'image/png' }

const fixture = async (
  config: Config = {},
  profile = 'web',
  imagePath: string | undefined = undefined,
) => {
  const ctx = new Context()
  roots.push(ctx)
  const routes = new Map<string, ConnectionFetchRoute>()
  const owner = { id: 'session-a', session: { id: 'session-a' } } as Agent
  let turn = 1
  let turnOpen = true
  ctx.provide('attachments', {
    saveImage: vi.fn(async ({ data }: { data: Uint8Array }) => ({
      ...ref,
      attachmentId: AttachmentId(`sha256:${createHash('sha256').update(data).digest('hex')}`),
    })),
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
  const mounted = await ctx.plugin(plugin, { providers: ['so360'], debugLog: false, ...config })
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
    execute('reply_image_search', { query: 'Lotus' }) as ReturnType<ReplyImages['search']>
  const embed = (ids: string[]) =>
    execute('reply_images_embed', {
      candidates: ids.map((candidateId) => ({ candidateId })),
    }) as Promise<EmbedResult>
  const prepare = (topics: ImageTopic[]) =>
    execute('reply_images_prepare', { topics }) as ReturnType<ReplyImages['prepare']>
  return {
    ctx,
    routes,
    mounted,
    search,
    embed,
    prepare,
    execute,
    nextTurn: () => {
      turn += 1
    },
    closeTurn: () => {
      turnOpen = false
    },
  }
}

it('registers tools through real Cordis, saves attachments, and returns valid persistent inline Markdown', async () => {
  const f = await fixture()
  const found = await f.search()
  const result = await f.embed(found.images.slice(0, 2).map((row) => row.candidateId))
  expect(result.images).toHaveLength(2)
  expect(result.markdown).toContain('https://harness.example/api/reply-images?')
  expect(result.markdown).toContain('License unconfirmed')
  expect(f.ctx.attachments.saveImage).toHaveBeenCalledTimes(2)
  expect(f.routes.get('/api/reply-images')?.methods).toEqual(['GET', 'HEAD'])
})

it('prepares three ordered visual topics with per-section placement guidance and source metadata', async () => {
  const f = await fixture()
  const result = await f.prepare([
    { topic: 'Lotus', query: 'Lotus', alt: 'Lotus flower' },
    { topic: 'Water lily', query: 'Water lily', alt: 'Water lily' },
    { topic: 'Garden', query: 'Garden', alt: 'Garden landscape' },
  ])
  expect(result.topics).toHaveLength(3)
  expect(result.topics.map((row) => row.topic)).toEqual(['Lotus', 'Water lily', 'Garden'])
  expect(result.topics.map((row) => row.placement)).toEqual([
    expect.stringContaining('section about "Lotus"'),
    expect.stringContaining('section about "Water lily"'),
    expect.stringContaining('section about "Garden"'),
  ])
  expect(result.topics.every((row) => row.markdown.includes('Image source:'))).toBe(true)
  expect(result.markdown.match(/Image source:/g)).toHaveLength(3)
  expect(f.ctx.attachments.saveImage).toHaveBeenCalledTimes(3)
  expect(vi.mocked(readHttp)).toHaveBeenCalledTimes(6)
  expect(
    validateJsonSchemaValue(f.ctx.tools.get('reply_images_prepare')!.output.schema, result),
  ).toEqual([])
  const prepareTool = f.ctx.tools.get('reply_images_prepare')!
  const outputSchema = prepareTool.output.schema as any
  expect(prepareTool.description).toContain('positive visual value')
  expect(prepareTool.description).toContain('Paste each successful topic.markdown verbatim')
  expect(prepareTool.description).toContain('title marker, and source, author, and license caption')
  expect(prepareTool.description).toContain('2–3 complementary blocks')
  expect(prepareTool.description).toContain('License unconfirmed')
  expect(prepareTool.description).toContain('Never discard')
  expect(prepareTool.description).toContain('official sites, encyclopedias, or mainstream media')
  expect(prepareTool.parameters).toMatchObject({
    properties: { topics: { description: expect.stringContaining('1–6 ordered') } },
  })
  expect(outputSchema.properties.topics.description).toContain(
    'Every item with images must be consumed',
  )
  expect(outputSchema.properties.topics.items.required).toContain('placement')
  const args = { topics: [{ topic: 'Lotus', query: 'Lotus', alt: 'Lotus flower' }] }
  const replayable = {
    ...result,
    topics: result.topics.map((item) => ({
      ...item,
      images: item.images.map((image) => ({ ...image })),
    })),
  }
  expect(f.ctx.tools.get('reply_images_prepare')!.output.render(args, replayable)).toEqual([
    { type: 'text', text: JSON.stringify(result) },
  ])
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
  expect(f.ctx.attachments.imageHostPath).toHaveBeenCalledWith({
    ...ref,
    attachmentId: result.images[0]!.attachmentId,
  })
  const grouped = await f.prepare([
    { topic: 'Other views', layout: 'strip', query: 'Garden', alt: 'Garden' },
  ])
  expect(grouped.topics[0]!.images).toHaveLength(3)
  expect(grouped.markdown).not.toContain('#dsh-layout')
  expect(grouped.markdown).toContain('"dsh-layout=strip&group=')
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

it('rejects image searches without an Agent or an open turn', async () => {
  const f = await fixture()
  await expect(f.execute('reply_image_search', { query: 'Lotus' }, null)).rejects.toMatchObject({
    code: 'TOOL_CONTEXT_UNAVAILABLE',
  })
  f.closeTurn()
  await expect(f.search()).rejects.toMatchObject({ code: 'TOOL_CONTEXT_UNAVAILABLE' })
  expect(readHttp).not.toHaveBeenCalled()
})

it('serializes and replays tool output with call cards that depend only on input', async () => {
  const f = await fixture({ publicBaseUrl: 'https://public.example' })
  const found = await f.search()
  const result = await f.embed([found.images[0]!.candidateId])
  const search = f.ctx.tools.get('reply_image_search')!
  const embed = f.ctx.tools.get('reply_images_embed')!
  const prepare = f.ctx.tools.get('reply_images_prepare')!
  const searchArgs = { query: 'Lotus' }
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
  expect(search.presentCall?.(searchArgs)).toMatchObject({
    title: 'Search images',
    rawInput: 'Lotus',
  })
  expect(embed.presentCall?.(embedArgs)).toMatchObject({
    title: 'Save inline images',
    rawInput: '1 image',
  })
  const prepareArgs = { topics: [{ topic: 'Lotus', query: 'Lotus', alt: 'Lotus flower' }] }
  expect(prepare.presentCall?.(prepareArgs)).toMatchObject({
    title: 'Prepare inline images',
    rawInput: 'Lotus (single)',
  })
  expect(result.markdown).toContain('https://public.example/api/reply-images?')
})

it('counts displayed images and resets the budget only for a new turn', async () => {
  const f = await fixture({ maxImagesPerTurn: 2 })
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

it('limits searches by configuration and disables automatic searches in explicit-request prompts', async () => {
  const f = await fixture({ maxSearchesPerTurn: 1, automatic: false })
  await f.search()
  await expect(f.search()).rejects.toMatchObject({ code: 'REPLY_IMAGES_BUDGET_EXCEEDED' })
  expect(vi.mocked(readHttp)).toHaveBeenCalledTimes(1)
  const prompt = (await f.ctx.systemPrompt.assemble()).sections.map((row) => row.text).join('\n')
  expect(prompt).toContain('only when the user explicitly asks')
  expect(f.ctx.tools.get('reply_images_prepare')).toBeDefined()
})

it('allows in-chat previews with unknown licenses and preserves the republication warning', async () => {
  const f = await fixture()
  const prompt = (await f.ctx.systemPrompt.assemble()).sections.map((row) => row.text).join('\n')
  expect(prompt).toContain('Unknown licenses do not prevent an in-chat reference preview')
  expect(prompt).toContain('Do not claim that an image is licensed for republication')
  expect(prompt).toContain('Use a concise subject-first search query')
  expect(prompt).toContain('First decide whether images add positive visual value')
  expect(prompt).toContain('use reply_images_prepare once')
  expect(prompt).toContain(
    'Skip short answers, code, abstract explanations, math, and text-only requests',
  )
  for (const layout of ['table', 'collage', 'strip', 'single']) expect(prompt).toContain(layout)
  expect(prompt).toContain('8 image searches and display at most 12 images')
  expect(prompt).toContain('consume every topic that has images')
  expect(prompt).toContain('never paste only the aggregate Markdown at the top')
  expect(prompt).toContain('Retain all source, author, and license captions')
  expect(prompt).toContain('Do not present an unverified private image as evidence')
  expect(prompt).toContain('2–3 complementary blocks')
  expect(prompt).toContain('License unconfirmed is normal for search-engine reference images')
  expect(prompt).toContain('Never discard')
  expect(prompt).toContain('official sites, encyclopedias, or mainstream media')
  expect(prompt).toContain('solely because its license is unconfirmed')
  expect(prompt).toContain('Never abandon table because a person has no photo')
})

it.each(['system prompt', 'tool description'] as const)(
  'requires mixed layouts for long multi-section answers in the %s',
  async (source) => {
    const f = await fixture()
    const guidance =
      source === 'system prompt'
        ? (await f.ctx.systemPrompt.assemble()).sections.map((row) => row.text).join('\n')
        : f.ctx.tools.get('reply_images_prepare')!.description
    expect(guidance).toContain(
      'must plan 2–3 complementary blocks in one reply_images_prepare call',
    )
    expect(guidance).toContain('Prefer table plus collage or strip')
    expect(guidance).toContain('Never use only single for a long, multi-section answer')
    expect(guidance).not.toContain('Use single or fewer blocks')
    expect(guidance).not.toContain('Use single for one visual subject or limited budget')
  },
)

it.each(['system prompt', 'tool description'] as const)(
  'requires people tables with public executives and missing-photo rows in the %s',
  async (source) => {
    const f = await fixture()
    const guidance =
      source === 'system prompt'
        ? (await f.ctx.systemPrompt.assemble()).sections.map((row) => row.text).join('\n')
        : f.ctx.tools.get('reply_images_prepare')!.description
    expect(guidance).toContain(
      'any section about key people (关键人物), parties involved (当事人), the founding team (创始团队), or comparisons (对比), you must use layout: "table" with items',
    )
    expect(guidance).toContain('CEOs, CFOs, VPs, and directors of listed companies')
    expect(guidance).toContain('government officials')
    expect(guidance).toContain('corporate executives publicly covered by mainstream media')
    expect(guidance).toContain('are public figures and may be included directly')
    expect(guidance).toContain(
      'automatically outputs a — placeholder row for a person without an image',
    )
    expect(guidance).toContain('Never abandon table because a person has no photo')
  },
)

it.each(['system prompt', 'tool description'] as const)(
  'provides an executable one-line mixed-layout parameter example in the %s',
  async (source) => {
    const f = await fixture()
    const tool = f.ctx.tools.get('reply_images_prepare')!
    const guidance =
      source === 'system prompt'
        ? (await f.ctx.systemPrompt.assemble()).sections.map((row) => row.text).join('\n')
        : tool.description
    const example = guidance.split('\n').find((line) => line.startsWith('Example: '))
    expect(example).toBeDefined()
    const args: { topics: ImageTopic[] } = JSON.parse(example!.slice('Example: '.length))
    expect(validateJsonSchemaValue(tool.parameters, args)).toEqual([])
    expect(args.topics.map(({ layout }) => layout)).toEqual(['table', 'collage', 'strip'])
    expect(args.topics[0]).toMatchObject({
      items: [
        {
          query: expect.any(String),
          alt: expect.any(String),
          caption: expect.any(String),
        },
      ],
    })
    for (const key of ['query', 'alt', 'count']) expect(args.topics[0]).not.toHaveProperty(key)
    const result = await f.prepare(args.topics)
    expect(result.topics.map(({ layout, images }) => [layout, images.length])).toEqual([
      ['table', 1],
      ['collage', 3],
      ['strip', 3],
    ])
    expect(result.warnings).toEqual([])
  },
)

it.each([
  { maxImagesPerTurn: 2, maxSearchesPerTurn: 1 },
  { maxImagesPerTurn: 20, maxSearchesPerTurn: 16 },
])('uses configured limits in the system prompt: %j', async (config) => {
  const f = await fixture(config)
  const prompt = (await f.ctx.systemPrompt.assemble()).sections.map((row) => row.text).join('\n')
  expect(prompt).toContain(
    `${config.maxSearchesPerTurn} image searches and display at most ${config.maxImagesPerTurn} images`,
  )
})

it('accepts six topics through the registered tool and rejects seven before doing any work', async () => {
  const f = await fixture()
  const topics = Array.from({ length: 6 }, (_, i) => ({
    topic: `Section ${i}`,
    query: `Subject ${i}`,
    alt: `Subject ${i}`,
  }))
  await expect(
    f.prepare([...topics, { topic: 'Extra', query: 'Extra', alt: 'Extra' }]),
  ).rejects.toMatchObject({ code: 'INVALID_ARGS' })
  expect(readHttp).not.toHaveBeenCalled()
  const result = await f.prepare(topics)
  expect(result.topics.map(({ topic }) => topic)).toEqual(topics.map(({ topic }) => topic))
  expect(result.topics.every(({ images }) => images.length === 1)).toBe(true)
  expect(
    validateJsonSchemaValue(f.ctx.tools.get('reply_images_prepare')!.output.schema, result),
  ).toEqual([])
})

it('runs a mixed-layout request through the registered tool and rejects invalid layout names', async () => {
  const f = await fixture()
  const topics: ImageTopic[] = [
    {
      topic: 'Catalog',
      layout: 'table',
      items: [{ query: 'Lotus', alt: 'Lotus', caption: 'Aquatic plant' }],
    },
    { topic: 'Habitat', layout: 'collage', query: 'Habitat', alt: 'Habitat' },
    { topic: 'Garden', layout: 'strip', query: 'Garden', alt: 'Garden', count: 2 },
  ]
  const result = await f.prepare(topics)
  expect(result.topics.map(({ layout, images }) => [layout, images.length])).toEqual([
    ['table', 1],
    ['collage', 3],
    ['strip', 2],
  ])
  const tool = f.ctx.tools.get('reply_images_prepare')!
  expect(tool.presentCall?.({ topics })).toMatchObject({
    rawInput: 'Catalog (table), Habitat (collage), Garden (strip)',
  })
  await expect(
    f.execute('reply_images_prepare', { topics: [{ ...topics[1], layout: 'invalid' }] }),
  ).rejects.toMatchObject({ code: 'INVALID_ARGS' })
})

it('rejects invalid arguments through the tool schema', async () => {
  const f = await fixture()
  await expect(f.execute('reply_image_search', { query: 4 })).rejects.toMatchObject({
    code: 'INVALID_ARGS',
  })
  await expect(
    f.execute('reply_images_embed', { candidates: [{ candidateId: 4 }] }),
  ).rejects.toMatchObject({ code: 'INVALID_ARGS' })
  await expect(
    f.execute('reply_images_prepare', { topics: [{ topic: 'Lotus', query: 4, alt: 'Lotus' }] }),
  ).rejects.toMatchObject({ code: 'INVALID_ARGS' })
  expect(readHttp).not.toHaveBeenCalled()
})

it('returns bounded diagnostics and allows text-only answers when all providers fail', async () => {
  const f = await fixture()
  vi.mocked(readHttp).mockRejectedValue(new Error('Rate limited'))
  expect(await f.search()).toMatchObject({
    images: [],
    warnings: [expect.stringContaining('Rate limited')],
  })
})

it('removes tools, prompts, and media routes on unload', async () => {
  const f = await fixture()
  expect(f.ctx.tools.get('reply_image_search')).toBeDefined()
  await f.mounted.dispose()
  expect(f.ctx.tools.get('reply_image_search')).toBeUndefined()
  expect(f.ctx.tools.get('reply_images_embed')).toBeUndefined()
  expect(f.ctx.tools.get('reply_images_prepare')).toBeUndefined()
  expect(f.routes.size).toBe(0)
  expect(
    (await f.ctx.systemPrompt.assemble()).sections.find(
      (row) => row.name === 'tool:reply-with-images',
    ),
  ).toBeUndefined()
})

it('persists a complete Desktop prepare trace with the session and tool call IDs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'reply-images-plugin-'))
  const path = join(dir, 'diagnostics.jsonl')
  try {
    const f = await fixture(
      { debugLog: true, debugLogPath: path },
      'desktop',
      'C:/Images/photo.png',
    )
    await f.prepare([{ topic: 'Lotus', query: 'Lotus', alt: 'Lotus' }])
    await f.mounted.dispose()
    const records = (await readFile(path, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(records).toMatchObject([
      { event: 'plugin.loaded', environment: 'desktop', providers: ['so360'] },
      {
        event: 'prepare.start',
        sessionTurn: { sessionId: 'session-a', turn: 1 },
        callId: 'call-1',
        topics: [{ query: 'Lotus' }],
      },
      { event: 'search.provider', count: 3 },
      { event: 'search.ranked' },
      { event: 'candidate.saved', provider: 'so360', width: 2, height: 1 },
      { event: 'prepare.done', topics: [{ layout: 'single', markerChannel: 'none' }] },
    ])
  } finally {
    await unlink(path).catch(() => {})
    await rmdir(dir)
  }
})
