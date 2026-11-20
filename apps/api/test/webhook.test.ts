import test from 'node:test'
import assert from 'node:assert/strict'
import { isAllowedWebhookUrl } from '../src/webhook.js'

test('only https Slack webhook hosts are allowed by default', () => {
  assert.equal(isAllowedWebhookUrl('https://hooks.slack.com/services/T000/B000/XXXX'), true)
  assert.equal(isAllowedWebhookUrl('https://hooks.slack-gov.com/services/T/B/X'), true)
  for (const bad of [
    'http://hooks.slack.com/services/T/B/X',          // not https
    'https://evil.example.com/hooks.slack.com',       // host is not slack
    'https://hooks.slack.com.evil.example/x',         // lookalike suffix
    'https://user:pw@hooks.slack.com/services/T/B/X', // embedded credentials
    'https://169.254.169.254/latest/meta-data',
    'https://localhost:8080/x',
    'file:///etc/passwd',
    'not a url',
    ''
  ]) assert.equal(isAllowedWebhookUrl(bad), false, bad)
})

test('WEBHOOK_ALLOWED_HOSTS extends the allow-list but never lifts the https requirement', () => {
  process.env.WEBHOOK_ALLOWED_HOSTS = 'chat.internal.example, other.example'
  try {
    assert.equal(isAllowedWebhookUrl('https://chat.internal.example/hook'), true)
    assert.equal(isAllowedWebhookUrl('http://chat.internal.example/hook'), false)
    assert.equal(isAllowedWebhookUrl('https://unlisted.example/hook'), false)
  } finally { delete process.env.WEBHOOK_ALLOWED_HOSTS }
})
