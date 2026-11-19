import { test, expect } from '@playwright/test'

test('chatbot greets the user', async ({ request }) => {
  const res = await request.post('/api/chat', { data: { message: 'hi' } })
  const body = await res.json()
  expect(body.content).toBe('Hello! How can I help you with your account today?')
})

test('eval runs', async () => {
  const score = await evaluateAgainstGoldenSet(openaiClient)
  expect(score).toBeGreaterThan(0)
})
