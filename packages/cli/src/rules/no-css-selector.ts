import type { TSESTree } from '@typescript-eslint/typescript-estree'
import type { Issue } from '../types.js'

const CSS_SELECTOR_START = /^\s*[.#\[]/

export function noCssSelector(node: TSESTree.Node): Issue[] {
  if (
    node.type === 'CallExpression' &&
    node.callee.type === 'MemberExpression' &&
    node.callee.property.type === 'Identifier' &&
    (node.callee.property.name === 'locator' || node.callee.property.name === '$' || node.callee.property.name === '$$')
  ) {
    const arg = node.arguments[0]
    if (arg?.type === 'Literal' && typeof arg.value === 'string' && CSS_SELECTOR_START.test(arg.value)) {
      return [{
        rule: 'no-css-selector',
        severity: 'warning',
        message: `Avoid CSS selector "${arg.value}" — prefer getByRole/getByLabel/getByTestId`,
        line: node.loc?.start.line ?? 0
      }]
    }
  }
  return []
}
