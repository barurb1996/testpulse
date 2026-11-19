import { test, expect } from '@playwright/test'

// happy-path-only: API tests, none asserts an error / 4xx outcome
test('lists loans', async ({ request }) => {
  const res = await request.get('/api/loans')
  expect(res.status()).toBe(200)
})
test('creates a loan', async ({ request }) => {
  const res = await request.post('/api/loans', { data: { principal: 100 } })
  expect(res.status()).toBe(201)
})
