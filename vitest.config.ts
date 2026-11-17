import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/search/types.ts'],
      reporter: ['text', 'html', 'json-summary'],
      thresholds: { lines: 95, statements: 95, branches: 85, functions: 95 },
    },
  },
})
