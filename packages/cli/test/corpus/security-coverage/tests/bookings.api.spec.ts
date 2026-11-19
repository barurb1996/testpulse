import { test, expect } from '@playwright/test'

test('creates a booking', async ({ request }) => {
  const res = await request.post('/api/bookings', { headers: { Authorization: `Bearer ${process.env.TOKEN}` }, data: { amount: 5000 } })
  expect(res.status()).toBe(201)
})

test('rejects deleting a booking without token', async ({ request }) => {
  const res = await request.delete(`/api/bookings/${id}`)
  expect(res.status()).toBe(401)
})

test('other user cannot read my booking', async ({ request }) => {
  const res = await request.get(`/api/bookings/${bookingId}`, { headers: { Authorization: `Bearer ${otherUserToken}` } })
  expect(res.status()).toBe(404)
})

test('rejects invalid amount', async ({ page }) => {
  expect((await page.request.post('/api/bookings', { data: { amount: -1 } })).status()).toBe(422)
})
