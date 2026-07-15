import { defineConfig } from 'vitest/config'
import { buildDefines } from './build-info.mjs'

export default defineConfig({
  // Same build constants as vite.config.ts — vitest does not read that file, and
  // anything importing src/config.ts needs __APP_VERSION__ to exist.
  define: buildDefines(),
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
