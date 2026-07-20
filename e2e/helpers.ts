import { expect, test, type Browser, type Page } from '@playwright/test'
import {
  E2E_ALLOW_LIST,
  E2E_CREATOR_KEY_ID,
  E2E_WORKSPACE_NAME,
} from '../src/collab/e2eConstants'
import { LEGAL_CONSENT_STORAGE_KEY, LEGAL_VERSION } from '../src/consent'

export type JoinOptions = {
  name?: string
  email?: string
  color?: string
}

/**
 * One workspace per Playwright worker, so workers can run in parallel without
 * meeting each other: the workspace id doubles as the Trystero room id, and
 * tests sharing a room see each other's peers and messages.
 *
 * No new signing is needed per worker — the creator's allow-list signature
 * covers only `emails|signedAt` (see src/collab/allowList.ts), not the
 * workspace id, so the fixed signed fixture is valid for every derived id.
 */
export function e2eWorkspaceId(workerIndex = test.info().workerIndex): string {
  return `e2e${String(workerIndex + 1).padStart(29, '0')}`
}

export function e2eInviteHash(workerIndex = test.info().workerIndex): string {
  const invite = {
    v: 1,
    workspaceId: e2eWorkspaceId(workerIndex),
    workspaceName: E2E_WORKSPACE_NAME,
    creatorKeyId: E2E_CREATOR_KEY_ID,
    allowList: E2E_ALLOW_LIST,
  }
  return `invite=${Buffer.from(JSON.stringify(invite)).toString('base64url')}`
}

function emailFor(opts: JoinOptions): string {
  if (opts.email) return opts.email
  const slug = (opts.name ?? 'user').toLowerCase().replace(/\s+/g, '')
  return `${slug}@e2e.test`
}

const E2E_SESSION_INIT_FLAG = 'peerly-e2e-session-init'

type FreshSessionOptions = {
  /**
   * Seed current Terms/Privacy acceptance after wipe (default true).
   * Most tests are not about first-run legal UX; without this the fixed
   * consent banner intercepts clicks on the composer (Send) for 90s+.
   * Pass false only when testing the banner itself.
   */
  acceptLegal?: boolean
}

/**
 * Clear persisted session before the app's first load in this tab.
 *
 * addInitScript runs on every navigation, so we gate the wipe behind a
 * sessionStorage flag. Reload keeps the flag (and the workspace session);
 * explicit clears in rejoinWorkspace/clearSession remove the flag first.
 */
export async function installFreshSession(page: Page, options: FreshSessionOptions = {}) {
  const acceptLegal = options.acceptLegal !== false
  await page.addInitScript(
    ({ flag, legalKey, legalVersion, acceptLegal: seedLegal }) => {
      if (sessionStorage.getItem(flag)) return
      localStorage.clear()
      sessionStorage.clear()
      sessionStorage.setItem(flag, '1')
      if (seedLegal) {
        localStorage.setItem(
          legalKey,
          JSON.stringify({ version: legalVersion, acceptedAt: Date.now() })
        )
      }
    },
    {
      flag: E2E_SESSION_INIT_FLAG,
      legalKey: LEGAL_CONSENT_STORAGE_KEY,
      legalVersion: LEGAL_VERSION,
      acceptLegal,
    }
  )
}

async function clearBrowserSession(page: Page, options: FreshSessionOptions = {}) {
  const acceptLegal = options.acceptLegal !== false
  await page.evaluate(
    ({ flag, legalKey, legalVersion, acceptLegal: seedLegal }) => {
      localStorage.clear()
      sessionStorage.clear()
      sessionStorage.removeItem(flag)
      if (seedLegal) {
        localStorage.setItem(
          legalKey,
          JSON.stringify({ version: legalVersion, acceptedAt: Date.now() })
        )
      }
    },
    {
      flag: E2E_SESSION_INIT_FLAG,
      legalKey: LEGAL_CONSENT_STORAGE_KEY,
      legalVersion: LEGAL_VERSION,
      acceptLegal,
    }
  )
}

/** Click Accept if the first-run legal banner is showing (no-op if already accepted). */
export async function acceptLegalConsentIfVisible(page: Page) {
  const accept = page.getByTestId('consent-accept')
  if (await accept.isVisible().catch(() => false)) {
    await accept.click()
    await expect(page.getByTestId('consent-banner')).toHaveCount(0, { timeout: 5_000 })
  }
}

export async function clearSession(page: Page) {
  await installFreshSession(page)
  await page.goto('/')
}

export async function openProfile(page: Page) {
  await page.getByTestId('member-self').click()
  await expect(page.getByTestId('profile-page')).toBeVisible()
}

/**
 * Open an invite link and wait for the pre-sign-in screen.
 *
 * Only the invite banner is asserted here: the join/create tabs render after
 * sign-in, since every action behind them needs a verified identity.
 */
export async function openInviteJoin(page: Page, inviteHash = e2eInviteHash()) {
  await installFreshSession(page)
  await page.goto(`/#${inviteHash}`)
  await expect(page.getByTestId('signin-e2e')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('invite-summary')).toBeVisible({ timeout: 15_000 })
}

export async function rejoinWorkspace(page: Page, opts: JoinOptions) {
  await clearBrowserSession(page)
  await page.reload()
  await openInviteJoin(page)
  await e2eSignIn(page, opts)
  await page.getByTestId('join-submit').click()
  await expect(page.locator('.sidebar')).toBeVisible()

  if (opts.name || opts.color) {
    await openProfile(page)
    if (opts.name) {
      await page.getByTestId('profile-name').fill(opts.name)
    }
    if (opts.color) {
      await page.getByTestId('profile-color').fill(opts.color)
    }
    await page.getByTestId('profile-back').click()
  }
}

export async function waitForWorkspace(page: Page, timeout = 30_000) {
  await expect(page.locator('.sidebar')).toBeVisible({ timeout })
}

export async function e2eSignIn(page: Page, opts: JoinOptions) {
  await page.getByTestId('e2e-email').fill(emailFor(opts))
  await page.getByTestId('signin-e2e').click()
  await expect(page.getByTestId('workspace-rail')).toBeVisible({ timeout: 15_000 })
}

export async function joinWorkspace(page: Page, opts: JoinOptions) {
  await openInviteJoin(page)
  await e2eSignIn(page, opts)
  await page.getByTestId('join-submit').click()
  await waitForWorkspace(page)

  if (opts.name || opts.color) {
    await openProfile(page)
    if (opts.name) {
      await page.getByTestId('profile-name').fill(opts.name)
    }
    if (opts.color) {
      await page.getByTestId('profile-color').fill(opts.color)
    }
    await page.getByTestId('profile-back').click()
  }
}

/**
 * Create a brand-new workspace as the signed-in user.
 *
 * Distinct from joinWorkspace(), which uses the fixed E2E invite: that
 * workspace's creator key belongs to no test device, so its members correctly
 * cannot invite. Creating one here makes this browser the creator, which is the
 * only way to exercise the invite flow.
 */
export async function createWorkspace(
  page: Page,
  opts: JoinOptions & { workspaceName: string; guests?: string }
) {
  await installFreshSession(page)
  await page.goto('/')
  // Sign in first, then use the dedicated create destination in the global rail.
  await e2eSignIn(page, opts)
  await page.getByTestId('rail-create-workspace').click()
  await page.getByTestId('workspace-name').fill(opts.workspaceName)
  if (opts.guests) await page.getByTestId('guest-emails').fill(opts.guests)
  await page.getByTestId('join-submit').click()
  await waitForWorkspace(page)
}

export async function leaveToPicker(page: Page) {
  // The workspace rail's Direct Messages / Home button closes the workspace.
  await page.getByTestId('rail-home').click()
  await expect(page.getByTestId('home-view')).toBeVisible({ timeout: 15_000 })
}

export async function waitForSignaling(page: Page) {
  const status = page.getByTestId('connection-status')
  // Fail faster than the old 45s wall when signaling never comes up.
  await expect(status).not.toContainText('Signaling offline', { timeout: 25_000 })
}

/** @deprecated Use waitForSignaling */
export const waitForRelay = waitForSignaling

export async function waitForPeerConnection(page: Page, timeout = 30_000) {
  await waitForRelay(page)
  const status = page.getByTestId('connection-status')
  await expect(status).toContainText('Connected', { timeout })
}

export async function expectPeerVisible(page: Page, peerName: string) {
  await expect(page.getByTestId('member-list')).toContainText(peerName)
}

export async function expectJoinRejected(page: Page, reason?: string | RegExp) {
  await expect(page.getByTestId('error-banner')).toBeVisible({ timeout: 15_000 })
  if (reason) {
    await expect(page.getByTestId('error-banner')).toContainText(reason)
  }
  await expect(page.locator('.sidebar')).not.toBeVisible()
}

export async function expectSharedFilesUsable(page: Page) {
  const result = await page.evaluate(async () => {
    const probe = async (url: string | null | undefined) => {
      if (!url) return 'EMPTY_URL'
      try {
        const res = await fetch(url)
        return res.ok ? 'OK' : `HTTP_${res.status}`
      } catch {
        return 'REVOKED'
      }
    }
    const img = document.querySelector<HTMLImageElement>('.message-list .file-preview')
    const link = document.querySelector<HTMLAnchorElement>('.message-list .file-download')
    return {
      imgDecoded: img ? img.naturalWidth > 0 : null,
      imgFetch: img ? await probe(img.getAttribute('src')) : null,
      linkFetch: link ? await probe(link.getAttribute('href')) : null,
    }
  })

  if (result.imgDecoded !== null) {
    expect(result.imgDecoded, 'image preview should decode, not be a dead blob URL').toBe(true)
    expect(result.imgFetch, 'image blob URL should still resolve').toBe('OK')
  }
  if (result.linkFetch !== null) {
    expect(result.linkFetch, 'file download blob URL should still resolve').toBe('OK')
  }
}

export async function createChannel(page: Page, name: string) {
  await page.getByTestId('add-channel-toggle').click()
  await page.getByTestId('add-channel-input').fill(name)
  await page.getByTestId('add-channel-submit').click()
  await expectChannel(page, name)
}

export async function startDirectMessage(page: Page, peerName: string) {
  await page.getByTestId(`message-peer-${peerName}`).click()
  await expect(page.locator('.dm-title', { hasText: peerName })).toBeVisible({ timeout: 15_000 })
}

export async function expectChannel(page: Page, name: string, timeout = 15_000) {
  await expect(page.locator('.channel-item', { hasText: name })).toBeVisible({ timeout })
}

export async function sendMessage(page: Page, text: string) {
  await acceptLegalConsentIfVisible(page)
  const input = page.getByTestId('message-input')
  await expect(input).toBeEnabled({ timeout: 10_000 })
  await input.fill(text)
  // Fail fast if the consent banner (or anything else) still intercepts clicks.
  await page.getByTestId('send-button').click({ timeout: 10_000 })
}

export async function expectMessage(page: Page, text: string, timeout = 20_000) {
  await expect(page.locator('.message-list')).toContainText(text, { timeout })
}

export async function withTwoUsers(
  browser: Browser,
  run: (alice: Page, bob: Page) => Promise<void>
) {
  const aliceCtx = await browser.newContext()
  const bobCtx = await browser.newContext()
  const alice = await aliceCtx.newPage()
  const bob = await bobCtx.newPage()

  await joinWorkspace(alice, { name: 'Alice', email: 'alice@e2e.test' })
  await waitForRelay(alice)
  await joinWorkspace(bob, { name: 'Bob', email: 'bob@e2e.test' })
  await waitForPeerConnection(alice)
  await waitForPeerConnection(bob)

  try {
    await run(alice, bob)
  } finally {
    // After a hard timeout the context may already be closed — don't hang cleanup.
    await Promise.allSettled([aliceCtx.close(), bobCtx.close()])
  }
}

export function collectConsole(page: Page, logs: string[]) {
  page.on('console', msg => {
    const type = msg.type()
    if (type === 'error' || type === 'warning') {
      logs.push(`[${type}] ${msg.text()}`)
    }
  })
}
