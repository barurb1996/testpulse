import type { EndpointCoverage } from '../types.js'
import type { OpenApiTarget } from '../openapi.js'
import type { TestKind } from './classify.js'

export type GapSeverity = 'critical' | 'warning' | 'info'

export interface SecurityGap {
  check: 'missing-unauthenticated-test' | 'missing-forbidden-test' | 'missing-object-level-authz-test' | 'missing-input-validation-test' | 'undocumented-endpoint-tested'
  severity: GapSeverity
  verb: string
  path: string
  detail: string
}

export interface MatrixRow {
  verb: string
  path: string
  secured: boolean
  covered: Record<TestKind, boolean>
  applicable: Record<Exclude<TestKind, 'happy'>, boolean>
  testedAt: Array<{ file: string; line: number; scenarioName: string }>
}

export interface SecurityCoverageReport {
  rows: MatrixRow[]
  gaps: SecurityGap[]
  applicableChecks: number
  satisfiedChecks: number
  coveragePct: number
}

const WRITE_VERBS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const SEVERITY_RANK: Record<GapSeverity, number> = { critical: 0, warning: 1, info: 2 }

/** Normalise a path from a test so it can be compared against a spec path. */
export function normaliseTestPath(p: string): string {
  let out = p.replace(/^https?:\/\/[^/]+/i, '').replace(/\?.*$/, '')
  out = out
    .split('/')
    .map(seg => {
      if (!seg) return seg
      if (/^\{.*\}$/.test(seg) || seg.startsWith(':') || /^#\(.*\)$/.test(seg)) return ':id'
      if (/^\d+$/.test(seg) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return ':id'
      return seg
    })
    .join('/')
  out = out.replace(/\/+/g, '/').replace(/(.)\/$/, '$1')
  return out.startsWith('/') ? out : '/' + out
}

function matches(testPath: string, specPath: string): boolean {
  return testPath === specPath || testPath.endsWith(specPath) // tolerate a base path prefix like /api/v1
}

export function computeSecurityCoverage(targets: OpenApiTarget[], endpoints: EndpointCoverage[]): SecurityCoverageReport {
  const normalisedCalls = endpoints.map(e => ({ ...e, norm: normaliseTestPath(e.path) }))
  const rows: MatrixRow[] = []
  const gaps: SecurityGap[] = []
  const matchedCalls = new Set<EndpointCoverage>()
  let applicableChecks = 0
  let satisfiedChecks = 0

  for (const t of targets) {
    const calls = normalisedCalls.filter(c => c.verb.toUpperCase() === t.verb && matches(c.norm, t.path))
    calls.forEach(c => matchedCalls.add(c))

    const covered: Record<TestKind, boolean> = { happy: false, unauth: false, forbidden: false, 'cross-user': false, 'invalid-input': false }
    for (const c of calls) for (const k of c.kinds ?? ['happy']) covered[k] = true
    if (calls.length > 0) covered.happy = covered.happy || calls.some(c => (c.kinds ?? []).includes('happy'))

    const secured = Boolean(t.secured)
    const isWrite = WRITE_VERBS.has(t.verb)
    const applicable = {
      unauth: secured,
      forbidden: secured && (t.responseCodes ?? []).includes('403'),
      'cross-user': secured && Boolean(t.hasObjectId),
      'invalid-input': (t.constrainedInputs?.length ?? 0) > 0 && (isWrite || t.verb === 'GET'),
    }

    const label = `${t.verb} ${t.path}`
    const check = (kind: keyof typeof applicable, gap: Omit<SecurityGap, 'verb' | 'path'>) => {
      if (!applicable[kind]) return
      applicableChecks++
      if (covered[kind]) satisfiedChecks++
      else gaps.push({ ...gap, verb: t.verb, path: t.path })
    }

    check('unauth', {
      check: 'missing-unauthenticated-test',
      severity: isWrite ? 'critical' : 'warning',
      detail: `${label} requires auth but no test calls it without a valid token and asserts 401`
    })
    check('forbidden', {
      check: 'missing-forbidden-test',
      severity: 'warning',
      detail: `${label} documents 403 but no test uses an under-privileged token and asserts 403`
    })
    check('cross-user', {
      check: 'missing-object-level-authz-test',
      severity: isWrite ? 'critical' : 'warning',
      detail: `${label} takes an object ID but no test accesses another user's resource and asserts 403/404 (BOLA/IDOR)`
    })
    check('invalid-input', {
      check: 'missing-input-validation-test',
      severity: 'warning',
      detail: `${label} declares input constraints (${(t.constrainedInputs ?? []).slice(0, 3).join(', ')}) but no test sends invalid data and asserts 400/422`
    })

    rows.push({
      verb: t.verb,
      path: t.path,
      secured,
      covered,
      applicable,
      testedAt: calls.map(c => ({ file: c.file, line: c.line, scenarioName: c.scenarioName }))
    })
  }

  const seenUndocumented = new Set<string>()
  for (const c of normalisedCalls) {
    if (matchedCalls.has(c)) continue
    const key = `${c.verb} ${c.norm}`
    if (seenUndocumented.has(key)) continue
    seenUndocumented.add(key)
    gaps.push({
      check: 'undocumented-endpoint-tested',
      severity: 'info',
      verb: c.verb,
      path: c.norm,
      detail: `${key} is exercised by tests but absent from the OpenAPI spec — stale spec or hidden API`
    })
  }

  gaps.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.path.localeCompare(b.path))
  const coveragePct = applicableChecks === 0 ? 100 : Math.round((satisfiedChecks / applicableChecks) * 100)
  return { rows, gaps, applicableChecks, satisfiedChecks, coveragePct }
}

export function printMatrix(report: SecurityCoverageReport): void {
  const mark = (applicable: boolean, ok: boolean) => (!applicable ? ' · ' : ok ? ' ✓ ' : ' ✗ ')
  const width = Math.min(48, Math.max(12, ...report.rows.map(r => `${r.verb} ${r.path}`.length)))
  console.log(`${'ENDPOINT'.padEnd(width)}  AUTH  401  403  BOLA  INPUT`)
  for (const r of report.rows) {
    const label = `${r.verb} ${r.path}`.slice(0, width).padEnd(width)
    console.log(
      `${label}  ${r.secured ? ' 🔒 ' : ' —  '} ${mark(r.applicable.unauth, r.covered.unauth)}${mark(r.applicable.forbidden, r.covered.forbidden)} ${mark(r.applicable['cross-user'], r.covered['cross-user'])}  ${mark(r.applicable['invalid-input'], r.covered['invalid-input'])}`
    )
  }
  console.log('\n  ✓ tested   ✗ missing   · not applicable per spec')
}
