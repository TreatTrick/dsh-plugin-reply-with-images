import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'

const JPEG_FRAME = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
])

const jpegDimensions = (bytes: Buffer) => {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return
  let offset = 2
  while (offset + 4 <= bytes.length && bytes[offset++] === 0xff) {
    while (bytes[offset] === 0xff) offset++
    const marker = bytes[offset++]
    if (marker === undefined || marker === 0xda || marker === 0xd9 || offset + 2 > bytes.length)
      break
    const size = bytes.readUInt16BE(offset)
    if (size < 2 || offset + size > bytes.length) break
    if (JPEG_FRAME.has(marker) && size >= 8) {
      return { height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5) }
    }
    offset += size
  }
}

const webpDimensions = (bytes: Buffer) => {
  if (
    bytes.length < 25 ||
    bytes.toString('ascii', 0, 4) !== 'RIFF' ||
    bytes.toString('ascii', 8, 12) !== 'WEBP'
  )
    return
  const type = bytes.toString('ascii', 12, 16)
  if (type === 'VP8X' && bytes.length >= 30) {
    return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) }
  }
  if (type === 'VP8L' && bytes[20] === 0x2f) {
    const bits = bytes.readUInt32LE(21)
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) }
  }
  if (type === 'VP8 ' && bytes.length >= 30 && bytes.toString('hex', 23, 26) === '9d012a') {
    return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff }
  }
}

/** Read dimensions without decoding pixels. Unrecognized headers still go through attachment validation. */
export const imageDimensions = (type: ImageMediaType, data: Uint8Array) => {
  const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  switch (type) {
    case 'image/png':
      if (
        bytes.length >= 24 &&
        bytes.toString('hex', 0, 8) === '89504e470d0a1a0a' &&
        bytes.toString('ascii', 12, 16) === 'IHDR'
      )
        return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
      break
    case 'image/gif':
      if (bytes.length >= 10 && /^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6)))
        return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) }
      break
    case 'image/jpeg':
      return jpegDimensions(bytes)
    case 'image/webp':
      return webpDimensions(bytes)
  }
}
