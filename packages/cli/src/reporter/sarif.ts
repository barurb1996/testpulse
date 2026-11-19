import path from 'path'
import type { AnalysisResult, IssueSeverity } from '../types.js'
import { RULE_REGISTRY } from '../rule-registry.js'

const LEVEL: Record<IssueSeverity, 'error' | 'warning' | 'note'> = {
  critical: 'error',
  warning: 'warning',
  info: 'note'
}

export function toSarif(results: AnalysisResult[], rootDir: string, version = '0.2.0') {
  const usedRules = new Set<string>()
  const sarifResults = results.flatMap(r =>
    r.issues.map(issue => {
      usedRules.add(issue.rule)
      const rel = path.relative(rootDir, r.file).replace(/\\/g, '/')
      return {
        ruleId: issue.rule,
        level: LEVEL[issue.severity],
        message: { text: issue.suggestion ? `${issue.message} — ${issue.suggestion}` : issue.message },
        locations: [{
          physicalLocation: {
            artifactLocation: { uri: rel },
            region: { startLine: Math.max(1, issue.line) }
          }
        }],
        partialFingerprints: issue.fingerprint ? { testpulseFingerprint: issue.fingerprint } : undefined
      }
    })
  )

  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [{
      tool: {
        driver: {
          name: 'Testpulse',
          version,
          informationUri: 'https://github.com/barurb1996/testpulse',
          rules: [...usedRules].map(id => {
            const meta = RULE_REGISTRY[id]
            return {
              id,
              shortDescription: { text: meta?.description ?? id },
              defaultConfiguration: { level: meta ? LEVEL[meta.severity] : 'warning' },
              properties: meta ? { category: meta.category, tags: [meta.category] } : undefined
            }
          })
        }
      },
      results: sarifResults
    }]
  }
}

export function toJson(results: AnalysisResult[], rootDir: string, score: number) {
  return {
    score,
    files: results.map(r => ({
      file: path.relative(rootDir, r.file).replace(/\\/g, '/'),
      issues: r.issues
    }))
  }
}
