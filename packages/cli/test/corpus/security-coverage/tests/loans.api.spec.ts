import { test, expect } from '@playwright/test'

test('creates a loan', async ({ request }) => {
  const res = await request.post('/api/loans', { headers: { Authorization: `Bearer ${process.env.TOKEN}` }, data: { principal: 5000 } })
  expect(res.status()).toBe(201)
})

test('rejects deleting a loan without token', async ({ request }) => {
  const res = await request.delete(`/api/loans/${id}`)
  expect(res.status()).toBe(401)
})

test('other user cannot read my loan', async ({ request }) => {
  const res = await request.get(`/api/loans/${loanId}`, { headers: { Authorization: `Bearer ${otherUserToken}` } })
  expect(res.status()).toBe(404)
})

test('rejects invalid principal', async ({ page }) => {
  expect((await page.request.post('/api/loans', { data: { principal: -1 } })).status()).toBe(422)
})
