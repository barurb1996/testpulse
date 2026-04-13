import type { TSESTree } from '@typescript-eslint/typescript-estree'
import type { Issue } from '../types.js'

const LONG_TIMEOUT_MS = 30_000

function numericValue(arg: TSESTree.Node | undefined): number | null {
  if (!arg) return null
  if (arg.type === 'Literal' && typeof arg.value === 'number') return arg.value
  return null
}

export function playwrightHardcodedTimeout(node: TSESTree.Node): Issue[] {
  if (node.type !== 'CallExpression') return []
  if (node.callee.type !== 'MemberExpression') return []
  const obj = node.callee.object
  const prop = node.callee.property
  if (obj.type !== 'Identifier' || prop.type !== 'Identifier') return []
  if (obj.name !== 'test') return []
  if (prop.name !== 'setTimeout' && prop.name !== 'slow') return []

  const value = numericValue(node.arguments[0])
  if (value === null) return []
  if (value < LONG_TIMEOUT_MS) return []

  return [{
    rule: 'playwright-hardcoded-timeout',
    severity: 'warning',
    message: `test.${prop.name}(${value}) — hardcoded timeout > ${LONG_TIMEOUT_MS / 1000}s usually masks flakiness; fix the underlying wait instead`,
    line: node.loc?.start.line ?? 0
  }]
}
