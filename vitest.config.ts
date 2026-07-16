import { fileURLToPath } from 'url'
import { defineConfig } from 'vitest/config'
import { buildDefines } from './build-info.mjs'

export default defineConfig({
  // Same build constants as vite.config.ts — vitest does not read that file, and
  // anything importing src/config.ts needs __APP_VERSION__ to exist.
  define: buildDefines(),
  resolve: {
    // Mirror vite.config.ts: tests exercise the workspace package from source.
    alias: [
      { find: '@peerly/core/react', replacement: fileURLToPath(new URL('./packages/core/src/react.ts', import.meta.url)) },
      { find: '@peerly/core', replacement: fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)) },
    ],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
