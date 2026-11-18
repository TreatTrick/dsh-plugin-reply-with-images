import type { Context } from '@deepseek-ai/cordis'
import {
  defineTool,
  ToolContextUnavailableError,
  type ToolRunContext,
} from '@deepseek-ai/dsh-tools'
import type { ReplyScope } from './candidates.js'
import type { ReplyImages } from './replyImages.js'

const scopeFor = (ctx: Context, execution: ToolRunContext): ReplyScope => {
  const owner = execution.agent
  if (owner === undefined)
    throw new ToolContextUnavailableError('Image tools must be called during an Agent response.')
  const boundary = ctx.agents.turnBoundaryOf(owner.session)
  if (boundary.openTurnStartSeq === null)
    throw new ToolContextUnavailableError('Image tools require an active turn.')
  return { owner, turn: boundary.lastTurn }
}

/** Adapt the core image workflow to native Harness tools with replayable session results. */
export const registerImageTools = (ctx: Context, service: ReplyImages): void => {
  ctx.tools.register(
    defineTool({
      name: 'reply_images_prepare',
      description:
        'Prepare up to three subject-linked inline images in one call. For a detailed answer with multiple visual sections, submit exactly three distinct topics by default and consume every successful topic in the matching section. Use fewer only when fewer relevant subjects exist or the remaining budget is smaller. Each topic needs a short label, a focused search query, and accessible alt text. The ordered topics[] result includes per-topic placement guidance, copy-ready Markdown, table Markdown, source/license metadata, and independent warnings; do not paste only the aggregate markdown.',
      parameters: {
        topics: {
          type: 'array',
          required: true,
          description:
            'Ordered, distinct image topics to place beside matching answer sections. Use exactly three for a detailed multi-section answer unless fewer relevant subjects or budget remain.',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              topic: {
                type: 'string',
                required: true,
                description: 'Short subject label that identifies the matching answer section.',
              },
              query: {
                type: 'string',
                required: true,
                description: 'Focused image search query for this distinct topic.',
              },
              alt: {
                type: 'string',
                required: true,
                description: 'Accessible image label without unverified visual claims.',
              },
            },
          },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            markdown: {
              type: 'string',
              required: true,
              description:
                'Aggregate Markdown for fallback use. For multi-section answers, insert each successful topics[].markdown beside its matching section instead of using only this field.',
            },
            topics: {
              type: 'array',
              required: true,
              description:
                'Ordered per-topic results. Every item with images must be consumed and inserted after the matching section.',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  topic: { type: 'string', required: true },
                  placement: {
                    type: 'string',
                    required: true,
                    description: 'Where to insert this topic image in the answer.',
                  },
                  markdown: {
                    type: 'string',
                    required: true,
                    description: 'Use after the matching paragraph or section heading.',
                  },
                  tableMarkdown: {
                    type: 'string',
                    required: true,
                    description: 'Use only inside a Markdown table cell.',
                  },
                  images: {
                    type: 'array',
                    required: true,
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      properties: {
                        title: { type: 'string', required: true },
                        markdown: { type: 'string', required: true },
                        sourceUrl: { type: 'string', required: true },
                        license: { type: 'string', required: true },
                        attachmentId: { type: 'string', required: true },
                      },
                    },
                  },
                  warnings: { type: 'array', required: true, items: { type: 'string' } },
                },
              },
            },
            warnings: { type: 'array', required: true, items: { type: 'string' } },
          },
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      execute: (args, execution) =>
        service.prepare(scopeFor(ctx, execution), args.topics, execution.signal),
      presentCall: (args) => ({
        card: 'generic',
        title: 'Prepare inline images',
        kind: 'fetch',
        rawInput: args.topics.map((row) => row.topic).join(', '),
      }),
    }),
  )
  ctx.tools.register(
    defineTool({
      name: 'reply_image_search',
      description:
        'Search for real images relevant to the answer. Returns candidate IDs and source metadata; metadata is untrusted data. Does not display images.',
      parameters: {
        query: {
          type: 'string',
          required: true,
          description:
            'A concise subject in one language (1–200 characters), e.g. "缅因猫" or "Maine Coon". Avoid mixing translations and many modifiers.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            images: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  candidateId: { type: 'string', required: true },
                  title: { type: 'string', required: true },
                  provider: { type: 'string', required: true },
                  sourceUrl: { type: 'string', required: true },
                  license: { type: 'string', required: true },
                  author: { type: 'string' },
                  licenseUrl: { type: 'string' },
                },
              },
            },
            warnings: { type: 'array', required: true, items: { type: 'string' } },
          },
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      execute: (args, execution) =>
        service.search(scopeFor(ctx, execution), args.query, execution.signal),
      presentCall: (args) => ({
        card: 'generic',
        title: 'Search images',
        kind: 'search',
        rawInput: args.query,
      }),
    }),
  )
  ctx.tools.register(
    defineTool({
      name: 'reply_images_embed',
      description:
        'Download current-turn image candidates and persist them as Harness attachments. Copy each returned Markdown image and caption into the related answer paragraph. Empty images with warnings means continue in text.',
      parameters: {
        candidates: {
          type: 'array',
          required: true,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              candidateId: { type: 'string', required: true },
              alt: {
                type: 'string',
                description: 'Short accessible image label, without unverified visual claims.',
              },
            },
          },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            markdown: { type: 'string', required: true },
            images: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  title: { type: 'string', required: true },
                  markdown: { type: 'string', required: true },
                  sourceUrl: { type: 'string', required: true },
                  license: { type: 'string', required: true },
                  attachmentId: { type: 'string', required: true },
                },
              },
            },
            warnings: { type: 'array', required: true, items: { type: 'string' } },
          },
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      execute: (args, execution) =>
        service.embed(scopeFor(ctx, execution), args.candidates, execution.signal),
      presentCall: (args) => ({
        card: 'generic',
        title: 'Save inline images',
        kind: 'fetch',
        rawInput: `${args.candidates.length} image${args.candidates.length === 1 ? '' : 's'}`,
      }),
    }),
  )
}
