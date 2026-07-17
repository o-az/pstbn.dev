import type { MiddlewareHandler } from 'hono'

export const MAX_PUBLIC_UPLOAD_SIZE = 25 * 1024 * 1024
export const MAX_AUTHENTICATED_RAW_UPLOAD_SIZE = 100_000_000

export const uploadSizeLimit: MiddlewareHandler = async (context, next) => {
  const mediaType = context.req
    .header('content-type')
    ?.split(';')
    .at(0)
    ?.trim()
    .toLowerCase()
  const isAuthenticatedRaw =
    context.get('auth') !== undefined && mediaType !== 'multipart/form-data'
  const maxUploadSize = isAuthenticatedRaw
    ? MAX_AUTHENTICATED_RAW_UPLOAD_SIZE
    : MAX_PUBLIC_UPLOAD_SIZE
  const limitLabel = isAuthenticatedRaw ? '100 MB' : '25 MiB'
  const contentLength = Number(context.req.header('content-length'))

  if (Number.isFinite(contentLength) && contentLength > maxUploadSize)
    return context.json(
      { ok: false, error: `Payload exceeds ${limitLabel} limit` },
      413
    )

  if (isAuthenticatedRaw) return await next()

  const body = context.req.raw.body
  if (!body) return await next()

  const chunks: Array<Uint8Array> = []
  const reader = body.getReader()
  let size = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    size += value.byteLength
    if (size > maxUploadSize) {
      await reader.cancel()
      return context.json(
        { ok: false, error: `Payload exceeds ${limitLabel} limit` },
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
