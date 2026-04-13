import { parse } from '@typescript-eslint/typescript-estree'
import { simpleTraverse } from '@typescript-eslint/typescript-estree'
import type { Issue } from '../types.js'
import { noHardWait } from '../rules/no-hard-wait.js'
import { noAssertion } from '../rules/no-assertion.js'

export function parsePlaywright(source: string, filePath: string): Issue[] {
  const ast = parse(source, {
    loc: true,
    range: true,
    jsx: false,
  })

  const issues: Issue[] = []

  simpleTraverse(ast, {
    enter(node) {
      issues.push(...noHardWait(node))
      issues.push(...noAssertion(node))
    }
  })

  return issues
}
