import { simpleTraverse } from '@typescript-eslint/typescript-estree'
import type { TSESTree } from '@typescript-eslint/typescript-estree'

export interface AssertInfo {
  matcher: string       // 'toBe', 'toMatchSnapshot', 'toBeDefined', …
  subjectExpr: string   // best-effort stringification of the expect() subject
  line: number
}

export interface PlaywrightTestCase {
  name: string
  line: number
  asserts: AssertInfo[]
  hasErrorPattern: boolean  // toThrow, .rejects, 4xx, catch with body
}

export const EXISTENCE_MATCHERS = new Set([
  'toBeDefined', 'toBeUndefined', 'toBeTruthy', 'toBeFalsy',
  'toBeNull', 'toBeNaN', 'toBeInstanceOf'
])

export const SNAPSHOT_MATCHERS = new Set([
  'toMatchSnapshot', 'toMatchInlineSnapshot', 'toMatchImageSnapshot'
])

export const ERROR_MATCHERS = new Set([
  'toThrow', 'toThrowError',
  'toThrowErrorMatchingSnapshot', 'toThrowErrorMatchingInlineSnapshot',
  'rejects'
])

function bestEffortCode(node: TSESTree.Node): string {
  if (node.type === 'Literal') return String(node.value)
  if (node.type === 'Identifier') return node.name
  if (node.type === 'MemberExpression') {
    const obj = bestEffortCode(node.object as TSESTree.Node)
    const prop = node.property.type === 'Identifier' ? node.property.name : '?'
    return `${obj}.${prop}`
  }
  if (node.type === 'CallExpression') {
    return `${bestEffortCode(node.callee as TSESTree.Node)}(...)`
  }
  return '…'
}

/** Walk up a `.resolves./.rejects.` chain to find the original expect(). */
function findExpectArg(node: TSESTree.Node): TSESTree.Node | null {
  if (
    node.type === 'CallExpression' &&
    node.callee.type === 'Identifier' &&
    node.callee.name === 'expect'
  ) {
    return (node.arguments[0] as TSESTree.Node) ?? null
  }
  if (node.type === 'MemberExpression') {
    return findExpectArg(node.object as TSESTree.Node)
  }
  if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression') {
    return findExpectArg(node.callee.object as TSESTree.Node)
  }
  return null
}

export function extractTestCases(ast: TSESTree.Program, source: string): PlaywrightTestCase[] {
  const cases: PlaywrightTestCase[] = []

  simpleTraverse(ast as TSESTree.Node, {
    enter(node) {
      if (
        node.type !== 'CallExpression' ||
        node.callee.type !== 'Identifier' ||
        !['test', 'it'].includes(node.callee.name)
      ) return

      const nameArg = node.arguments[0]
      if (!nameArg || nameArg.type !== 'Literal' || typeof nameArg.value !== 'string') return

      const callback = node.arguments[1]
      if (
        !callback ||
        (callback.type !== 'ArrowFunctionExpression' && callback.type !== 'FunctionExpression') ||
        callback.body.type !== 'BlockStatement'
      ) return

      const tc: PlaywrightTestCase = {
        name: nameArg.value,
        line: node.loc?.start.line ?? 0,
        asserts: [],
        hasErrorPattern: false
      }

      simpleTraverse(callback.body as TSESTree.Node, {
        enter(inner) {
          // .matcher(…) where the chain roots in expect()
          if (
            inner.type === 'CallExpression' &&
            inner.callee.type === 'MemberExpression' &&
            inner.callee.property.type === 'Identifier'
          ) {
            const matcher = inner.callee.property.name
            const subject = findExpectArg(inner.callee.object as TSESTree.Node)

            if (subject !== null) {
              tc.asserts.push({
                matcher,
                subjectExpr: bestEffortCode(subject),
                line: inner.loc?.start.line ?? 0
              })
              if (ERROR_MATCHERS.has(matcher)) tc.hasErrorPattern = true
            }
          }

          // .rejects accessor
          if (
            inner.type === 'MemberExpression' &&
            inner.property.type === 'Identifier' &&
            inner.property.name === 'rejects'
          ) {
            tc.hasErrorPattern = true
          }
        }
      })

      // Scan source text of the whole test call for error keywords / status codes
      if (node.range) {
        const testSrc = source.slice(node.range[0], node.range[1])
        if (/\b(4[0-9]{2}|throw|toThrow|\.rejects|\.catch\s*\(|fail|error)\b/i.test(testSrc)) {
          tc.hasErrorPattern = true
        }
      }

      cases.push(tc)
    }
  })

  return cases
}
