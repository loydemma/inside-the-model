import { test, expect } from '@playwright/test'

test('side sheet on desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await page.locator('.deeper-btn').first().click()
  const panel = page.locator('#deeper-panel')
  await expect(panel).toBeVisible()
  expect(await panel.evaluate((el) => getComputedStyle(el).right)).toBe('0px')
  const box = await panel.boundingBox()
  expect(box!.width).toBeLessThanOrEqual(480.5) // sub-pixel rounding while it slides in
})

test('bottom sheet on phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.locator('.deeper-btn').first().click()
  const panel = page.locator('#deeper-panel')
  await expect(panel).toBeVisible()
  await page.waitForTimeout(600)
  const box = await panel.boundingBox()
  expect(box!.y + box!.height).toBeCloseTo(844, 0)
  expect(box!.width).toBe(390)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})
