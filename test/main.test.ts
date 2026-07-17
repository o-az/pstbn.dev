import { unzipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { env, exports } from 'cloudflare:workers'

import { createPastes } from '#storage.ts'
import type { PasteMetadata } from '#storage.ts'

const UNKEY_ORIGIN = 'https://api.unkey.com'
let unkeyRequests: Array<{ pathname: string; body: unknown }>

beforeEach(() => {
  unkeyRequests = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const request = new Request(input, init)
    const url = new URL(request.url)

    if (url.origin !== UNKEY_ORIGIN || request.method !== 'POST')
      throw new Error(`Unexpected outbound request: ${request.method} ${url}`)

    if (url.pathname === '/v2/ratelimit.limit') {
      const body = await request.json()
      unkeyRequests.push({ pathname: url.pathname, body })
      if ((body as { identifier?: string }).identifier === 'rate-limit-error')
        throw new Error('Unkey unavailable')

      return Response.json({
        meta: { requestId: 'test-rate-limit' },
        data: {
          success: true,
          limit: 10,
          remaining: 9,
          reset: Date.now() + 60_000
        }
      })
    }

    if (url.pathname === '/v2/keys.verifyKey') {
      const body = (await request.json()) as { key: string }
      unkeyRequests.push({ pathname: url.pathname, body })
      const code =
        body.key === 'rate-limited-key'
          ? 'RATE_LIMITED'
          : body.key === 'valid-key'
            ? 'VALID'
            : 'NOT_FOUND'

      return Response.json({
        meta: { requestId: 'test-key-verification' },
        data: {
          valid: code === 'VALID',
          code,
          keyId: code === 'NOT_FOUND' ? undefined : 'key_test'
        }
      })
    }

    throw new Error(`Unexpected Unkey endpoint: ${url.pathname}`)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function upload(form: FormData, query = '', authorization?: string) {
  const response = await exports.default.fetch(`http://localhost/${query}`, {
    method: 'POST',
    headers: authorization ? { Authorization: authorization } : undefined,
    body: form
  })
  const responseBody = await response.text()
  const urls = responseBody.trim().split('\n')
  return { response, responseBody, urls }
}

async function getPaste(url: string | undefined) {
  if (url === undefined)
    throw new Error('Upload response did not include a paste URL')

  const id = new URL(url).pathname.slice(1)
  const [object, rawMetadata] = await Promise.all([
    env.PASTE_CONTENT.get(id),
    env.PASTE_METADATA.get(id)
  ])
  if (object === null || rawMetadata === null)
    throw new Error(`Paste ${id} was not stored`)

  return {
    content: await object.arrayBuffer(),
    metadata: JSON.parse(rawMetadata) as PasteMetadata
  }
}

function decode(content: ArrayBuffer | Uint8Array | undefined): string {
  if (content === undefined) throw new Error('Expected content was not found')
  return new TextDecoder().decode(content)
}

describe('API key authentication', () => {
  test('allows public uploads and limits them by connecting IP', async () => {
    const response = await exports.default.fetch('http://localhost/', {
      method: 'POST',
      headers: { 'CF-Connecting-IP': '203.0.113.1' },
      body: 'hello'
    })

    expect(response.status).toBe(201)
    expect(unkeyRequests).toEqual([
      {
        pathname: '/v2/ratelimit.limit',
        body: expect.objectContaining({ identifier: '203.0.113.1' })
      }
    ])
  })

  test('fails closed when the public rate limiter is unavailable', async () => {
    const response = await exports.default.fetch('http://localhost/', {
      method: 'POST',
      headers: { 'CF-Connecting-IP': 'rate-limit-error' },
      body: 'hello'
    })

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'Service unavailable' })
  })

  test('rejects a malformed Authorization header without contacting Unkey', async () => {
    const response = await exports.default.fetch('http://localhost/', {
      method: 'POST',
      headers: { Authorization: 'Basic valid-key' },
      body: 'hello'
    })

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({
      error: 'Invalid Authorization header'
    })
    expect(unkeyRequests).toEqual([])
  })

  test('rejects an invalid API key', async () => {
    const response = await exports.default.fetch('http://localhost/', {
      method: 'POST',
      headers: { Authorization: 'Bearer invalid-key' },
      body: 'hello'
    })

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'NOT_FOUND' })
    expect(unkeyRequests.map(request => request.pathname)).toEqual([
      '/v2/keys.verifyKey'
    ])
  })

  test('uses only the key-attached limit for a valid API key', async () => {
    const response = await exports.default.fetch('http://localhost/', {
      method: 'POST',
      headers: { Authorization: 'Bearer valid-key' },
      body: 'hello'
    })

    expect(response.status).toBe(201)
    const pasteResponse = await exports.default.fetch(
      (await response.text()).trim()
    )
    expect(await pasteResponse.text()).toBe('hello')
    expect(unkeyRequests.map(request => request.pathname)).toEqual([
      '/v2/keys.verifyKey'
    ])
  })

  test('returns the key-attached rate limit response', async () => {
    const response = await exports.default.fetch('http://localhost/', {
      method: 'POST',
      headers: { Authorization: 'Bearer rate-limited-key' },
      body: 'hello'
    })

    expect(response.status).toBe(429)
    expect(await response.json()).toEqual({ error: 'RATE_LIMITED' })
  })

  test('keeps paste retrieval public and unmetered', async () => {
    const uploadResponse = await exports.default.fetch('http://localhost/', {
      method: 'POST',
      body: 'shared paste'
    })
    const pasteUrl = await uploadResponse.text()
    unkeyRequests = []

    const response = await exports.default.fetch(pasteUrl.trim())

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('shared paste')
    expect(unkeyRequests).toEqual([])
  })
})

describe('multipart uploads', () => {
  test('stores one entry directly by default', async () => {
    const form = new FormData()
    form.append(
      'video',
      new File(['video'], 'video.mp4', { type: 'video/mp4' })
    )

    const { response, urls } = await upload(form)
    const paste = await getPaste(urls[0])

    expect(response.status).toBe(201)
    expect(urls).toHaveLength(1)
    expect(decode(paste.content)).toBe('video')
    expect(paste.metadata.contentType).toBe('video/mp4')
  })

  test('zips multiple entries by default with safe unique names', async () => {
    const form = new FormData()
    form.append('video', new File(['video'], '../media.bin'))
    form.append('image', new File(['image'], 'media.bin'))
    form.append('prototype', new File(['prototype'], '__proto__'))
    form.append('caption', 'hello')
    form.append('long', new File(['long'], `${'a'.repeat(300)}.txt`))

    const { response, urls } = await upload(form)
    const paste = await getPaste(urls[0])
    const archive = unzipSync(new Uint8Array(paste.content))

    expect(response.status).toBe(201)
    expect(urls).toHaveLength(1)
    expect(paste.metadata.contentType).toBe('application/zip')
    expect(Object.keys(archive)).toEqual([
      'media.bin',
      'media-2.bin',
      'file-3',
      'caption.txt',
      'file-5'
    ])
    expect(decode(archive['caption.txt'])).toBe('hello')
  })

  test('zip=false creates one paste per entry', async () => {
    const form = new FormData()
    form.append('first', 'one')
    form.append('second', 'two')

    const { response, urls } = await upload(form, '?zip=false')
    const pastes = await Promise.all(urls.map(getPaste))

    expect(response.status).toBe(201)
    expect(urls).toHaveLength(2)
    expect(pastes.map(paste => decode(paste.content))).toEqual(['one', 'two'])
  })

  test('zip=true archives one entry', async () => {
    const form = new FormData()
    form.append('note', 'hello')

    const { response, urls } = await upload(form, '?zip=true')
    const paste = await getPaste(urls[0])

    expect(response.status).toBe(201)
    expect(Object.keys(unzipSync(new Uint8Array(paste.content)))).toEqual([
      'note.txt'
    ])
  })

  test('rejects more than ten entries', async () => {
    const form = new FormData()
    for (let index = 0; index < 11; index += 1)
      form.append(`field-${index}`, 'value')

    const { response, responseBody } = await upload(form)

    expect(response.status).toBe(400)
    const error = JSON.parse(responseBody) as { ok: boolean; error: string }
    expect(error).toEqual({
      ok: false,
      error: 'Too many multipart entries; maximum is 10'
    })
  })

  test('rejects an invalid zip option', async () => {
    const form = new FormData()
    form.append('note', 'hello')

    const { response, responseBody } = await upload(form, '?zip=yes')

    expect(response.status).toBe(400)
    expect(JSON.parse(responseBody)).toEqual({
      ok: false,
      error: "'zip' must be 'true' or 'false'"
    })
  })

  test('rejects requests over the overall size limit', async () => {
    const response = await exports.default.fetch('http://localhost/', {
      method: 'POST',
      headers: { 'Content-Length': '1' },
      body: new Uint8Array(25 * 1024 * 1024 + 1)
    })

    expect(response.status).toBe(413)
    expect(await response.text()).toContain('Payload exceeds 25 MiB limit')
  })

  test('allows authenticated uploads over the public size limit', async () => {
    const response = await exports.default.fetch('http://localhost/', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-key',
        'Content-Length': String(25 * 1024 * 1024 + 1)
      },
      body: 'authenticated upload'
    })

    expect(response.status).toBe(201)
  })

  test('enforces the authenticated size limit', async () => {
    const response = await exports.default.fetch('http://localhost/', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-key',
        'Content-Length': String(100_000_001)
      },
      body: 'authenticated upload'
    })

    expect(response.status).toBe(413)
    expect(await response.text()).toContain('Payload exceeds 100 MB limit')
  })

  test('keeps authenticated multipart uploads at the 25 MiB limit', async () => {
    const form = new FormData()
    form.append('file', new Blob(['hello']), 'hello.txt')

    const response = await exports.default.fetch('http://localhost/', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-key',
        'Content-Length': String(25 * 1024 * 1024 + 1)
      },
      body: form
    })

    expect(response.status).toBe(413)
    expect(await response.text()).toContain('Payload exceeds 25 MiB limit')
  })

  test('cleans up every paste when a split storage write fails', async () => {
    const metadata = new Set<string>()
    const contents = new Set<string>()
    let metadataWrites = 0
    const kv = {
      async put(key: string) {
        metadataWrites += 1
        if (metadataWrites === 2) throw new Error('metadata write failed')
        metadata.add(key)
      },
      async delete(key: string) {
        metadata.delete(key)
      }
    } as unknown as KVNamespace
    const r2 = {
      async put(key: string) {
        contents.add(key)
      },
      async delete(keys: string | Array<string>) {
        for (const key of typeof keys === 'string' ? [keys] : keys)
          contents.delete(key)
      }
    } as unknown as R2Bucket

    await expect(
      createPastes({
        kv,
        r2,
        inputs: [
          { content: new TextEncoder().encode('one').buffer, language: null },
          { content: new TextEncoder().encode('two').buffer, language: null }
        ]
      })
    ).rejects.toThrow('metadata write failed')

    expect({ contents: contents.size, metadata: metadata.size }).toEqual({
      contents: 0,
      metadata: 0
    })
  })
})
