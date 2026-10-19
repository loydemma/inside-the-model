import { test, expect } from '@playwright/test'
import { PORTFOLIO_URL, REPO_URL } from '../src/config'

test('page loads hero copy', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('h1')).toContainText('Inside the Model')
  await expect(page.getByText('Five things AI does, made visible.')).toBeVisible()
})

test('no horizontal scroll on phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
  expect(scrollWidth).toBeLessThanOrEqual(390)
})

test('no console errors', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.waitForTimeout(1500)
  expect(errors).toEqual([])
})

test('five sections in order', async ({ page }) => {
  await page.goto('/')
  const ids = await page.locator('section.stage-section').evaluateAll((els) => els.map((e) => e.id))
  expect(ids).toEqual(['attention', 'orange', 'jello', 'flower', 'rocket'])
})

test('eyebrows numbered', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('section.stage-section .eyebrow').first()).toHaveText(/^01 · ATTENTION$/i)
})

test('ending links', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await expect(page.getByText('Designed and built by Emma Loyd')).toBeVisible()
  await expect(page.locator('[data-repo-link]')).toHaveAttribute('href', REPO_URL)
  for (const el of await page.locator('[data-portfolio-link]').all()) {
    await expect(el).toHaveAttribute('href', PORTFOLIO_URL)
  }
})
