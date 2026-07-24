import { fileURLToPath } from 'url'
import { defineConfig } from 'vitest/config'
import { buildDefines } from './build-info.mjs'

export default defineConfig({
  define: buildDefines(),
  resolve: {
    alias: [
      { find: '@peerly/core/react', replacement: fileURLToPath(new URL('./packages/core/src/react.ts', import.meta.url)) },
      { find: '@peerly/core', replacement: fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)) },
      // worker/index.test.mjs runs in plain Node, not the Workers runtime;
      // see scripts/cloudflareWorkersStub.mjs for why this alias is safe.
      { find: 'cloudflare:workers', replacement: fileURLToPath(new URL('./scripts/cloudflareWorkersStub.mjs', import.meta.url)) },
    ],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'packages/core/src/**/*.test.ts', 'worker/**/*.test.mjs'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: [
        'packages/core/src/deviceIdentity.ts',
        'packages/core/src/oidcDeviceBinding.ts',
        'packages/core/src/peerIdentityHandshake.ts',
        'packages/core/src/signedControl.ts',
        'src/collab/friendInvite.ts',
      ],
      thresholds: { lines: 70, functions: 70, statements: 70, branches: 65 },
    },
  },
})
