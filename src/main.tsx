import { Hono } from 'hono'
import { zipSync } from 'fflate'
import { showRoutes } from 'hono/dev'
import { timeout } from 'hono/timeout'
import { prettyJSON } from 'hono/pretty-json'

import {
  createPaste,
  createPastes,
  type FormEntry,
  getPasteContent,
  getPasteMetadata,
  toMultipartEntries,
  createStreamedPaste
} from '#storage.ts'
import { cli } from '#cli.ts'
import { Docs } from '#docs.tsx'
import { authMiddleware } from '#middleware/auth.ts'
import { uploadSizeLimit } from '#middleware/upload-size.ts'
import { rateLimitMiddleware } from '#middleware/ratelimit.ts'
import { FORMAT_CONTENT_TYPES, parsePastePath } from '#utilities.ts'

import OpenAPISchema from '#openapi.json' with { type: 'json' }

export const MAX_MULTIPART_ENTRIES = 10

let _bindings: Cloudflare.Env
const requestTimeout = timeout(5_000)

cli.use(async (context, next) => {
  context.set('kv', _bindings.PASTE_METADATA)
  context.set('r2', _bindings.PASTE_CONTENT)
  await next()
})

const app = new Hono<{ Bindings: Cloudflare.Env }>()
  .use('*', (context, next) =>
    context.req.method === 'POST' ? next() : requestTimeout(context, next)
  )
  .use(prettyJSON({ force: true }))
  .use(async (context, next) => {
    _bindings = context.env
    await next()
  })

app
  .get('/health', context => context.text('ok'))
  .get('/status', context =>
    context.json({
      ok: true,
      commitSha: __COMMIT_SHA__ || context.env.COMMIT_SHA
    })
  )
  .get('/', context => context.redirect('/docs'))
  .get('/schema', context => context.json(OpenAPISchema))
  .get('/openapi.json', context => context.json(OpenAPISchema))
  .get('/docs', context =>
    context.html(Docs({ baseUrl: new URL(context.req.url).origin }))
  )

app.post(
  '/',
  authMiddleware(),
  rateLimitMiddleware,
  uploadSizeLimit,
  async context => {
    const language = context.req.query('lang') ?? null
    const requestContentType = context.req.header('content-type') ?? ''

    const mediaType = requestContentType.split(';').at(0)?.trim().toLowerCase()
    const isMultipart = mediaType === 'multipart/form-data'

    const zipOption = context.req.query('zip')
    if (
      zipOption !== undefined &&
      zipOption !== 'true' &&
      zipOption !== 'false'
    )
      return context.json(
        { ok: false, error: "'zip' must be 'true' or 'false'" },
        400
      )

    if (!isMultipart && zipOption !== undefined)
      return context.json(
        { ok: false, error: "'zip' is only supported for multipart uploads" },
        400
      )

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
        return context.json(
          { ok: false, error: 'Multipart body has no entries' },
          400
        )

      if (formEntries.length > MAX_MULTIPART_ENTRIES)
        return context.json(
          {
            ok: false,
            error: `Too many multipart entries; maximum is ${MAX_MULTIPART_ENTRIES}`
          },
          400
        )

      const entries = await toMultipartEntries(formEntries)
      const shouldZip =
        zipOption === 'true' || (zipOption === undefined && entries.length > 1)

      if (shouldZip) {
        const archive = Object.create(null) as Record<string, Uint8Array>
        for (const entry of entries) archive[entry.filename] = entry.content

        const zipped = zipSync(archive, { level: 0 })
        const paste = await createPaste({
          content: zipped.buffer,
          language: null,
          contentType: 'application/zip',
          r2: context.env.PASTE_CONTENT,
          kv: context.env.PASTE_METADATA
        })
        return context.text(`${url.origin}/${paste.id}\n`, 201)
      }

      const pastes = await createPastes({
        r2: context.env.PASTE_CONTENT,
        kv: context.env.PASTE_METADATA,
        inputs: entries.map(entry => ({
          language,
          content: entry.content.buffer,
          contentType: entry.contentType
        }))
      })

      return context.text(
        `${pastes.map(paste => `${url.origin}/${paste.id}`).join('\n')}\n`,
        201
      )
    }

    const contentType = requestContentType.split(';').at(0) || undefined

    if (context.get('auth') !== undefined) {
      const body = context.req.raw.body
      if (!body) return context.json({ ok: false, error: 'Empty body' }, 400)

      const paste = await createStreamedPaste({
        r2: context.env.PASTE_CONTENT,
        kv: context.env.PASTE_METADATA,
        content: body,
        language,
        contentType
      })
      if (!paste) return context.json({ ok: false, error: 'Empty body' }, 400)

      return context.text(`${url.origin}/${paste.id}\n`, 201)
    }

    const body = await context.req.arrayBuffer()
    if (!body.byteLength)
      return context.json({ ok: false, error: 'Empty body' }, 400)

    const paste = await createPaste({
      r2: context.env.PASTE_CONTENT,
      kv: context.env.PASTE_METADATA,
      language,
      contentType,
      content: body
    })

    return context.text(`${url.origin}/${paste.id}\n`, 201)
  }
)

app.get('/create', authMiddleware(), rateLimitMiddleware, async context => {
  const raw = context.req.query('content')
  if (!raw)
    return context.json(
      { ok: false, error: 'Missing content query param' },
      400
    )

  const encoding = context.req.query('encoding')
  const content =
    encoding === 'base64'
      ? Uint8Array.from(atob(raw), c => c.charCodeAt(0)).buffer
      : new TextEncoder().encode(raw).buffer
  const language = context.req.query('lang') ?? null
  const paste = await createPaste({
    content,
    language,
    r2: context.env.PASTE_CONTENT,
    kv: context.env.PASTE_METADATA
  })
  const url = new URL(context.req.url)

  return context.text(`${url.origin}/${paste.id}\n`, 201)
})

app.get('/:id', async context => {
  const accept = context.req.header('accept') ?? ''
  const { id, format } = parsePastePath(context.req.param('id'))
  const [object, metadata] = await Promise.all([
    getPasteContent({
      id,
      r2: context.env.PASTE_CONTENT
    }),
    getPasteMetadata({
      id,
      kv: context.env.PASTE_METADATA
    })
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
app.post(
  '/*',
  authMiddleware(),
  rateLimitMiddleware,
  uploadSizeLimit,
  context => cli.fetch(context.req.raw)
)

if (process.env.NODE_ENV === 'development') showRoutes(app, { colorize: true })

export default app satisfies ExportedHandler<Cloudflare.Env>
