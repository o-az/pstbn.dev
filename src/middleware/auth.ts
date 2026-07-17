import { Unkey } from '@unkey/api'
import type { MiddlewareHandler } from 'hono'
import { createMiddleware } from 'hono/factory'
import type { V2KeysVerifyKeyResponseData } from '@unkey/api/models/components'

declare module 'hono' {
  interface ContextVariableMap {
    auth: V2KeysVerifyKeyResponseData | undefined
  }
}

export const authMiddleware = (
  options: { permissions?: string } = {}
): MiddlewareHandler<{ Bindings: Cloudflare.Env }> => {
  return createMiddleware(async (context, next) => {
    const authorization = context.req.header('Authorization')
    if (authorization === undefined) return await next()

    const match = authorization.match(/^Bearer ([^\s]+)$/i)
    if (!match)
      return context.json({ error: 'Invalid Authorization header' }, 401)
    const apiKey = authorization.slice(authorization.indexOf(' ') + 1)

    try {
      const unkey = new Unkey({ rootKey: context.env.UNKEY_ROOT_KEY })
      const { data } = await unkey.keys.verifyKey({
        key: apiKey,
        permissions: options.permissions
      })

      if (data.ratelimits?.[0]) {
        const [rateLimit] = data.ratelimits
        context.header('X-RateLimit-Limit', rateLimit.limit.toString())
        context.header('X-RateLimit-Reset', rateLimit.reset.toString())
        context.header('X-RateLimit-Remaining', rateLimit.remaining.toString())
      }

      if (data.credits !== undefined)
        context.header('X-Credit-Remaining', data.credits.toString())

      if (!data.valid) {
        if (
          data.code === 'FORBIDDEN' ||
          data.code === 'INSUFFICIENT_PERMISSIONS'
        )
          return context.json({ error: data.code }, 403)

        if (data.code === 'RATE_LIMITED')
          return context.json({ error: data.code }, 429)

        return context.json({ error: data.code }, 401)
      }

      context.set('auth', data)
      await next()
    } catch (error) {
      console.error(error)
      return context.json({ error: 'Service unavailable' }, 503)
    }
  })
}
