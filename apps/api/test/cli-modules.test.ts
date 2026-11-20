// The repo-scan route runs the CLI engine. This guards the wiring that was once broken (a relative path to a
// directory that did not exist): the three modules must resolve and analyse a real directory.
// Needs the CLI built: pnpm --filter testpulse run build
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'path'
import { fileURLToPath } from 'url'
import { loadCli } from '../src/cli-modules.js'

const corpus = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'cli', 'test', 'corpus')

test('the CLI engine resolves from the API and analyses a directory', async () => {
  const { analyzeDirectory, scanCodebase, loadJunitResults } = await loadCli()
  for (const fn of [analyzeDirectory, scanCodebase, loadJunitResults]) assert.equal(typeof fn, 'function')

  const outcome = await analyzeDirectory(path.join(corpus, 'ai-slop'), { skipIgnores: true })
  const rules = new Set(outcome.results.flatMap(r => r.issues.map(i => i.rule)))
  assert.ok(rules.has('tautological-assertion') && rules.has('swallowed-error'), [...rules].join(', '))

  const files = await scanCodebase(path.join(corpus, 'ai-app'))
  assert.ok(Array.isArray(files))
  const junit = await loadJunitResults(path.join(corpus, 'ai-app'), 'nothing/*.xml')
  assert.deepEqual(junit.results, [])
})
