import type { Context } from '@deepseek-ai/cordis'
import {
  defineTool,
  ToolContextUnavailableError,
  type ToolRunContext,
} from '@deepseek-ai/dsh-tools'
import type { ReplyScope } from './candidates.js'
import { imageLayouts, type ReplyImages } from './replyImages.js'

const scopeFor = (ctx: Context, execution: ToolRunContext): ReplyScope => {
  const owner = execution.agent
  if (owner === undefined)
    throw new ToolContextUnavailableError('Image tools must be called during an Agent response.')
  const boundary = ctx.agents.turnBoundaryOf(owner.session)
  if (boundary.openTurnStartSeq === null)
    throw new ToolContextUnavailableError('Image tools require an active turn.')
  return { owner, turn: boundary.lastTurn, sessionId: owner.session.id, callId: execution.callId }
}

/** Adapt the core image workflow to native Harness tools with replayable session results. */
export const registerImageTools = (ctx: Context, service: ReplyImages): void => {
  ctx.tools.register(
    defineTool({
      name: 'reply_images_prepare',
      description: [
        'Use once whenever real photos, experimental phenomena, diagrams, or visual references make the answer clearer, more intuitive, or more comfortable to read — including science, concepts, history, places, products, organizations, public figures, and comparisons. Do not skip scientific or explanatory topics when real phenomena, experiments, or diagrams can illustrate them. Only skip pure code/debugging, purely symbolic calculation with no visualizable subject, one-line answers, or explicit text-only requests. For a long, multi-section answer with visual value, you must plan 2–3 complementary blocks in one reply_images_prepare call, placed in different sections (do not lump everything into one top block). Never use only single for a long, multi-section answer. Prefer table plus collage or strip. If the answer has any section about key people (关键人物), parties involved (当事人), the founding team (创始团队), or comparisons (对比), you must use layout: "table" with items, one item per person/entity with query, alt, and a short caption. CEOs, CFOs, VPs, and directors of listed companies, government officials, and corporate executives publicly covered by mainstream media are public figures and may be included directly. The tool automatically outputs a — placeholder row for a person without an image. Never abandon table because a person has no photo. Use collage for a core product or one main scene plus two related views of an event or phenomenon; use strip for product interfaces, scenes, experiments, or 3–4 moments or angles of one subject. Reserve single for a standalone visual subject or an additional section highlight. Use concrete photo, experiment, or diagram queries (avoid "logo"/"icon" unless requested). License unconfirmed is normal for search-engine reference images. Never discard a relevant reference image from official sites, encyclopedias, or mainstream media solely because its license is unconfirmed. Retain the actual license metadata; do not claim reuse permission, and honor requests for a documented reusable license. Paste each successful topic.markdown verbatim in its matching section and retain every image link, alt/title marker, and source, author, and license caption. For layout: "table", paste topic.markdown verbatim as a complete Markdown table (keeping its header row, separator row, and surrounding blank lines); never unwrap rows or paste images inline. Use tableMarkdown (only returned for single topics) exclusively inside existing table cells, never as a standalone paragraph. Search and image budgets are separate; reduce per-block image counts to fit both remaining budgets.',
        'Example: {"topics":[{"topic":"People","layout":"table","items":[{"query":"Jensen Huang portrait","alt":"Jensen Huang","caption":"CEO"}]},{"topic":"Products","layout":"collage","query":"Nvidia GPU","alt":"Nvidia GPU"},{"topic":"Scenes","layout":"strip","query":"Nvidia keynote","alt":"Nvidia keynote"}]}',
      ].join('\n'),
      parameters: {
        topics: {
          type: 'array',
          required: true,
          description:
            '1–6 ordered, distinct image sections. For long multi-section answers, plan 2–3 complementary blocks with explicit layouts. Use query and alt with optional count, or use items for one image per subquery.',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              topic: {
                type: 'string',
                required: true,
                description: 'Short subject label that identifies the matching answer section.',
              },
              layout: {
                type: 'string',
                enum: imageLayouts,
                description:
                  'Defaults to single. You must explicitly use table with items for key people, parties involved, the founding team, or comparisons. Prefer table plus collage or strip for long multi-section answers.',
              },
              query: {
                type: 'string',
                description:
                  'Focused query for the whole topic. Required with alt when items is omitted.',
              },
              alt: {
                type: 'string',
                description: 'Accessible image label without unverified visual claims.',
              },
              count: {
                type: 'integer',
                enum: [1, 2, 3, 4, 5],
                description:
                  'Target images from one search. Defaults to 3 for collage/strip and 1 for single/table.',
              },
              items: {
                type: 'array',
                description:
                  '1–5 subqueries, each requesting one image. Required for people tables and comparisons. Missing photos keep their rows with — placeholders. Omit topic-level query, alt, and count when using items.',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    query: { type: 'string', required: true, description: 'Focused subquery.' },
                    alt: {
                      type: 'string',
                      required: true,
                      description: 'Accessible description of this image.',
                    },
                    caption: {
                      type: 'string',
                      description: 'Optional short table description (up to 240 characters).',
                    },
                  },
                },
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
                  layout: {
                    type: 'string',
                    enum: imageLayouts,
                    required: true,
                    description: 'Effective layout after accounting for unavailable images.',
                  },
                  placement: {
                    type: 'string',
                    required: true,
                    description: 'Where to insert this topic image in the answer.',
                  },
                  markdown: {
                    type: 'string',
                    required: true,
                    description:
                      'Copy-ready image, gallery, or complete table for the matching section.',
                  },
                  tableMarkdown: {
                    type: 'string',
                    description:
                      'Provided only for single-image topics; use exclusively inside an existing Markdown table cell, never as a standalone paragraph.',
                  },
                  images: {
                    type: 'array',
                    required: true,
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      properties: {
                        title: { type: 'string', required: true },
                        markdown: {
                          type: 'string',
                          description:
                            'Single-image Markdown (provided only for single-image topics; for table/collage/strip use topics[].markdown).',
                        },
                        tableMarkdown: {
                          type: 'string',
                          description:
                            'Single-line image and attribution for an existing table cell (provided only for single-image topics).',
                        },
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
        rawInput: args.topics.map((row) => `${row.topic} (${row.layout ?? 'single'})`).join(', '),
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
