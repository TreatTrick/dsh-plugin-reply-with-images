import { z } from 'zod'
import {
  AttachmentId,
  isAttachmentError,
  type AttachmentStore,
  type ImageAttachmentRef,
} from '@deepseek-ai/dsh-attachment'

export const MEDIA_PATH = '/api/reply-images'
const reference = z.object({
  id: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  type: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  bytes: z.coerce
    .number()
    .int()
    .positive()
    .max(100 * 1024 * 1024),
  width: z.coerce.number().int().positive().max(100000),
  height: z.coerce.number().int().positive().max(100000),
})
const fail = (status: number, text: string): Response =>
  new Response(text, { status, headers: { 'Cache-Control': 'private, no-store' } })

/** Store complete attachment validation metadata in the URL so restarts need no in-memory mapping. */
export const mediaUrl = (baseUrl: string, ref: ImageAttachmentRef): string => {
  const query = new URLSearchParams({
    id: ref.attachmentId,
    type: ref.mediaType,
    bytes: String(ref.bytes),
    width: String(ref.width),
    height: String(ref.height),
  })
  return `${baseUrl.replace(/\/$/, '')}${MEDIA_PATH}?${query}`
}

/** Authenticate through the official Connection service before invoking; revalidate stored content on read. */
export const createMediaResource =
  (store: Pick<AttachmentStore, 'readImage'>) =>
  async (request: Request): Promise<Response> => {
    if (!['GET', 'HEAD'].includes(request.method))
      return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } })
    const parsed = reference.safeParse(Object.fromEntries(new URL(request.url).searchParams))
    if (!parsed.success) return fail(400, 'Invalid image reference')
    const value = parsed.data
    const ref: ImageAttachmentRef = {
      attachmentId: AttachmentId(value.id),
      mediaType: value.type,
      bytes: value.bytes,
      width: value.width,
      height: value.height,
    }
    try {
      const stored = await store.readImage(ref, request.signal)
      return new Response(request.method === 'HEAD' ? null : stored.data.slice(), {
        headers: {
          'Content-Type': stored.ref.mediaType,
          'Content-Length': String(stored.data.byteLength),
          'Cache-Control': 'private, max-age=31536000, immutable',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "sandbox; default-src 'none'",
        },
      })
    } catch (error) {
      request.signal.throwIfAborted()
      if (!isAttachmentError(error)) throw error
      return fail(
        error.code === 'ATTACHMENT_NOT_FOUND' ? 404 : 409,
        'Image not found or validation failed',
      )
    }
  }
