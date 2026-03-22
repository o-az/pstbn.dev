import { html, raw } from "hono/html"
import type { ApiReferenceConfigurationWithMultipleSources } from "@scalar/types/api-reference"

import packageJSON from "#package.json" with { type: "json" }

type ScalarConfig = (baseUrl: string) => Partial<ApiReferenceConfigurationWithMultipleSources>

const getScalarConfig: ScalarConfig = baseUrl => ({
  hideModels: true,
  layout: "modern",
  telemetry: false,
  persistAuth: false,
  url: "/schema",
  hideClientButton: true,
  title: packageJSON.name,
  mcp: { disabled: true },
  expandAllResponses: true,
  showDeveloperTools: "never",
  documentDownloadType: "json",
  operationTitleSource: "path",
  sources: [{ url: "/schema", default: true }],
  servers: [{ url: baseUrl, description: "Current" }]
})

export const Docs = (props: { baseUrl: string }) => {
  const scalarConfig = getScalarConfig(props.baseUrl)

  return (
    <html lang='en'>
      <head>
        <title>pstbn.dev</title>
        <meta charset='utf-8' />
        <meta
          name='viewport'
          content='width=device-width, initial-scale=1'
        />
      </head>
      <body>
        <main id='app'></main>
        <script src='https://cdn.jsdelivr.net/npm/@scalar/api-reference'></script>
        <script>{html
        /* jsx */ `Scalar.createApiReference('#app', ${raw(JSON.stringify(scalarConfig))})`}</script>
      </body>
    </html>
  )
}
