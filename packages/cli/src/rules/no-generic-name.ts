import type { TSESTree } from '@typescript-eslint/typescript-estree'
import type { Issue } from '../types.js'

const GENERIC_NAMES = new Set([
  'test', 'test1', 'test 1', 'test2', 'test 2', 'tests',
  'it', 'it works', 'works', 'should work',
  'foo', 'bar', 'baz', 'example', 'demo',
  'untitled', 'new test', 'todo', 'tbd'
])

export function noGenericName(node: TSESTree.Node): Issue[] {
  if (
    node.type === 'CallExpression' &&
    node.callee.type === 'Identifier' &&
    node.callee.name === 'test'
  ) {
    const name = node.arguments[0]
    if (name?.type === 'Literal' && typeof name.value === 'string') {
      const normalized = name.value.trim().toLowerCase()
      if (GENERIC_NAMES.has(normalized) || normalized.length < 5) {
        return [{
          rule: 'no-generic-name',
          severity: 'warning',
          message: `Test name "${name.value}" is too generic — describe the behavior being verified`,
          line: node.loc?.start.line ?? 0
        }]
      }
    }
  }
  return []
}
