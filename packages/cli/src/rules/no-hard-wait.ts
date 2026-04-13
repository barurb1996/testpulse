import type { TSESTree } from '@typescript-eslint/typescript-estree'
import type { Issue } from '../types.js'

export function noHardWait(node: TSESTree.Node): Issue[] {
  if (
    node.type === 'CallExpression' &&
    node.callee.type === 'MemberExpression' &&
    node.callee.property.type === 'Identifier' &&
    node.callee.property.name === 'waitForTimeout'
  ) {
    return [{
      rule: 'no-hard-wait',
      severity: 'critical',
      message: 'Avoid waitForTimeout() — use auto-waiting locators instead',
      line: node.loc?.start.line ?? 0
    }]
  }
  return []
}
