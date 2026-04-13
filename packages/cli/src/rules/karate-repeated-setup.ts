import type { Issue } from '../types.js'
import type { KarateFeature } from '../parsers/karate.js'

const PREFIX_LENGTH = 3
const MIN_SCENARIOS_SHARING = 3

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, ' ')
}

export function karateRepeatedSetup(feature: KarateFeature): Issue[] {
  const groups = new Map<string, Array<{ name: string; line: number }>>()

  for (const scenario of feature.scenarios) {
    if (scenario.steps.length < PREFIX_LENGTH) continue
    const signature = scenario.steps.slice(0, PREFIX_LENGTH).map(s => normalize(s.text)).join('|||')
    const bucket = groups.get(signature) ?? []
    bucket.push({ name: scenario.name, line: scenario.line })
    groups.set(signature, bucket)
  }

  const issues: Issue[] = []
  for (const bucket of groups.values()) {
    if (bucket.length < MIN_SCENARIOS_SHARING) continue
    const names = bucket.map(b => `"${b.name}"`).join(', ')
    issues.push({
      rule: 'karate-repeated-setup',
      severity: 'warning',
      message: `${bucket.length} scenarios share the same first ${PREFIX_LENGTH} steps — move them to a Background block: ${names}`,
      line: bucket[0].line
    })
  }

  return issues
}
