import { Ratelimit } from '@unkey/ratelimit'
import { createMiddleware } from 'hono/factory'

const rateLimiter = new Ratelimit({
  limit: 10,
  duration: '60s',
  namespace: 'api',
  rootKey: process.env.UNKEY_ROOT_KEY!
})

export const rateLimitMiddleware = createMiddleware(async (context, next) => {
  const identifier =
    context.req.header('x-user-id') ??
    context.req.header('x-forwarded-for') ??
    'anonymous'

  const { success, remaining, reset } = await rateLimiter.limit(identifier)

  context.header('X-RateLimit-Remaining', remaining.toString())
  context.header('X-RateLimit-Reset', reset.toString())

  if (!success) return context.json({ error: 'Rate limited' }, 429)

  await next()
})
