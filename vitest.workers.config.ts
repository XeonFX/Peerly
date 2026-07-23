import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
  test: {
    include: ['packages/core/worker/realtime/**/*.workers.test.mjs'],
    poolOptions: {
      workers: {
        // The preview config is the one with Durable Object bindings; the
        // default wrangler.jsonc must stay migration-free until cutover
        // (see the comment in wrangler.preview.jsonc).
        wrangler: { configPath: './wrangler.preview.jsonc' },
        // WebSocket tests (control/signal socket upgrades) are not supported
        // under per-file storage isolation — see
        // https://developers.cloudflare.com/workers/testing/vitest-integration/known-issues/#websockets.
        // Every test uses a distinct Durable Object name instead, so
        // disabling isolation does not let state leak between tests.
        isolatedStorage: false,
      },
    },
  },
})
