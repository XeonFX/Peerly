import { test, expect, type Browser } from '@playwright/test'
import {
  joinWorkspace,
  e2eSignIn,
  openInviteJoin,
  installFreshSession,
  waitForPeerConnection,
  expectPeerVisible,
  expectJoinRejected,
  expectAccessDenied,
  createChannel,
  expectChannel,
  startDirectMessage,
  sendMessage,
  expectMessage,
  expectSharedFilesUsable,
  waitForWorkspace,
  collectConsole,
  waitForRelay,
  openProfile,
  rejoinWorkspace,
  withTwoUsers,
  E2E_WORKSPACE_ID,
} from './helpers'
import path from 'path'
import fs from 'fs'
import os from 'os'

async function joinAlice(browser: Browser) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await joinWorkspace(page, {
    name: 'Alice',
    email: 'alice@e2e.test',
    color: '#e01e5a',
  })
  await waitForRelay(page)
  return { context, page }
}

test.describe.configure({ mode: 'serial' })

test.describe('Peerly P2P collaboration', () => {
  test('signaling is online after join', async ({ page }) => {
    await joinWorkspace(page, { name: 'Alice', email: 'alice@e2e.test' })
    await waitForRelay(page)
    await expect(page.getByTestId('connection-status')).not.toContainText('Signaling offline')
    await expect(page.locator('.workspace-name')).toContainText('test-ws')
  })

  test('uninvited email cannot join the workspace', async ({ browser }) => {
    const alice = await joinAlice(browser)
    const bobCtx = await browser.newContext()
    const bob = await bobCtx.newPage()

    await openInviteJoin(bob)
    await e2eSignIn(bob, { email: 'outsider@e2e.test' })
    await bob.getByTestId('join-submit').click()
    await expectJoinRejected(bob, /not on this workspace/i)

    await alice.context.close()
    await bobCtx.close()
  })

  test('invalid invite link cannot join', async ({ page }) => {
    await installFreshSession(page)
    await page.goto('/#invite=not-valid-base64!!!')
    await expect(page.getByTestId('invite-summary')).not.toBeVisible()
    await page.getByTestId('join-workspace-tab').click()
    await expect(page.getByTestId('join-submit')).toBeDisabled()
  })

  test('an uninvited peer cannot connect to workspace traffic', async ({ browser }) => {
    const alice = await joinAlice(browser)
    const malloryCtx = await browser.newContext()
    const mallory = await malloryCtx.newPage()

    await openInviteJoin(mallory)
    await e2eSignIn(mallory, { email: 'outsider@e2e.test' })
    await mallory.getByTestId('join-submit').click()
    await expectJoinRejected(mallory, /not on this workspace/i)

    await sendMessage(alice.page, 'quarterly numbers are attached')
    await expectMessage(alice.page, 'quarterly numbers are attached')

    await alice.context.close()
    await malloryCtx.close()
  })

  test('two users connect and see each other', async ({ browser }) => {
    const logs: string[] = []
    const aliceCtx = await browser.newContext()
    const bobCtx = await browser.newContext()
    const alice = await aliceCtx.newPage()
    const bob = await bobCtx.newPage()
    collectConsole(alice, logs)
    collectConsole(bob, logs)

    await joinWorkspace(alice, { name: 'Alice', email: 'alice@e2e.test', color: '#e01e5a' })
    await waitForRelay(alice)
    await joinWorkspace(bob, { name: 'Bob', email: 'bob@e2e.test', color: '#2eb67d' })

    await waitForPeerConnection(alice)
    await waitForPeerConnection(bob)

    await expectPeerVisible(alice, 'Bob')
    await expectPeerVisible(bob, 'Alice')

    await aliceCtx.close()
    await bobCtx.close()
  })

  test('user colors sync to peers', async ({ browser }) => {
    const aliceCtx = await browser.newContext()
    const bobCtx = await browser.newContext()
    const alice = await aliceCtx.newPage()
    const bob = await bobCtx.newPage()

    await joinWorkspace(alice, { name: 'Alice', email: 'alice@e2e.test', color: '#e01e5a' })
    await waitForRelay(alice)
    await joinWorkspace(bob, { name: 'Bob', email: 'bob@e2e.test', color: '#2eb67d' })

    await waitForPeerConnection(alice)
    await waitForPeerConnection(bob)

    await expect(bob.getByTestId('member-Alice')).toHaveAttribute('data-peer-color', '#e01e5a')
    await expect(alice.getByTestId('member-Bob')).toHaveAttribute('data-peer-color', '#2eb67d')

    await openProfile(alice)
    await alice.getByTestId('profile-color').fill('#9b59b6')
    await alice.getByTestId('profile-back').click()
    await expect(bob.getByTestId('member-Alice')).toHaveAttribute('data-peer-color', '#9b59b6', {
      timeout: 15_000,
    })

    await aliceCtx.close()
    await bobCtx.close()
  })

  test('chat messages sync between peers', async ({ browser }) => {
    const aliceCtx = await browser.newContext()
    const bobCtx = await browser.newContext()
    const alice = await aliceCtx.newPage()
    const bob = await bobCtx.newPage()

    await joinWorkspace(alice, { name: 'Alice', email: 'alice@e2e.test' })
    await waitForRelay(alice)
    await joinWorkspace(bob, { name: 'Bob', email: 'bob@e2e.test' })

    await waitForPeerConnection(alice)
    await waitForPeerConnection(bob)

    await sendMessage(alice, 'Hello from Alice!')
    await expectMessage(bob, 'Hello from Alice!')

    await sendMessage(bob, 'Hi Alice, Bob here.')
    await expectMessage(alice, 'Hi Alice, Bob here.')

    await aliceCtx.close()
    await bobCtx.close()
  })

  test('file sharing between peers', async ({ browser }) => {
    const aliceCtx = await browser.newContext()
    const bobCtx = await browser.newContext()
    const alice = await aliceCtx.newPage()
    const bob = await bobCtx.newPage()

    await joinWorkspace(alice, { name: 'Alice', email: 'alice@e2e.test' })
    await waitForRelay(alice)
    await joinWorkspace(bob, { name: 'Bob', email: 'bob@e2e.test' })

    await waitForPeerConnection(alice)
    await waitForPeerConnection(bob)

    const tmpFile = path.join(os.tmpdir(), `flux-test-${Date.now()}.txt`)
    fs.writeFileSync(tmpFile, 'Hello from shared file!')

    const fileInput = alice.getByTestId('file-input')
    await fileInput.setInputFiles(tmpFile)

    await expect(bob.locator('.message-list')).toContainText('test-', { timeout: 45_000 })
    await expect(bob.locator('.files-panel')).toContainText('txt', { timeout: 45_000 })

    fs.unlinkSync(tmpFile)
    await aliceCtx.close()
    await bobCtx.close()
  })

  // Regression: needs TWO users. After both refresh, history sync re-ran over
  // files already on screen and revoked their blob URLs. The thumbnail still
  // rendered (the image had already decoded), so it looked fine — until you
  // clicked and got ERR_FILE_NOT_FOUND. Assert the URL still resolves.
  test('shared file stays openable after both peers refresh', async ({ browser }) => {
    await withTwoUsers(browser, async (alice, bob) => {
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mNk+M9QzwAEjDAGADPBAv0C90OhAAAAAElFTkSuQmCC',
        'base64'
      )
      await alice.getByTestId('file-input').setInputFiles({
        name: 'shared.png',
        mimeType: 'image/png',
        buffer: png,
      })
      await expect(alice.locator('.message-list .file-preview')).toBeVisible({ timeout: 20_000 })
      await expect(bob.locator('.message-list .file-preview')).toBeVisible({ timeout: 30_000 })

      await alice.reload({ waitUntil: 'domcontentloaded' })
      await bob.reload({ waitUntil: 'domcontentloaded' })
      await waitForWorkspace(alice, 30_000)
      await waitForWorkspace(bob, 30_000)
      await expect(alice.locator('.message-list .file-preview')).toBeVisible({ timeout: 20_000 })
      await expect(bob.locator('.message-list .file-preview')).toBeVisible({ timeout: 20_000 })

      // Let the peers reconnect so history sync actually runs — that is what
      // used to revoke the URLs out from under the rendered messages.
      await waitForPeerConnection(alice)
      await waitForPeerConnection(bob)

      for (const page of [alice, bob]) {
        await expect
          .poll(
            () =>
              page.evaluate(async () => {
                const img = document.querySelector<HTMLImageElement>(
                  '.message-list .file-preview'
                )
                if (!img) return 'NO_IMAGE'
                try {
                  const res = await fetch(img.getAttribute('src') ?? '')
                  return res.ok ? 'OK' : `HTTP_${res.status}`
                } catch {
                  return 'REVOKED'
                }
              }),
            { timeout: 20_000 }
          )
          .toBe('OK')
      }
    })
  })

  test('video call starts and shows participants', async ({ browser }) => {
    const aliceCtx = await browser.newContext()
    const bobCtx = await browser.newContext()
    const alice = await aliceCtx.newPage()
    const bob = await bobCtx.newPage()

    await joinWorkspace(alice, { name: 'Alice', email: 'alice@e2e.test' })
    await waitForRelay(alice)
    await joinWorkspace(bob, { name: 'Bob', email: 'bob@e2e.test' })

    await waitForPeerConnection(alice)
    await waitForPeerConnection(bob)

    await alice.getByTestId('video-call-button').click()
    await expect(alice.locator('.video-call-overlay')).toBeVisible()
    await expect(bob.locator('.video-call-overlay')).toBeVisible({ timeout: 30_000 })

    await aliceCtx.close()
    await bobCtx.close()
  })

  test('shared image preview survives page reload', async ({ page }) => {
    await joinWorkspace(page, { name: 'Alice', email: 'alice@e2e.test' })
    await waitForRelay(page)

    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    )
    await page.getByTestId('file-input').setInputFiles({
      name: 'shared-photo.png',
      mimeType: 'image/png',
      buffer: png,
    })

    const preview = page.locator('.message-list .file-preview')
    await expect(preview).toBeVisible({ timeout: 15_000 })
    await expect(preview).toHaveAttribute('src', /^blob:/)
    await expect
      .poll(async () => {
        const raw = await page.evaluate(() => localStorage.getItem('peerly-history-e2e00000000000000000000000000001__general'))
        return raw?.includes('shared-photo.png') ?? false
      })
      .toBe(true)

    await page.reload()
    await expect(page.locator('.sidebar')).toBeVisible({ timeout: 15_000 })
    await expect(preview).toBeVisible({ timeout: 15_000 })
    await expect(preview).toHaveAttribute('src', /^blob:/)
    // The above all pass for a revoked blob URL. This is what actually catches it.
    await expect.poll(async () => {
      return page.evaluate(() => {
        const img = document.querySelector<HTMLImageElement>('.message-list .file-preview')
        return img ? img.naturalWidth > 0 : false
      })
    }, { timeout: 15_000 }).toBe(true)
    await expectSharedFilesUsable(page)
  })

  test('shared file download link still works after reload', async ({ page }) => {
    await joinWorkspace(page, { name: 'Alice', email: 'alice@e2e.test' })
    await waitForRelay(page)

    await page.getByTestId('file-input').setInputFiles({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('hello from a shared file'),
    })
    await expect(page.locator('.message-list .file-download')).toBeVisible({ timeout: 15_000 })
    await expect
      .poll(async () => {
        const raw = await page.evaluate(() => localStorage.getItem('peerly-history-e2e00000000000000000000000000001__general'))
        return raw?.includes('notes.txt') ?? false
      })
      .toBe(true)

    await page.reload()
    await expect(page.locator('.sidebar')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('.message-list .file-download')).toBeVisible({ timeout: 15_000 })
    await expect.poll(async () => {
      return page.evaluate(async () => {
        const link = document.querySelector<HTMLAnchorElement>('.message-list .file-download')
        if (!link) return 'NO_LINK'
        try {
          const res = await fetch(link.getAttribute('href') ?? '')
          return res.ok ? await res.text() : `HTTP_${res.status}`
        } catch {
          return 'REVOKED'
        }
      })
    }, { timeout: 15_000 }).toBe('hello from a shared file')
  })

  test('session persists after page reload', async ({ page }) => {
    await joinWorkspace(page, { name: 'Alice', email: 'alice@e2e.test', color: '#e01e5a' })
    await waitForRelay(page)
    await page.reload()
    await expect(page.locator('.sidebar')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('member-list')).toContainText('Alice')
    await openProfile(page)
    await expect(page.getByTestId('profile-color')).toHaveValue('#e01e5a')
  })

  test('rejoining user receives chat history from peers', async ({ browser }) => {
    const aliceCtx = await browser.newContext()
    const bobCtx = await browser.newContext()
    const alice = await aliceCtx.newPage()
    const bob = await bobCtx.newPage()

    await joinWorkspace(alice, { name: 'Alice', email: 'alice@e2e.test' })
    await waitForRelay(alice)
    await joinWorkspace(bob, { name: 'Bob', email: 'bob@e2e.test' })

    await waitForPeerConnection(alice)
    await waitForPeerConnection(bob)

    await sendMessage(alice, 'Message before Bob left')
    await expectMessage(bob, 'Message before Bob left')

    await rejoinWorkspace(bob, { name: 'Bob', email: 'bob@e2e.test' })
    await waitForPeerConnection(bob)
    await expectMessage(bob, 'Message before Bob left', 45_000)

    await aliceCtx.close()
    await bobCtx.close()
  })

  test('rejoining user receives shared files from peers', async ({ browser }) => {
    const aliceCtx = await browser.newContext()
    const bobCtx = await browser.newContext()
    const alice = await aliceCtx.newPage()
    const bob = await bobCtx.newPage()

    await joinWorkspace(alice, { name: 'Alice', email: 'alice@e2e.test' })
    await waitForRelay(alice)
    await joinWorkspace(bob, { name: 'Bob', email: 'bob@e2e.test' })

    await waitForPeerConnection(alice)
    await waitForPeerConnection(bob)

    const tmpFile = path.join(os.tmpdir(), `flux-rejoin-${Date.now()}.txt`)
    fs.writeFileSync(tmpFile, 'File survives rejoin!')

    await alice.getByTestId('file-input').setInputFiles(tmpFile)
    await expect(bob.locator('.message-list')).toContainText('flux-rejoin-', { timeout: 45_000 })

    await rejoinWorkspace(bob, { name: 'Bob', email: 'bob@e2e.test' })
    await waitForPeerConnection(bob)
    await expect(bob.locator('.message-list')).toContainText('flux-rejoin-', { timeout: 60_000 })
    await expect(bob.locator('.files-panel')).toContainText('txt', { timeout: 60_000 })

    fs.unlinkSync(tmpFile)
    await aliceCtx.close()
    await bobCtx.close()
  })

  test('id token is not stored in localStorage', async ({ page }) => {
    await joinWorkspace(page, { name: 'Alice', email: 'alice@e2e.test' })
    const stored = await page.evaluate(() => localStorage.getItem('peerly-session'))
    expect(stored).toBeTruthy()
    expect(stored).toContain('workspaceId')
    const token = await page.evaluate(
      () =>
        sessionStorage.getItem('peerly-id-token') ?? sessionStorage.getItem('flux-google-token')
    )
    expect(token).toBeTruthy()
    expect(stored).not.toContain(token ?? '')
  })

  test('avatar image appears in chat messages', async ({ page }) => {
    await joinWorkspace(page, { name: 'Alice', email: 'alice@e2e.test' })
    await openProfile(page)

    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    )
    await page.getByTestId('avatar-input').setInputFiles({
      name: 'avatar.png',
      mimeType: 'image/png',
      buffer: png,
    })
    await page.getByTestId('profile-back').click()
    await sendMessage(page, 'Avatar check')
    await expect(page.locator('.message-list .avatar-img')).toBeVisible()
  })

  test('avatar image appears on every chat message after upload', async ({ page }) => {
    await joinWorkspace(page, { name: 'Alice', email: 'alice@e2e.test' })
    await openProfile(page)

    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    )
    await page.getByTestId('avatar-input').setInputFiles({
      name: 'avatar.png',
      mimeType: 'image/png',
      buffer: png,
    })
    await page.getByTestId('profile-back').click()
    await sendMessage(page, 'First message')
    await sendMessage(page, 'Second message')
    await expect(page.locator('[data-testid="chat-message"] .avatar-img')).toHaveCount(2)
  })

  test('peer avatar updates on existing messages after upload', async ({ browser }) => {
    await withTwoUsers(browser, async (alice, bob) => {
      await sendMessage(alice, 'Message before avatar')
      await expectMessage(bob, 'Message before avatar')

      await openProfile(alice)
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64'
      )
      await alice.getByTestId('avatar-input').setInputFiles({
        name: 'avatar.png',
        mimeType: 'image/png',
        buffer: png,
      })
      await alice.getByTestId('profile-back').click()

      await expect(bob.locator('[data-testid="chat-message"] .avatar-img')).toBeVisible({
        timeout: 15_000,
      })
    })
  })

  test('peer avatar image appears in received chat messages', async ({ browser }) => {
    await withTwoUsers(browser, async (alice, bob) => {
      await openProfile(alice)
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64'
      )
      await alice.getByTestId('avatar-input').setInputFiles({
        name: 'avatar.png',
        mimeType: 'image/png',
        buffer: png,
      })
      await alice.getByTestId('profile-back').click()
      await sendMessage(alice, 'Hello with avatar')
      await expectMessage(bob, 'Hello with avatar')
      await expect(bob.locator('.message-list .avatar-img')).toBeVisible({ timeout: 15_000 })
    })
  })

  test('peer avatar appears in direct messages', async ({ browser }) => {
    await withTwoUsers(browser, async (alice, bob) => {
      await openProfile(alice)
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64'
      )
      await alice.getByTestId('avatar-input').setInputFiles({
        name: 'avatar.png',
        mimeType: 'image/png',
        buffer: png,
      })
      await alice.getByTestId('profile-back').click()
      await startDirectMessage(alice, 'Bob')
      await sendMessage(alice, 'DM with avatar')
      await expect(bob.locator('[data-testid^="dm-"]')).toBeVisible({ timeout: 15_000 })
      await bob.locator('[data-testid^="dm-"]').click()
      await expectMessage(bob, 'DM with avatar')
      await expect(bob.locator('[data-testid="chat-message"] .avatar-img')).toBeVisible({
        timeout: 15_000,
      })
    })
  })

  test('private messages only appear in direct message thread', async ({ browser }) => {
    await withTwoUsers(browser, async (alice, bob) => {
      await startDirectMessage(alice, 'Bob')
      await sendMessage(alice, 'Secret DM ping')
      await expect(bob.locator('[data-testid^="dm-"]')).toBeVisible({ timeout: 15_000 })
      await bob.locator('[data-testid^="dm-"]').click()
      await expectMessage(bob, 'Secret DM ping')

      await alice.locator('.channel-item', { hasText: 'general' }).click()
      await expect(alice.locator('.message-list')).not.toContainText('Secret DM ping')
      await bob.locator('.channel-item', { hasText: 'general' }).click()
      await expect(bob.locator('.message-list')).not.toContainText('Secret DM ping')
    })
  })

  test('unread badge appears for messages in other channels', async ({ browser }) => {
    await withTwoUsers(browser, async (alice, bob) => {
      await createChannel(alice, 'alerts')
      await expectChannel(bob, 'alerts')

      await alice.locator('.channel-item', { hasText: 'alerts' }).click()
      await sendMessage(alice, 'Ping from alerts')

      await expect(bob.getByTestId('unread-alerts')).toHaveText('1', { timeout: 15_000 })
      await bob.locator('.channel-item', { hasText: 'alerts' }).click()
      await expect(bob.getByTestId('unread-alerts')).toHaveCount(0)
      await expectMessage(bob, 'Ping from alerts')
    })
  })

  test('created channel syncs to connected peer', async ({ browser }) => {
    await withTwoUsers(browser, async (alice, bob) => {
      await createChannel(alice, 'design')
      await expectChannel(bob, 'design')
    })
  })

  test('synced channel persists after peer refresh', async ({ browser }) => {
    await withTwoUsers(browser, async (alice, bob) => {
      await createChannel(alice, 'ops')
      await expectChannel(bob, 'ops')
      await bob.reload()
      await expect(bob.locator('.sidebar')).toBeVisible({ timeout: 15_000 })
      await waitForPeerConnection(bob)
      await expectChannel(bob, 'ops')
    })
  })

  test('channel switch keeps workspace connection', async ({ browser }) => {
    await withTwoUsers(browser, async alice => {
      await createChannel(alice, 'random')
      await alice.locator('.channel-item', { hasText: 'random' }).click()
      await expect(alice.getByTestId('connection-status')).toContainText('Connected', {
        timeout: 15_000,
      })
      await expect(alice.getByText(`Room: ${E2E_WORKSPACE_ID}`)).toBeVisible()
    })
  })

  test('messages stay isolated per channel', async ({ browser }) => {
    await withTwoUsers(browser, async (alice, bob) => {
      await sendMessage(alice, 'Only in general')
      await expectMessage(bob, 'Only in general')

      await createChannel(alice, 'random')
      await expectChannel(bob, 'random')
      await alice.locator('.channel-item', { hasText: 'random' }).click()
      await sendMessage(alice, 'Only in random')
      await bob.locator('.channel-item', { hasText: 'random' }).click()
      await expectMessage(bob, 'Only in random', 30_000)

      await bob.locator('.channel-item', { hasText: 'general' }).click()
      await expectMessage(bob, 'Only in general')
      await expect(bob.locator('.message-list')).not.toContainText('Only in random')

      await bob.locator('.channel-item', { hasText: 'random' }).click()
      await expectMessage(bob, 'Only in random')
      await expect(bob.locator('.message-list')).not.toContainText('Only in general')
    })
  })

  test('large avatar upload is resized to webp', async ({ page }) => {
    await joinWorkspace(page, { name: 'Alice', email: 'alice@e2e.test' })
    await openProfile(page)

    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    )
    await page.getByTestId('avatar-input').setInputFiles({
      name: 'large-avatar.png',
      mimeType: 'image/png',
      buffer: png,
    })

    await expect(page.getByTestId('profile-page').locator('.avatar-lg')).toHaveAttribute(
      'src',
      /^data:image\/webp/,
      { timeout: 10_000 }
    )
  })
})