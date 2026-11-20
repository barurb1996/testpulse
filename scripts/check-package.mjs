// Release gate for the npm package: packs packages/cli, inspects the tarball, installs it into an empty
// project and runs it. Catches the classes of mistake that only show up after `npm publish`
// (missing bin, stray files, broken install). Usage: pnpm --filter testpulse build && node scripts/check-package.mjs
import { execFileSync, spawnSync } from 'child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkgDir = path.join(root, 'packages', 'cli')
const failures = []
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failures.push(msg) }
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], ...opts })

const tmp = mkdtempSync(path.join(os.tmpdir(), 'tp-pack-'))
try {
  const src = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf-8'))
  const packed = JSON.parse(sh('npm', ['pack', '--json', '--pack-destination', tmp], { cwd: pkgDir }))[0]
  const files = packed.files.map(f => f.path)

  console.log(`\n${packed.name}@${packed.version}: ${files.length} files, ${(packed.size / 1024).toFixed(1)} kB packed\n`)
  for (const must of ['package.json', 'LICENSE', 'README.md', 'dist/index.js', 'dist/analyzer.js'])
    check(files.includes(must), `tarball contains ${must}`)
  const stray = files.filter(f => /\.map$|\.d\.ts$|(^|\/)test\/|(^|\/)src\/|(^|\/)\.env|\.tgz$|corpus|labels|\.ts$(?<!\.d\.ts)/.test(f))
  check(stray.length === 0, `no maps, declarations, sources, fixtures or secrets in the tarball${stray.length ? ': ' + stray.slice(0, 5).join(', ') : ''}`)
  check(packed.size < 200 * 1024, `packed size ${(packed.size / 1024).toFixed(0)} kB is under 200 kB`)

  const manifest = JSON.parse(sh('tar', ['-xOzf', path.join(tmp, packed.filename), 'package/package.json']))
  check(manifest.name === 'testpulse', 'package name is testpulse')
  check(manifest.version === src.version, `manifest version ${manifest.version} matches the source`)
  check(manifest.bin && manifest.bin.testpulse && files.includes(manifest.bin.testpulse.replace(/^\.\//, '')), 'bin.testpulse is present and points at a packed file')
  check(manifest.license === 'MIT', 'license is MIT')
  check(!!manifest.engines?.node, 'engines.node is declared')
  check(!!manifest.homepage && !!manifest.repository, 'homepage and repository are set')
  check(!manifest.scripts?.postinstall && !manifest.scripts?.preinstall && !manifest.scripts?.install, 'no install scripts')
  check(Object.keys(manifest.dependencies ?? {}).every(d => !d.startsWith('@testpulse/')), 'no unpublished workspace dependencies')

  // install into an empty project exactly like a user would
  const proj = path.join(tmp, 'proj')
  mkdirSync(proj)
  writeFileSync(path.join(proj, 'package.json'), '{"name":"consumer","private":true}')
  sh('npm', ['install', '--no-audit', '--no-fund', path.join(tmp, packed.filename)], { cwd: proj })
  const binPath = path.join(proj, 'node_modules', '.bin', process.platform === 'win32' ? 'testpulse.cmd' : 'testpulse')
  check(existsSync(binPath), 'npm created the testpulse executable')
  const entry = readFileSync(path.join(proj, 'node_modules', 'testpulse', 'dist', 'index.js'), 'utf-8')
  check(entry.startsWith('#!/usr/bin/env node'), 'entry point has a node shebang')

  const v = spawnSync(binPath, ['--version'], { cwd: proj, encoding: 'utf-8', shell: process.platform === 'win32' })
  check(v.status === 0 && v.stdout.trim() === src.version, `installed binary reports version ${src.version}`)

  mkdirSync(path.join(proj, 'e2e'))
  writeFileSync(path.join(proj, 'e2e', 'a.spec.ts'), "import { test } from '@playwright/test'\ntest('does nothing useful', async () => {})\n")
  const a = spawnSync(binPath, ['e2e'], { cwd: proj, encoding: 'utf-8', shell: process.platform === 'win32' })
  check(a.status === 1 && /no-assertion/.test(a.stdout), 'installed binary analyses a file and exits 1 on a critical issue')
  const j = spawnSync(binPath, ['e2e', '--format', 'json', '--no-exit'], { cwd: proj, encoding: 'utf-8', shell: process.platform === 'win32' })
  let parsed = null; try { parsed = JSON.parse(j.stdout) } catch { /* reported below */ }
  check(parsed && parsed.files?.length === 1, 'installed binary emits valid JSON')
  const docx = spawnSync(process.execPath, ['-e', "import('mammoth').then(()=>process.exit(0),()=>process.exit(1))"], { cwd: path.join(proj, 'node_modules', 'testpulse') })
  check(docx.status === 0, 'runtime dependencies resolve (mammoth)')
} catch (e) {
  failures.push(`script error: ${e.message}`)
  console.error(e.stderr?.toString() || e)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nAll package checks passed')
process.exit(failures.length ? 1 : 0)
