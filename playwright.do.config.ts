import { defineConfig, devices } from '@playwright/test'

/**
 * The Durable Objects browser suite.
 *
 * Separate from playwright.config.ts because the target is different in kind:
 * a built app behind the real worker rather than a dev server, and one shared
 * control plane rather than a relay that keeps workers apart. Everything here
 * meets in that control plane, so the suite is serial — parallel workers would
 * see each other's accounts and rooms.
 *
 * It is also slower to start: the build and the worker boot before the first
 * test, which is why the server timeout is generous and the test timeout is
 * not.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: /durable-objects\.spec\.ts/,
  timeout: 60_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:17275',
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
            // Two contexts on one host would otherwise exchange mDNS
            // candidates they cannot resolve, and never connect.
            '--disable-features=WebRtcHideLocalIpsWithMdns',
            '--allow-insecure-localhost',
          ],
        },
      },
    },
  ],
  webServer: {
    command: 'node server/test-server-do.mjs',
    url: 'http://127.0.0.1:17275/.well-known/jwks.json',
    // Never reuse. The worker serves a build, so a server left over from an
    // earlier run serves that run's bundle — and the suite then passes or
    // fails on code that is no longer in the tree, which is worse than not
    // running it. Costs one rebuild per run.
    reuseExistingServer: false,
    timeout: 180_000,
  },
})
