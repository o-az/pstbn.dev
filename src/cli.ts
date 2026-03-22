import { Cli, z } from "incur"

import { createPaste, getPasteContent, getPasteMetadata, listPastes } from "#storage.ts"

export const cli = Cli.create("pstbn.dev", {
  version: process.env.APP_VERSION,
  description: "Agent-frist, simple, robust pastebin",
  vars: z.object({
    r2: z.custom<R2Bucket>(),
    kv: z.custom<KVNamespace>()
  })
})
  .command("create", {
    description: "Create a new paste",
    options: z.object({
      language: z
        .string()
        .optional()
        .describe("Language for syntax highlighting (e.g. json, sh, rust)"),
      content: z.string().optional().describe("Paste content (alternative to piping via stdin)")
    }),
    alias: { language: "l", content: "c" },
    output: z.object({
      id: z.string(),
      language: z.string().nullable(),
      size: z.number(),
      createdAt: z.string(),
      url: z.string()
    }),
    examples: [
      { options: { content: "hello world" }, description: "Create a simple paste" },
      {
        options: { content: "const x = 1", language: "ts" },
        description: "Create a paste with language"
      }
    ],
    run: async context => {
      const content = context.options.content
      if (!content) {
        return context.error({
          code: "MISSING_CONTENT",
          message: "Provide content via --content or pipe via stdin",
          retryable: true
        })
      }

      const paste = await createPaste(
        context.var.kv,
        context.var.r2,
        content,
        context.options.language ?? null
      )

      return context.ok(
        {
          ...paste,
          url: `/${paste.id}`
        },
        {
          cta: {
            description: "Next steps:",
            commands: [{ command: `get ${paste.id}`, description: "View the paste" }]
          }
        }
      )
    }
  })
  .command("get", {
    description: "Get a paste by ID",
    args: z.object({
      id: z.string().describe("Paste ID")
    }),
    options: z.object({
      meta: z.coerce.boolean().optional().describe("Return metadata instead of content")
    }),
    examples: [
      { args: { id: "01ABC123" }, description: "Get paste content" },
      { args: { id: "01ABC123" }, options: { meta: true }, description: "Get paste metadata" }
    ],
    run: async context => {
      if (context.options.meta) {
        const metadata = await getPasteMetadata(context.var.kv, context.args.id)
        if (!metadata) {
          return context.error({
            code: "NOT_FOUND",
            message: `Paste ${context.args.id} not found`,
            retryable: false
          })
        }
        return metadata
      }

      const content = await getPasteContent(context.var.r2, context.args.id)
      if (!content) {
        return context.error({
          code: "NOT_FOUND",
          message: `Paste ${context.args.id} not found`,
          retryable: false
        })
      }
      return { content }
    }
  })
  .command("list", {
    description: "List recent pastes",
    options: z.object({
      limit: z.coerce.number().default(20).describe("Max results to return"),
      cursor: z.string().optional().describe("Pagination cursor from previous response")
    }),
    alias: { limit: "n" },
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
      return await listPastes(context.var.kv, {
        limit: context.options.limit,
        cursor: context.options.cursor
      })
    }
  })

if (import.meta.main) await cli.serve()
