import test from 'node:test'
import assert from 'node:assert/strict'
import { redactSecrets, scanSecurityHygiene } from '../../src/rules/security-hygiene.js'

const rulesOn = (src: string, opts = {}) => scanSecurityHygiene(src, opts).map(i => i.rule)
const first = (src: string, opts = {}) => scanSecurityHygiene(src, opts)[0]

test('provider keys are critical findings and the message never reveals more than a 4-char prefix', () => {
  const aws = 'AKIAIOSFODNN7EXAMPLQ'
  const i = first(`const k = '${aws}'`)
  assert.equal(i.rule, 'hardcoded-secret'); assert.equal(i.severity, 'critical')
  assert.ok(!i.message.includes(aws) && !i.message.includes(aws.slice(-4)), i.message)
  const gh = 'ghp_' + 'a1B2c3D4e5'.repeat(4)
  assert.ok(!first(`token = "${gh}"`).message.includes(gh.slice(8)))
})

test('passwords: real-looking literals are flagged and fully hidden, fixtures and placeholders are not', () => {
  const i = first(`const cfg = { password: 'Zx9$kQ2mPw7vL' }`)
  assert.equal(i.rule, 'hardcoded-secret')
  assert.ok(!i.message.includes('Zx9') && !i.message.includes('7vL'), 'short secrets are never partially shown')
  for (const fine of [
    `password: process.env.PW`, `password: 'changeme123'`, `password: 'wrong-password'`, `password: 'a-very-long-password-1'`,
    `password: '#(password)'`, `password: '<your-password>'`, `const pw = 'x'`
  ]) assert.ok(!rulesOn(fine).includes('hardcoded-secret'), fine)
})

test('PII: valid card/IBAN/PESEL are flagged; phone numbers, timestamps and placeholder e-mails are not', () => {
  assert.ok(rulesOn(`card: '4539 1488 0343 6467'`).includes('real-looking-pii'), 'Luhn-valid card with a real network prefix')
  assert.ok(!rulesOn(`card: '4539 1488 0343 6468'`).includes('real-looking-pii'), 'fails the Luhn check')
  assert.ok(rulesOn(`iban: 'DE89 3704 0044 0532 0130 00'`).includes('real-looking-pii'))
  assert.ok(rulesOn(`pesel: '44051401359'`).includes('real-looking-pii'))
  assert.ok(rulesOn(`mail: 'jan.kowalski@gmail.com'`).includes('real-looking-pii'))
  for (const fine of [`phone: '+15551110003'`, `from=1699934989607`, `card: '4242424242424242'`, `mail: 'test@gmail.com'`, `mail: 'qa@example.com'`, `iban: 'DE00 0000 0000 0000 0000 00'`])
    assert.ok(!rulesOn(fine).includes('real-looking-pii'), fine)
})

test('TLS, http and output rules', () => {
  for (const line of ['use: { ignoreHTTPSErrors: true }', 'rejectUnauthorized: false', "* configure ssl = true", 'requests.get(u, verify=False)'])
    assert.ok(rulesOn(line).includes('tls-verification-disabled'), line)
  assert.ok(rulesOn(`const u = 'http://api.partner-systems.io/v1'`).includes('insecure-http'))
  for (const fine of [`const u = 'http://localhost:3000'`, `// see http://api.partner-systems.io`, ` * http://www.apache.org/licenses/LICENSE-2.0`, `const u = 'http://192.168.1.10'`])
    assert.ok(!rulesOn(fine).includes('insecure-http'), fine)
  assert.ok(rulesOn(`console.log('token', token)`).includes('secret-in-test-output'))
  assert.ok(rulesOn(`  * print 'token: ' + authToken`).includes('secret-in-test-output'), 'Karate step lines are code, not comments')
  assert.ok(rulesOn(`  * url 'http://api.partner-systems.io'`).includes('insecure-http'))
  assert.ok(!rulesOn(`// console.log(token)`).includes('secret-in-test-output'))
})

test('productionDomains: exact and wildcard entries match; regex metacharacters never throw', () => {
  assert.ok(rulesOn(`get('https://api.acme-bank.com/x')`, { productionDomains: ['api.acme-bank.com'] }).includes('production-target'))
  assert.ok(rulesOn(`get('https://eu.acme-bank.com/x')`, { productionDomains: ['*.acme-bank.com'] }).includes('production-target'))
  assert.ok(!rulesOn(`get('https://staging.example.com/x')`, { productionDomains: ['api.acme-bank.com'] }).includes('production-target'))
  assert.doesNotThrow(() => scanSecurityHygiene(`x`, { productionDomains: ['(', '[a-', 'a**', '?', '+'] }))
})

test('redactSecrets removes credentials before text is sent anywhere', () => {
  const out = redactSecrets(`const k='AKIAIOSFODNN7EXAMPLQ'\nconst t = "ghp_${'a1B2c3D4e5'.repeat(4)}"\npassword: 'Zx9$kQ2mPw7vL'\nconst ok = 'hello'`)
  assert.ok(!/AKIA|ghp_|Zx9/.test(out), out)
  assert.match(out, /\[REDACTED\]/)
  assert.ok(out.includes("'hello'"))
})
