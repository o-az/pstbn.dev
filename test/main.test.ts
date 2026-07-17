import { unzipSync } from 'fflate'
import { describe, expect, test } from 'vitest'
import { env, exports } from 'cloudflare:workers'

import { createPastes } from '#storage.ts'
import type { PasteMetadata } from '#storage.ts'

async function upload(form: FormData, query = '') {
  const response = await exports.default.fetch(`http://localhost/${query}`, {
    method: 'POST',
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
      createPastes(kv, r2, [
        { content: new TextEncoder().encode('one').buffer, language: null },
        { content: new TextEncoder().encode('two').buffer, language: null }
      ])
    ).rejects.toThrow('metadata write failed')

    expect({ contents: contents.size, metadata: metadata.size }).toEqual({
      contents: 0,
      metadata: 0
    })
  })
})
