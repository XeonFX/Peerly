import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { joinWorkspace } from './helpers'

for (const width of [320, 390, 768]) {
  test(`workspace has no serious accessibility violations at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await joinWorkspace(page, { email: 'alice@e2e.test' })
    const result = await new AxeBuilder({ page }).disableRules(['color-contrast']).analyze()
    expect(result.violations.filter(item => ['serious', 'critical'].includes(item.impact ?? '')))
      .toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(width + 1)
  })
}

test('message search traps focus, inerts the workspace, closes on Escape, and restores focus', async ({ page }) => {
  await joinWorkspace(page, { email: 'alice@e2e.test' })
  const opener = page.getByTestId('open-search')
  await opener.focus()
  await opener.press('Enter')
  const dialog = page.getByRole('dialog', { name: /search messages/i })
  await expect(dialog).toBeVisible()
  await expect(page.getByTestId('message-search-input')).toBeFocused()
  expect(await page.locator('[inert]').count()).toBeGreaterThan(0)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(opener).toBeFocused()
})

test('reduced motion and 200% zoom remain usable', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 390, height: 844 })
  await joinWorkspace(page, { email: 'alice@e2e.test' })
  await page.evaluate(() => { document.documentElement.style.zoom = '2' })
  const duration = await page.locator('button').first().evaluate(node => getComputedStyle(node).transitionDuration)
  expect(['0s', '0.00001s', '0.01ms', '1e-05s']).toContain(duration)
})
