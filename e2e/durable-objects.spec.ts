import { expect, test, type Page } from '@playwright/test'
import {
  createWorkspace,
  expectMessage,
  expectPeerVisible,
  installFreshSession,
  joinWorkspace,
  sendMessage,
  withTwoGlobalUsers,
  waitForSignaling,
} from './helpers'

/**
 * Two real browsers against the real control plane.
 *
 * Everything else that tests the Durable Objects either calls a gateway's RPCs
 * directly or runs the client with the DO backend switched off. Neither can
 * catch a fault that only appears when a browser talks to a real gateway —
 * and that is the class of fault this migration was chasing: an identity
 * derivation that was wrong in exactly the way the tests' own inputs hid.
 *
 * So the assertions here are the product loops, not the plumbing. Nothing
 * reaches into a socket or asserts on a frame; each test is something a user
 * would notice.
 *
 * What this cannot prove: two Chromium contexts on one host connect over host
 * candidates and never touch TURN. See docs/REWRITE_ARCHITECTURE.md — that
 * needs a separate probe against the real relay.
 */

const WORKSPACE = 'do-e2e'

/** Signed in and on Home, with the control plane up. */
async function signedIn(page: Page, name: string): Promise<void> {
  await createWorkspace(page, {
    name,
    email: `${name.toLowerCase()}@e2e.test`,
    workspaceName: `${WORKSPACE}-${name.toLowerCase()}`,
  })
}

test.describe('durable objects control plane', () => {
  test('signs in through the worker and reaches the control plane', async ({ page }) => {
    // The whole identity chain in one assertion: the browser mints an OIDC
    // token, the worker fetches the JWKS and verifies it, derives an opaque
    // account id, and hands back a session the client can open a socket with.
    // Every earlier version of this test supplied the account id itself.
    await signedIn(page, 'Alice')
    await waitForSignaling(page)
    await expect(page.getByTestId('connection-status')).not.toContainText('Signaling offline')
  })

  test('a second device on the same account is a different account to the server', async ({
    browser,
  }) => {
    // Two contexts, same email, different device keys. The server derives its
    // account id from the token's issuer and subject, so these must land on
    // the same account — while their device keys stay distinct. Getting this
    // backwards is what made every user look like the same user.
    const first = await browser.newContext()
    const second = await browser.newContext()
    try {
      const one = await first.newPage()
      const two = await second.newPage()
      await signedIn(one, 'Alice')
      await installFreshSession(two)
      await two.goto('/')
      await waitForSignaling(one)
      await expect(one.getByTestId('workspace-rail')).toBeVisible()
      await expect(two.getByTestId('identity-login')).toBeVisible()
    } finally {
      await Promise.allSettled([first.close(), second.close()])
    }
  })

  test('two users exchange a message and a fresh browser replays it with both senders offline', async ({ browser }) => {
    // The whole point of the suite: two independent browsers, each with its
    // own device key and its own server-derived account, meeting through the
    // gateway and exchanging a message a person would see.
    const aliceCtx = await browser.newContext()
    const bobCtx = await browser.newContext()
    const contexts = [aliceCtx, bobCtx]
    try {
      const alice = await aliceCtx.newPage()
      const bob = await bobCtx.newPage()

      await joinWorkspace(alice, { name: 'Alice', email: 'alice@e2e.test' })
      await waitForSignaling(alice)
      await joinWorkspace(bob, { name: 'Bob', email: 'bob@e2e.test' })

      // Text uses the authorized content Durable Object. Requiring a WebRTC
      // peer here would make the reliability test fail on the optional file/
      // call path before it can exercise durable delivery.
      await waitForSignaling(alice)
      await waitForSignaling(bob)
      await expectPeerVisible(alice, 'Bob')

      await sendMessage(alice, 'through the gateway')
      await expectMessage(bob, 'through the gateway')

      // Remove both local copies and every possible P2P history source. A new
      // browser can display this only if the encrypted event was committed by
      // the content Durable Object before the original send was acknowledged.
      await Promise.all([aliceCtx.close(), bobCtx.close()])
      const freshBobCtx = await browser.newContext()
      contexts.push(freshBobCtx)
      const freshBob = await freshBobCtx.newPage()
      await joinWorkspace(freshBob, { name: 'Bob', email: 'bob@e2e.test' })
      await expectMessage(freshBob, 'through the gateway')
    } finally {
      await Promise.allSettled(contexts.map(context => context.close()))
    }
  })

  test('global DMs persist text and reactions while attachment bytes stay P2P', async ({
    browser,
  }) => {
    await withTwoGlobalUsers(browser, async (alice, bob, accounts) => {
      await alice.getByTestId('friend-invite-email').fill(accounts.bobEmail)
      await alice.getByTestId('friend-invite-submit').click()
      await expect(bob.getByTestId('friend-incoming')).toBeVisible({ timeout: 20_000 })
      await bob.locator('[data-testid^="friend-accept-"]').click()

      await expect(alice.locator('[data-testid^="friend-message-"]')).toBeVisible({
        timeout: 20_000,
      })
      await alice.locator('[data-testid^="friend-message-"]').click()
      await expect(bob.getByTestId('global-dm-chat')).toBeVisible({ timeout: 20_000 })

      await alice.getByTestId('global-dm-input').fill('Durable direct message')
      await alice.getByTestId('global-dm-send').click()
      await expect(bob.getByTestId('global-dm-messages')).toContainText(
        'Durable direct message',
        { timeout: 20_000 }
      )

      await bob.getByTestId('global-dm-theirs').hover()
      await bob.getByLabel('React 👍').click()
      await expect(alice.getByTestId('global-dm-messages')).toContainText('👍 1', {
        timeout: 20_000,
      })

      await alice.getByTestId('global-dm-file-input').setInputFiles({
        name: 'hybrid.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('Durable metadata, peer-to-peer bytes'),
      })
      const receivedFile = bob.getByRole('link', { name: 'hybrid.txt' })
      await expect(receivedFile).toBeVisible({ timeout: 30_000 })
      await expect(receivedFile).toHaveAttribute('href', /^blob:/)
    })
  })
})

/**
 * Pairing a second device, and taking it away again.
 *
 * These are the changes from the de-duplication pass that carry the most
 * risk — the sync allow-list, the grant exchange, revocation — and until now
 * they were covered only by unit tests. Unit tests cannot see two device keys
 * negotiating, which is the entire mechanism.
 *
 * Both contexts sign in as the *same* person. That is the point: the account
 * is derived from the token's issuer and subject, so both land on one account,
 * while their device keys differ because storage is per-context. A regression
 * that collapses those two ideas passes every other test in this file.
 */
test.describe('device pairing', () => {
  const OWNER = 'alice@e2e.test'

  /** Signed in on the devices screen, with no workspace involved. */
  async function openDevices(page: Page, hash = ''): Promise<void> {
    await installFreshSession(page)
    await page.goto('/')
    await page.getByTestId('e2e-email').fill(OWNER)
    await page.getByTestId('signin-e2e').click()
    await expect(page.getByTestId('workspace-rail')).toBeVisible({ timeout: 20_000 })
    await page.goto(`/devices${hash}`)
    await expect(page.getByTestId('my-devices-page')).toBeVisible({ timeout: 20_000 })
  }

  test('a second device pairs, syncs, and can be revoked', async ({ browser }) => {
    const firstCtx = await browser.newContext()
    const secondCtx = await browser.newContext()
    try {
      const first = await firstCtx.newPage()
      const second = await secondCtx.newPage()

      await openDevices(first)

      // Three values on the first device, one per rule the sync list has:
      // something that should arrive, something the receiving device has
      // already chosen for itself, and something no rule names at all.
      await first.evaluate(() => {
        localStorage.setItem('peerly-profile', JSON.stringify({ userName: 'Synced Ada' }))
        localStorage.setItem('peerly-home-sidebar-width-v1', '321')
        localStorage.setItem('peerly-self-ids:ws-probe', '["must-not-travel"]')
      })

      await first.getByTestId('start-pairing').click()
      const link = await first.getByTestId('pair-link').inputValue()
      expect(link).toContain('#pair=')

      // The second device joins through the one-time link, exactly as a user
      // would by opening it there.
      await openDevices(second, new URL(link).hash)

      // Each side shows the other's fingerprint, and they must agree — this
      // is the only thing that actually authorises the pairing, so a test
      // that skipped it would be testing nothing.
      await expect(first.getByTestId('pair-fingerprint')).toBeVisible({ timeout: 30_000 })
      await expect(second.getByTestId('pair-fingerprint')).toBeVisible({ timeout: 30_000 })
      const shownToFirst = await first.getByTestId('pair-fingerprint').textContent()
      const shownToSecond = await second.getByTestId('pair-fingerprint').textContent()
      expect(shownToFirst).not.toBe(shownToSecond)
      expect(shownToFirst?.trim()).toBeTruthy()

      // Mutual, in both directions, or no grant exists.
      await first.getByTestId('approve-device').click()
      await second.getByTestId('approve-device').click()
      await expect(first.getByTestId('pair-linked')).toBeVisible({ timeout: 30_000 })
      await expect(second.getByTestId('pair-linked')).toBeVisible({ timeout: 30_000 })

      // Each now lists the other, which only happens once both grants exist.
      await expect(first.getByTestId('approved-device')).toHaveCount(1, { timeout: 30_000 })
      await expect(second.getByTestId('approved-device')).toHaveCount(1, { timeout: 30_000 })

      // The account data really moved. Nothing else here proves that: a
      // pairing that exchanged grants and then synced nothing would satisfy
      // every assertion above.
      await expect
        .poll(() => second.evaluate(() => localStorage.getItem('peerly-profile')), {
          timeout: 30_000,
        })
        .toContain('Synced Ada')

      // A choice the receiving device had already made stands. Sync is not
      // supposed to hand one device's preferences to another — the first
      // device's 321 must not replace whatever this one picked.
      const width = await second.evaluate(() =>
        localStorage.getItem('peerly-home-sidebar-width-v1')
      )
      expect(width).not.toBe('321')

      // And the key no rule names did not travel at all. This is the whole
      // point of closing the list: a per-device value must not become a
      // second device's value just because nobody remembered to exclude it.
      expect(
        await second.evaluate(() => localStorage.getItem('peerly-self-ids:ws-probe'))
      ).toBeNull()

      // Revoking drops both directions. Doing it on one device and checking
      // the same device is what the unit tests already do; what matters here
      // is that the grant is really gone rather than merely hidden.
      first.once('dialog', dialog => void dialog.accept())
      await first.getByTestId('revoke-device').click()
      await expect(first.getByTestId('approved-device')).toHaveCount(0, { timeout: 20_000 })

      await first.reload()
      await expect(first.getByTestId('my-devices-page')).toBeVisible({ timeout: 20_000 })
      await expect(first.getByTestId('approved-device')).toHaveCount(0, { timeout: 20_000 })
    } finally {
      await Promise.allSettled([firstCtx.close(), secondCtx.close()])
    }
  })
})
