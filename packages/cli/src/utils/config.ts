import { readFile } from 'fs/promises'
import path from 'path'
import type { IssueSeverity } from '../types.js'

export interface RuleConfig {
  off?: boolean
  severity?: IssueSeverity
}

export interface TestpulseConfig {
  rules?: Record<string, 'off' | RuleConfig>
  ignoreFiles?: string[]
  productionDomains?: string[]
}

export interface IgnoreEntry {
  fingerprint: string
  rule?: string
  reason?: string
  file?: string
}

export interface IgnoreFile {
  version: number
  ignores: IgnoreEntry[]
}

export interface ResolvedConfig {
  config: TestpulseConfig | null
  ignores: IgnoreFile | null
  ignoreSet: Set<string>
  fileGlobs: RegExp[]
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, 'utf-8')
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '__DOUBLESTAR__')
    .replace(/\*/g, '[^/]*')
    .replace(/__DOUBLESTAR__/g, '.*')
    .replace(/\?/g, '[^/]')
  return new RegExp(`^${escaped}$`)
}

async function findConfigDir(startDir: string): Promise<string | null> {
  let dir = startDir
  while (true) {
    const candidate = path.join(dir, '.testpulse')
    try {
      const { stat } = await import('fs/promises')
      const s = await stat(candidate)
      if (s.isDirectory()) return candidate
    } catch { /* continue walking up */ }
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

export async function loadConfig(projectRoot: string): Promise<ResolvedConfig> {
  const configDir = await findConfigDir(projectRoot)
  const config = configDir ? await readJson<TestpulseConfig>(path.join(configDir, 'config.json')) : null
  const ignores = configDir ? await readJson<IgnoreFile>(path.join(configDir, 'ignores.json')) : null

  const ignoreSet = new Set<string>()
  if (ignores?.ignores) {
    for (const entry of ignores.ignores) ignoreSet.add(entry.fingerprint)
  }

  const fileGlobs = (config?.ignoreFiles ?? []).map(globToRegex)

  return { config, ignores, ignoreSet, fileGlobs }
}

export function isFileIgnored(relPath: string, globs: RegExp[]): boolean {
  const normalised = relPath.replace(/\\/g, '/')
  return globs.some(g => g.test(normalised))
}

export function shouldSkipRule(ruleName: string, config: TestpulseConfig | null): boolean {
  if (!config?.rules) return false
  const entry = config.rules[ruleName]
  if (entry === 'off') return true
  if (entry && typeof entry === 'object' && entry.off) return true
  return false
}

export function applySeverityOverride(ruleName: string, current: IssueSeverity, config: TestpulseConfig | null): IssueSeverity {
  if (!config?.rules) return current
  const entry = config.rules[ruleName]
  if (!entry || typeof entry !== 'object') return current
  return entry.severity ?? current
}
