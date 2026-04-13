import type { TSESTree } from '@typescript-eslint/typescript-estree'
import type { Issue } from '../types.js'

export function noAssertion(node: TSESTree.Node): Issue[] {
  if (
    node.type === 'CallExpression' &&
    node.callee.type === 'Identifier' &&
    node.callee.name === 'test'
  ) {
    const body = (node.arguments[1] as TSESTree.ArrowFunctionExpression)?.body
    if (body?.type === 'BlockStatement') {
      const hasExpect = JSON.stringify(body).includes('"expect"')
      if (!hasExpect) {
        return [{
          rule: 'no-assertion',
          severity: 'critical',
          message: 'Test has no assertions — it will always pass',
          line: node.loc?.start.line ?? 0
        }]
      }
    }
  }
  return []
}
