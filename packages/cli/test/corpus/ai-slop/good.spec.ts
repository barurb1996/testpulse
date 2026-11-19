import { test, expect } from '@playwright/test'

// no tautological assertions — real values compared
test('price calculation returns correct total', async ({ page }) => {
  await page.goto('/cart')
  const total = await page.locator('[data-testid="total"]').textContent()
  expect(total).toBe('$198.00')
})

// value assertions, not just existence
test('user profile loads with correct name', async ({ page }) => {
  await page.goto('/profile')
  const name = await page.locator('[data-testid="name"]').textContent()
  expect(name).toBe('Alice Smith')
})

// errors handled with assertion, not swallowed
test('payment fails with invalid card', async ({ page }) => {
  await page.goto('/pay')
  await page.fill('#card', '0000-0000-0000-0000')
  await page.click('#submit')
  await expect(page.locator('.error-message')).toBeVisible()
  await expect(page.locator('.error-message')).toHaveText('Invalid card number')
})

// explicit assertions alongside snapshot
test('homepage renders correctly', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('h1')).toHaveText('Welcome to Testpulse')
  expect(await page.screenshot()).toMatchSnapshot()
})

// active assertion, not commented
test('total amount is calculated', async ({ page }) => {
  await page.goto('/cart')
  const total = await page.locator('[data-testid="total"]').textContent()
  expect(total).toBe('$150.00')
})

// name matches body — error case tested properly
test('should reject invalid token', async ({ page }) => {
  const res = await page.request.get('/api/profile', {
    headers: { Authorization: 'Bearer bad-token' }
  })
  expect(res.status()).toBe(401)
})

// parameterised with test.each — not copy-paste
test.each([
  ['alice@example.com', 'Alice'],
  ['bob@example.com', 'Bob'],
  ['carol@example.com', 'Carol'],
])('logs in with %s', async ({ page }, email, name) => {
  await page.goto('/login')
  await page.fill('#email', email)
  await page.click('#submit')
  await expect(page.locator('.welcome')).toHaveText(`Hello, ${name}`)
})
