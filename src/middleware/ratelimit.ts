import { Ratelimit } from '@unkey/ratelimit'
import { createMiddleware } from 'hono/factory'

export const rateLimitMiddleware = createMiddleware(async (context, next) => {
  if (context.get('auth') !== undefined) return await next()

  const identifier = context.req.header('CF-Connecting-IP') ?? 'anonymous'

  let result
  try {
    const rateLimiter = new Ratelimit({
      limit: 10,
      duration: '60s',
      namespace: 'api',
      rootKey: context.env.UNKEY_ROOT_KEY
    })
    result = await rateLimiter.limit(identifier)
  } catch (error) {
    console.error(error)
    return context.json({ error: 'Service unavailable' }, 503)
  }

  const { success, remaining, reset } = result

  context.header('X-RateLimit-Remaining', remaining.toString())
  context.header('X-RateLimit-Reset', reset.toString())

  if (!success) return context.json({ error: 'Rate limited' }, 429)

  await next()
})
