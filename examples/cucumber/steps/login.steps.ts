import { Given, When, Then } from '@cucumber/cucumber'
import type { Page } from '@playwright/test'

declare const page: Page

Given('I am on the login page', async () => {
  await page.goto('/login')
})

When('I enter valid credentials', async () => {
  page.fill('#email', 'test@example.com')
  page.click('.btn-submit')
})

Then('I should see the dashboard', async () => {
})

Given('I click {string}', (selector: string) => {
  page.click(selector)
  console.log('clicked', selector)
})

When('I wait briefly', async () => {
  await page.waitForTimeout(2000)
})
