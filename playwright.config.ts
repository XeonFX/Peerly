import { defineConfig, devices } from '@playwright/test'

/**
 * Parallelism: each worker gets its own workspace/room (see e2eWorkspaceId in
 * e2e/helpers.ts), so workers never meet over the shared local relay. The
 * Nostr subset stays serial — dozens of concurrent connections from one IP is
 * exactly what public relays throttle.
 */
const nostr = process.env.E2E_SIGNALING === 'nostr'

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 45_000 },
  fullyParallel: !nostr,
  workers: nostr ? 1 : process.env.CI ? 2 : 4,
  // One retry: with 4 workers this machine runs up to 8 Chromium pages doing
  // real WebRTC at once, and a file transfer occasionally misses its window
  // under that contention. A genuine regression still fails twice and reds the
  // run; a timing flake costs one extra test instead of the whole suite.
  retries: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:17273',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    permissions: ['camera', 'microphone'],
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          chromiumSandbox: false,
          args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            '--disable-features=WebRtcHideLocalIpsWithMdns',
            '--allow-insecure-localhost',
          ],
        },
      },
    },
  ],
  webServer: {
    command: 'node server/test-server.mjs',
    url: 'http://127.0.0.1:17273',
    reuseExistingServer: false,
    timeout: 120_000,
  },
})