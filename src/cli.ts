import { Cli, z } from 'incur'

import {
  createPaste,
  getPasteContent,
  getPasteMetadata,
  listPastes
} from '#storage.ts'

import packageJSON from '#package.json' with { type: 'json' }

const BASE_URL = process.env.PSTBN_URL ?? 'https://pstbn.dev'

export const cli = Cli.create('pstbn', {
  version: packageJSON.version,
  description: 'Agent-first, simple, robust pastebin',
  vars: z.object({
    r2: z.custom<R2Bucket>().optional(),
    kv: z.custom<KVNamespace>().optional()
  })
})
  .command('create', {
    description: 'Create a new paste',
    options: z.object({
      language: z
        .string()
        .optional()
        .describe('Language for syntax highlighting (e.g. json, sh, rust)'),
      content: z
        .string()
        .optional()
        .describe('Paste content (alternative to piping via stdin)'),
      file: z.string().optional().describe('Path to a file to upload')
    }),
    alias: { language: 'l', content: 'c', file: 'f' },
    output: z.object({
      id: z.string().optional(),
      language: z.string().nullable().optional(),
      size: z.number().optional(),
      createdAt: z.string().optional(),
      url: z.string()
    }),
    examples: [
      {
        options: { content: 'hello world' },
        description: 'Create a simple paste'
      },
      {
        options: { content: 'const x = 1', language: 'ts' },
        description: 'Create a paste with language'
      },
      { options: { file: './video.mp4' }, description: 'Upload a file' }
    ],
    run: async context => {
      const content = context.options.content
      const filePath = context.options.file
      if (content && filePath)
        return context.error({
          code: 'CONFLICTING_INPUT',
          message: 'Provide either --content or --file, not both',
          retryable: true
        })

      if (!content && !filePath)
        return context.error({
          code: 'MISSING_CONTENT',
          message:
            'Provide content via --content, a path via --file, or pipe via stdin',
          retryable: true
        })

      const { kv, r2 } = context.var
      if (kv && r2) {
        if (filePath)
          return context.error({
            code: 'FILE_UNSUPPORTED',
            message: '--file is only available when running the CLI locally',
            retryable: false
          })

        const paste = await createPaste({
          kv,
          r2,
          language: context.options.language ?? null,
          content: new TextEncoder().encode(content).buffer
        })
        return context.ok(
          { ...paste, url: `/${paste.id}` },
          {
            cta: {
              description: 'Next steps:',
              commands: [
                { command: `get ${paste.id}`, description: 'View the paste' }
              ]
            }
          }
        )
      }

      const lang = context.options.language
      const url = new URL(lang ? `?lang=${lang}` : '/', BASE_URL)
      let body: BodyInit
      let headers: HeadersInit | undefined

      if (filePath) {
        try {
          const [{ readFile }, { basename }] = await Promise.all([
            import('node:fs/promises'),
            import('node:path')
          ])
          const bytes = await readFile(filePath)
          const form = new FormData()
          form.append('file', new Blob([bytes]), basename(filePath))
          body = form
        } catch (error) {
          return context.error({
            code: 'FILE_READ_FAILED',
            message:
              error instanceof Error
                ? error.message
                : `Failed to read ${filePath}`,
            retryable: false
          })
        }
      } else {
        body = content!
        headers = { 'Content-Type': 'text/plain' }
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body
      })

      if (!response.ok) {
        const body = await response.text()
        return context.error({
          code: 'CREATE_FAILED',
          message: body || 'Failed to create paste'
        })
      }

      const pasteUrl = (await response.text()).trim()
      const id = pasteUrl.split('/').pop()
      return context.ok(
        { url: pasteUrl },
        {
          cta: {
            description: 'Next steps:',
            commands: [{ command: `get ${id}`, description: 'View the paste' }]
          }
        }
      )
    }
  })
  .command('get', {
    description: 'Get a paste by ID',
    args: z.object({
      id: z.string().describe('Paste ID')
    }),
    options: z.object({
      meta: z.coerce
        .boolean()
        .optional()
        .describe('Return metadata instead of content')
    }),
    examples: [
      { args: { id: '01ABC123' }, description: 'Get paste content' },
      {
        args: { id: '01ABC123' },
        options: { meta: true },
        description: 'Get paste metadata'
      }
    ],
    run: async context => {
      const { kv, r2 } = context.var

      if (context.options.meta) {
        if (kv) {
          const metadata = await getPasteMetadata({
            kv,
            id: context.args.id
          })
          if (!metadata)
            return context.error({
              code: 'NOT_FOUND',
              message: `Paste ${context.args.id} not found`,
              retryable: false
            })

          return metadata
        }
        const response = await fetch(
          new URL(`/${context.args.id}?meta=true`, BASE_URL)
        )
        if (!response.ok)
          return context.error({
            code: 'NOT_FOUND',
            message: `Paste ${context.args.id} not found`,
            retryable: false
          })

        return await response.json()
      }

      if (r2) {
        const object = await getPasteContent({
          id: context.args.id,
          r2
        })
        if (!object)
          return context.error({
            code: 'NOT_FOUND',
            message: `Paste ${context.args.id} not found`,
            retryable: false
          })

        return { content: await object.text() }
      }

      const response = await fetch(new URL(`/${context.args.id}`, BASE_URL), {
        headers: { Accept: 'text/plain' }
      })
      if (!response.ok)
        return context.error({
          code: 'NOT_FOUND',
          message: `Paste ${context.args.id} not found`,
          retryable: false
        })

      return { content: await response.text() }
    }
  })
  .command('list', {
    description: 'List recent pastes',
    options: z.object({
      limit: z.coerce.number().default(20).describe('Max results to return'),
      cursor: z
        .string()
        .optional()
        .describe('Pagination cursor from previous response')
    }),
    alias: { limit: 'n' },
    output: z.object({
      pastes: z.array(
        z.object({
          id: z.string(),
          language: z.string().nullable(),
          size: z.number(),
          createdAt: z.string()
        })
      ),
      cursor: z.string().nullable()
    }),
    run: async context => {
      const { kv } = context.var
      if (kv)
        return await listPastes({
          kv,
          options: {
            limit: context.options.limit,
            cursor: context.options.cursor
          }
        })

      const params = new URLSearchParams({
        limit: String(context.options.limit)
      })
      if (context.options.cursor) params.set('cursor', context.options.cursor)

      const url = new URL(`/list`, BASE_URL)
      url.search = params.toString()

      const response = await fetch(url)
      const json: unknown = await response.json()
      const Paste = z.object({
        id: z.string(),
        language: z.string().nullable(),
        size: z.number(),
        createdAt: z.string()
      })
      const ListResponse = z.object({
        ok: z.boolean(),
        data: z.object({
          pastes: z.array(Paste),
          cursor: z.nullable(z.string())
        })
      })
      const { data } = ListResponse.parse(json)
      return { pastes: data.pastes, cursor: data.cursor }
    }
  })
