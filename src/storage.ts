import * as z from 'zod/mini'
import { ulid } from '@std/ulid'

import { sniffFile } from '#utilities.ts'

const PasteMetadataSchema = z.object({
  id: z.string(),
  size: z.number(),
  createdAt: z.string(),
  language: z.nullable(z.string()),
  contentType: z.optional(z.string())
})

export type PasteMetadata = z.infer<typeof PasteMetadataSchema>

export type PasteInput = {
  content: ArrayBuffer
  language: string | null
  contentType?: string | null
}

function preparePaste(input: PasteInput): PasteMetadata {
  const id = ulid()
  return {
    id,
    language: input.language,
    size: input.content.byteLength,
    createdAt: new Date().toISOString(),
    contentType: input.contentType ?? sniffFile(input.content).mimeType
  }
}

async function deletePastes(kv: KVNamespace, r2: R2Bucket, ids: Array<string>): Promise<void> {
  await Promise.allSettled([r2.delete(ids), ...ids.map(id => kv.delete(id))])
}

async function storePaste(
  kv: KVNamespace,
  r2: R2Bucket,
  input: PasteInput,
  metadata: PasteMetadata
): Promise<void> {
  try {
    await r2.put(metadata.id, input.content)
    await kv.put(metadata.id, JSON.stringify(metadata))
  } catch (error) {
    await deletePastes(kv, r2, [metadata.id])
    throw error
  }
}

export async function createPaste(
  kv: KVNamespace,
  r2: R2Bucket,
  content: ArrayBuffer,
  language: string | null,
  contentType?: string | null
): Promise<PasteMetadata> {
  const input = { content, language, contentType }
  const metadata = preparePaste(input)

  await storePaste(kv, r2, input, metadata)
  return metadata
}

export async function createPastes(
  kv: KVNamespace,
  r2: R2Bucket,
  inputs: Array<PasteInput>
): Promise<Array<PasteMetadata>> {
  const pastes = inputs.map(input => ({ input, metadata: preparePaste(input) }))
  const results = await Promise.allSettled(
    pastes.map(({ input, metadata }) => storePaste(kv, r2, input, metadata))
  )
  const failure = results.find(result => result.status === 'rejected')

  if (failure) {
    await deletePastes(
      kv,
      r2,
      pastes.map(paste => paste.metadata.id)
    )
    throw failure.reason
  }

  return pastes.map(paste => paste.metadata)
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
