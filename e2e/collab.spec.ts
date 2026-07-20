import { test, expect, type Browser } from '@playwright/test'
import {
  joinWorkspace,
  createWorkspace,
  leaveToPicker,
  e2eSignIn,
  openInviteJoin,
  installFreshSession,
  waitForPeerConnection,
  expectPeerVisible,
  expectJoinRejected,
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
  e2eWorkspaceId,
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

// Not `mode: 'serial'`: tests are self-contained (fresh contexts, storage
// wiped per test) and each worker has its own workspace/room (e2eWorkspaceId),
// so they parallelize safely — serial mode was pinning the suite to 1 worker.
test.describe('Peerly P2P collaboration', () => {
  test('first visit shows legal consent banner; Accept dismisses it', async ({ page }) => {
    await installFreshSession(page, { acceptLegal: false })
    await page.goto('/')
    await expect(page.getByTestId('consent-banner')).toBeVisible({ timeout: 10_000 })
    await page.getByTestId('consent-accept').click()
    await expect(page.getByTestId('consent-banner')).toHaveCount(0)
    // Persisted acceptance survives reload.
    await page.reload()
    await expect(page.getByTestId('consent-banner')).toHaveCount(0)
  })

  test('theme preference persists and P2P readiness stays visible', async ({ page }) => {
    await joinWorkspace(page, { name: 'Alice', email: 'alice@e2e.test' })

    await expect(page.getByText('Invite-only workspace — verified identities')).not.toBeVisible()
    await expect(page.getByRole('heading', { name: 'You', exact: true })).not.toBeVisible()
    await expect(page.getByTestId('member-list').locator('li').first()).toContainText('Alice')
    await expect(page.getByTestId('member-list').locator('li').first()).toContainText('you')
    await expect(page.locator('.files-panel')).not.toBeVisible()
    await expect(page.getByTestId('toggle-files').locator('svg')).toBeVisible()
    await expect(page.getByTestId('attach-file-button').locator('svg')).toBeVisible()
    await page.getByTestId('toggle-files').click()
    await expect(page.locator('.files-panel')).toContainText('No shared files yet')
    await page.getByTestId('toggle-files').click()

    await expect(page.getByTestId('p2p-capability')).toContainText('P2P ready', {
      timeout: 10_000,
    })

    const initialTheme = await page.locator('html').getAttribute('data-theme')
    const expectedTheme = initialTheme === 'peerly-dark' ? 'peerly' : 'peerly-dark'
    await page.getByTestId('theme-toggle').click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', expectedTheme)

    await page.reload()
    await waitForWorkspace(page)
    await expect(page.locator('html')).toHaveAttribute('data-theme', expectedTheme)

    await page.getByTestId('workspace-settings-open').click()
    await expect(page.getByTestId('p2p-capability-card')).toContainText('P2P ready', {
      timeout: 10_000,
    })
    await expect(page.getByTestId('p2p-capability-card')).toContainText(
      'Strict NAT and corporate firewalls'
    )
  })

  test('remembered workspaces let you switch without the invite link', async ({ page }) => {
    await joinWorkspace(page, { name: 'Alice', email: 'alice@e2e.test' })
    await expect(page.locator('.workspace-name')).toContainText('test-ws')

    // Leaving must NOT sign you out — you land on the picker still signed in.
    await leaveToPicker(page)
    await expect(page.getByTestId('home-view')).toBeVisible()

    // The workspace we just joined is offered without pasting the link again.
    await page.getByRole('button', { name: 'test-ws', exact: true }).click()
    await waitForWorkspace(page)
    await expect(page.locator('.workspace-name')).toContainText('test-ws')
  })

  test('a remembered workspace survives a reload and can be reopened', async ({ page }) => {
    await joinWorkspace(page, { name: 'Alice', email: 'alice@e2e.test' })
    await leaveToPicker(page)

    await page.reload()
    await expect(page.getByTestId('home-view')).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: 'test-ws', exact: true }).click()
    await waitForWorkspace(page)
  })

  test('the picker only offers workspaces the signed-in email is invited to', async ({ page }) => {
    await joinWorkspace(page, { name: 'Alice', email: 'alice@e2e.test' })
    await leaveToPicker(page)
    await page.getByTestId('rail-create-workspace').click()
    await expect(page.getByTestId('open-workspace-test-ws')).toBeVisible()

    // Same browser, different identity: outsider@ is not on the fixture's
    // allow-list, so the workspace must not be offered to them.
    await page.getByTestId('rail-home').click()
    await page.getByTestId('home-account-tab').click()
    await page.getByTestId('account-sign-out').click()
    await e2eSignIn(page, { email: 'outsider@e2e.test' })
    await page.getByTestId('rail-create-workspace').click()
    await expect(page.getByTestId('open-workspace-test-ws')).not.toBeVisible()
  })

  test('reading history is not hijacked by new messages; the pill catches up', async ({ browser }) => {
    await withTwoUsers(browser, async (alice, bob) => {
      // Enough messages that bob's list actually scrolls — the anchoring logic
      // is meaningless (and untestable) unless the content overflows.
      for (let i = 1; i <= 25; i++) {
        await sendMessage(alice, `backlog message ${i}`)
      }
      await expectMessage(bob, 'backlog message 25')
      // The last message arriving does not mean all arrived — deliveries can
      // interleave. Scrolling up before the backlog settles would count the
      // stragglers as "new below", which is correct behaviour but not this test.
      await expect(bob.getByTestId('chat-message')).toHaveCount(25, { timeout: 30_000 })
      const overflows = await bob
        .locator('.message-list')
        .evaluate(el => el.scrollHeight > el.clientHeight + 200)
      expect(overflows).toBe(true)

      // Bob scrolls up to read history.
      await bob.locator('.message-list').evaluate(el => {
        el.scrollTop = 0
      })

      await sendMessage(alice, 'the message below the fold')
      await expectMessage(bob, 'the message below the fold')
      await bob.waitForTimeout(300)

      // Bob must still be where he was, with a pill offering the way down.
      const scrollTop = await bob.locator('.message-list').evaluate(el => el.scrollTop)
      expect(scrollTop).toBeLessThan(150)
      // The exact count is honest but jitter-dependent (late backlog also
      // arrives "below the fold"); the contract is presence + preserved scroll.
      await expect(bob.getByTestId('new-messages-pill')).toBeVisible()
      await expect(bob.getByTestId('new-messages-pill')).toContainText('new message')

      await bob.getByTestId('new-messages-pill').click()
      await expect(bob.getByTestId('new-messages-pill')).toHaveCount(0)
      // The jump animates; poll until the smooth scroll lands.
      await expect
        .poll(
          () =>
            bob
              .locator('.message-list')
              .evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight < 150),
          { timeout: 5_000 }
        )
        .toBe(true)
    })
  })

  test('profile name and colour survive leaving and rejoining a workspace', async ({ page }) => {
    await joinWorkspace(page, { name: 'Alice', email: 'alice@e2e.test' })

    await openProfile(page)
    await page.getByTestId('profile-name').fill('Krystian')
    await page.getByTestId('color-preset-#e01e5a').click()
    await page.getByTestId('profile-back').click()

    await leaveToPicker(page)
    await page.getByRole('button', { name: 'test-ws', exact: true }).click()
    await waitForWorkspace(page)

    await openProfile(page)
    await expect(page.getByTestId('profile-name')).toHaveValue('Krystian')
    await expect(page.getByTestId('profile-color')).toHaveValue('#e01e5a')
  })

  test('backup round-trip: export, clear local data, import restores messages', async ({ page }) => {
    await joinWorkspace(page, { name: 'Alice', email: 'alice@e2e.test' })
    await sendMessage(page, 'message worth keeping')
    // Message signing is asynchronous; export only after the signed local copy
    // is visible, matching the state the user expects the backup to capture.
    await expectMessage(page, 'message worth keeping')

    await page.getByTestId('workspace-settings-open').click()
    const downloadPromise = page.waitForEvent('download')
    await page.getByTestId('export-backup').click()
    const download = await downloadPromise
    const backupPath = await download.path()
    expect(download.suggestedFilename()).toMatch(/^peerly-.*\.json$/)

    // Clear message history through the destructive settings action. The
    // picker broom intentionally removes cached file bodies only.
    page.once('dialog', dialog => void dialog.accept())
    await page.getByTestId('clear-local-history').click()
    await expect
      .poll(() =>
        page.evaluate(
          workspaceId =>
            Object.keys(localStorage).some(key =>
              key.startsWith(`peerly-history-${workspaceId}__`)
            ),
          e2eWorkspaceId()
        )
      )
      .toBe(false)

    await page.getByTestId('workspace-settings-back').click()
    await leaveToPicker(page)
    await page.getByTestId('rail-create-workspace').click()

    // A backup is most valuable on a fresh profile. Forget the only remembered
    // workspace and prove restore remains available from the empty picker.
    await page.getByTestId('forget-workspace-test-ws').click()
    await expect(page.getByTestId('open-workspace-test-ws')).toHaveCount(0)
    await expect(page.getByTestId('import-backup')).toBeVisible()

    await page.getByTestId('import-backup').click()
    await page.getByTestId('import-backup-input').setInputFiles(backupPath)
    await expect(page.getByTestId('import-notice')).toContainText('Restored "test-ws"', {
      timeout: 15_000,
    })
    await expect(page.getByTestId('import-notice')).toContainText('1 message imported')

    await page.getByTestId('open-workspace-test-ws').click()
    await waitForWorkspace(page)
    await expectMessage(page, 'message worth keeping')
  })

  test('a token nearing expiry shows the re-auth banner, and re-auth clears it', async ({ page }) => {
    await joinWorkspace(page, { name: 'Alice', email: 'alice@e2e.test' })
    await expect(page.getByTestId('reauth-banner')).toHaveCount(0)

    // Rewrite the stored token's exp to 60s out — inside the warning window.
    // The signature becomes invalid, which is fine: banner display reads only
    // exp; the fresh token minted by re-auth is what handshakes would use.
    await page.evaluate(() => {
      const token = sessionStorage.getItem('peerly-id-token')
      if (!token) throw new Error('no stored token')
      const [header, payload, sig] = token.split('.')
      const decode = (part: string) =>
        JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')))
      const encode = (value: unknown) =>
        btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      const claims = decode(payload)
      claims.exp = Math.floor(Date.now() / 1000) + 60
      sessionStorage.setItem('peerly-id-token', `${header}.${encode(claims)}.${sig}`)
    })
    await page.reload()
    await waitForWorkspace(page)

    await expect(page.getByTestId('reauth-banner')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('reauth-banner')).toContainText('expires in a few minutes')

    await page.getByTestId('reauth-button').click()
    await expect(page.getByTestId('reauth-banner')).toHaveCount(0, { timeout: 15_000 })

    // The renewed session still works end to end.
    await sendMessage(page, 'still here after renewing')
    await expectMessage(page, 'still here after renewing')
  })

  test('an expired sign-in leaves the room until re-auth restores it', async ({ page }) => {
    // Real time must pass for the token to lapse in place — but only ~15s of
    // it: the ok→expired transition is identical wherever exp sits.
    test.setTimeout(60_000)
    await joinWorkspace(page, { name: 'Alice', email: 'alice@e2e.test' })
    await waitForRelay(page)

    await page.evaluate(() => {
      const token = sessionStorage.getItem('peerly-id-token')
      if (!token) throw new Error('no stored token')
      const [header, payload, sig] = token.split('.')
      const decode = (part: string) =>
        JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')))
      const encode = (value: unknown) =>
        btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      const claims = decode(payload)
      claims.exp = Math.floor(Date.now() / 1000) + 15
      sessionStorage.setItem('peerly-id-token', `${header}.${encode(claims)}.${sig}`)
    })
    await page.reload()
    await waitForWorkspace(page)
    await expect(page.getByTestId('signaling-info')).toContainText('signaling endpoint', {
      timeout: 15_000,
    })

    // Once exp passes, this device must LEAVE the room — staying would present
    // a dead token to every newcomer's handshake, producing an error storm on
    // both sides ("identity verification failed: ID token: Token expired").
    await expect(page.getByTestId('signaling-info')).toContainText('Connecting to signaling', {
      timeout: 45_000,
    })
    await expect(page.getByTestId('reauth-banner')).toBeVisible()

    // Re-auth mints a fresh token; the room comes back on its own.
    await page.getByTestId('reauth-button').click()
    await expect(page.getByTestId('signaling-info')).toContainText('signaling endpoint', {
      timeout: 30_000,
    })
    await sendMessage(page, 'back after re-auth')
    await expectMessage(page, 'back after re-auth')
  })

  test('the creator can remove a member, and their name leaves the invite list', async ({ page }) => {
    await createWorkspace(page, {
      email: 'alice@e2e.test',
      workspaceName: 'remove-test',
      guests: 'bob@e2e.test',
    })

    // Invite controls live in a footer popover — open it first.
    await expect(page.getByTestId('invite-panel-toggle')).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('invite-panel-toggle').click()
    await expect(page.getByTestId('invited-bob@e2e.test')).toBeVisible({ timeout: 15_000 })

    // The creator's own row must not offer removal — removing yourself is a
    // lockout, not a feature.
    await expect(page.getByTestId('remove-member-alice@e2e.test')).toHaveCount(0)

    page.once('dialog', dialog => void dialog.accept())
    await page.getByTestId('invited-bob@e2e.test').hover()
    await page.getByTestId('remove-member-bob@e2e.test').click()

    await expect(page.getByTestId('invited-bob@e2e.test')).toHaveCount(0, { timeout: 15_000 })
    await leaveToPicker(page)
    await page.getByTestId('rail-create-workspace').click()
    await expect(page.getByTestId('open-workspace-remove-test')).toContainText('1 member')
  })

  test('the creator can invite someone to an existing workspace', async ({ page }) => {
    await createWorkspace(page, {
      email: 'alice@e2e.test',
      workspaceName: 'invite-test',
    })

    // This browser created the workspace, so it holds the signing key.
    await expect(page.getByTestId('invite-panel-toggle')).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('invite-panel-toggle').click()
    await page.getByTestId('invite-people-toggle').click()
    await page.getByTestId('invite-emails').fill('bob@e2e.test')
    await page.getByTestId('invite-submit').click()

    await expect(page.getByTestId('invited-bob@e2e.test')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('invited-members')).toContainText('bob@e2e.test')
    await leaveToPicker(page)
    await page.getByTestId('rail-create-workspace').click()
    await expect(page.getByTestId('open-workspace-invite-test')).toContainText('2 members')
  })

  test('a non-creator is told they cannot invite, instead of failing later', async ({ page }) => {
    // Joins via the fixed E2E invite, whose creator key no test device holds.
    await joinWorkspace(page, { name: 'Alice', email: 'alice@e2e.test' })

    await expect(page.getByTestId('invite-panel-toggle')).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('invite-panel-toggle').click()
    await expect(page.getByTestId('invite-creator-only')).toBeVisible()
    await expect(page.getByTestId('invite-people-toggle')).not.toBeVisible()
    // Sharing the existing link is still open to everyone.
    await expect(page.getByTestId('copy-invite')).toBeVisible()
  })

  // The workspace id doubles as the Trystero encryption password. It used to be
  // printed in the sidebar ("Room: <id>") and on the profile page, putting the
  // workspace secret on screen for anyone screen-sharing or looking over a
  // shoulder. It must not appear in the rendered page at all.
  test('workspace name can be changed in settings', async ({ page }) => {
    await joinWorkspace(page, { name: 'Alice', email: 'alice@e2e.test' })
    await page.getByTestId('workspace-settings-open').click()
    await expect(page.getByTestId('workspace-settings-page')).toBeVisible()
    await page.getByTestId('workspace-name').fill('Renamed team')
    await page.getByTestId('workspace-settings-back').click()
    await expect(page.locator('.workspace-name')).toContainText('Renamed team')
  })

  test('the workspace secret is never displayed in the UI', async ({ page }) => {
    await joinWorkspace(page, { name: 'Alice', email: 'alice@e2e.test' })

    const leaked = async () =>
      page.evaluate(id => document.body.innerText.includes(id), e2eWorkspaceId())

    expect(await leaked()).toBe(false)

    // Including the profile page, which listed it under "Workspace info".
    await openProfile(page)
    expect(await leaked()).toBe(false)
  })

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

    // A malformed invite must not be presented as a workspace to join...
    await expect(page.getByTestId('signin-e2e')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('invite-summary')).not.toBeVisible()

    // ...and signing in must not produce a joinable one either.
    await e2eSignIn(page, { email: 'alice@e2e.test' })
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

    await expect(alice.getByTestId('p2p-capability')).toContainText('P2P active')
    await expect(bob.getByTestId('p2p-capability')).toContainText('P2P active')

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

  test('safe links, signed edits, reactions, and deletes sync between peers', async ({ browser }) => {
    await withTwoUsers(browser, async (alice, bob) => {
      await sendMessage(alice, 'Read https://example.com/docs.')
      await expectMessage(bob, 'Read https://example.com/docs.')
      const link = bob.getByRole('link', { name: 'https://example.com/docs' })
      await expect(link).toHaveAttribute('href', 'https://example.com/docs')
      await expect(link).toHaveAttribute('rel', 'noopener noreferrer')

      alice.once('dialog', dialog => void dialog.accept('Read the updated note'))
      await alice.getByLabel('Edit message').last().click()
      await expectMessage(bob, 'Read the updated note')
      await expect(bob.locator('.message-list')).not.toContainText('Read https://example.com/docs.')

      await bob.getByLabel('React 👍').last().click()
      await expect(alice.getByLabel('👍 reaction, 1')).toBeVisible({ timeout: 15_000 })

      alice.once('dialog', dialog => void dialog.accept())
      await alice.getByLabel('Delete message').last().click()
      await expect(bob.locator('.message-list')).toContainText('Message deleted', {
        timeout: 15_000,
      })
      await expect(bob.locator('.message-list')).not.toContainText('Read the updated note')
    })
  })

  test('composer accepts multiple files in one selection', async ({ page }) => {
    await joinWorkspace(page, { name: 'Alice', email: 'alice@e2e.test' })
    await page.getByTestId('file-input').setInputFiles([
      { name: 'one.txt', mimeType: 'text/plain', buffer: Buffer.from('one') },
      { name: 'two.txt', mimeType: 'text/plain', buffer: Buffer.from('two') },
    ])
    await expect(page.locator('.message-list')).toContainText('one.txt', { timeout: 15_000 })
    await expect(page.locator('.message-list')).toContainText('two.txt', { timeout: 15_000 })

  })

  test('on-demand image sync shows a thumbnail before transferring the original', async ({ browser }) => {
    await withTwoUsers(browser, async (alice, bob) => {
      const png = fs.readFileSync(path.join(process.cwd(), 'public/icon-192.png'))
      await alice.getByTestId('file-input').setInputFiles({
        name: 'thumbnail-first.png',
        mimeType: 'image/png',
        buffer: png,
      })

      const thumbnail = bob.locator('.message-list img.file-preview')
      await expect(thumbnail).toBeVisible({ timeout: 30_000 })
      await expect(thumbnail).toHaveAttribute('src', /^data:image\//)
      const downloadOriginal = bob.getByTestId('download-original')
      await expect(downloadOriginal).toContainText('Download original')

      await downloadOriginal.click()
      await expect(downloadOriginal).toHaveCount(0, { timeout: 30_000 })
      const fullImageLink = bob.locator('.message-list a[href^="blob:"]')
      await expect(fullImageLink).toBeVisible({ timeout: 30_000 })
      await expect
        .poll(
          () =>
            fullImageLink.evaluate(async link => {
              try {
                return (await fetch((link as HTMLAnchorElement).href)).ok
              } catch {
                return false
              }
            }),
          { timeout: 30_000 }
        )
        .toBe(true)
    })
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

    const tmpFile = path.join(os.tmpdir(), `peerly-test-${Date.now()}.txt`)
    fs.writeFileSync(tmpFile, 'Hello from shared file!')

    const fileInput = alice.getByTestId('file-input')
    await fileInput.setInputFiles(tmpFile)

    await expect(bob.locator('.message-list')).toContainText('test-', { timeout: 45_000 })
    await bob.getByTestId('toggle-files').click()
    await expect(bob.locator('.files-panel')).toContainText('txt', { timeout: 45_000 })

    const onDemandFile = bob.locator('button.file-download')
    await expect(onDemandFile).toContainText('Download on demand')
    await onDemandFile.click()
    const cachedFile = bob.locator('a.file-download')
    await expect(cachedFile).toContainText('Ready on this device', { timeout: 45_000 })
    await expect
      .poll(
        () =>
          bob.evaluate(async () => {
            const link = document.querySelector<HTMLAnchorElement>('a.file-download')
            if (!link?.href) return 'NO_LINK'
            try {
              return (await fetch(link.href)).ok ? 'OK' : 'FAILED'
            } catch {
              return 'FAILED'
            }
          }),
        { timeout: 30_000 }
      )
      .toBe('OK')

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
    await expect(bob.getByTestId('incoming-call-banner')).toContainText('Alice', {
      timeout: 30_000,
    })
    await bob.getByRole('button', { name: 'Join', exact: true }).click()
    await expect(bob.locator('.video-call-overlay')).toBeVisible({ timeout: 30_000 })

    await alice.evaluate(() => {
      navigator.mediaDevices.getDisplayMedia = () =>
        navigator.mediaDevices.getUserMedia({ video: true, audio: false })
    })
    await alice.getByTestId('screen-share-button').click()
    await expect(alice.getByTestId('screen-share-button')).toHaveAttribute('aria-pressed', 'true')
    await alice.getByTestId('screen-share-button').click()
    await expect(alice.getByTestId('screen-share-button')).toHaveAttribute('aria-pressed', 'false')

    await aliceCtx.close()
    await bobCtx.close()
  })

  test('a cancelled call stops presenting as incoming on the callee', async ({ browser }) => {
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
    await expect(bob.getByTestId('incoming-call-banner')).toContainText('Alice', {
      timeout: 30_000,
    })

    // Alice hangs up before Bob answers. Her explicit call-end signal must
    // clear Bob's banner promptly (15s budget — NOT the 30s crash-fallback
    // timeout), and it must STAY away — regression: Alice's lingering stream
    // re-announced on renegotiation and re-armed Bob's incoming-call state in
    // a loop only a page refresh could break.
    await alice.getByTestId('video-call-button').click()
    await expect(alice.locator('.video-call-overlay')).not.toBeVisible()
    await expect(bob.getByTestId('incoming-call-banner')).toHaveCount(0, { timeout: 15_000 })
    await bob.waitForTimeout(3_000)
    await expect(bob.getByTestId('incoming-call-banner')).toHaveCount(0)

    await aliceCtx.close()
    await bobCtx.close()
  })

  test('camera re-enable restores the local preview', async ({ page }) => {
    await joinWorkspace(page, { name: 'Alice', email: 'alice@e2e.test' })
    await waitForRelay(page)

    await page.getByTestId('video-call-button').click()
    await expect(page.locator('.video-call-overlay')).toBeVisible()

    const previewPlaying = () =>
      page.evaluate(() => {
        const video = document.querySelector<HTMLVideoElement>('.video-call-overlay video')
        return video ? video.srcObject !== null && video.videoWidth > 0 : false
      })
    await expect.poll(previewPlaying, { timeout: 15_000 }).toBe(true)

    // Camera off: the <video> unmounts in favour of the initial placeholder.
    await page.getByRole('button', { name: 'Turn off camera' }).click()
    await expect(page.locator('.video-call-overlay video')).toHaveCount(0)

    // Camera on again: the remounted <video> must be re-attached to the same
    // stream. Regression: it kept srcObject = null and stayed a gray tile.
    await page.getByRole('button', { name: 'Turn on camera' }).click()
    await expect(page.locator('.video-call-overlay video')).toBeVisible()
    await expect.poll(previewPlaying, { timeout: 15_000 }).toBe(true)
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
        const raw = await page.evaluate(
          key => localStorage.getItem(key),
          `peerly-history-${e2eWorkspaceId()}__general`
        )
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
        const raw = await page.evaluate(
          key => localStorage.getItem(key),
          `peerly-history-${e2eWorkspaceId()}__general`
        )
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

    const tmpFile = path.join(os.tmpdir(), `peerly-rejoin-${Date.now()}.txt`)
    fs.writeFileSync(tmpFile, 'File survives rejoin!')

    await alice.getByTestId('file-input').setInputFiles(tmpFile)
    await expect(bob.locator('.message-list')).toContainText('peerly-rejoin-', { timeout: 45_000 })

    await rejoinWorkspace(bob, { name: 'Bob', email: 'bob@e2e.test' })
    await waitForPeerConnection(bob)
    await expect(bob.locator('.message-list')).toContainText('peerly-rejoin-', { timeout: 60_000 })
    await bob.getByTestId('toggle-files').click()
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
    const token = await page.evaluate(() => sessionStorage.getItem('peerly-id-token'))
    expect(token).toBeTruthy()
    expect(stored).not.toContain(token ?? '')
  })

  // selfId is random per page load. Before the self-id registry, a message sent
  // in an earlier session kept the name/avatar snapshot frozen at send time and
  // ignored later profile changes — "it's still me, but my old message didn't
  // update".
  test('own messages from before a refresh follow a rename', async ({ page }) => {
    await joinWorkspace(page, { name: 'Alice', email: 'alice@e2e.test' })
    await sendMessage(page, 'Sent before refresh')

    await page.reload()
    await waitForWorkspace(page)
    await expectMessage(page, 'Sent before refresh')

    await openProfile(page)
    await page.getByTestId('profile-name').fill('Alicia')
    await page.getByTestId('profile-back').click()

    const oldMessage = page
      .getByTestId('chat-message')
      .filter({ hasText: 'Sent before refresh' })
    await expect(oldMessage).toContainText('Alicia')
    await expect(oldMessage).not.toContainText('Alice ')
  })

  // Same account on two devices: messages are linked by the durable user id
  // (hash of the OIDC issuer+subject, verified in the handshake), so a message
  // sent from one device follows profile changes made on another — even after
  // the sending device disconnects and its transport id means nothing.
  test('messages from my other device follow a rename here', async ({ browser }) => {
    const deviceA = await browser.newContext()
    const deviceB = await browser.newContext()
    const here = await deviceA.newPage()
    const laptop = await deviceB.newPage()

    try {
      await joinWorkspace(here, { name: 'Alice', email: 'alice@e2e.test' })
      await waitForRelay(here)
      await joinWorkspace(laptop, { name: 'Alice', email: 'alice@e2e.test' })
      await waitForPeerConnection(here)
      await waitForPeerConnection(laptop)

      await sendMessage(laptop, 'Sent from my laptop')
      await expectMessage(here, 'Sent from my laptop')

      // The sending device goes away; only the durable id can link its message.
      await deviceB.close()

      await openProfile(here)
      await here.getByTestId('profile-name').fill('Alicia')
      await here.getByTestId('profile-back').click()

      const laptopMessage = here
        .getByTestId('chat-message')
        .filter({ hasText: 'Sent from my laptop' })
      await expect(laptopMessage).toContainText('Alicia')
    } finally {
      await deviceA.close()
    }
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

  test('friend DMs sync reactions and attachments', async ({ browser }) => {
    await withTwoUsers(browser, async (alice, bob) => {
      await alice.getByTestId('rail-home').click()
      await bob.getByTestId('rail-home').click()

      await alice.getByTestId('friend-invite-email').fill('bob@e2e.test')
      await alice.getByTestId('friend-invite-submit').click()
      await expect(bob.getByTestId('friend-incoming')).toBeVisible({ timeout: 15_000 })
      await bob.locator('[data-testid^="friend-accept-"]').click()

      await expect(alice.locator('[data-testid^="friend-message-"]')).toBeVisible({ timeout: 15_000 })
      await alice.locator('[data-testid^="friend-message-"]').click()
      await expect(bob.getByTestId('global-dm-chat')).toBeVisible({ timeout: 15_000 })

      await alice.getByTestId('global-dm-input').fill('React to this DM')
      await alice.getByTestId('global-dm-send').click()
      await expect(bob.getByTestId('global-dm-messages')).toContainText('React to this DM', { timeout: 15_000 })
      await bob.getByLabel('React 👍').click()
      await expect(alice.getByTestId('global-dm-messages')).toContainText('👍 1', { timeout: 15_000 })

      await alice.getByTestId('global-dm-file-input').setInputFiles({
        name: 'hello-dm.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('Peerly direct-message attachment'),
      })
      const receivedFile = bob.getByRole('link', { name: 'hello-dm.txt' })
      await expect(receivedFile).toBeVisible({ timeout: 15_000 })
      await expect(receivedFile).toHaveAttribute('href', /^blob:/)
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

  test('unread activity updates the tab title and favicon outside the conversation', async ({ browser }) => {
    await withTwoUsers(browser, async (alice, bob) => {
      await bob.getByTestId('member-self').click()
      await sendMessage(alice, 'Background attention check')
      await expect(bob).toHaveTitle(/^\(1\) Peerly$/)
      await expect
        .poll(() =>
          bob.evaluate(() => document.querySelector<HTMLLinkElement>('link[rel~="icon"]')?.href)
        )
        .toMatch(/^data:image\/png/)

      await bob.getByTestId('profile-back').click()
      await expectMessage(bob, 'Background attention check')
      await expect(bob).toHaveTitle('Peerly')
    })
  })

  test('created channel syncs to connected peer', async ({ browser }) => {
    await withTwoUsers(browser, async (alice, bob) => {
      await createChannel(alice, 'design')
      await expectChannel(bob, 'design')
    })
  })

  test('channel rename and deletion sync; direct messages can be closed', async ({ browser }) => {
    await withTwoUsers(browser, async (alice, bob) => {
      await createChannel(alice, 'planning')
      await expectChannel(bob, 'planning')

      alice.once('dialog', dialog => void dialog.accept('roadmap'))
      await alice.getByLabel('Rename planning').click()
      await expectChannel(alice, 'roadmap')
      await expectChannel(bob, 'roadmap')

      alice.once('dialog', dialog => void dialog.accept())
      await alice.getByLabel('Delete roadmap').click()
      await expect(alice.locator('.channel-item', { hasText: 'roadmap' })).toHaveCount(0)
      await expect(bob.locator('.channel-item', { hasText: 'roadmap' })).toHaveCount(0, {
        timeout: 15_000,
      })

      await startDirectMessage(alice, 'Bob')
      await alice.getByLabel('Close direct message with Bob').click()
      await expect(alice.getByTestId(/dm-/)).toHaveCount(0)
    })
  })

  test('workspace settings expose storage, localization, and notification controls', async ({ page }) => {
    await joinWorkspace(page, { name: 'Alice', email: 'alice@e2e.test' })
    await page.getByTestId('workspace-settings-open').click()
    await expect(page.getByTestId('workspace-storage')).toBeVisible()
    await expect(page.getByTestId('notification-settings')).toBeVisible()
    // Relay health is Nostr-only diagnostics; E2E runs ws-relay, so the card
    // must stay hidden rather than probe a strategy it doesn't apply to.
    await expect(page.getByTestId('relay-health-card')).toHaveCount(0)
    await page.getByTestId('rail-home').click()
    await page.getByTestId('home-account-tab').click()
    await page.getByTestId('locale-select').selectOption('pl')
    await expect(page.getByRole('heading', { name: 'Profil i preferencje' })).toBeVisible()
    await page.locator('[data-testid^="rail-workspace-"]').first().click()
    await expect(page.getByRole('heading', { name: 'Kanały' })).toBeVisible()
    await expect(page.getByTestId('video-call-button')).toHaveAttribute(
      'aria-label',
      'Rozpocznij rozmowę wideo'
    )
    await page.getByTestId('member-self').click()
    await expect(page.getByRole('heading', { name: 'Twój profil' })).toBeVisible()
    await page.getByTestId('profile-back').click()
    await page.getByTestId('rail-home').click()
    await page.getByTestId('home-account-tab').click()
    await page.getByTestId('locale-select').selectOption('en')
    await expect(page.getByRole('heading', { name: 'Profile & preferences' })).toBeVisible()
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
      // Previously asserted the sidebar printed `Room: <workspaceId>` — which was
      // the workspace's encryption secret on screen. The workspace name proves
      // we are still in the same workspace without displaying the secret.
      await expect(alice.locator('.workspace-name')).toContainText('test-ws')
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
