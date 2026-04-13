import type { TSESTree } from '@typescript-eslint/typescript-estree'
import type { Issue } from '../types.js'

const ASYNC_METHODS = new Set([
  'click', 'dblclick', 'fill', 'type', 'press', 'check', 'uncheck',
  'hover', 'focus', 'blur', 'selectOption', 'setInputFiles',
  'goto', 'reload', 'goBack', 'goForward',
  'waitForSelector', 'waitForURL', 'waitForLoadState', 'waitForResponse', 'waitForRequest',
  'screenshot', 'textContent', 'innerText', 'innerHTML',
  'getAttribute', 'isVisible', 'isHidden', 'isEnabled', 'isDisabled', 'isChecked',
  'tap', 'dragTo', 'scrollIntoViewIfNeeded'
])

function isExpectCall(node: TSESTree.Node): boolean {
  let current: TSESTree.Node | undefined = node
  while (current) {
    if (current.type === 'CallExpression') {
      if (current.callee.type === 'Identifier' && current.callee.name === 'expect') return true
      current = current.callee
      continue
    }
    if (current.type === 'MemberExpression') {
      current = current.object
      continue
    }
    break
  }
  return false
}

export function missingAwait(node: TSESTree.Node, parent: TSESTree.Node | undefined): Issue[] {
  if (
    node.type !== 'CallExpression' ||
    node.callee.type !== 'MemberExpression' ||
    node.callee.property.type !== 'Identifier'
  ) {
    return []
  }

  const methodName = node.callee.property.name
  if (!ASYNC_METHODS.has(methodName)) return []

  if (isExpectCall(node.callee.object)) return []

  if (parent?.type === 'AwaitExpression') return []
  if (parent?.type === 'ReturnStatement') return []
  if (parent?.type === 'ArrowFunctionExpression' && parent.body === node) return []
  if (parent?.type === 'MemberExpression' || parent?.type === 'CallExpression') return []

  return [{
    rule: 'missing-await',
    severity: 'critical',
    message: `Missing await on async call ".${methodName}()" — the promise will not be resolved before the test continues`,
    line: node.loc?.start.line ?? 0
  }]
}
