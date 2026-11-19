import { simpleTraverse } from '@typescript-eslint/typescript-estree'
import type { TSESTree } from '@typescript-eslint/typescript-estree'
import type { Issue } from '../types.js'

function hasAssertionCall(body: TSESTree.BlockStatement): boolean {
  let found = false
  simpleTraverse(body as TSESTree.Node, {
    enter(node) {
      if (found) return
      // expect(...)
      if (
        node.type === 'CallExpression' &&
        node.callee.type === 'Identifier' &&
        node.callee.name === 'expect'
      ) {
        found = true
        return
      }
      // assert.XXX(...) — chai / node:assert
      if (
        node.type === 'CallExpression' &&
        node.callee.type === 'MemberExpression' &&
        node.callee.object.type === 'Identifier' &&
        node.callee.object.name === 'assert'
      ) {
        found = true
      }
    }
  })
  return found
}

export function noAssertion(node: TSESTree.Node): Issue[] {
  if (
    node.type !== 'CallExpression' ||
    node.callee.type !== 'Identifier' ||
    !['test', 'it'].includes(node.callee.name)
  ) return []

  const callback = node.arguments[1]
  if (
    !callback ||
    (callback.type !== 'ArrowFunctionExpression' && callback.type !== 'FunctionExpression') ||
    callback.body.type !== 'BlockStatement'
  ) return []

  if (!hasAssertionCall(callback.body)) {
    const name = node.arguments[0]
    const label = name?.type === 'Literal' && typeof name.value === 'string' ? ` "${name.value}"` : ''
    return [{
      rule: 'no-assertion',
      severity: 'critical',
      message: `Test${label} has no assertions — it will always pass`,
      line: node.loc?.start.line ?? 0,
      category: 'ai-slop',
      suggestion: 'Add at least one expect() that verifies the behaviour described in the test name'
    }]
  }
  return []
}
