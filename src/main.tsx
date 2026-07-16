import { ulid } from '@std/ulid'
import { zipSync } from 'fflate'
import { showRoutes } from 'hono/dev'
import { timeout } from 'hono/timeout'
import { prettyJSON } from 'hono/pretty-json'
import { Hono, type MiddlewareHandler } from 'hono'

import { cli } from '#cli.ts'
import { Docs } from '#docs.tsx'
import { createPaste, createPastes, getPasteContent, getPasteMetadata } from '#storage.ts'

import OpenAPISchema from '#openapi.json' with { type: 'json' }

const MAX_MULTIPART_ENTRIES = 10
const MAX_UPLOAD_SIZE = 25 * 1024 * 1024
const MAX_ARCHIVE_NAME_SIZE = 240

let _bindings: Cloudflare.Env

cli.use(async (context, next) => {
  context.set('kv', _bindings.PASTE_METADATA)
  context.set('r2', _bindings.PASTE_CONTENT)
  await next()
})

const app = new Hono<{ Bindings: Cloudflare.Env }>()

app.use('*', timeout(5_000))
app.use(prettyJSON({ force: true }))

app.use(async (context, next) => {
  _bindings = context.env
  await next()
})

const rateLimit: MiddlewareHandler<{ Bindings: Cloudflare.Env }> = async (context, next) => {
  const apiKey = context.req.header('x-api-key') ?? context.req.query('apiKey')
  const validKey = apiKey ? await context.env.PASTE_METADATA.get(`apikey:${apiKey}`) : null

  const limiter = validKey ? context.env.RATE_LIMIT_KEYED : context.env.RATE_LIMIT_FREE
  const key = validKey ? apiKey! : (context.req.header('cf-connecting-ip') ?? 'unknown')

  const { success } = await limiter.limit({ key })
  if (!success) return context.json({ ok: false, error: 'Rate limit exceeded' }, 429)
  await next()
}

const uploadSizeLimit: MiddlewareHandler = async (context, next) => {
  const contentLength = Number(context.req.header('content-length'))
  if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_SIZE)
    return context.json({ ok: false, error: 'Payload exceeds 25 MiB limit' }, 413)

  const body = context.req.raw.body
  if (!body) return await next()

  const chunks: Array<Uint8Array> = []
  const reader = body.getReader()
  let size = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    size += value.byteLength
    if (size > MAX_UPLOAD_SIZE) {
      await reader.cancel()
      return context.json({ ok: false, error: 'Payload exceeds 25 MiB limit' }, 413)
    }
    chunks.push(value)
  }

  const requestInit = {
    body: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk)
        controller.close()
      }
    }),
    duplex: 'half'
  }
  context.req.raw = new Request(context.req.raw, requestInit)
  await next()
}

app.get('/health', context => context.text('ok'))
app.get('/key/generate', context => context.json({ ok: true, key: `pstbn_${ulid()}` }))
app
  .get('/schema', context => context.json(OpenAPISchema))
  .get('/openapi.json', context => context.json(OpenAPISchema))

app
  .get('/docs', context => context.html(Docs({ baseUrl: new URL(context.req.url).origin })))
  .get('/', context => context.redirect('/docs'))

type MultipartEntry = {
  content: Uint8Array<ArrayBuffer>
  contentType: string | undefined
  filename: string
}

type FormEntry = [name: string, value: File | string]

function safeArchiveName(value: string, fallback: string): string {
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

async function toMultipartEntries(formEntries: Array<FormEntry>): Promise<Array<MultipartEntry>> {
  const usedNames = new Set<string>()
  const entries = await Promise.all(
    formEntries.map(async ([name, value], index) => {
      if (value instanceof File) {
        return {
          content: new Uint8Array(await value.arrayBuffer()),
          contentType:
            value.type === 'application/octet-stream' ? undefined : value.type || undefined,
          filename: safeArchiveName(value.name, `file-${index + 1}`)
        }
      }

      return {
        content: new TextEncoder().encode(value),
        contentType: 'text/plain; charset=utf-8',
        filename: `${safeArchiveName(name, `field-${index + 1}`)}.txt`
      }
    })
  )

  return entries.map(entry => ({
    ...entry,
    filename: uniqueArchiveName(entry.filename, usedNames)
  }))
}

app.post('/', rateLimit, uploadSizeLimit, async context => {
  const language = context.req.query('lang') ?? null
  const requestContentType = context.req.header('content-type') ?? ''
  const mediaType = requestContentType.split(';')[0]?.trim().toLowerCase()
  const isMultipart = mediaType === 'multipart/form-data'
  const zipOption = context.req.query('zip')

  if (zipOption !== undefined && zipOption !== 'true' && zipOption !== 'false')
    return context.json({ ok: false, error: "'zip' must be 'true' or 'false'" }, 400)

  if (!isMultipart && zipOption !== undefined)
    return context.json({ ok: false, error: "'zip' is only supported for multipart uploads" }, 400)

  const url = new URL(context.req.url)

  if (isMultipart) {
    let form: FormData
    try {
      form = await context.req.raw.formData()
    } catch {
      return context.json({ ok: false, error: 'Invalid multipart body' }, 400)
    }

    const formEntries = [...form.entries()] as Array<FormEntry>

    if (formEntries.length === 0)
      return context.json({ ok: false, error: 'Multipart body has no entries' }, 400)

    if (formEntries.length > MAX_MULTIPART_ENTRIES)
      return context.json(
        { ok: false, error: `Too many multipart entries; maximum is ${MAX_MULTIPART_ENTRIES}` },
        400
      )

    const entries = await toMultipartEntries(formEntries)
    const shouldZip = zipOption === 'true' || (zipOption === undefined && entries.length > 1)

    if (shouldZip) {
      const archive = Object.create(null) as Record<string, Uint8Array>
      for (const entry of entries) archive[entry.filename] = entry.content

      const zipped = zipSync(archive, { level: 0 })
      const paste = await createPaste(
        context.env.PASTE_METADATA,
        context.env.PASTE_CONTENT,
        zipped.buffer,
        null,
        'application/zip'
      )
      return context.text(`${url.origin}/${paste.id}\n`, 201)
    }

    const pastes = await createPastes(
      context.env.PASTE_METADATA,
      context.env.PASTE_CONTENT,
      entries.map(entry => ({
        content: entry.content.buffer,
        language,
        contentType: entry.contentType
      }))
    )

    return context.text(`${pastes.map(paste => `${url.origin}/${paste.id}`).join('\n')}\n`, 201)
  }

  const body = await context.req.arrayBuffer()
  const contentType = requestContentType.split(';')[0] || undefined

  if (!body.byteLength) return context.json({ ok: false, error: 'Empty body' }, 400)

  const paste = await createPaste(
    context.env.PASTE_METADATA,
    context.env.PASTE_CONTENT,
    body,
    language,
    contentType
  )

  return context.text(`${url.origin}/${paste.id}\n`, 201)
})

app.get('/create', rateLimit, async context => {
  const raw = context.req.query('content')
  if (!raw) return context.json({ ok: false, error: 'Missing content query param' }, 400)

  const encoding = context.req.query('encoding')
  const content =
    encoding === 'base64'
      ? Uint8Array.from(atob(raw), c => c.charCodeAt(0)).buffer
      : new TextEncoder().encode(raw).buffer
  const language = context.req.query('lang') ?? null
  const paste = await createPaste(
    context.env.PASTE_METADATA,
    context.env.PASTE_CONTENT,
    content,
    language
  )
  const url = new URL(context.req.url)

  return context.text(`${url.origin}/${paste.id}\n`, 201)
})

const FORMAT_CONTENT_TYPES = {
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

function parsePastePath(raw: string): { id: string; format: PasteFormat | null } {
  const match = raw.match(
    /^(?<id>[0-9A-HJKMNP-TV-Z]{26})(?:\.(?<format>json|txt|md|html|gif|jpg|jpeg|png|webp|mp4|m4v|mov|webm|avi|mkv|cast))?$/
  )
  return {
    id: match?.groups?.id ?? raw,
    format: (match?.groups?.format as PasteFormat | undefined) ?? null
  }
}

app.get('/:id', async context => {
  const accept = context.req.header('accept') ?? ''
  const { id, format } = parsePastePath(context.req.param('id'))
  const [object, metadata] = await Promise.all([
    getPasteContent(context.env.PASTE_CONTENT, id),
    getPasteMetadata(context.env.PASTE_METADATA, id)
  ])

  if (object !== null) {
    if (metadata?.language) context.header('X-Language', metadata.language)

    if (context.req.query('meta') === 'true') {
      const text = await object.text()
      return context.json({ ...metadata, content: text })
    }

    const contentType = accept.includes('application/json')
      ? FORMAT_CONTENT_TYPES.json
      : format
        ? FORMAT_CONTENT_TYPES[format]
        : (metadata?.contentType ?? 'text/plain; charset=utf-8')

    context.header('content-type', contentType)
    return context.body(object.body)
  }

  return cli.fetch(context.req.raw)
})

app.get('/*', context => cli.fetch(context.req.raw))
app.post('/*', rateLimit, context => cli.fetch(context.req.raw))

if (process.env.NODE_ENV === 'development') showRoutes(app, { colorize: true })

export default app satisfies ExportedHandler<Cloudflare.Env>
