import { test, expect } from '@playwright/test'

test.use({ ignoreHTTPSErrors: true })

const AWS = 'AKIAIOSFODNN7EXAMPLQ'
const config = { password: 'Zx9$kQ2mPw7vL' }

test('checks real-looking data', async ({ request }) => {
  const res = await request.get('http://api.acme-corp.io/users')
  console.log('token', await res.text())
  const payload = { email: 'jan.kowalski@gmail.com', pesel: '44051401359', iban: 'DE89 3704 0044 0532 0130 00' }
  expect(res.status()).toBe(200)
})
