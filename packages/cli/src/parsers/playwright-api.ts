import { parse, simpleTraverse } from '@typescript-eslint/typescript-estree'
import type { TSESTree } from '@typescript-eslint/typescript-estree'
import type { EndpointCoverage } from '../types.js'
import { classifyOutcome } from '../security/classify.js'

const HTTP_VERBS = new Set(['get', 'post', 'put', 'delete', 'patch', 'head'])
const REQUEST_NAMES = /^(request|api|apiContext|apiRequest|apiClient|client)$/i

/** Receiver is `request`, `page.request`, `context.request`, or a variable named like an API client. */
function isRequestReceiver(node: TSESTree.Node): boolean {
  if (node.type === 'Identifier') return REQUEST_NAMES.test(node.name)
  if (node.type === 'MemberExpression' && node.property.type === 'Identifier') return node.property.name === 'request'
  return false
}

function urlFromArg(arg: TSESTree.Node | undefined): string | null {
  if (!arg) return null
  if (arg.type === 'Literal' && typeof arg.value === 'string') return arg.value
  if (arg.type === 'TemplateLiteral') {
    // `${BASE_URL}/loans/${id}`: a leading expression followed by a path is the base URL, not a path segment
    const leadingBase = arg.expressions.length > 0 && (arg.quasis[0].value.cooked ?? '') === '' && (arg.quasis[1]?.value.cooked ?? '').startsWith('/')
    let out = ''
    arg.quasis.forEach((q, i) => {
      out += q.value.cooked ?? ''
      if (i < arg.expressions.length && !(leadingBase && i === 0)) out += ':id'
    })
    return out
  }
  if (arg.type === 'BinaryExpression' && arg.operator === '+') {
    const left = urlFromArg(arg.left as TSESTree.Node)
    // BASE_URL + '/loans': an identifier/member on the left followed by a path literal is a base URL
    if (left === null) {
      const leftIsRef = arg.left.type === 'Identifier' || arg.left.type === 'MemberExpression'
      if (leftIsRef && arg.right.type === 'Literal' && typeof arg.right.value === 'string' && arg.right.value.startsWith('/')) return arg.right.value
      return null
    }
    const right = arg.right.type === 'Literal' && typeof arg.right.value === 'string' ? arg.right.value : ':id'
    return left + right
  }
  return null
}

function contains(outer: TSESTree.Node, inner: TSESTree.Node): boolean {
  return Boolean(outer.range && inner.range && outer.range[0] <= inner.range[0] && inner.range[1] <= outer.range[1])
}

interface PendingCall {
  node: TSESTree.CallExpression
  verb: string
  url: string
  varName: string | null
  optionsText: string
  line: number
}

const STATUS_MATCHERS = new Set(['toBe', 'toEqual', 'toStrictEqual'])

/** Extract HTTP calls made through Playwright's APIRequestContext, classified by expected outcome. */
export function extractPlaywrightEndpoints(source: string, filePath: string): EndpointCoverage[] {
  let ast: TSESTree.Program
  try {
    ast = parse(source, { loc: true, range: true, jsx: false })
  } catch {
    return []
  }
  const out: EndpointCoverage[] = []

  simpleTraverse(ast, {
    enter(node) {
      if (
        node.type !== 'CallExpression' ||
        node.callee.type !== 'Identifier' ||
        !['test', 'it'].includes(node.callee.name)
      ) return
      const nameArg = node.arguments[0]
      const callback = node.arguments[1]
      if (
        !nameArg || nameArg.type !== 'Literal' || typeof nameArg.value !== 'string' ||
        !callback || (callback.type !== 'ArrowFunctionExpression' && callback.type !== 'FunctionExpression') ||
        callback.body.type !== 'BlockStatement'
      ) return

      const testName = nameArg.value
      const body = callback.body
      const testSource = source.slice(body.range[0], body.range[1])
      const calls: PendingCall[] = []
      const asserts: Array<{ subject: TSESTree.Node; matcher: string; args: TSESTree.Node[]; negated: boolean }> = []

      simpleTraverse(body as TSESTree.Node, {
        enter(inner) {
          if (inner.type === 'CallExpression' && inner.callee.type === 'MemberExpression' && inner.callee.property.type === 'Identifier') {
            const prop = inner.callee.property.name
            if (HTTP_VERBS.has(prop) && isRequestReceiver(inner.callee.object as TSESTree.Node)) {
              const url = urlFromArg(inner.arguments[0] as TSESTree.Node | undefined)
              if (url !== null) {
                calls.push({
                  node: inner,
                  verb: prop.toUpperCase(),
                  url,
                  varName: null,
                  optionsText: inner.arguments[1] && inner.arguments[1].range ? source.slice(inner.arguments[1].range[0], inner.arguments[1].range[1]) : '',
                  line: inner.loc?.start.line ?? 0
                })
              }
            }
            // expect(<subject>).matcher(args) incl. .not / .resolves chains
            let obj: TSESTree.Node = inner.callee.object as TSESTree.Node
            let negated = false
            while (obj.type === 'MemberExpression') {
              if (obj.property.type === 'Identifier' && obj.property.name === 'not') negated = true
              obj = obj.object as TSESTree.Node
            }
            if (obj.type === 'CallExpression' && obj.callee.type === 'Identifier' && obj.callee.name === 'expect' && obj.arguments[0]) {
              asserts.push({ subject: obj.arguments[0] as TSESTree.Node, matcher: prop, args: inner.arguments as TSESTree.Node[], negated })
            }
          }
        }
      })

      // Resolve `const res = await request.get(...)` -> varName in a second pass (declarator precedes its init).
      simpleTraverse(body as TSESTree.Node, {
        enter(inner) {
          if (inner.type === 'VariableDeclarator' && inner.id.type === 'Identifier' && inner.init) {
            let init: TSESTree.Node = inner.init
            if (init.type === 'AwaitExpression') init = init.argument
            const match = calls.find(c => c.node === init)
            if (match) match.varName = inner.id.name
          }
        }
      })

      for (const call of calls) {
        let status: number | null = null
        for (const a of asserts) {
          const subjectText = a.subject.range ? source.slice(a.subject.range[0], a.subject.range[1]) : ''
          const tied = contains(a.subject, call.node) || (call.varName !== null && new RegExp(`\\b${call.varName}\\b`).test(subjectText))
          if (!tied || a.negated) continue // `.not.toBe(401)` says what the status is NOT
          const arg = a.args[0]
          if (STATUS_MATCHERS.has(a.matcher) && /status/i.test(subjectText) && arg?.type === 'Literal' && typeof arg.value === 'number') {
            status = arg.value
            break
          }
          if (a.matcher === 'toBeOK' || (/\.ok\s*\(\s*\)/.test(subjectText) && a.matcher === 'toBeTruthy')) status = status ?? 200
        }

        const kinds = classifyOutcome({ status, scenarioName: testName, contextText: `${call.optionsText}\n${testSource}` })
        out.push({
          verb: call.verb,
          path: call.url,
          file: filePath,
          line: call.line,
          scenarioName: testName,
          via: 'direct',
          kinds,
          status
        })
      }
    }
  })

  return out
}
