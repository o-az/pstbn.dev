import type { MiddlewareHandler } from 'hono'

import { MAX_UPLOAD_SIZE } from '#main.tsx'

export const uploadSizeLimit: MiddlewareHandler = async (context, next) => {
  const contentLength = Number(context.req.header('content-length'))

  if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_SIZE)
    return context.json(
      { ok: false, error: 'Payload exceeds 25 MiB limit' },
      413
    )

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
      return context.json(
        { ok: false, error: 'Payload exceeds 25 MiB limit' },
        413
      )
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
