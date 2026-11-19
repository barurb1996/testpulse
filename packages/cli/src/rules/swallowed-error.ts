import type { TSESTree } from '@typescript-eslint/typescript-estree'
import type { Issue } from '../types.js'

function isEmptyBlock(block: TSESTree.BlockStatement): boolean {
  return block.body.every(s => s.type === 'EmptyStatement')
}

function text(node: TSESTree.Node, source: string): string {
  return node.range ? source.slice(node.range[0], node.range[1]) : ''
}

// Best-effort cleanup / race-tolerant calls where ignoring a failure is the point.
const CLEANUP_CALL = /(waitFor|delete|remove|dispose|close|continue|abort|fulfill|unroute|cleanup|destroy|teardown|reload|screenshot)\w*\s*\(/i

export function swallowedError(node: TSESTree.Node, parent: TSESTree.Node | undefined, source: string): Issue[] {
  // try { … } catch (e) {}
  if (node.type === 'CatchClause' && isEmptyBlock(node.body)) {
    // a comment inside the block means the author documented the intent ("ignore 404")
    if (/\/\/|\/\*/.test(text(node.body, source))) return []
    const tryBlock = parent?.type === 'TryStatement' ? text(parent.block, source) : ''
    const guardsAssertion = /\bexpect\b|\bassert\b/.test(tryBlock)
    return [{
      rule: 'swallowed-error',
      severity: guardsAssertion ? 'critical' : 'warning',
      message: guardsAssertion
        ? 'Empty catch around an assertion — a failing expect() is silently swallowed'
        : 'Empty catch block with no explanation — failures are silently ignored',
      line: node.loc?.start.line ?? 0,
      category: 'ai-slop',
      suggestion: 'Assert on the error, re-throw it, or add a comment saying why ignoring it is safe'
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
      if (/\/\/|\/\*/.test(text(arg.body as TSESTree.Node, source))) return []
      const receiver = text(node.callee.object as TSESTree.Node, source)
      if (CLEANUP_CALL.test(receiver)) return []
      const guardsAssertion = /\bexpect\b/.test(receiver)
      return [{
        rule: 'swallowed-error',
        severity: guardsAssertion ? 'critical' : 'warning',
        message: guardsAssertion
          ? '.catch(() => {}) on an assertion — a failing expect() is silently swallowed'
          : '.catch(() => {}) swallows promise rejections silently',
        line: node.loc?.start.line ?? 0,
        category: 'ai-slop',
        suggestion: 'Remove .catch() or assert on the rejection with .rejects.toThrow()'
      }]
    }
  }

  return []
}
