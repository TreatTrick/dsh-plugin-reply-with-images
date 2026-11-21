import { expect, it } from 'vitest'
import { imageDimensions } from '../src/imageDimensions.js'

it('reads PNG, GIF, and JPEG dimensions including a JPEG with an APP segment and fill bytes', () => {
  expect(
    imageDimensions(
      'image/png',
      Buffer.from('89504e470d0a1a0a0000000d4948445200000140000000c8', 'hex'),
    ),
  ).toEqual({ width: 320, height: 200 })
  expect(imageDimensions('image/gif', Buffer.from('4749463839614001c800', 'hex'))).toEqual({
    width: 320,
    height: 200,
  })
  expect(
    imageDimensions('image/jpeg', Buffer.from('ffd8ffe000040000ffffc000080800c8014003', 'hex')),
  ).toEqual({ width: 320, height: 200 })
})

it('reads lossy, lossless, and extended WebP headers', () => {
  const riff = Buffer.from('524946461600000057454250', 'hex')
  const webp = (type: string, chunk: Buffer) => {
    const size = Buffer.alloc(4)
    size.writeUInt32LE(chunk.length)
    return imageDimensions('image/webp', Buffer.concat([riff, Buffer.from(type), size, chunk]))
  }
  expect(webp('VP8 ', Buffer.from('0000009d012a4001c800', 'hex'))).toEqual({
    width: 320,
    height: 200,
  })
  const lossless = Buffer.alloc(5, 0x2f)
  lossless.writeUInt32LE(319 | (199 << 14), 1)
  expect(webp('VP8L', lossless)).toEqual({ width: 320, height: 200 })
  expect(webp('VP8X', Buffer.from('000000003f0100c70000', 'hex'))).toEqual({
    width: 320,
    height: 200,
  })
  expect(webp('VP8 ', Buffer.alloc(10))).toBeUndefined()
})

it('declines unsupported or truncated headers without throwing', () => {
  expect(imageDimensions('image/png', Buffer.alloc(30))).toBeUndefined()
  expect(imageDimensions('image/gif', Buffer.alloc(12))).toBeUndefined()
  expect(imageDimensions('image/jpeg', Buffer.alloc(4))).toBeUndefined()
  expect(imageDimensions('image/jpeg', Buffer.from('ffd8ffda0002', 'hex'))).toBeUndefined()
  expect(imageDimensions('image/jpeg', Buffer.from('ffd8ffc0000808', 'hex'))).toBeUndefined()
  expect(imageDimensions('image/jpeg', Buffer.from('ffd8ffc0000200', 'hex'))).toBeUndefined()
  expect(imageDimensions('image/webp', Buffer.alloc(30))).toBeUndefined()
})
