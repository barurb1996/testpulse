import { test, expect } from '@playwright/test'

test('uses env + reserved data', async ({ request }) => {
  const password = process.env.TEST_PASSWORD
  const res = await request.post('https://staging.example.com/login', {
    data: { email: 'qa@example.com', password, card: '4242424242424242' }
  })
  expect(res.status()).toBe(200)
})
