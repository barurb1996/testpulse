import { eq } from 'drizzle-orm'
import { db, pool } from './index.js'
import {
  projects,
  runs,
  issues,
  runEndpoints,
  coverageTargets,
  gapSuggestions
} from './schema.js'

const PROJECT_SLUG = 'demo-acme-bank'
const PROJECT_NAME = 'Acme Bank — demo data'

interface DemoRun {
  daysAgo: number
  score: number
  critical: number
  warning: number
  info: number
  filesScanned: number
  commitSha: string
  branch: string
  endpointsCovered: Array<{ verb: string; path: string; scenarioName: string }>
  exampleIssues: Array<{ file: string; line: number; rule: string; severity: 'critical' | 'warning' | 'info'; message: string }>
}

const DEMO_TARGETS = [
  { verb: 'GET', path: '/loans', domain: 'loan', summary: 'List loans' },
  { verb: 'POST', path: '/loans', domain: 'loan', summary: 'Create loan application' },
  { verb: 'GET', path: '/loans/:id', domain: 'loan', summary: 'Get loan by id' },
  { verb: 'DELETE', path: '/loans/:id', domain: 'loan', summary: 'Cancel loan' },
  { verb: 'POST', path: '/transfers', domain: 'transfer', summary: 'Initiate money transfer' },
  { verb: 'GET', path: '/transfers/:id', domain: 'transfer', summary: 'Transfer status' },
  { verb: 'POST', path: '/auth/login', domain: 'auth', summary: 'Login with credentials' },
  { verb: 'POST', path: '/auth/refresh', domain: 'auth', summary: 'Refresh access token' },
  { verb: 'GET', path: '/users/me', domain: 'user', summary: 'Current user profile' }
]

const RUNS: DemoRun[] = [
  {
    daysAgo: 21, score: 34, critical: 8, warning: 22, info: 4, filesScanned: 58, commitSha: 'a1b2c3d', branch: 'main',
    endpointsCovered: [
      { verb: 'GET', path: '/loans', scenarioName: 'list loans as admin' },
      { verb: 'POST', path: '/auth/login', scenarioName: 'valid login returns token' }
    ],
    exampleIssues: [
      { file: 'tests/loan/listLoans.feature', line: 12, rule: 'karate-no-assertion', severity: 'critical', message: 'Scenario has no Then, no match/status/assert' },
      { file: 'tests/auth/login.feature', line: 20, rule: 'karate-explicit-sleep', severity: 'warning', message: 'helpers.sleep(2000) — use retry' }
    ]
  },
  {
    daysAgo: 14, score: 48, critical: 5, warning: 18, info: 3, filesScanned: 60, commitSha: 'b2c3d4e', branch: 'main',
    endpointsCovered: [
      { verb: 'GET', path: '/loans', scenarioName: 'list loans as admin' },
      { verb: 'POST', path: '/loans', scenarioName: 'create loan with valid inputs' },
      { verb: 'POST', path: '/auth/login', scenarioName: 'valid login returns token' }
    ],
    exampleIssues: [
      { file: 'tests/loan/createLoan.feature', line: 18, rule: 'karate-explicit-sleep', severity: 'warning', message: 'helpers.sleep(3000) — use retry' },
      { file: 'tests/auth/login.feature', line: 20, rule: 'karate-explicit-sleep', severity: 'warning', message: 'helpers.sleep(2000) — use retry' }
    ]
  },
  {
    daysAgo: 7, score: 61, critical: 3, warning: 14, info: 5, filesScanned: 64, commitSha: 'c3d4e5f', branch: 'main',
    endpointsCovered: [
      { verb: 'GET', path: '/loans', scenarioName: 'list loans as admin' },
      { verb: 'POST', path: '/loans', scenarioName: 'create loan with valid inputs' },
      { verb: 'GET', path: '/loans/:id', scenarioName: 'retrieves loan by id' },
      { verb: 'POST', path: '/auth/login', scenarioName: 'valid login returns token' },
      { verb: 'GET', path: '/users/me', scenarioName: 'returns current user profile' }
    ],
    exampleIssues: [
      { file: 'tests/transfers/createTransfer.feature', line: 25, rule: 'karate-no-assertion', severity: 'critical', message: 'Scenario "happy path" has no assertions' }
    ]
  },
  {
    daysAgo: 2, score: 72, critical: 1, warning: 9, info: 6, filesScanned: 66, commitSha: 'd4e5f6a', branch: 'main',
    endpointsCovered: [
      { verb: 'GET', path: '/loans', scenarioName: 'list loans as admin' },
      { verb: 'POST', path: '/loans', scenarioName: 'create loan with valid inputs' },
      { verb: 'GET', path: '/loans/:id', scenarioName: 'retrieves loan by id' },
      { verb: 'POST', path: '/transfers', scenarioName: 'creates transfer' },
      { verb: 'GET', path: '/transfers/:id', scenarioName: 'transfer status progresses to SETTLED' },
      { verb: 'POST', path: '/auth/login', scenarioName: 'valid login returns token' },
      { verb: 'POST', path: '/auth/refresh', scenarioName: 'refresh with valid refresh token' },
      { verb: 'GET', path: '/users/me', scenarioName: 'returns current user profile' }
    ],
    exampleIssues: [
      { file: 'tests/transfers/createTransfer.feature', line: 42, rule: 'karate-hardcoded-uuid', severity: 'warning', message: 'Hardcoded UUID a1b2... use karate.uuid()' }
    ]
  }
]

const GAP_SAMPLES: Record<string, Array<{ title: string; rationale: string; severity: 'critical' | 'warning' | 'info'; steps: string[] }>> = {
  'POST /loans': [
    {
      title: 'Rejects loan creation with missing authentication token',
      rationale: 'Unauthenticated access could allow anyone to create loans against another user.',
      severity: 'critical',
      steps: [
        'Given no authentication token is set',
        'When a POST request is made to /loans with a valid body',
        'Then the response status code is 401',
        'And no loan is created in the system'
      ]
    },
    {
      title: 'Rejects loan with principal below required minimum',
      rationale: 'Business rule: minimum loan amount must be enforced at the API layer.',
      severity: 'warning',
      steps: [
        'Given a valid authenticated user',
        'When a POST request is made to /loans with principal: 1',
        'Then the response status code is 422',
        'And error.code is "PRINCIPAL_BELOW_MINIMUM"'
      ]
    }
  ],
  'DELETE /loans/:id': [
    {
      title: 'Prevents cross-tenant loan cancellation',
      rationale: 'Cancelling a loan belonging to another tenant is a data-integrity breach.',
      severity: 'critical',
      steps: [
        'Given a loan belonging to Tenant A',
        'And a valid authentication token for a user in Tenant B',
        'When a DELETE request is made to /loans/:id for that loan',
        'Then the response status code is 403 or 404',
        'And the loan is not cancelled'
      ]
    }
  ],
  'POST /auth/refresh': [
    {
      title: 'Rejects expired refresh tokens',
      rationale: 'Expired refresh tokens must not mint new access tokens — otherwise indefinite session.',
      severity: 'critical',
      steps: [
        'Given a refresh token issued more than 30 days ago',
        'When a POST request is made to /auth/refresh with that token',
        'Then the response status code is 401',
        'And error.code is "TOKEN_EXPIRED"'
      ]
    }
  ]
}

export async function seed(opts: { onlyIfMissing?: boolean } = {}) {
  if (opts.onlyIfMissing) {
    const existing = await db.select().from(projects).where(eq(projects.slug, PROJECT_SLUG))
    if (existing.length > 0) {
      console.log(`Demo project "${PROJECT_SLUG}" already exists, skipping seed.`)
      return
    }
    console.log('⏳ seeding demo project…')
  } else {
    console.log('⏳ cleaning existing demo data…')
    const existing = await db.select().from(projects).where(eq(projects.slug, PROJECT_SLUG))
    if (existing.length > 0) {
      await db.delete(projects).where(eq(projects.slug, PROJECT_SLUG))
      console.log('   removed previous demo project (cascades cleared)')
    }
  }

  const [project] = await db.insert(projects).values({ slug: PROJECT_SLUG, name: PROJECT_NAME }).returning()
  console.log(`✓ project: ${project.slug}`)

  console.log('⏳ seeding coverage targets…')
  const targetRows = await db.insert(coverageTargets).values(DEMO_TARGETS.map(t => ({
    projectId: project.id,
    verb: t.verb,
    path: t.path,
    domain: t.domain,
    summary: t.summary,
    source: 'demo-seed'
  }))).returning()
  console.log(`✓ ${targetRows.length} coverage targets`)

  console.log('⏳ seeding runs + endpoints + issues…')
  for (const r of RUNS) {
    const createdAt = new Date(Date.now() - r.daysAgo * 24 * 60 * 60 * 1000)
    const totalIssues = r.critical + r.warning + r.info
    const [run] = await db.insert(runs).values({
      projectId: project.id,
      commitSha: r.commitSha,
      branch: r.branch,
      score: r.score,
      totalIssues,
      criticalIssues: r.critical,
      filesScanned: r.filesScanned,
      createdAt
    }).returning()

    if (r.exampleIssues.length > 0) {
      await db.insert(issues).values(r.exampleIssues.map(i => ({
        runId: run.id,
        file: i.file,
        line: i.line,
        rule: i.rule,
        severity: i.severity,
        message: i.message,
        fingerprint: `demo-${run.id.slice(0, 8)}-${i.line}`
      })))
    }

    if (r.endpointsCovered.length > 0) {
      await db.insert(runEndpoints).values(r.endpointsCovered.map(e => ({
        runId: run.id,
        verb: e.verb,
        path: e.path,
        scenarioName: e.scenarioName
      })))
    }
  }
  console.log(`✓ ${RUNS.length} runs seeded with endpoints + issues`)

  console.log('⏳ seeding gap suggestions…')
  let suggestionCount = 0
  for (const target of targetRows) {
    const key = `${target.verb} ${target.path}`
    const samples = GAP_SAMPLES[key]
    if (!samples) continue
    await db.insert(gapSuggestions).values(samples.map(s => ({
      projectId: project.id,
      targetId: target.id,
      title: s.title,
      rationale: s.rationale,
      severity: s.severity,
      steps: s.steps,
      endpointHash: `demo-${target.id.slice(0, 8)}`,
      model: 'demo-seed'
    })))
    suggestionCount += samples.length
  }
  console.log(`✓ ${suggestionCount} gap suggestions`)

  console.log(`\n✅ demo project ready: open /coverage and /dashboard with project slug "${PROJECT_SLUG}"`)
}

// Allow running directly: tsx src/db/seed.ts
if (process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js')) {
  seed().then(() => pool.end()).catch(err => {
    console.error(err)
    process.exit(1)
  })
}
