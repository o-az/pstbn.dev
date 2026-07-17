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

async function deletePastes(
  kv: KVNamespace,
  r2: R2Bucket,
  ids: Array<string>
): Promise<void> {
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

type CreatePasteArgs<Content extends ArrayBuffer | ReadableStream> = {
  r2: R2Bucket
  kv: KVNamespace
  content: Content
  language: string | null
  contentType?: string | null
}

export async function createPaste(
  args: CreatePasteArgs<ArrayBuffer>
): Promise<PasteMetadata> {
  const { r2, kv, ...input } = args
  const metadata = preparePaste(input)

  await storePaste(kv, r2, input, metadata)
  return metadata
}

export async function createStreamedPaste<
  Content extends ArrayBuffer | ReadableStream
>(args: CreatePasteArgs<Content>): Promise<PasteMetadata | null> {
  const id = ulid()

  try {
    const object = await args.r2.put(id, args.content)
    if (!object) throw new Error('R2 upload failed')

    if (object.size === 0) {
      await args.r2.delete(id)
      return null
    }

    const metadata = {
      id,
      size: object.size,
      language: args.language,
      createdAt: new Date().toISOString(),
      contentType: args.contentType || undefined
    }
    await args.kv.put(id, JSON.stringify(metadata))
    return metadata
  } catch (error) {
    await deletePastes(args.kv, args.r2, [id])
    throw error
  }
}

export async function createPastes(args: {
  kv: KVNamespace
  r2: R2Bucket
  inputs: Array<PasteInput>
}): Promise<Array<PasteMetadata>> {
  const { kv, r2, inputs } = args

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

export async function getPasteContent(args: {
  r2: R2Bucket
  id: string
}): Promise<R2ObjectBody | null> {
  return await args.r2.get(args.id)
}

export async function getPasteMetadata(args: {
  kv: KVNamespace
  id: string
}): Promise<PasteMetadata | null> {
  const raw = await args.kv.get(args.id)
  if (!raw) return null
  const { data, success, error } = PasteMetadataSchema.safeParse(
    JSON.parse(raw)
  )

  if (success) return data

  console.error(
    `Failed to parse metadata for paste ${args.id} - ${z.prettifyError(error)}`
  )
  return null
}

export async function listPastes(args: {
  kv: KVNamespace
  options?: { limit?: number; cursor?: string }
}): Promise<{ pastes: Array<PasteMetadata>; cursor: string | null }> {
  const limit = args.options?.limit ?? 20
  const result = await args.kv.list({
    limit,
    cursor: args.options?.cursor ?? undefined
  })

  const pastes = await Promise.all(
    result.keys.map(async key => {
      const raw = await args.kv.get(key.name)
      if (!raw) return null

      return JSON.parse(raw)
    })
  )

  return {
    pastes: pastes.filter((paste): paste is PasteMetadata => paste !== null),
    cursor: result.list_complete ? null : result.cursor
  }
}

export type FormEntry = [name: string, value: File | string]

export const MAX_ARCHIVE_NAME_SIZE = 240

/**
 * Keep archive entries recognizable and safe to extract. Strip path components
 * and control characters, then use the provided fallback for empty, reserved,
 * or oversized names.
 */
function safeArchiveName(args: { value: string; fallback: string }): string {
  const { value, fallback } = args

  const basename = value.replaceAll('\\', '/').split('/').pop()
  const safe = Array.from(basename ?? '')
    .filter(character => {
      const code = character.charCodeAt(0)
      return code > 0x1f && code !== 0x7f
    })
    .join('')
    .trim()
  return !safe ||
    safe === '.' ||
    safe === '..' ||
    safe === '__proto__' ||
    new TextEncoder().encode(safe).byteLength > MAX_ARCHIVE_NAME_SIZE
    ? fallback
    : safe
}

// Avoid overwriting entries and case-insensitive extraction collisions by adding -2, -3, etc.
function uniqueArchiveName(filename: string, usedNames: Set<string>): string {
  let candidate = filename
  let suffix = 2
  const dot = filename.lastIndexOf('.')
  const stem = dot > 0 ? filename.slice(0, dot) : filename
  const extension = dot > 0 ? filename.slice(dot) : ''

  while (usedNames.has(candidate.toLowerCase())) {
    candidate = `${stem}-${suffix}${extension}`
    suffix += 1
  }

  usedNames.add(candidate.toLowerCase())
  return candidate
}

export async function toMultipartEntries(
  formEntries: Array<FormEntry>
): Promise<
  Array<{
    filename: string
    contentType: string | undefined
    content: Uint8Array<ArrayBuffer>
  }>
> {
  const usedNames = new Set<string>()
  const entries = await Promise.all(
    formEntries.map(async ([name, value], index) => {
      if (value instanceof File) {
        return {
          content: new Uint8Array(await value.arrayBuffer()),
          contentType:
            value.type === 'application/octet-stream'
              ? undefined
              : value.type || undefined,
          filename: safeArchiveName({
            value: value.name,
            fallback: `file-${index + 1}`
          })
        }
      }

      return {
        content: new TextEncoder().encode(value),
        contentType: 'text/plain; charset=utf-8',
        filename: `${safeArchiveName({
          value: name,
          fallback: `field-${index + 1}`
        })}.txt`
      }
    })
  )

  return entries.map(entry => ({
    ...entry,
    filename: uniqueArchiveName(entry.filename, usedNames)
  }))
}
