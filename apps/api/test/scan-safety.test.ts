import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, symlink, writeFile, rm } from 'fs/promises'
import os from 'os'
import path from 'path'
import { SAFE_BRANCH, SAFE_REL_PATH, assertSafeRepoUrl, isPrivateAddress, resolveInside, sanitizeError } from '../src/scan-safety.js'

test('private, loopback, link-local and CGNAT addresses are recognised', () => {
  for (const a of ['127.0.0.1', '10.1.2.3', '192.168.0.9', '172.16.0.1', '172.31.255.255', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd12::1', 'fe80::1'])
    assert.equal(isPrivateAddress(a), true, a)
  for (const a of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700::1111'])
    assert.equal(isPrivateAddress(a), false, a)
})

test('repo URLs: https only, no credentials, no internal hosts', async () => {
  await assert.rejects(() => assertSafeRepoUrl('http://93.184.216.34/r.git'), /https/)
  await assert.rejects(() => assertSafeRepoUrl('file:///etc/passwd'), /https/)
  await assert.rejects(() => assertSafeRepoUrl('ssh://git@93.184.216.34/r.git'), /https/)
  await assert.rejects(() => assertSafeRepoUrl('https://user:token@93.184.216.34/r.git'), /credentials/)
  await assert.rejects(() => assertSafeRepoUrl('https://localhost/r.git'), /not allowed/)
  await assert.rejects(() => assertSafeRepoUrl('https://build.internal/r.git'), /not allowed/)
  await assert.rejects(() => assertSafeRepoUrl('https://127.0.0.1/r.git'), /non-public/)
  await assert.rejects(() => assertSafeRepoUrl('https://169.254.169.254/r.git'), /non-public/)
  await assert.rejects(() => assertSafeRepoUrl('https://[::1]/r.git'), /non-public/)
  const ok = await assertSafeRepoUrl('https://93.184.216.34/org/repo.git')
  assert.equal(ok.hostname, '93.184.216.34')
})

test('branch names and relative paths reject option injection and traversal', () => {
  for (const ok of ['main', 'release/1.2', 'feature_x-y.z']) assert.ok(SAFE_BRANCH.test(ok), ok)
  for (const bad of ['--upload-pack=evil', '-x', 'a b', 'a;rm', '$(id)', '']) assert.ok(!SAFE_BRANCH.test(bad), bad)
  for (const ok of ['.', 'src/test', 'tests/e2e']) assert.ok(SAFE_REL_PATH.test(ok), ok)
  for (const bad of ['/etc', '../x', 'a/../../b', '..']) assert.ok(!SAFE_REL_PATH.test(bad), bad)
})

test('error text is stripped of tokens, basic-auth forms and URL credentials', () => {
  const token = 'ghp_ABCDEF1234567890abcdef1234567890ABCD'
  const b64 = Buffer.from(`x-access-token:${token}`).toString('base64')
  const msg = sanitizeError(new Error(`fatal: unable to access 'https://x-access-token:${token}@github.com/o/r.git' header Authorization: Basic ${b64}`), [token])
  assert.ok(!msg.includes(token) && !msg.includes(b64), msg)
  assert.match(msg, /https:\/\/\[redacted\]@/)
})

test('resolveInside refuses paths (and symlinks) that leave the repository', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tp-inside-'))
  const outside = await mkdtemp(path.join(os.tmpdir(), 'tp-outside-'))
  try {
    await mkdir(path.join(root, 'tests'))
    await writeFile(path.join(outside, 'secret.txt'), 'x')
    await symlink(outside, path.join(root, 'link'))
    assert.equal(await resolveInside(root, 'tests'), await (await import('fs/promises')).realpath(path.join(root, 'tests')))
    await assert.rejects(() => resolveInside(root, '../'), /escapes/)
    await assert.rejects(() => resolveInside(root, 'link'), /escapes/)
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})
