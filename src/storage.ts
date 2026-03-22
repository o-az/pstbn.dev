import * as z from "zod/mini"
import { ulid } from "@std/ulid"

const SIGNATURES = [
  [[0xff, 0xd8, 0xff], "image/jpeg"],
  [[0x89, 0x50, 0x4e, 0x47], "image/png"],
  [[0x47, 0x49, 0x46, 0x38], "image/gif"],
  [[0x52, 0x49, 0x46, 0x46], "image/webp"], // RIFF (check WEBP at offset 8 ideally, but good enough)
  [[0x25, 0x50, 0x44, 0x46], "application/pdf"]
] as const satisfies Array<[Array<number>, string]>

function detectContentType(buf: ArrayBuffer, hint?: string): string {
  if (hint && hint !== "application/octet-stream") return hint

  const bytes = new Uint8Array(buf, 0, Math.min(12, buf.byteLength))
  for (const [sig, mime] of SIGNATURES) {
    if (sig.every((byte, index) => bytes[index] === byte)) return mime
  }
  return hint ?? "application/octet-stream"
}

const PasteMetadataSchema = z.object({
  id: z.string(),
  size: z.number(),
  createdAt: z.string(),
  language: z.nullable(z.string()),
  contentType: z.optional(z.string())
})

export type PasteMetadata = z.infer<typeof PasteMetadataSchema>

export async function createPaste(
  kv: KVNamespace,
  r2: R2Bucket,
  content: ArrayBuffer,
  language: string | null,
  contentType?: string
): Promise<PasteMetadata> {
  const id = ulid()

  const detectedType = detectContentType(content, contentType)

  const metadata: PasteMetadata = {
    id,
    language,
    size: content.byteLength,
    createdAt: new Date().toISOString(),
    contentType: detectedType
  }

  await Promise.all([r2.put(id, content), kv.put(id, JSON.stringify(metadata))])

  return metadata
}

export async function getPasteContent(r2: R2Bucket, id: string): Promise<R2ObjectBody | null> {
  return await r2.get(id)
}

export async function getPasteMetadata(kv: KVNamespace, id: string): Promise<PasteMetadata | null> {
  const raw = await kv.get(id)
  if (!raw) return null
  const { data, success, error } = PasteMetadataSchema.safeParse(JSON.parse(raw))

  if (success) return data

  console.error(`Failed to parse metadata for paste ${id} - ${z.prettifyError(error)}`)
  return null
}

export async function listPastes(
  kv: KVNamespace,
  options?: { limit?: number; cursor?: string }
): Promise<{ pastes: Array<PasteMetadata>; cursor: string | null }> {
  const limit = options?.limit ?? 20
  const result = await kv.list({ limit, cursor: options?.cursor ?? undefined })

  const pastes = await Promise.all(
    result.keys.map(async key => {
      const raw = await kv.get(key.name)
      if (!raw) return null

      return JSON.parse(raw)
    })
  )

  return {
    pastes: pastes.filter((paste): paste is PasteMetadata => paste !== null),
    cursor: result.list_complete ? null : result.cursor
  }
}
