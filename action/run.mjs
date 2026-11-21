#!/usr/bin/env node
// Entry point of the Testpulse GitHub Action. Installs the published CLI from npm, analyses the repository,
// writes outputs and a step summary, comments on the pull request and decides the exit status.
// All inputs arrive through TP_* environment variables (never interpolated into a shell), so a branch name or path
// cannot run commands. Dependencies are injectable so the logic is unit-tested without a runner (action/run.test.mjs).
import { spawnSync } from 'node:child_process'
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MARKER = '<!-- testpulse-report -->'
const bool = (v, d) => (v === undefined || v === '' ? d : String(v).toLowerCase() === 'true')

export function parseInputs(env) {
  const i = {
    path: env.TP_PATH || '.',
    failOnCritical: bool(env.TP_FAIL_ON_CRITICAL, true),
    minScore: env.TP_MIN_SCORE === undefined || env.TP_MIN_SCORE === '' ? 0 : Number(env.TP_MIN_SCORE),
    commentOnPr: bool(env.TP_COMMENT_ON_PR, true),
    changedSince: env.TP_CHANGED_SINCE || '',
    uploadSarif: bool(env.TP_UPLOAD_SARIF, false),
    junit: env.TP_JUNIT || '',
    apiUrl: env.TP_API_URL || '',
    project: env.TP_PROJECT || '',
    version: env.TP_VERSION || '~0.3.0'
  }
  if (i.path.startsWith('-')) throw new Error('path must not start with "-"')
  if (!Number.isInteger(i.minScore) || i.minScore < 0 || i.minScore > 100) throw new Error('min-score must be an integer between 0 and 100')
  if (!/^[A-Za-z0-9.~^*_-]+$/.test(i.version)) throw new Error('testpulse-version must be a semver range or dist-tag such as ~0.3.0, ^0.2 or latest')
  if (i.changedSince && !/^[A-Za-z0-9_./~^@-]+$/.test(i.changedSince)) throw new Error('changed-since must be a plain git ref')
  if ((i.apiUrl && !i.project) || (!i.apiUrl && i.project)) throw new Error('api-url and project must be set together')
  if (i.apiUrl && !/^https:\/\//.test(i.apiUrl)) throw new Error('api-url must be an https URL')
  return i
}

const defaultRun = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024, shell: process.platform === 'win32' && cmd === 'npm', ...opts })
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

export async function main(env = process.env, deps = {}) {
  const run = deps.run ?? defaultRun
  const fetchFn = deps.fetch ?? globalThis.fetch
  const out = deps.out ?? ((line) => console.log(line))
  const tmp = deps.tmp ?? mkdtempSync(path.join(os.tmpdir(), 'testpulse-'))
  const write = deps.write ?? ((file, text) => appendFileSync(file, text))
  const state = { exitCode: 0, outputs: {} }
  const fail = (msg) => { out(`::error::${msg}`); state.exitCode = 1 }

  let inp
  try { inp = parseInputs(env) } catch (e) { fail(e.message); return state }

  const install = run('npm', ['install', '--prefix', tmp, '--no-audit', '--no-fund', '--loglevel=error', `testpulse@${inp.version}`])
  if (install.code !== 0) { fail(`could not install testpulse@${inp.version}: ${install.stderr.trim().split('\n').slice(-3).join(' ')}`); return state }
  const cli = path.join(tmp, 'node_modules', 'testpulse', 'dist', 'index.js')
  const node = process.execPath

  const common = [inp.path, ...(inp.changedSince ? ['--changed-since', inp.changedSince] : []), ...(inp.junit ? ['--junit', inp.junit] : [])]
  const pushArgs = inp.apiUrl ? ['--push', inp.apiUrl, '--project', inp.project] : []
  const cliEnv = { ...process.env, ...(env.TP_TOKEN ? { TESTPULSE_TOKEN: env.TP_TOKEN } : {}) }

  const text = run(node, [cli, ...common, ...pushArgs, '--no-exit'], { env: cliEnv })
  out(text.stdout)
  if (text.stderr) out(text.stderr)
  if (text.code !== 0) { fail(`testpulse exited with ${text.code}`); return state }

  const jsonFile = path.join(tmp, 'result.json')
  const json = run(node, [cli, ...common, '--format', 'json', '--output', jsonFile, '--no-exit'], { env: cliEnv })
  let report
  try { report = JSON.parse(readFileSync(jsonFile, 'utf-8')) } catch { fail(`could not read the analysis result${json.code ? ` (exit ${json.code})` : ''}`); return state }
  const score = report.score
  const critical = report.files.reduce((n, f) => n + f.issues.filter(i => i.severity === 'critical').length, 0)
  const total = report.files.reduce((n, f) => n + f.issues.length, 0)
  state.outputs = { score: String(score), critical: String(critical) }

  if (inp.uploadSarif) {
    const sarif = path.join(tmp, 'testpulse.sarif') // never write into the user's workspace
    const r = run(node, [cli, ...common, '--format', 'sarif', '--output', sarif, '--no-exit'], { env: cliEnv })
    if (r.code === 0) state.outputs['sarif-file'] = sarif; else out('::warning::could not produce the SARIF report')
  }

  const summary = [
    `## Testpulse: quality score ${score}/100`, '',
    `**${critical}** critical issue(s), **${total}** issue(s) in total`, '',
    '<details><summary>Full output</summary>', '', '```', text.stdout.trim(), '```', '', '</details>', ''
  ].join('\n')
  if (env.GITHUB_STEP_SUMMARY) write(env.GITHUB_STEP_SUMMARY, summary)
  if (env.GITHUB_OUTPUT) write(env.GITHUB_OUTPUT, Object.entries(state.outputs).map(([k, v]) => `${k}=${v}\n`).join(''))

  if (inp.commentOnPr && env.GITHUB_EVENT_NAME === 'pull_request' && env.GITHUB_TOKEN && env.GITHUB_REPOSITORY) {
    try {
      const pr = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf-8')).pull_request?.number
      if (pr) await upsertComment({ fetchFn, repo: env.GITHUB_REPOSITORY, pr, token: env.GITHUB_TOKEN, body: `${MARKER}\n${summary}`, out })
    } catch (e) { out(`::warning::could not post the PR comment: ${e.message}`) }
  }

  if (inp.failOnCritical && critical > 0) fail(`${critical} critical issue(s) found (fail-on-critical)`)
  if (inp.minScore > 0 && score < inp.minScore) fail(`score ${score} is below min-score ${inp.minScore}`)
  return state
}

async function upsertComment({ fetchFn, repo, pr, token, body, out }) {
  const api = `https://api.github.com/repos/${repo}/issues`
  const headers = { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json', 'user-agent': 'testpulse-action' }
  const list = await fetchFn(`${api}/${pr}/comments?per_page=100`, { headers })
  if (!list.ok) { out(`::warning::could not read PR comments (${list.status}); the token may be read-only on forks`); return }
  const existing = (await list.json()).find(c => typeof c.body === 'string' && c.body.startsWith(MARKER))
  const res = existing
    ? await fetchFn(`${api}/comments/${existing.id}`, { method: 'PATCH', headers, body: JSON.stringify({ body }) })
    : await fetchFn(`${api}/${pr}/comments`, { method: 'POST', headers, body: JSON.stringify({ body }) })
  if (!res.ok) out(`::warning::could not write the PR comment (${res.status})`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(state => { process.exitCode = state.exitCode }).catch(e => { console.log(`::error::${e.message}`); process.exitCode = 1 })
}
