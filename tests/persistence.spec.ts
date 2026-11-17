import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import { createMediaResource, mediaUrl } from '../src/media.js'

const homes: string[] = []
const roots: Context[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await root.fiber.dispose()
  for (const home of homes.splice(0)) {
    if (!home.startsWith(join(tmpdir(), 'reply-images-test-')))
      throw new Error('Invalid test cleanup path')
    await rm(home, { recursive: true, force: true })
  }
})
const open = async (home: string) => {
  const root = new Context()
  roots.push(root)
  await root.plugin(LocalAttachmentStore, { dshHome: home })
  return root
}

it('reads the same image from Markdown after reopening the real official attachment backend', async () => {
  const home = await mkdtemp(join(tmpdir(), 'reply-images-test-'))
  homes.push(home)
  const first = await open(home)
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
    'base64',
  )
  const ref = await first.attachments.saveImage({ data: png, mediaType: 'image/png' })
  const url = mediaUrl('https://harness.example', ref)
  const saved = await first.attachments.readImage(ref)
  await first.fiber.dispose()
  const reopened = await open(home)
  const response = await createMediaResource(reopened.attachments)(new Request(url))
  expect(response.status).toBe(200)
  expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from(saved.data))
})

it('rejects HTML disguised as PNG through the real attachment service without publishing corrupt images', async () => {
  const home = await mkdtemp(join(tmpdir(), 'reply-images-test-'))
  homes.push(home)
  const root = await open(home)
  await expect(
    root.attachments.saveImage({
      data: Buffer.from('<html>captcha</html>'),
      mediaType: 'image/png',
    }),
  ).rejects.toMatchObject({ code: 'INVALID_IMAGE' })
})
