import { expect, type Browser, type Page } from '@playwright/test'

export type JoinOptions = {
  name?: string
  email?: string
  color?: string
}

/** Fixed workspace id used by E2E — matches src/collab/e2eAuth.ts */
export const E2E_WORKSPACE_ID = 'e2e00000000000000000000000000001'

/** Fixed invite used by E2E — matches src/collab/e2eAuth.ts */
export const E2E_INVITE_HASH =
  'invite=eyJ2IjoxLCJ3b3Jrc3BhY2VJZCI6ImUyZTAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAxIiwid29ya3NwYWNlTmFtZSI6InRlc3Qtd3MiLCJjcmVhdG9yS2V5SWQiOiJQLTI1Njo4UDRaMmxOZEp0NFlRMEpId1VsZjZWWWpMUEJhd2x6R1lFSWZPcDZpR1ZrOmV6NFJZeEEteGxPZERueDIyZTdXVnZzYUNpRDdqc0F4T1JobnZMbElOQm8iLCJhbGxvd0xpc3QiOnsiZW1haWxzIjpbImFsaWNlQGUyZS50ZXN0IiwiYm9iQGUyZS50ZXN0Il0sInNpZ25lZEF0IjoxNzAwMDAwMDAwMDAwLCJzaWduYXR1cmUiOiJOLWNSd0Zkbk1VU01PdnFPVDM1U3NacmFqZEpiZ3dTVlRIcG1JYWExOXFiRGpCa2lUUHpES1BJb0JzdzVHblhsZDgwbWlHdlRkMFVRejdmWFFDNXdxdyJ9fQ'

function emailFor(opts: JoinOptions): string {
  if (opts.email) return opts.email
  const slug = (opts.name ?? 'user').toLowerCase().replace(/\s+/g, '')
  return `${slug}@e2e.test`
}

const E2E_SESSION_INIT_FLAG = 'peerly-e2e-session-init'

/**
 * Clear persisted session before the app's first load in this tab.
 *
 * addInitScript runs on every navigation, so we gate the wipe behind a
 * sessionStorage flag. Reload keeps the flag (and the workspace session);
 * explicit clears in rejoinWorkspace/clearSession remove the flag first.
 */
export async function installFreshSession(page: Page) {
  await page.addInitScript(flag => {
    if (sessionStorage.getItem(flag)) return
    localStorage.clear()
    sessionStorage.clear()
    sessionStorage.setItem(flag, '1')
  }, E2E_SESSION_INIT_FLAG)
}

async function clearBrowserSession(page: Page) {
  await page.evaluate(flag => {
    localStorage.clear()
    sessionStorage.clear()
    sessionStorage.removeItem(flag)
  }, E2E_SESSION_INIT_FLAG)
}

export async function clearSession(page: Page) {
  await installFreshSession(page)
  await page.goto('/')
}

export async function openProfile(page: Page) {
  await page.getByTestId('nav-profile').click()
  await expect(page.getByTestId('profile-page')).toBeVisible()
}

export async function openInviteJoin(page: Page, inviteHash = E2E_INVITE_HASH) {
  await installFreshSession(page)
  await page.goto(`/#${inviteHash}`)
  await expect(page.getByTestId('join-workspace-tab')).toBeVisible({ timeout: 15_000 })
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
  await expect(page.getByTestId('signed-in-user')).toBeVisible({ timeout: 15_000 })
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

export async function waitForSignaling(page: Page) {
  const status = page.getByTestId('connection-status')
  await expect(status).not.toContainText('Signaling offline', { timeout: 45_000 })
}

/** @deprecated Use waitForSignaling */
export const waitForRelay = waitForSignaling

export async function waitForPeerConnection(page: Page, timeout = 45_000) {
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
  const input = page.getByTestId('message-input')
  await expect(input).toBeEnabled({ timeout: 15_000 })
  await input.fill(text)
  await page.getByTestId('send-button').click()
}

export async function expectMessage(page: Page, text: string, timeout = 30_000) {
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
    await aliceCtx.close()
    await bobCtx.close()
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