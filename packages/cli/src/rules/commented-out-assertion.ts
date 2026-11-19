import type { Issue } from '../types.js'

const LINE_COMMENT_RE = /^\s*\/\/+\s*expect\s*\(/
const BLOCK_COMMENT_RE = /\/\*[^*]*expect\s*\(/

export function commentedOutAssertion(source: string): Issue[] {
  const issues: Issue[] = []
  const lines = source.split('\n')

  for (let i = 0; i < lines.length; i++) {
    if (LINE_COMMENT_RE.test(lines[i]) || BLOCK_COMMENT_RE.test(lines[i])) {
      issues.push({
        rule: 'commented-out-assertion',
        severity: 'warning',
        message: 'Commented-out expect() — assertion is not running',
        line: i + 1,
        category: 'ai-slop',
        suggestion: 'Uncomment or delete this assertion'
      })
    }
  }

  return issues
}
