import { test, expect } from '@playwright/test'

// tautological-assertion: expect(x).toBe(x) and expect(true).toBe(true)
test('price calculation returns correct total', async ({ page }) => {
  const price = 99
  expect(price).toBe(price)        // same variable — always passes
  expect(true).toBe(true)          // literal vs literal — always passes
  expect(null).toBeNull()          // null.toBeNull — always passes
})

// weak-assertion-only: only existence checks, no value verified
test('user profile loads', async ({ page }) => {
  await page.goto('/profile')
  const name = await page.locator('.name').textContent()
  expect(name).toBeDefined()
  expect(name).toBeTruthy()
})

// swallowed-error: empty catch block
test('payment succeeds', async ({ page }) => {
  try {
    await page.goto('/pay')
    await page.click('#submit')
  } catch (e) {}   // swallowed
  expect(true).toBe(true)
})

// swallowed-error: .catch(() => {})
test('loads user data', async ({ page }) => {
  await fetch('/api/users').catch(() => {})
  expect(true).toBeDefined()
})

// snapshot-only: all assertions are snapshots
test('homepage renders correctly', async ({ page }) => {
  await page.goto('/')
  expect(await page.screenshot()).toMatchSnapshot()
  expect(await page.locator('h1').innerHTML()).toMatchInlineSnapshot()
})

// commented-out-assertion: expect() commented out
test('total amount is calculated', async ({ page }) => {
  const total = 150
  // expect(total).toBe(150)
  expect(total).toBeDefined()
})

// name-body-mismatch: name implies error but no error assertion
test('should reject invalid token', async ({ page }) => {
  const res = await page.request.get('/api/dashboard', { headers: { Authorization: 'Bearer bad' } })
  expect(res.status()).toBe(200)
})

// copy-paste-variant: same structure, different data literals
test('logs in with user "alice@example.com"', async ({ page }) => {
  await page.goto('/login')
  await page.fill('#email', 'alice@example.com')
  expect(await page.locator('.welcome').textContent()).toBeDefined()
})
test('logs in with user "bob@example.com"', async ({ page }) => {
  await page.goto('/login')
  await page.fill('#email', 'bob@example.com')
  expect(await page.locator('.welcome').textContent()).toBeDefined()
})
test('logs in with user "carol@example.com"', async ({ page }) => {
  await page.goto('/login')
  await page.fill('#email', 'carol@example.com')
  expect(await page.locator('.welcome').textContent()).toBeDefined()
})
