import type { GapSuggestion } from '../api.js'

export function triggerDownload(content: string, filename: string, mime = 'text/plain'): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 500)
}

function severityEmoji(sev: string): string {
  if (sev === 'critical') return '🔴'
  if (sev === 'warning') return '🟡'
  return '🔵'
}

export function formatSuggestionsAsMarkdown(
  projectSlug: string,
  suggestions: GapSuggestion[]
): string {
  const byEndpoint = new Map<string, GapSuggestion[]>()
  for (const s of suggestions) {
    const key = `${s.targetVerb} ${s.targetPath}`
    const bucket = byEndpoint.get(key) ?? []
    bucket.push(s)
    byEndpoint.set(key, bucket)
  }

  const lines: string[] = []
  lines.push(`# Testpulse — gap analysis for \`${projectSlug}\``)
  lines.push('')
  lines.push(`Generated on ${new Date().toISOString().slice(0, 10)}. ${suggestions.length} suggested missing tests across ${byEndpoint.size} endpoints.`)
  lines.push('')
  lines.push('> Suggestions are heuristic (Claude Haiku). Human-review before acting.')
  lines.push('')

  const counts = suggestions.reduce<Record<string, number>>((acc, s) => {
    acc[s.severity] = (acc[s.severity] ?? 0) + 1
    return acc
  }, {})
  lines.push(`**Severity breakdown:** 🔴 ${counts.critical ?? 0} critical · 🟡 ${counts.warning ?? 0} warning · 🔵 ${counts.info ?? 0} info`)
  lines.push('')
  lines.push('---')
  lines.push('')

  for (const [endpoint, items] of byEndpoint) {
    const first = items[0]
    lines.push(`## \`${endpoint}\``)
    if (first.targetSummary) lines.push(`_${first.targetSummary}_`)
    if (first.targetDomain) lines.push(`Domain: \`${first.targetDomain}\``)
    lines.push('')

    for (const s of items) {
      lines.push(`### ${severityEmoji(s.severity)} ${s.title}`)
      lines.push('')
      if (s.rationale) {
        lines.push(`**Why it matters:** ${s.rationale}`)
        lines.push('')
      }
      lines.push('```gherkin')
      for (const step of s.steps) lines.push(step)
      lines.push('```')
      lines.push('')
    }
    lines.push('---')
    lines.push('')
  }

  return lines.join('\n')
}

function safeFilenameFor(endpoint: string, title: string): string {
  const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return `${clean(endpoint)}__${clean(title).slice(0, 50)}.feature`
}

export function formatSuggestionAsFeature(s: GapSuggestion): { filename: string; content: string } {
  const endpointLabel = `${s.targetVerb} ${s.targetPath}`
  const lines: string[] = []
  lines.push(`# Auto-scaffolded by Testpulse gap analysis (Claude Haiku suggestion).`)
  lines.push(`# Severity: ${s.severity}`)
  if (s.rationale) lines.push(`# Rationale: ${s.rationale}`)
  lines.push('')
  lines.push(`@testpulse-suggestion @${s.severity}`)
  lines.push(`Feature: ${s.title}`)
  lines.push('')
  lines.push(`  # Endpoint: ${endpointLabel}`)
  if (s.targetSummary) lines.push(`  # Summary: ${s.targetSummary}`)
  lines.push('')
  lines.push(`  Scenario: ${s.title}`)
  for (const step of s.steps) lines.push(`    ${step}`)
  lines.push('')

  return {
    filename: safeFilenameFor(endpointLabel, s.title),
    content: lines.join('\n')
  }
}
