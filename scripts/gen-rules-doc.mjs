// Generates docs/RULES.md from the rule registry so the documentation cannot drift from the code.
// Usage: pnpm --filter testpulse exec tsc && node scripts/gen-rules-doc.mjs
import { writeFileSync } from 'fs'
import { RULE_REGISTRY } from '../packages/cli/dist/rule-registry.js'

const titles = {
  'ai-slop': 'Test quality ("AI slop")',
  'security-hygiene': 'Security hygiene in test code',
  'ai-app': 'Tests of LLM-backed apps'
}
const sevIcon = { critical: '✗ critical', warning: '⚠ warning', info: 'ℹ info' }
const rules = Object.values(RULE_REGISTRY)
let out = `# Rule reference\n\n_Generated from \`packages/cli/src/rule-registry.ts\` (${rules.length} rules). Do not edit by hand: run \`node scripts/gen-rules-doc.mjs\`._\n\n`
out += 'Severity scoring: critical −10, warning −3, info −3 from a baseline of 100 (floor 0). A critical issue makes the CLI exit 1 unless `--no-exit` is passed.\n'
out += 'Rules are heuristics and can be wrong; see [docs/VALIDATION.md](VALIDATION.md) for how they were measured and [docs/CONFIG.md](CONFIG.md) to silence or re-grade one.\n\n'
for (const cat of Object.keys(titles)) {
  const group = rules.filter(r => r.category === cat).sort((a, b) => a.id.localeCompare(b.id))
  if (group.length === 0) continue
  out += `## ${titles[cat]}\n\n| Rule | Severity | Frameworks | What it catches |\n| --- | --- | --- | --- |\n`
  for (const r of group) out += `| \`${r.id}\` | ${sevIcon[r.severity]} | ${r.frameworks.join(', ')} | ${r.description} |\n`
  out += '\n'
}
out += '## Not rules, but commands\n\n`security-coverage` (OpenAPI × tests matrix), `ai-coverage` (OWASP LLM test coverage), `audit-mcp` and `judge` are separate commands, documented in [docs/CLI.md](CLI.md).\n'
writeFileSync(new URL('../docs/RULES.md', import.meta.url), out)
console.log(`wrote docs/RULES.md (${rules.length} rules)`)
