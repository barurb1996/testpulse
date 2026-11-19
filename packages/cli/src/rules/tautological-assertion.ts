import type { TSESTree } from '@typescript-eslint/typescript-estree'
import type { Issue } from '../types.js'

function nodeCode(node: TSESTree.Node): string {
  if (node.type === 'Literal') return String(node.value)
  if (node.type === 'Identifier') return node.name
  if (node.type === 'TemplateLiteral') return '`…`'
  return '…'
}

/** Matchers where passing a specific literal subject is always trivially true. */
const SELF_PROVING: Record<string, (subject: TSESTree.Node) => boolean> = {
  toBeNull:      s => s.type === 'Literal' && s.value === null,
  toBeUndefined: s => s.type === 'Identifier' && s.name === 'undefined',
  toBeTruthy:    s => s.type === 'Literal' && Boolean(s.value) === true,
  toBeFalsy:     s => s.type === 'Literal' && !s.value,
  toBeDefined:   s => s.type === 'Literal' && s.value !== null,
  toBeNaN:       s => s.type === 'Identifier' && s.name === 'NaN',
}

function sameNode(a: TSESTree.Node, b: TSESTree.Node): boolean {
  if (a.type !== b.type) return false
  if (a.type === 'Literal' && b.type === 'Literal') return a.value === b.value
  if (a.type === 'Identifier' && b.type === 'Identifier') return a.name === b.name
  return false
}

/** Walk up .resolves/.rejects chain to find expect() subject. */
function expectSubject(node: TSESTree.Node): TSESTree.Node | null {
  if (
    node.type === 'CallExpression' &&
    node.callee.type === 'Identifier' &&
    node.callee.name === 'expect'
  ) return (node.arguments[0] as TSESTree.Node) ?? null
  if (node.type === 'MemberExpression') return expectSubject(node.object as TSESTree.Node)
  if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression')
    return expectSubject(node.callee.object as TSESTree.Node)
  return null
}

export function tautologicalAssertion(node: TSESTree.Node): Issue[] {
  if (
    node.type !== 'CallExpression' ||
    node.callee.type !== 'MemberExpression' ||
    node.callee.property.type !== 'Identifier'
  ) return []

  const matcherName = node.callee.property.name
  const subject = expectSubject(node.callee.object as TSESTree.Node)
  if (!subject) return []

  let tautological = false
  const matcherArgs = node.arguments as TSESTree.Node[]

  // expect(x).toBe(x), expect(x).toEqual(x), expect(x).toStrictEqual(x)
  if (['toBe', 'toEqual', 'toStrictEqual', 'toDeepEqual'].includes(matcherName)) {
    const arg = matcherArgs[0]
    if (arg && sameNode(subject, arg)) tautological = true
  }

  // expect(null).toBeNull(), expect(true).toBeTruthy(), …
  const selfProving = SELF_PROVING[matcherName]
  if (selfProving && selfProving(subject)) tautological = true

  if (!tautological) return []

  return [{
    rule: 'tautological-assertion',
    severity: 'critical',
    message: `Tautological assertion: expect(${nodeCode(subject)}).${matcherName}(…) can never fail`,
    line: node.loc?.start.line ?? 0,
    category: 'ai-slop',
    suggestion: 'Assert the actual computed value against the expected result, not a constant against itself'
  }]
}
