/** File sniffer utilities for inferring a safe response MIME type from bytes. */

export const FORMAT_CONTENT_TYPES = {
  txt: 'text/plain; charset=utf-8',
  html: 'text/html; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  json: 'application/json; charset=utf-8',
  gif: 'image/gif',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  webm: 'video/webm',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
  cast: 'application/x-asciicast'
} as const

type PasteFormat = keyof typeof FORMAT_CONTENT_TYPES

export function parsePastePath(raw: string): {
  id: string
  format: PasteFormat | null
} {
  const match = raw.match(
    /^(?<id>[0-9A-HJKMNP-TV-Z]{26})(?:\.(?<format>json|txt|md|html|gif|jpg|jpeg|png|webp|mp4|m4v|mov|webm|avi|mkv|cast))?$/
  )
  return {
    id: match?.groups?.id ?? raw,
    format: (match?.groups?.format as PasteFormat | undefined) ?? null
  }
}

const SIGNATURES = [
  [[0xff, 0xd8, 0xff], 'image/jpeg'],
  [[0x89, 0x50, 0x4e, 0x47], 'image/png'],
  [[0x47, 0x49, 0x46, 0x38], 'image/gif'],
  [[0x25, 0x50, 0x44, 0x46], 'application/pdf'],
  [[0x50, 0x4b, 0x03, 0x04], 'application/zip'],
  [[0x1f, 0x8b, 0x08], 'application/gzip']
] as const satisfies Array<[Array<number>, string]>

const ISO_BASE_MEDIA_BRANDS = new Map([
  ['avc1', 'video/mp4'],
  ['dash', 'video/mp4'],
  ['iso2', 'video/mp4'],
  ['iso3', 'video/mp4'],
  ['iso4', 'video/mp4'],
  ['iso5', 'video/mp4'],
  ['iso6', 'video/mp4'],
  ['isom', 'video/mp4'],
  ['m4v ', 'video/x-m4v'],
  ['mp41', 'video/mp4'],
  ['mp42', 'video/mp4'],
  ['qt  ', 'video/quicktime']
])

export function sniffFile(buf: ArrayBuffer): {
  mimeType: string
  kind: 'text' | 'binary'
} {
  const bytes = new Uint8Array(buf, 0, Math.min(12, buf.byteLength))

  for (const [signature, mimeType] of SIGNATURES) {
    if (signature.every((byte, index) => bytes[index] === byte)) {
      return {
        mimeType,
        kind: 'binary'
      }
    }
  }

  const containerType = sniffContainer(buf)
  if (containerType) {
    return {
      mimeType: containerType,
      kind: 'binary'
    }
  }

  if (looksLikeText(buf)) {
    return {
      mimeType: 'text/plain; charset=utf-8',
      kind: 'text'
    }
  }

  return {
    mimeType: 'application/octet-stream',
    kind: 'binary'
  }
}

function sniffContainer(buf: ArrayBuffer): string | null {
  if (buf.byteLength < 12) return null

  const bytes = new Uint8Array(buf, 0, Math.min(16, buf.byteLength))
  const text = new TextDecoder().decode(bytes)

  if (text.slice(4, 8) === 'ftyp') {
    return ISO_BASE_MEDIA_BRANDS.get(text.slice(8, 12)) ?? 'video/mp4'
  }

  if (text.slice(0, 4) === 'RIFF') {
    if (text.slice(8, 12) === 'WEBP') return 'image/webp'
    if (text.slice(8, 12) === 'AVI ') return 'video/x-msvideo'
  }

  if (
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  ) {
    const header = new TextDecoder().decode(
      new Uint8Array(buf, 0, Math.min(4_096, buf.byteLength))
    )
    if (header.includes('webm')) return 'video/webm'
    if (header.includes('matroska')) return 'video/x-matroska'
  }

  return null
}

function looksLikeText(buf: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buf, 0, Math.min(8_192, buf.byteLength))
  if (!bytes.length) return true

  let suspicious = 0

  for (const byte of bytes) {
    if (byte === 0) return false

    const isControl =
      byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d
    if (isControl) suspicious += 1
  }

  return suspicious / bytes.length < 0.02
}
