import type { TSESTree } from '@typescript-eslint/typescript-estree'
import type { Issue } from '../types.js'

function isTestCall(node: TSESTree.Node): boolean {
  if (node.type !== 'CallExpression') return false
  const callee = node.callee
  if (callee.type === 'Identifier') return callee.name === 'test' || callee.name === 'it'
  if (callee.type === 'MemberExpression' && callee.object.type === 'Identifier' && callee.property.type === 'Identifier') {
    return (callee.object.name === 'test' || callee.object.name === 'it') &&
      (callee.property.name === 'only' || callee.property.name === 'skip' || callee.property.name === 'fixme')
  }
  return false
}

function collectTopLevelBranches(body: TSESTree.BlockStatement): Issue[] {
  const issues: Issue[] = []
  for (const stmt of body.body) {
    if (stmt.type === 'IfStatement') {
      issues.push({
        rule: 'playwright-conditional-in-test',
        severity: 'warning',
        message: `if statement inside a test body — tests should run deterministic steps; move conditional logic to fixtures or split into separate tests`,
        line: stmt.loc?.start.line ?? 0
      })
    } else if (stmt.type === 'SwitchStatement') {
      issues.push({
        rule: 'playwright-conditional-in-test',
        severity: 'warning',
        message: `switch inside a test body — tests should run deterministic steps; split into separate tests`,
        line: stmt.loc?.start.line ?? 0
      })
    }
  }
  return issues
}

export function playwrightConditionalInTest(node: TSESTree.Node): Issue[] {
  if (!isTestCall(node)) return []
  const call = node as TSESTree.CallExpression
  const fn = call.arguments[1]
  if (!fn || (fn.type !== 'ArrowFunctionExpression' && fn.type !== 'FunctionExpression')) return []
  if (fn.body.type !== 'BlockStatement') return []
  return collectTopLevelBranches(fn.body)
}
