import { Cli, z } from "incur"

const BASE_URL = process.env.PSTBN_URL ?? "https://pstbn.dev"

const cli = Cli.create("pstbn", {
  description: "Agent-first, simple, robust pastebin",
  vars: z.object({})
})

cli.command("create", {
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

    const lang = context.options.language
    const url = new URL(lang ? `/?lang=${lang}` : "/", BASE_URL)
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain", Origin: BASE_URL },
      body: content
    })

    if (!response.ok) {
      const body = await response.text()
      return context.error({
        code: "CREATE_FAILED",
        message: body || "Failed to create paste"
      })
    }

    const pasteUrl = (await response.text()).trim()
    const id = pasteUrl.split("/").pop()
    return context.ok(
      { url: pasteUrl },
      {
        cta: {
          description: "Next steps:",
          commands: [{ command: `get ${id}`, description: "View the paste" }]
        }
      }
    )
  }
})

cli.command("get", {
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
    const accept = context.options.meta ? "application/json" : "text/plain"
    const response = await fetch(new URL(`/${context.args.id}`, BASE_URL), {
      headers: { Accept: accept }
    })

    if (!response.ok) {
      return context.error({
        code: "NOT_FOUND",
        message: `Paste ${context.args.id} not found`,
        retryable: false
      })
    }

    if (context.options.meta) return await response.json()
    return { content: await response.text() }
  }
})

cli.command("list", {
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
    const params = new URLSearchParams({ limit: String(context.options.limit) })
    if (context.options.cursor) params.set("cursor", context.options.cursor)

    const response = await fetch(new URL(`/list?${params}`, BASE_URL))
    const json: unknown = await response.json()
    const Paste = z.object({
      id: z.string(),
      language: z.string().nullable(),
      size: z.number(),
      createdAt: z.string()
    })
    const ListResponse = z.object({
      ok: z.boolean(),
      data: z.object({ pastes: z.array(Paste), cursor: z.nullable(z.string()) })
    })
    const { data } = ListResponse.parse(json)
    return { pastes: data.pastes, cursor: data.cursor }
  }
})

await cli.serve()
