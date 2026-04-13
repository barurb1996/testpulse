import type { TSESTree } from '@typescript-eslint/typescript-estree'
import type { Issue } from '../types.js'

export function cucumberConsoleInStep(node: TSESTree.Node): Issue[] {
  if (node.type !== 'CallExpression') return []
  if (node.callee.type !== 'MemberExpression') return []
  const obj = node.callee.object
  const prop = node.callee.property
  if (obj.type !== 'Identifier' || obj.name !== 'console') return []
  if (prop.type !== 'Identifier') return []
  if (prop.name !== 'log' && prop.name !== 'debug' && prop.name !== 'info') return []

  return [{
    rule: 'cucumber-console-in-step',
    severity: 'info',
    message: `console.${prop.name} left in step definition — remove before merging`,
    line: node.loc?.start.line ?? 0
  }]
}
