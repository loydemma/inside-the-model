import { test, expect, type Page, type Locator } from '@playwright/test'

// One visitor's walk through all four sections, doing each section's one action, with no errors.

function trackErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(e.message))
  return errors
}

async function arrive(section: Locator): Promise<void> {
  await section.evaluate((el) => el.scrollIntoView({ block: 'start' }))
}

async function centre(el: Locator) {
  const b = (await el.boundingBox())!
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width }
}

// A swipe (touch) or a drag (mouse) straight across the middle of `el`.
async function swipe(page: Page, el: Locator, touch: boolean): Promise<void> {
  const c = await centre(el)
  const from = { x: c.x - c.w * 0.4, y: c.y }
  const to = { x: c.x + c.w * 0.4, y: c.y + 10 }
  if (!touch) {
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(to.x, to.y, { steps: 10 })
    await page.mouse.up()
    return
  }
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] })
  for (let i = 1; i <= 10; i++) {
    const p = { x: from.x + ((to.x - from.x) * i) / 10, y: from.y + ((to.y - from.y) * i) / 10 }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [p] })
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

// Press and hold `el` until `done` is visible, then let go.
async function holdUntil(page: Page, el: Locator, done: Locator, touch: boolean): Promise<void> {
  const c = await centre(el)
  const cdp = touch ? await page.context().newCDPSession(page) : null
  if (cdp) await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [c] })
  else {
    await page.mouse.move(c.x, c.y)
    await page.mouse.down()
  }
  await expect(done).toBeVisible({ timeout: 30_000 })
  if (cdp) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  else await page.mouse.up()
}

const viewports = [
  { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
  { name: 'phone', use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } },
]

for (const vp of viewports) {
  test.describe(vp.name, () => {
    test.use(vp.use)

    test('journey through every section', async ({ page }) => {
      test.setTimeout(120_000)
      const touch = vp.name === 'phone'
      const errors = trackErrors(page)
      await page.goto('/')

      // Orange: slice until every token is off; the counter, caption and why follow.
      const orange = page.locator('#orange')
      await arrive(orange)
      await expect(orange).toHaveClass(/is-your-turn/, { timeout: 10_000 })
      await expect(async () => {
        await swipe(page, orange.locator('[data-orange-stage]'), touch)
        await expect(orange.locator('.why')).toHaveClass(/is-shown/, { timeout: 1500 })
      }).toPass({ timeout: 20_000 })
      await expect(orange.locator('[data-counter]')).toHaveClass(/is-shown/)
      await expect(orange.locator('[data-chunks]')).toHaveText('2')

      // Flower: hold until the answer is done, then give it a source.
      const flower = page.locator('#flower')
      await arrive(flower)
      await expect(flower).toHaveClass(/is-your-turn/, { timeout: 10_000 })
      await holdUntil(page, flower.locator('[data-flower-stage]'), flower.locator('.why.is-shown'), touch)
      await expect(flower.locator('[data-caption]')).toHaveClass(/is-shown/)
      await flower.getByRole('button', { name: 'Give it a source' }).click()
      await expect(flower.locator('[data-source-card]')).toBeVisible()

      // Jello: the intro plays, then the hottest stop and a poke.
      const jello = page.locator('#jello')
      await arrive(jello)
      await expect(jello.locator('.why')).toHaveClass(/is-shown/, { timeout: 15_000 })
      await jello.locator('[data-temperature-slider]').fill('4')
      await expect(jello.locator('[data-temperature-value]')).toHaveText('2.0')
      const stage = jello.locator('[data-jello-stage]')
      if (touch) await stage.tap()
      else await stage.click()
      await expect(jello).toHaveClass(/has-poked/)

      // Rocket: the intro stacks the stages, then a launch lands a result.
      const rocket = page.locator('#rocket')
      await arrive(rocket)
      await expect(rocket.locator('.why')).toHaveClass(/is-shown/, { timeout: 15_000 })
      await rocket.getByRole('button', { name: 'Launch' }).click()
      await expect(rocket.locator('[data-result]')).toHaveText(/Made it!|Stage \d+ failed\./, { timeout: 15_000 })

      expect(errors).toEqual([])
    })
  })
}

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' })

  test('every section lands on its answered state at once', async ({ page }) => {
    const errors = trackErrors(page)
    await page.goto('/')
    const prompt = { timeout: 1500 }

    const orange = page.locator('#orange')
    await arrive(orange)
    for (const sel of ['[data-counter]', '[data-caption]', '[data-hint]', '.why']) {
      await expect(orange.locator(sel)).toHaveClass(/is-shown/, prompt)
    }
    await expect(orange.locator('[data-chunks]')).toHaveText('2', { timeout: 10_000 }) // after the tokenizer loads

    const flower = page.locator('#flower')
    await arrive(flower)
    await expect(flower.locator('.why')).toHaveClass(/is-shown/, prompt)
    await expect(flower.locator('[data-response] [data-invented]')).toHaveCount(1)
    await expect(flower.getByRole('button', { name: 'Give it a source' })).toBeVisible()

    const jello = page.locator('#jello')
    await arrive(jello)
    await expect(jello.locator('.why')).toHaveClass(/is-shown/, prompt)
    await expect(jello.locator('[data-temperature-value]')).toHaveText('0.0')

    const rocket = page.locator('#rocket')
    await arrive(rocket)
    await expect(rocket.locator('.why')).toHaveClass(/is-shown/, prompt)
    await expect(rocket.locator('[data-odds]')).toHaveText('60%')
    await expect(rocket.getByRole('button', { name: 'Launch' })).toBeEnabled()

    expect(errors).toEqual([])
  })
})
