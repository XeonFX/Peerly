import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import {
  expectMessage,
  joinWorkspace,
  sendMessage,
  waitForPeerConnection,
  waitForRelay,
  waitForWorkspace,
} from './helpers'

/**
 * Two tabs of one browser profile share one device key and one sign-in. Each is its own peer under a tab key the
 * device key certifies (docs/two-tabs.md). These run two pages in ONE browser context, which is what shares
 * IndexedDB, localStorage, BroadcastChannel and Web Locks between them, as real tabs do.
 */

const JOINED = 'This workspace is also open in another tab of this browser.'
const LEFT = 'Your other tab closed. This tab is still connected.'

/** Alice's first tab joins; her second tab opens the same workspace URL, as a user opening a new tab would. */
async function aliceInTwoTabs(browser: Browser) {
  const context = await browser.newContext()
  const first = await context.newPage()
  await joinWorkspace(first, { name: 'Alice', email: 'alice@e2e.test' })
  await waitForRelay(first)
  const second = await openAnotherTab(context, first)
  await waitForPeerConnection(first)
  await waitForPeerConnection(second)
  return { context, first, second }
}

async function openAnotherTab(context: BrowserContext, existing: Page) {
  const tab = await context.newPage()
  // No installFreshSession here: that would wipe the storage the first tab shares with this one.
  await tab.goto(existing.url())
  await waitForWorkspace(tab)
  return tab
}

async function joinBob(browser: Browser) {
  const context = await browser.newContext()
  const bob = await context.newPage()
  await joinWorkspace(bob, { name: 'Bob', email: 'bob@e2e.test' })
  return { context, bob }
}

test.describe('two tabs of one browser', () => {
  test('two tabs join one workspace as two peers of the same person, and stay in sync', async ({ browser }) => {
    const alice = await aliceInTwoTabs(browser)
    for (const tab of [alice.first, alice.second]) {
      await expect(tab.getByTestId('error-banner')).toHaveCount(0)
      await expect(tab.getByTestId('tab-notice')).toContainText(JOINED)
      await expect(tab.getByTestId('member-self-tabs')).toHaveText('you · 2 tabs')
      // Your other tab is you: it is not listed as another member.
      await expect(tab.getByTestId('member-Alice')).toHaveCount(0)
    }
    await alice.first.getByTestId('tab-notice-dismiss').click()
    await expect(alice.first.getByTestId('tab-notice')).toHaveCount(0)

    const { context: bobContext, bob } = await joinBob(browser)
    try {
      await waitForPeerConnection(bob)
      await expect(bob.getByTestId('member-Alice')).toHaveCount(1)
      await expect(alice.first.getByTestId('connection-status')).toContainText('Connected (2 peers)')

      await sendMessage(alice.first, 'Sent from my first tab')
      await expectMessage(alice.second, 'Sent from my first tab')
      await expectMessage(bob, 'Sent from my first tab')
      // My own message from my other tab is not unread here.
      await expect(alice.second.locator('[data-testid^="unread-"]')).toHaveCount(0)

      await sendMessage(bob, 'Hi to both of your tabs')
      await expectMessage(alice.first, 'Hi to both of your tabs')
      await expectMessage(alice.second, 'Hi to both of your tabs')

    } finally {
      await Promise.allSettled([alice.context.close(), bobContext.close()])
    }
  })

  test('one tab closes: the other says so once and keeps working', async ({ browser }) => {
    const alice = await aliceInTwoTabs(browser)
    const { context: bobContext, bob } = await joinBob(browser)
    try {
      await waitForPeerConnection(bob)
      await alice.second.close()

      await expect(alice.first.getByTestId('tab-notice')).toContainText(LEFT, { timeout: 20_000 })
      await expect(alice.first.getByTestId('member-self-tabs')).toHaveText('you')
      await expect(alice.first.getByTestId('error-banner')).toHaveCount(0)

      await sendMessage(bob, 'Still here?')
      await expectMessage(alice.first, 'Still here?')
    } finally {
      await Promise.allSettled([alice.context.close(), bobContext.close()])
    }
  })

  test('both tabs reconnect after reloading, without a closed-tab notice', async ({ browser }) => {
    const alice = await aliceInTwoTabs(browser)
    try {
      await alice.second.reload()
      await waitForWorkspace(alice.second)
      await waitForPeerConnection(alice.second)
      await alice.first.reload()
      await waitForWorkspace(alice.first)
      await waitForPeerConnection(alice.first)
      await waitForPeerConnection(alice.second)

      // A reload is the same tab coming back: neither tab announces the other as closed.
      await alice.first.waitForTimeout(7_000)
      for (const tab of [alice.first, alice.second]) {
        await expect(tab.getByTestId('tab-notice').filter({ hasText: LEFT })).toHaveCount(0)
        await expect(tab.getByTestId('member-self-tabs')).toHaveText('you · 2 tabs')
        await expect(tab.getByTestId('error-banner')).toHaveCount(0)
      }

      await sendMessage(alice.second, 'After both reloads')
      await expectMessage(alice.first, 'After both reloads')
    } finally {
      await alice.context.close()
    }
  })

  test('starting a call never rings your own other tab', async ({ browser }) => {
    const alice = await aliceInTwoTabs(browser)
    try {
      await alice.first.getByTestId('video-call-button').click()
      await expect(alice.first.locator('.video-call-overlay')).toBeVisible()
      await alice.second.waitForTimeout(5_000)
      await expect(alice.second.getByTestId('incoming-call-banner')).toHaveCount(0)
    } finally {
      await alice.context.close()
    }
  })

  test('an incoming call rings in one tab only, and answering it in one tab settles it in both', async ({ browser }) => {
    const alice = await aliceInTwoTabs(browser)
    // Count ring notes per tab. Headless Chromium keeps AudioContext suspended without a gesture; report it running
    // so the app's own ringtone code runs and is counted.
    await alice.context.addInitScript(() => {
      const w = window as unknown as { __notes: number }
      w.__notes = 0
      Object.defineProperty(AudioContext.prototype, 'state', { get: () => 'running' })
      const create = AudioContext.prototype.createOscillator
      AudioContext.prototype.createOscillator = function (this: AudioContext) {
        w.__notes += 1
        return create.call(this)
      }
    })
    await alice.first.evaluate(() => localStorage.setItem('peerly-attention-sounds', 'enabled'))
    for (const tab of [alice.first, alice.second]) {
      await tab.reload()
      await waitForWorkspace(tab)
    }
    const { context: bobContext, bob } = await joinBob(browser)
    try {
      await waitForPeerConnection(bob)
      await bob.getByTestId('video-call-button').click()
      for (const tab of [alice.first, alice.second]) {
        await expect(tab.getByTestId('incoming-call-banner')).toContainText('Bob', { timeout: 30_000 })
      }
      await alice.first.waitForTimeout(3_500)
      const notes = async () => Promise.all(
        [alice.first, alice.second].map(tab => tab.evaluate(() => (window as unknown as { __notes: number }).__notes))
      )
      const before = await notes()
      expect(before.filter(count => count > 0)).toHaveLength(1)

      const ringing = before[0]! > 0 ? alice.first : alice.second
      const other = ringing === alice.first ? alice.second : alice.first
      await other.getByRole('button', { name: 'Join', exact: true }).click()
      await expect(other.locator('.video-call-overlay')).toBeVisible({ timeout: 30_000 })
      await expect(ringing.getByTestId('incoming-call-banner')).toHaveCount(0, { timeout: 10_000 })

      const settled = await notes()
      await alice.first.waitForTimeout(3_500)
      expect(await notes()).toEqual(settled)
    } finally {
      await Promise.allSettled([alice.context.close(), bobContext.close()])
    }
  })
})
