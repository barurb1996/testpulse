import type { AnalysisResult } from '../types.js'

export interface Summary {
  filesScanned: number
  totalIssues: number
  critical: number
  score: number
}

export interface ReportOptions {
  suppressed?: number
  staleIgnoreFingerprints?: string[]
  showFingerprints?: boolean
}

export function reporter(results: AnalysisResult[], opts: ReportOptions = {}): Summary {
  const totalIssues = results.reduce((acc, r) => acc + r.issues.length, 0)
  const critical = results.flatMap(r => r.issues).filter(i => i.severity === 'critical').length
  const score = Math.max(0, 100 - (critical * 10) - ((totalIssues - critical) * 3))

  console.log(`Scanned ${results.length} files\n`)

  for (const result of results) {
    if (result.issues.length === 0) continue
    console.log(`  ${result.file}`)
    for (const issue of result.issues) {
      const icon = issue.severity === 'critical' ? '✗' : issue.severity === 'warning' ? '⚠' : 'ℹ'
      const fp = opts.showFingerprints && issue.fingerprint ? ` · ${issue.fingerprint}` : ''
      console.log(`    ${icon} [${issue.rule}${fp}] line ${issue.line}: ${issue.message}`)
    }
    console.log()
  }

  console.log(`Quality score: ${score}/100`)
  if (critical > 0) {
    console.log(`Critical issues: ${critical} — fix before merging`)
  }

  if (opts.suppressed && opts.suppressed > 0) {
    console.log(`Suppressed via .testpulse/ignores.json: ${opts.suppressed}`)
  }

  if (opts.staleIgnoreFingerprints && opts.staleIgnoreFingerprints.length > 0) {
    console.log(`\nStale ignores (no current issue matches these fingerprints — safe to delete):`)
    for (const fp of opts.staleIgnoreFingerprints) console.log(`  · ${fp}`)
  }

  console.log()
  return { filesScanned: results.length, totalIssues, critical, score }
}
