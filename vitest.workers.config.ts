import { cloudflareTest } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    cloudflareTest({
      // Only preview has Durable Object bindings. Production stays migration-free.
      wrangler: { configPath: './wrangler.preview.jsonc' },
    }),
  ],
  test: {
    include: ['packages/core/worker/realtime/**/*.workers.test.{mjs,ts}'],
    // The plugin isolates storage per file; tests also use distinct object names.
  },
})
