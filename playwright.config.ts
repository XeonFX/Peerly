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
  // Keep wall-clock failure budget tight: a blocked UI (e.g. consent banner
  // over Send) should fail in ~30–45s, not 90s × 2 retries × many tests.
  timeout: 45_000,
  expect: { timeout: 15_000 },
  fullyParallel: !nostr,
  workers: nostr ? 1 : process.env.CI ? 2 : 4,
  // One retry on CI only: genuine regressions fail twice; local runs fail once.
  retries: process.env.CI ? 1 : 0,
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