import { Unkey } from '@unkey/api'
import { createMiddleware } from 'hono/factory'
import { Context, type MiddlewareHandler } from 'hono'
import type { V2KeysVerifyKeyResponseData } from '@unkey/api/models/components'

declare module 'hono' {
  interface ContextVariableMap {
    auth: V2KeysVerifyKeyResponseData
  }
}

type AuthMiddleware = (options?: {
  permissions?: string
  getKey?: (conext: Context) => string | null
}) => MiddlewareHandler<{
  Bindings: Cloudflare.Env
}>

export const authMiddleware: AuthMiddleware = (options = {}) => {
  return createMiddleware(async (context, next) => {
    const apiKey = context.req.header('Authorization')?.replace('Bearer ', '')
    if (!apiKey) return context.json({ error: 'Missing API key' }, 401)

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

      if (data.credits)
        context.header('X-Credit-Remaining', data.credits.toString())

      if (!data.valid)
        return context.json(
          { error: data.code },
          data.code === 'RATE_LIMITED' ? 429 : 401
        )

      if (data.code === 'INSUFFICIENT_PERMISSIONS')
        return context.json({ error: 'Forbidden' }, 403)

      context.set('auth', data)
      await next()
    } catch (error) {
      console.error(error)
      return context.json({ error: 'Service unavailable' }, 503)
    }
  })
}
