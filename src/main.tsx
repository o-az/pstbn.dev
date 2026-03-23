import { Hono } from "hono"
import { csrf } from "hono/csrf"
import { showRoutes } from "hono/dev"
import { timeout } from "hono/timeout"
import { prettyJSON } from "hono/pretty-json"

import { cli } from "#cli.ts"
import { Docs } from "#docs.tsx"
import { createPaste, getPasteContent, getPasteMetadata } from "#storage.ts"

import OpenAPISchema from "#openapi.json" with { type: "json" }

let _bindings: Cloudflare.Env

cli.use(async (context, next) => {
  context.set("kv", _bindings.PASTE_METADATA)
  context.set("r2", _bindings.PASTE_CONTENT)
  await next()
})

const app = new Hono<{ Bindings: Cloudflare.Env }>()

app.use(csrf())
app.use("*", timeout(5_000))
app.use(prettyJSON({ force: true }))

app.use(async (context, next) => {
  _bindings = context.env
  await next()
})

app.get("/health", context => context.text("ok"))
app
  .get("/schema", context => context.json(OpenAPISchema))
  .get("/openapi.json", context => context.json(OpenAPISchema))

app
  .get("/docs", context => context.html(Docs({ baseUrl: new URL(context.req.url).origin })))
  .get("/", context => context.redirect("/docs"))

app.post("/", async context => {
  const rawContentType = context.req.header("content-type") ?? ""
  const language = context.req.query("lang") ?? null

  let body: ArrayBuffer
  let contentType: string | undefined

  if (rawContentType.includes("multipart/form-data")) {
    const form = await context.req.parseBody()
    const file = form["file"]
    if (!(file instanceof File))
      return context.json({ error: "Missing 'file' field in multipart body" }, 400)
    body = await file.arrayBuffer()
    contentType = file.type || undefined
  } else {
    body = await context.req.arrayBuffer()
    contentType = rawContentType || undefined
  }

  if (!body.byteLength) return context.json({ error: "Empty body" }, 400)

  const paste = await createPaste(
    context.env.PASTE_METADATA,
    context.env.PASTE_CONTENT,
    body,
    language,
    contentType
  )
  const url = new URL(context.req.url)

  return context.text(`${url.origin}/${paste.id}\n`, 201)
})

app.get("/create", async context => {
  const raw = context.req.query("content")
  if (!raw) return context.json({ error: "Missing content query param" }, 400)

  const encoding = context.req.query("encoding")
  const content =
    encoding === "base64"
      ? Uint8Array.from(atob(raw), c => c.charCodeAt(0)).buffer
      : new TextEncoder().encode(raw).buffer
  const language = context.req.query("lang") ?? null
  const paste = await createPaste(
    context.env.PASTE_METADATA,
    context.env.PASTE_CONTENT,
    content,
    language
  )
  const url = new URL(context.req.url)

  return context.text(`${url.origin}/${paste.id}\n`, 201)
})

app.get("/:id", async context => {
  const accept = context.req.header("accept") ?? ""
  const wantsJSON = accept.includes("application/json")
  const wantsText =
    accept.includes("text/html") || accept.includes("text/plain") || accept === "*/*"

  if (wantsJSON || wantsText) {
    const id = context.req.param("id")
    const [object, metadata] = await Promise.all([
      getPasteContent(context.env.PASTE_CONTENT, id),
      getPasteMetadata(context.env.PASTE_METADATA, id)
    ])

    if (object !== null) {
      if (metadata?.language) context.header("X-Language", metadata.language)
      if (wantsJSON) {
        const text = await object.text()
        return context.json({ ...metadata, content: text })
      }
      const ct = metadata?.contentType ?? "text/plain; charset=utf-8"
      context.header("content-type", ct)
      return context.body(object.body)
    }
  }
  return cli.fetch(context.req.raw)
})

app.all("/*", context => cli.fetch(context.req.raw))

if (process.env.NODE_ENV === "development") showRoutes(app, { colorize: true })

export default app satisfies ExportedHandler<Cloudflare.Env>
