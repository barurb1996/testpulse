import { parse, simpleTraverse, type TSESTree } from '@typescript-eslint/typescript-estree'
import type { Issue } from '../types.js'
import { missingAwait } from '../rules/missing-await.js'
import { noCssSelector } from '../rules/no-css-selector.js'
import { noHardWait } from '../rules/no-hard-wait.js'
import { cucumberEmptyStepBody } from '../rules/cucumber-empty-step-body.js'
import { cucumberConsoleInStep } from '../rules/cucumber-console-in-step.js'

const CUCUMBER_HINTS = /from\s+['"]@cucumber\/cucumber['"]|require\s*\(\s*['"]@cucumber\/cucumber['"]|from\s+['"]playwright-bdd['"]/
const STEP_CALL_HINTS = /\b(Given|When|Then|And|But)\s*\(\s*[/'"]/

export function looksLikeCucumberStepFile(filePath: string, source: string): boolean {
  if (CUCUMBER_HINTS.test(source)) return true
  if (/\.steps?\.(ts|tsx|js|mjs|cjs)$/.test(filePath)) return true
  if (/\bsteps?\b[\\/]/.test(filePath) && STEP_CALL_HINTS.test(source)) return true
  return false
}

export function parseCucumberSteps(source: string, _filePath: string): Issue[] {
  const ast = parse(source, { loc: true, range: true, jsx: false })
  const issues: Issue[] = []

  simpleTraverse(ast, {
    enter(node: TSESTree.Node, parent: TSESTree.Node | undefined) {
      issues.push(...missingAwait(node, parent))
      issues.push(...noCssSelector(node))
      issues.push(...noHardWait(node))
      issues.push(...cucumberEmptyStepBody(node))
      issues.push(...cucumberConsoleInStep(node))
    }
  })

  return issues
}
