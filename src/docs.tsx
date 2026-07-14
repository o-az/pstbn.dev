import { html, raw } from 'hono/html'
import type { ApiReferenceConfigurationWithMultipleSources } from '@scalar/types/api-reference'

import packageJSON from '#package.json' with { type: 'json' }

type ScalarConfig = (baseUrl: string) => Partial<ApiReferenceConfigurationWithMultipleSources>

const getScalarConfig: ScalarConfig = baseUrl => ({
  url: '/schema',
  theme: 'saturn',
  layout: 'modern',
  telemetry: false,
  hideModels: true,
  hideClientButton: false,
  title: packageJSON.name,
  expandAllResponses: true,
  showDeveloperTools: 'never',
  documentDownloadType: 'json',
  operationTitleSource: 'path',
  sources: [{ url: '/schema', default: true }],
  servers: [{ url: baseUrl, description: 'Current' }],
  defaultHttpClient: { targetKey: 'shell', clientKey: 'curl' },
  hiddenClients: {
    c: true,
    clojure: true,
    csharp: true,
    dart: true,
    fsharp: true,
    go: true,
    http: true,
    java: true,
    js: true,
    kotlin: true,
    node: ['axios', 'ofetch', 'undici'],
    objc: true,
    ocaml: true,
    php: true,
    r: true,
    swift: true
  }
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
        <link
          rel='icon'
          href='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>📋</text></svg>'
        />
      </head>
      <body>
        <main id='app'></main>
        <script src='https://cdn.jsdelivr.net/npm/@scalar/api-reference'></script>
        <script>{html /* jsx */ `Scalar.createApiReference('#app',
        ${raw(JSON.stringify(scalarConfig))})`}</script>
      </body>
    </html>
  )
}
