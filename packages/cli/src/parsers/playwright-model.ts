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
  hasNegativeAssertion: boolean   // .not.*, toBeHidden, toBeDisabled, absent outcomes
  hasSuccessStatusAssertion: boolean // asserts a 2xx status / toBeOK
  hasErrorStatusAssertion: boolean   // asserts a 4xx/5xx status somewhere in the test
  vacuousLoops: number[]             // lines of loops asserting over a list never checked for emptiness
  hasHelperAssertion: boolean     // calls expectFoo()/assertFoo() page-object helpers
}

// Only matchers that say "something exists" without saying what. toBeNull/toBeUndefined/toBeFalsy
// are legitimate value assertions for "absent" outcomes, so they are NOT weak.
export const EXISTENCE_MATCHERS = new Set(['toBeDefined', 'toBeTruthy'])

const NEGATIVE_MATCHERS = new Set(['toBeHidden', 'toBeDisabled', 'toBeEmpty', 'toBeNull', 'toBeUndefined', 'toBeFalsy', 'toHaveCount'])
const HELPER_ASSERTION = /^(expect|assert|verify|ensure)[A-Z_]/

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
        hasErrorPattern: false,
        hasNegativeAssertion: false,
        hasSuccessStatusAssertion: false,
        hasErrorStatusAssertion: false,
        vacuousLoops: [],
        hasHelperAssertion: false
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
              // negated chain: expect(x).not.toBeVisible()
              let chain: TSESTree.Node = inner.callee.object as TSESTree.Node
              let negated = false
              while (chain.type === 'MemberExpression') {
                if (chain.property.type === 'Identifier' && chain.property.name === 'not') negated = true
                chain = chain.object as TSESTree.Node
              }
              const firstArg = inner.arguments[0]
              const numArg = firstArg && firstArg.type === 'Literal' && typeof firstArg.value === 'number' ? firstArg.value : undefined
              const subjectCode = bestEffortCode(subject)
              if (negated || NEGATIVE_MATCHERS.has(matcher) && !(matcher === 'toHaveCount' && numArg !== 0)) tc.hasNegativeAssertion = true
              if ((matcher === 'toBeOK' && !negated) || (/status/i.test(subjectCode) && numArg !== undefined && numArg >= 200 && numArg < 300 && ['toBe', 'toEqual', 'toStrictEqual'].includes(matcher))) {
                tc.hasSuccessStatusAssertion = true
              }
              if (/status/i.test(subjectCode) && numArg !== undefined && numArg >= 400 && ['toBe', 'toEqual', 'toStrictEqual'].includes(matcher)) tc.hasErrorStatusAssertion = true
              tc.asserts.push({
                matcher,
                subjectExpr: bestEffortCode(subject),
                line: inner.loc?.start.line ?? 0
              })
              if (ERROR_MATCHERS.has(matcher)) tc.hasErrorPattern = true
            }
          }

          // for (const x of list) { expect(...) } with no emptiness check on `list` passes on an empty list
          if (inner.type === 'ForOfStatement' && inner.right.range && inner.body.range) {
            const listText = source.slice(inner.right.range[0], inner.right.range[1]).trim()
            const bodyText = source.slice(inner.body.range[0], inner.body.range[1])
            if (/\bexpect\s*\(/.test(bodyText) && callback.range) {
              const whole = source.slice(callback.range[0], callback.range[1])
              const esc = listText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
              const checked = new RegExp(`${esc}\\s*\\)?\\.length|expect\\(\\s*${esc}\\s*\\)\\.(toHaveLength|not\\.toEqual|not\\.toHaveLength|toBeGreaterThan)`).test(whole)
              const literalList = new RegExp(`(const|let|var)\\s+${esc}\\s*(:[^=]+)?=\\s*\\[`).test(whole) || /^\[/.test(listText) // a literal array is never empty
              // Object.entries(CONST) / CONST where CONST is a literal declared anywhere in the file is never empty
              const innerMatch = /^(?:Object\.(?:entries|keys|values)\()?([A-Za-z_$][\w$]*)\)?$/.exec(listText)
              const listId = innerMatch ? innerMatch[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : null
              const fileLiteral = listId !== null && new RegExp(`(const|let|var)\\s+${listId}\\s*(:[^=]+)?=\\s*[\\[{]`).test(source)
              if (!checked && !literalList && !fileLiteral) tc.vacuousLoops.push(inner.loc?.start.line ?? 0)
            }
          }

          // page-object style helpers that assert internally: expectFoo(), poPage.assertBar()
          if (inner.type === 'CallExpression') {
            const c = inner.callee
            const leaf = c.type === 'Identifier' ? c.name : c.type === 'MemberExpression' && c.property.type === 'Identifier' ? c.property.name : ''
            if (HELPER_ASSERTION.test(leaf)) tc.hasHelperAssertion = true
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

      // Scan the callback BODY only: the test name itself ("should reject …") must not satisfy the check
      if (callback.range) {
        const testSrc = source.slice(callback.range[0], callback.range[1])
        if (/\b(4[0-9]{2}|throw|toThrow|\.rejects|\.catch\s*\(|fail|error)\b/i.test(testSrc)) {
          tc.hasErrorPattern = true
        }
      }

      cases.push(tc)
    }
  })

  return cases
}
