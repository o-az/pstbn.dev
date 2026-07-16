interface EnvironmentVariables extends Cloudflare.Env {
  readonly PORT: string
  readonly NODE_ENV: 'development' | 'production' | 'test'
}

declare const __COMMIT_SHA__: string

// Node.js `process.env` auto-completion
declare namespace NodeJS {
  interface ProcessEnv extends EnvironmentVariables {}
}

// Bun/vite `import.meta.env` auto-completion
interface ImportMetaEnv extends EnvironmentVariables {}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
