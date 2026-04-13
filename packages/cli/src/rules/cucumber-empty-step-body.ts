import type { TSESTree } from '@typescript-eslint/typescript-estree'
import type { Issue } from '../types.js'

const STEP_NAMES = new Set(['Given', 'When', 'Then', 'And', 'But'])

function isStepCall(node: TSESTree.Node): node is TSESTree.CallExpression {
  return node.type === 'CallExpression'
    && node.callee.type === 'Identifier'
    && STEP_NAMES.has(node.callee.name)
}

function bodyIsEmpty(fn: TSESTree.Node): boolean {
  if (fn.type !== 'ArrowFunctionExpression' && fn.type !== 'FunctionExpression') return false
  if (fn.body.type !== 'BlockStatement') return false
  return fn.body.body.length === 0
}

export function cucumberEmptyStepBody(node: TSESTree.Node): Issue[] {
  if (!isStepCall(node)) return []
  const handler = node.arguments[node.arguments.length - 1]
  if (!handler || !bodyIsEmpty(handler)) return []

  const stepDef = node.arguments[0]
  const label = stepDef?.type === 'Literal' && typeof stepDef.value === 'string'
    ? `"${stepDef.value}"`
    : stepDef?.type === 'Literal' && stepDef.value instanceof RegExp
      ? stepDef.value.toString()
      : '<step>'

  return [{
    rule: 'cucumber-empty-step-body',
    severity: 'critical',
    message: `Step definition ${label} has an empty body — the step will silently pass without doing anything`,
    line: node.loc?.start.line ?? 0
  }]
}
