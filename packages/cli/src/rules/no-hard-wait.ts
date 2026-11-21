import type { TSESTree } from '@typescript-eslint/typescript-estree'
import type { Issue } from '../types.js'
import { isHelperNamespace, isSleepMethod } from '../helper-names.js'

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
  if (
    node.type === 'CallExpression' &&
    node.callee.type === 'MemberExpression' &&
    node.callee.object.type === 'Identifier' &&
    node.callee.property.type === 'Identifier' &&
    isHelperNamespace(node.callee.object.name) &&
    isSleepMethod(node.callee.property.name)
  ) {
    return [{
      rule: 'no-hard-wait',
      severity: 'warning',
      message: `Avoid ${node.callee.object.name}.${node.callee.property.name}() — a fixed pause makes the test slow and flaky; wait for a condition instead`,
      line: node.loc?.start.line ?? 0
    }]
  }
  return []
}
