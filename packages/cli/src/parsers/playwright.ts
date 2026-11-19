import { parse, simpleTraverse } from '@typescript-eslint/typescript-estree'
import type { Issue } from '../types.js'
import { noHardWait } from '../rules/no-hard-wait.js'
import { noAssertion } from '../rules/no-assertion.js'
import { noCssSelector } from '../rules/no-css-selector.js'
import { noGenericName } from '../rules/no-generic-name.js'
import { missingAwait } from '../rules/missing-await.js'
import { playwrightTestOnly } from '../rules/playwright-test-only.js'
import { playwrightConditionalInTest } from '../rules/playwright-conditional-in-test.js'
import { playwrightHardcodedTimeout } from '../rules/playwright-hardcoded-timeout.js'
import { tautologicalAssertion } from '../rules/tautological-assertion.js'
import { swallowedError } from '../rules/swallowed-error.js'
import { commentedOutAssertion } from '../rules/commented-out-assertion.js'
import { weakAssertionOnly } from '../rules/weak-assertion-only.js'
import { snapshotOnly } from '../rules/snapshot-only.js'
import { happyPathOnly } from '../rules/happy-path-only.js'
import { nameBodyMismatch } from '../rules/name-body-mismatch.js'
import { copyPasteVariant } from '../rules/copy-paste-variant.js'
import { extractTestCases } from './playwright-model.js'
import { extractPlaywrightEndpoints } from './playwright-api.js'

export function parsePlaywright(source: string, filePath: string): Issue[] {
  const ast = parse(source, {
    loc: true,
    range: true,
    jsx: false,
  })

  const issues: Issue[] = []

  // Per-node rules — run on every AST node
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
      issues.push(...tautologicalAssertion(node))
      issues.push(...swallowedError(node, parent as import('@typescript-eslint/typescript-estree').TSESTree.Node | undefined, source))
    }
  })

  // Source-level rules (regex on raw text)
  issues.push(...commentedOutAssertion(source))

  // Test-level rules — need TestCase model
  const testCases = extractTestCases(ast, source)
  for (const tc of testCases) {
    issues.push(...weakAssertionOnly(tc))
    issues.push(...snapshotOnly(tc))
    issues.push(...nameBodyMismatch(tc))
  }

  // File-level rules — need all test cases at once
  if (testCases.length > 0) {
    issues.push(...happyPathOnly(testCases, filePath, extractPlaywrightEndpoints(source, filePath)))
    issues.push(...copyPasteVariant(testCases, filePath))
  }

  return issues
}
