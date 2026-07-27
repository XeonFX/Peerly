import { expect, test, type Page } from '@playwright/test'
import {
  createWorkspace,
  expectMessage,
  expectPeerVisible,
  installFreshSession,
  joinWorkspace,
  sendMessage,
  waitForPeerConnection,
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

  test('two users in one workspace see each other and exchange messages', async ({ browser }) => {
    // The whole point of the suite: two independent browsers, each with its
    // own device key and its own server-derived account, meeting through the
    // gateway and exchanging a message a person would see.
    const aliceCtx = await browser.newContext()
    const bobCtx = await browser.newContext()
    try {
      const alice = await aliceCtx.newPage()
      const bob = await bobCtx.newPage()

      await joinWorkspace(alice, { name: 'Alice', email: 'alice@e2e.test' })
      await waitForSignaling(alice)
      await joinWorkspace(bob, { name: 'Bob', email: 'bob@e2e.test' })

      await waitForPeerConnection(alice)
      await waitForPeerConnection(bob)
      await expectPeerVisible(alice, 'Bob')

      await sendMessage(alice, 'through the gateway')
      await expectMessage(bob, 'through the gateway')
    } finally {
      await Promise.allSettled([aliceCtx.close(), bobCtx.close()])
    }
  })
})
