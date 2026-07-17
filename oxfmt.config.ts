import { defineConfig } from 'oxfmt'

export default defineConfig({
  ignorePatterns: [
    '*.toml',
    '**/_/**',
    '.agents',
    '**/dist/**',
    '**/node_modules/**',
    'worker-configuration.d.ts'
  ],
  jsdoc: true,
  semi: false,
  enabled: true,
  lineWidth: 80,
  indentWidth: 2,
  printWidth: 80,
  singleQuote: true,
  proseWrap: 'never',
  arrowParens: 'avoid',
  jsxSingleQuote: true,
  bracketSpacing: true,
  indentStyle: 'space',
  quoteStyle: 'single',
  trailingComma: 'none',
  bracketSameLine: true,
  sortPackageJson: false,
  quoteProps: 'as-needed',
  insertFinalNewline: true,
  attributePosition: 'auto',
  indentScriptAndStyle: true,
  singleAttributePerLine: true,
  selfCloseVoidElements: 'never',
  embeddedLanguageFormatting: 'auto',
  overrides: [
    {
      files: ['**/*.json', '**/*.json'],
      options: {
        printWidth: 1
      }
    }
  ]
})
