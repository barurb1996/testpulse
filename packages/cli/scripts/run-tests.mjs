// Runs every test/unit/*.test.ts through tsx. A script instead of a shell glob because cmd.exe does not expand
// globs and Node 20's test runner does not either. On GitHub Actions, failures are also emitted as annotations
// so they are readable without downloading logs.
import { readdirSync } from 'fs'
import { spawnSync } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dir = path.join(root, 'test', 'unit')
const files = readdirSync(dir).filter(f => f.endsWith('.test.ts')).sort().map(f => path.join('test', 'unit', f))
const onCi = process.env.GITHUB_ACTIONS === 'true'

const r = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...(onCi ? ['--test-reporter=tap'] : []), ...files], {
  cwd: root, encoding: 'utf-8', stdio: onCi ? ['ignore', 'pipe', 'inherit'] : 'inherit', maxBuffer: 64 * 1024 * 1024
})

if (onCi) {
  process.stdout.write(r.stdout ?? '')
  const lines = (r.stdout ?? '').split('\n')
  let shown = 0
  lines.forEach((line, i) => {
    const m = /^\s*not ok \d+ - (.+)$/.exec(line)
    if (!m || shown >= 15) return
    const detail = lines.slice(i + 1, i + 40).filter(l => /^\s+(error|expected|actual|code|message):/.test(l) || /Error/.test(l)).slice(0, 4).map(l => l.trim()).join(' | ')
    console.log(`::error title=Test failed::${m[1]} ${detail}`.replace(/%/g, '%25').replace(/\r/g, '').slice(0, 900))
    shown++
  })
}
process.exit(r.status ?? 1)
