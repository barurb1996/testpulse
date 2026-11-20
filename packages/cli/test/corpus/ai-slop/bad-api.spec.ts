import { test, expect } from '@playwright/test'

// happy-path-only: API tests, none asserts an error / 4xx outcome
test('lists bookings', async ({ request }) => {
  const res = await request.get('/api/bookings')
  expect(res.status()).toBe(200)
})
test('creates a booking', async ({ request }) => {
  const res = await request.post('/api/bookings', { data: { amount: 100 } })
  expect(res.status()).toBe(201)
})
