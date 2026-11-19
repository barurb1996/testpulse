// Compares Testpulse findings with independent labels of AI-generated tests.
// Usage: node eval.mjs [labels-file]   (default labels.json; run after `pnpm exec tsc` in packages/cli)
import { readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { analyzeDirectory } from '../../../dist/analyzer.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const labelsFile = process.argv[2] ?? 'labels.json'
const labels = JSON.parse(readFileSync(path.join(here, labelsFile), 'utf-8'))

// Rules that speak about test quality / safety (framework-style rules like no-css-selector are excluded).
// EXCLUDE=rule1,rule2 drops rules from the comparison (e.g. maintainability hints that are not "slop").
const exclude = (process.env.EXCLUDE ?? '').split(',').filter(Boolean)
const QUALITY = (r) => !['no-css-selector', 'no-generic-name', 'karate-print-in-test', ...exclude].includes(r)

const projects = [...new Set(labels.map(l => l.file.split('/tests/')[0]))]
const flaggedBy = new Map() // `${file}#${name}` -> Set(rules)

for (const proj of projects) {
  const dir = path.join(here, proj)
  const outcome = await analyzeDirectory(dir, { skipIgnores: true })
  for (const res of outcome.results) {
    const rel = proj + '/' + path.relative(dir, res.file).replace(/\\/g, '/')
    const tests = labels.filter(l => l.file === rel).sort((a, b) => a.line - b.line)
    for (const issue of res.issues) {
      if (!QUALITY(issue.rule)) continue
      let owner = null
      for (const t of tests) if (t.line <= issue.line) owner = t
      if (!owner) continue
      const key = `${owner.file}#${owner.name}`
      if (!flaggedBy.has(key)) flaggedBy.set(key, new Set())
      flaggedBy.get(key).add(issue.rule)
    }
  }
}

let tp = 0, fp = 0, fn = 0, tn = 0
const misses = [], falseAlarms = []
const perProblem = {}
for (const l of labels) {
  const rules = flaggedBy.get(`${l.file}#${l.name}`)
  const flagged = Boolean(rules)
  if (l.slop && flagged) tp++
  else if (l.slop && !flagged) { fn++; misses.push(l) }
  else if (!l.slop && flagged) { fp++; falseAlarms.push({ ...l, rules: [...rules] }) }
  else tn++
  if (l.slop) for (const p of l.problems ?? ['other']) {
    perProblem[p] ??= { total: 0, caught: 0 }
    perProblem[p].total++
    if (flagged) perProblem[p].caught++
  }
}
const pct = (a, b) => (b === 0 ? 'n/a' : `${Math.round((100 * a) / b)}%`)
console.log(`tests labelled: ${labels.length}  (slop: ${tp + fn}, fine: ${fp + tn})`)
console.log(`precision: ${pct(tp, tp + fp)}   recall: ${pct(tp, tp + fn)}   (TP ${tp} FP ${fp} FN ${fn} TN ${tn})\n`)
console.log('recall by labelled problem (any rule firing on that test counts):')
for (const [p, v] of Object.entries(perProblem).sort()) console.log(`  ${p.padEnd(24)} ${v.caught}/${v.total}`)
console.log('\nmissed slop:'); for (const m of misses) console.log(`  ${m.file}:${m.line} "${m.name}" [${(m.problems ?? []).join(', ')}]`)
console.log('\nflagged but labelled fine:'); for (const f of falseAlarms) console.log(`  ${f.file}:${f.line} "${f.name}" <- ${f.rules.join(', ')}`)
