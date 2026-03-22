import * as z from "zod/mini"
import { ulid } from "@std/ulid"

const PasteMetadataSchema = z.object({
  id: z.string(),
  size: z.number(),
  createdAt: z.string(),
  language: z.nullable(z.string())
})

export type PasteMetadata = z.infer<typeof PasteMetadataSchema>

export async function createPaste(
  kv: KVNamespace,
  r2: R2Bucket,
  content: string,
  language: string | null
): Promise<PasteMetadata> {
  const id = ulid()
  const encoded = new TextEncoder().encode(content)

  const metadata: PasteMetadata = {
    id,
    language,
    size: encoded.byteLength,
    createdAt: new Date().toISOString()
  }

  await Promise.all([r2.put(id, encoded), kv.put(id, JSON.stringify(metadata))])

  return metadata
}

export async function getPasteContent(r2: R2Bucket, id: string): Promise<string | null> {
  const object = await r2.get(id)
  if (!object) return null
  return object.text()
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
