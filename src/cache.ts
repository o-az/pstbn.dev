import { env } from 'cloudflare:workers'
import { CloudflareStore } from '@unkey/cache/stores'

/**
 * @NOTE
 *
 *   This is not used anywhere yet and is a heavy WIP. Do not edit or use Just
 *   Ignore for now.
 */

/**
 * @DOCS
 *
 *   - https://developers.cloudflare.com/workers/runtime-apis/cache/index.md
 *   - https://unkey.com/docs/libraries/ts/cache/overview#cloudflare
 */

export const _cloudflareCache = new CloudflareStore({
  cacheBuster: 'v1', // default
  zoneId: env.CLOUDFLARE_ZONE_ID,
  domain: env.CLOUDFLARE_CACHE_DOMAIN,
  cloudflareApiKey: env.CLOUDFLARE_API_KEY
})
