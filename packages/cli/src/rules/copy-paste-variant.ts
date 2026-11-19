import type { Issue } from '../types.js'
import type { PlaywrightTestCase } from '../parsers/playwright-model.js'
import path from 'path'

/** Replace string/number literals so we can detect structural duplicates. */
function normalizeName(name: string): string {
  return name
    .replace(/['"][^'"]*['"]/g, '__STR__')
    .replace(/\b\d+(\.\d+)?\b/g, '__NUM__')
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '__EMAIL__')
    .trim()
    .toLowerCase()
}

function assertSignature(tc: PlaywrightTestCase): string {
  return tc.asserts.map(a => a.matcher).join(',')
}

export function copyPasteVariant(testCases: PlaywrightTestCase[], filePath: string): Issue[] {
  if (testCases.length < 2) return []

  const groups = new Map<string, PlaywrightTestCase[]>()

  for (const tc of testCases) {
    const sig = assertSignature(tc)
    if (!sig) continue
    const key = `${normalizeName(tc.name)}|||${sig}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(tc)
  }

  const issues: Issue[] = []
  const fileName = path.basename(filePath)

  for (const group of groups.values()) {
    if (group.length < 2) continue
    // Confirm they're genuinely different (not identical names)
    const distinctNames = new Set(group.map(t => t.name))
    if (distinctNames.size < 2) continue

    const first = group[0]
    const names = [...distinctNames].slice(0, 3).map(n => `"${n}"`).join(', ')
    issues.push({
      rule: 'copy-paste-variant',
      severity: 'warning',
      message: `${group.length} tests in ${fileName} differ only in data values (${names}…) — refactor to test.each`,
      line: first.line,
      category: 'ai-slop',
      suggestion: `Use test.each([...])('${normalizeName(first.name)}', async ({ page }) => { … }) to consolidate variants`
    })
  }

  return issues
}
