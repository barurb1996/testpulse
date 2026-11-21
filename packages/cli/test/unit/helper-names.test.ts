import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { analyzeDirectory } from '../../src/analyzer.js'
import { HELPER_SLEEP_RE, isHelperNamespace } from '../../src/helper-names.js'

async function run(files: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-helpers-'))
  try {
    for (const [name, body] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true })
      fs.writeFileSync(path.join(dir, name), body)
    }
    const out = await analyzeDirectory(dir, { skipIgnores: true })
    return out.results.flatMap(r => r.issues.map(i => i.rule))
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}

test('namespace list covers common helper folder names', () => {
  for (const n of ['helpers', 'utils', 'tools', 'fixtures', 'helperFunctions', 'HelperFunctions', 'support'])
    assert.ok(isHelperNamespace(n), n)
  for (const n of ['page', 'testUtils', 'request', 'expect']) assert.ok(!isHelperNamespace(n), n)
})

test('sleep regex matches namespace.sleep/pause/delay only', () => {
  for (const s of ['* utils.sleep(1000)', 'tools.pause(5)', 'helperFunctions.delay(10)', 'fixtures.sleep(1)'])
    assert.ok(HELPER_SLEEP_RE.test(s), s)
  for (const s of ['* def x = utils.parse(1)', 'myutils.sleep(1)', 'tools.sleeper(1)'])
    assert.ok(!HELPER_SLEEP_RE.test(s), s)
})

test('Playwright: sleep through any helper namespace is flagged', async () => {
  const rules = await run({ 'a.spec.ts': `import { test, expect } from '@playwright/test'
test('x', async ({ page }) => { await utils.sleep(2000); expect(await page.title()).toBe('A') })
test('y', async ({ page }) => { await tools.pause(500); expect(1).toBe(1) })` })
  assert.equal(rules.filter(r => r === 'no-hard-wait').length, 2)
})

test('Playwright: non-sleep helper calls are not flagged as hard waits', async () => {
  const rules = await run({ 'a.spec.ts': `import { test, expect } from '@playwright/test'
test('x', async ({ page }) => { await utils.login(page); expect(await page.title()).toBe('A') })` })
  assert.ok(!rules.includes('no-hard-wait'))
})

test('Karate: sleep through utils/tools namespace is flagged', async () => {
  const rules = await run({ 'a.feature': `Feature: f
  Scenario: s
    Given url 'http://localhost'
    * tools.sleep(1000)
    When method get
    Then status 200` })
  assert.ok(rules.includes('karate-explicit-sleep'))
})

test('Cucumber Java: helper-namespace sleep in a step is flagged', async () => {
  const rules = await run({ 'Steps.java': `public class Steps {
  @When("I wait")
  public void wait_() {
    utils.sleep(3000);
    assertTrue(true);
  }
}` })
  assert.ok(rules.includes('cucumber-java-explicit-sleep'))
})

test('Karate no-assertion: request without any check stays critical; unresolved helper call and setup files are warnings', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-kna-'))
  try {
    fs.writeFileSync(path.join(dir, 'real.feature'), `Feature: f\n  Scenario: gets users\n    * url 'http://localhost'\n    * method get\n`)
    fs.writeFileSync(path.join(dir, 'helper-call.feature'), `Feature: f\n  Scenario: setup data\n    * def v = call createFund { id: '1' }\n`)
    fs.writeFileSync(path.join(dir, 'initTest.feature'), `Feature: f\n  Scenario: init\n    * url 'http://localhost'\n    * method post\n`)
    fs.writeFileSync(path.join(dir, 'mock.feature'), `Feature: mock\n  Scenario: pathMatches('/cats')\n    * def response = { a: 1 }\n`)
    const out = await analyzeDirectory(dir, { skipIgnores: true })
    const sev = (f: string) => out.results.find(r => r.file.endsWith(f))?.issues.filter(i => i.rule === 'karate-no-assertion').map(i => i.severity)
    assert.deepEqual(sev('real.feature'), ['critical'])
    assert.deepEqual(sev('helper-call.feature'), ['warning'])
    assert.deepEqual(sev('initTest.feature'), ['warning'])
    assert.deepEqual(sev('mock.feature') ?? [], [])
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
