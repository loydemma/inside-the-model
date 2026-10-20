import { test, expect } from '@playwright/test'

test('fallback without GPU', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('#fallback-card')).toBeVisible()
  await expect(page.locator('html.no-3d')).toHaveCount(1)
  const h2s = page.locator('section.stage-section h2')
  await expect(h2s).toHaveCount(4)
  for (const h of await h2s.all()) {
    await h.scrollIntoViewIfNeeded()
    await expect(h).toBeVisible()
  }
})
