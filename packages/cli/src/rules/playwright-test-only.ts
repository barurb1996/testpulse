import type { TSESTree } from '@typescript-eslint/typescript-estree'
import type { Issue } from '../types.js'

export function playwrightTestOnly(node: TSESTree.Node): Issue[] {
  if (node.type !== 'CallExpression') return []
  if (node.callee.type !== 'MemberExpression') return []
  const prop = node.callee.property
  const obj = node.callee.object
  if (prop.type !== 'Identifier') return []

  if (prop.name === 'only') {
    const objName = obj.type === 'Identifier' ? obj.name : null
    if (objName === 'test' || objName === 'describe' || objName === 'it') {
      return [{
        rule: 'playwright-test-only',
        severity: 'critical',
        message: `${objName}.only left in code — all other tests in the file will be skipped in CI`,
        line: node.loc?.start.line ?? 0
      }]
    }
  }
  return []
}
