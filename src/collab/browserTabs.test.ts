import { afterEach, describe, expect, it } from 'vitest'
import { BrowserTabs } from './browserTabs'
import { fakeBrowser } from './testing/fakeBrowserTabs'

const opened: BrowserTabs[] = []
function track<T extends BrowserTabs>(tab: T): T {
  opened.push(tab)
  return tab
}

afterEach(() => {
  for (const tab of opened.splice(0)) tab.close()
})

describe('sibling tabs', () => {
  it('a tab answers for its own tab key, and only another live tab gets that answer', async () => {
    const browser = fakeBrowser()
    const first = track(browser.tab())
    const second = track(browser.tab())
    second.addOwnTabKey('tab-key-2')
    await expect(first.hasSibling('tab-key-2')).resolves.toBe(true)
    await expect(first.hasSibling('tab-key-unknown')).resolves.toBe(false)
    // A tab never vouches for itself: its own key is not a sibling's.
    first.addOwnTabKey('tab-key-1')
    await expect(first.hasSibling('tab-key-1')).resolves.toBe(false)
  })

  it('a tab of another browser profile (another channel and lock space) cannot vouch', async () => {
    const here = track(fakeBrowser().tab())
    const elsewhere = track(fakeBrowser().tab())
    elsewhere.addOwnTabKey('tab-key-elsewhere')
    await expect(here.hasSibling('tab-key-elsewhere')).resolves.toBe(false)
  })

  it('a closed tab no longer vouches', async () => {
    const browser = fakeBrowser()
    const first = track(browser.tab())
    const second = browser.tab()
    second.addOwnTabKey('tab-key-2')
    second.close()
    await expect(first.hasSibling('tab-key-2')).resolves.toBe(false)
  })

  it('a stale tab – one whose life lock the browser dropped – is not taken for a sibling even if it answers', async () => {
    const browser = fakeBrowser()
    const first = track(browser.tab())
    const stale = track(browser.tab({ tabId: 'stale-tab' }))
    stale.addOwnTabKey('tab-key-stale')
    await expect(first.hasSibling('tab-key-stale')).resolves.toBe(true)
    browser.locks.forceRelease('peerly-tab:stale-tab')
    await expect(first.hasSibling('tab-key-stale')).resolves.toBe(false)
  })

  it('without BroadcastChannel no tab is a sibling, which keeps the old one-tab behaviour', async () => {
    const lonely = track(new BrowserTabs({ channel: null, locks: null }))
    await expect(lonely.hasSibling('anything')).resolves.toBe(false)
  })
})

describe('attention once per browser', () => {
  it('exactly one of several tabs claims the same event, however they race', async () => {
    const browser = fakeBrowser()
    const tabs = [track(browser.tab()), track(browser.tab()), track(browser.tab())]
    const claims = await Promise.all(tabs.map(tab => tab.claim('dm:general:m1')))
    expect(claims.filter(Boolean)).toHaveLength(1)
  })

  it('a tab receiving the event late, after the claim was released, stays quiet', async () => {
    const browser = fakeBrowser()
    const first = track(browser.tab())
    const late = track(browser.tab())
    await expect(first.claim('dm:general:m2')).resolves.toBe(true)
    await new Promise(resolve => setTimeout(resolve, 120))
    await expect(late.claim('dm:general:m2')).resolves.toBe(false)
  })

  it('the claiming tab may ask again (a re-render restarting its ringtone); others still may not', async () => {
    const browser = fakeBrowser()
    const ringing = track(browser.tab())
    const other = track(browser.tab())
    await expect(ringing.claim('call:bob:s1')).resolves.toBe(true)
    await expect(ringing.claim('call:bob:s1')).resolves.toBe(true)
    await expect(other.claim('call:bob:s1')).resolves.toBe(false)
  })

  it('a visible tab wins a ring over a hidden one', async () => {
    const browser = fakeBrowser()
    const hidden = track(browser.tab({ isVisible: () => false }))
    const visible = track(browser.tab({ isVisible: () => true }))
    const [hiddenClaim, visibleClaim] = await Promise.all([
      hidden.claim('call:bob:s2', { preferVisible: true }),
      visible.claim('call:bob:s2', { preferVisible: true }),
    ])
    expect(visibleClaim).toBe(true)
    expect(hiddenClaim).toBe(false)
  })

  it('a call answered in one tab is announced to the others', async () => {
    const browser = fakeBrowser()
    const answering = track(browser.tab())
    const other = track(browser.tab())
    const heard: string[] = []
    other.onHandled(key => heard.push(key))
    answering.announceHandled('call:bob:s3')
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(heard).toEqual(['call:bob:s3'])
    await expect(other.claim('call:bob:s3')).resolves.toBe(false)
  })

  it('different events are claimed independently', async () => {
    const browser = fakeBrowser()
    const first = track(browser.tab())
    track(browser.tab())
    await expect(first.claim('dm:general:a')).resolves.toBe(true)
    await expect(first.claim('dm:general:b')).resolves.toBe(true)
  })
})
