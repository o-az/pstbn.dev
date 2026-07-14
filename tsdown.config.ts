import { defineConfig } from 'tsdown'

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
  }
})
