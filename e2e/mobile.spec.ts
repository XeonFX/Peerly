import { expect, test, type Page } from '@playwright/test'
import { joinWorkspace } from './helpers'

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1)
}

test.describe('phone layout', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('keeps workspace controls reachable and uses master-detail home navigation', async ({ page }) => {
    await joinWorkspace(page, { email: 'alice@e2e.test' })

    const rail = page.getByTestId('workspace-rail')
    await expect(rail).toBeVisible()
    const railBox = await rail.boundingBox()
    expect(railBox).not.toBeNull()
    expect(railBox!.y + railBox!.height).toBeGreaterThanOrEqual(843)
    await expectNoHorizontalOverflow(page)

    await page.getByTestId('rail-home').click()
    await expect(page.getByTestId('home-sidebar')).toBeVisible()
    const sidebarBox = await page.getByTestId('home-sidebar').boundingBox()
    expect(sidebarBox?.width).toBeGreaterThanOrEqual(388)

    await page.getByTestId('home-friends-tab').click()
    await expect(page.locator('main').getByRole('heading', { name: 'Friends', exact: true }).first()).toBeVisible()
    await expect(page.getByTestId('home-mobile-back')).toBeVisible()
    await page.getByTestId('home-mobile-back').click()
    await expect(page.getByTestId('home-sidebar')).toBeVisible()

    await page.getByTestId('home-devices-tab').click()
    await expect(page.getByTestId('home-mobile-back')).toBeVisible()
    await page.getByTestId('home-mobile-back').click()
    await expect(page.getByTestId('home-sidebar')).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })
})
