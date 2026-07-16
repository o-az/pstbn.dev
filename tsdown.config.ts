import { defineConfig } from 'tsdown'
import { COMMIT_SHA } from './vite.config.ts'

export default defineConfig({
  dts: true,
  clean: true,
  format: 'esm',
  publint: true,
  target: 'esnext',
  entry: ['./src/bin.ts'],
  exports: {
    bin: true,
    all: true,
    enabled: true,
    extensions: true,
    packageJson: true
  },
  define: {
    __COMMIT_SHA__: JSON.stringify(COMMIT_SHA)
  }
})
