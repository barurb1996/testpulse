import type { AnalysisResult } from '../types.js'

export function reporter(results: AnalysisResult[]): void {
  const totalIssues = results.reduce((acc, r) => acc + r.issues.length, 0)
  const critical = results.flatMap(r => r.issues).filter(i => i.severity === 'critical').length
  const score = Math.max(0, 100 - (critical * 10) - ((totalIssues - critical) * 3))

  console.log(`Scanned ${results.length} files\n`)

  for (const result of results) {
    if (result.issues.length === 0) continue
    console.log(`  ${result.file}`)
    for (const issue of result.issues) {
      const icon = issue.severity === 'critical' ? '✗' : '⚠'
      console.log(`    ${icon} [${issue.rule}] line ${issue.line}: ${issue.message}`)
    }
    console.log()
  }

  console.log(`Quality score: ${score}/100`)
  if (critical > 0) {
    console.log(`Critical issues: ${critical} — fix before merging\n`)
    process.exit(1)
  }
}
