import { test, expect } from '@playwright/test'

test('login', async ({ page }) => {
  await page.goto('/')
  await page.waitForTimeout(3000)
  page.click('#submit')
})

test('should render homepage and show the main CTA when the user is not logged in', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('link', { name: 'Sign up' })).toBeVisible()
})

test('checks things', async ({ page }) => {
  await page.goto('/profile')
  await page.locator('.profile-name').click()
})
