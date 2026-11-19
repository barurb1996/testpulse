import type { TSESTree } from '@typescript-eslint/typescript-estree'
import type { Issue } from '../types.js'

function isEmptyBlock(block: TSESTree.BlockStatement): boolean {
  return block.body.every(s => s.type === 'EmptyStatement')
}

export function swallowedError(node: TSESTree.Node): Issue[] {
  // try { … } catch (e) {}
  if (node.type === 'CatchClause' && isEmptyBlock(node.body)) {
    return [{
      rule: 'swallowed-error',
      severity: 'critical',
      message: 'Empty catch block — exception is silently swallowed, test cannot fail on errors',
      line: node.loc?.start.line ?? 0,
      category: 'ai-slop',
      suggestion: 'Assert on the error (expect(fn).rejects.toThrow()) or at minimum re-throw it'
    }]
  }

  // .catch(() => {})
  if (
    node.type === 'CallExpression' &&
    node.callee.type === 'MemberExpression' &&
    node.callee.property.type === 'Identifier' &&
    node.callee.property.name === 'catch'
  ) {
    const arg = node.arguments[0]
    if (
      arg &&
      (arg.type === 'ArrowFunctionExpression' || arg.type === 'FunctionExpression') &&
      arg.body.type === 'BlockStatement' &&
      isEmptyBlock(arg.body as TSESTree.BlockStatement)
    ) {
      return [{
        rule: 'swallowed-error',
        severity: 'critical',
        message: '.catch(() => {}) swallows promise rejections silently',
        line: node.loc?.start.line ?? 0,
        category: 'ai-slop',
        suggestion: 'Remove .catch() or assert on the rejection with .rejects.toThrow()'
      }]
    }
  }

  return []
}
