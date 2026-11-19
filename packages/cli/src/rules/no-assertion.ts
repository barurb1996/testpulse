import { simpleTraverse } from '@typescript-eslint/typescript-estree'
import type { TSESTree } from '@typescript-eslint/typescript-estree'
import type { Issue } from '../types.js'

/** Root identifier of a call/member chain: expect.poll(...).toBe -> "expect". */
function rootName(node: TSESTree.Node): string | null {
  let cur: TSESTree.Node = node
  for (let i = 0; i < 20; i++) {
    if (cur.type === 'CallExpression') cur = cur.callee as TSESTree.Node
    else if (cur.type === 'MemberExpression') cur = cur.object as TSESTree.Node
    else if (cur.type === 'AwaitExpression') cur = cur.argument
    else break
  }
  return cur.type === 'Identifier' ? cur.name : null
}

function calleeLeafName(call: TSESTree.CallExpression): string | null {
  const c = call.callee
  if (c.type === 'Identifier') return c.name
  if (c.type === 'MemberExpression' && c.property.type === 'Identifier') return c.property.name
  return null
}

// Helpers that assert on the caller's behalf (page objects, custom matchers) and Playwright waits that fail on timeout.
// Boundary after the prefix: expectFoo / assert_bar count, expectedFoo / checkout / check() / waitForTimeout() do not.
const ASSERTING_HELPER = /^(expect|assert|verify|ensure|should)([A-Z_]|$)|^waitFor(?!Timeout\b)/
const NAMED_ASSERTERS = new Set(['toPass'])

/** Receivers that are Playwright/JS built-ins: a test using only these has nowhere to hide an assertion. */
const BUILTIN_ROOTS = new Set(['page', 'request', 'context', 'browser', 'test', 'expect', 'console', 'Math', 'JSON', 'Date', 'Promise', 'Object', 'Array', 'String', 'Number'])

/** True when the body calls into project code (page objects, helpers) that could assert on its own. */
function callsProjectCode(body: TSESTree.BlockStatement): boolean {
  let found = false
  simpleTraverse(body as TSESTree.Node, {
    enter(node) {
      if (found || node.type !== 'CallExpression') return
      const root = rootName(node)
      if (root && !BUILTIN_ROOTS.has(root)) found = true
    }
  })
  return found
}

function hasAssertionCall(body: TSESTree.BlockStatement): boolean {
  let found = false
  simpleTraverse(body as TSESTree.Node, {
    enter(node) {
      if (found || node.type !== 'CallExpression') return
      const root = rootName(node)
      if (root === 'expect' || root === 'assert') { found = true; return }
      const leaf = calleeLeafName(node)
      if (leaf && (ASSERTING_HELPER.test(leaf) || NAMED_ASSERTERS.has(leaf))) found = true
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
    const helperDriven = callsProjectCode(callback.body)
    return [{
      rule: 'no-assertion',
      severity: helperDriven ? 'warning' : 'critical',
      message: helperDriven
        ? `Test${label} has no visible assertion — it only calls helpers/page objects; verify they assert, or add an expect()`
        : `Test${label} has no assertions — it will always pass`,
      line: node.loc?.start.line ?? 0,
      category: 'ai-slop',
      suggestion: 'Add at least one expect() that verifies the behaviour described in the test name'
    }]
  }
  return []
}
