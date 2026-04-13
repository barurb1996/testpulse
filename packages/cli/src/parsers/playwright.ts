import { parse } from '@typescript-eslint/typescript-estree'
import { simpleTraverse } from '@typescript-eslint/typescript-estree'
import type { Issue } from '../types.js'
import { noHardWait } from '../rules/no-hard-wait.js'
import { noAssertion } from '../rules/no-assertion.js'
import { noCssSelector } from '../rules/no-css-selector.js'
import { noGenericName } from '../rules/no-generic-name.js'
import { missingAwait } from '../rules/missing-await.js'
import { playwrightTestOnly } from '../rules/playwright-test-only.js'
import { playwrightConditionalInTest } from '../rules/playwright-conditional-in-test.js'
import { playwrightHardcodedTimeout } from '../rules/playwright-hardcoded-timeout.js'

export function parsePlaywright(source: string, filePath: string): Issue[] {
  const ast = parse(source, {
    loc: true,
    range: true,
    jsx: false,
  })

  const issues: Issue[] = []

  simpleTraverse(ast, {
    enter(node, parent) {
      issues.push(...noHardWait(node))
      issues.push(...noAssertion(node))
      issues.push(...noCssSelector(node))
      issues.push(...noGenericName(node))
      issues.push(...missingAwait(node, parent))
      issues.push(...playwrightTestOnly(node))
      issues.push(...playwrightConditionalInTest(node))
      issues.push(...playwrightHardcodedTimeout(node))
    }
  })

  return issues
}
