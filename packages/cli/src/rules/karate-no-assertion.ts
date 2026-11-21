import type { Issue } from '../types.js'
import { isSetupFile } from './karate-setup.js'
import type { KarateScenario } from '../parsers/karate.js'
import { ASSERTION_TOKENS, type KarateProjectContext } from '../parsers/karate-project.js'
const HTTP_METHOD_STEP = /\bmethod\s+\w+/i
/** A call into project code we could not resolve (`call createFund {...}`, `callonce login`, `karate.call(...)`). */
const UNRESOLVED_CALL = /(?:^|\s|=)(?:call|callonce)\s+(?!read\b)[A-Za-z_$][\w.$]*|\bkarate\.call(?:Single)?\s*\(/
/** Mock-server scenarios are named after a matcher expression and answer requests instead of making them. */
const MOCK_SCENARIO_NAME = /^(?:pathMatches|methodIs|paramExists|paramValue|headerContains|bodyPath|typeContains)\s*\(/
const MOCK_STEP = /^(?:def\s+)?(?:response(?:Status|Headers|Delay)?|afterScenario)\s*=|^configure\s+cors\b/
const DRIVER_STEP = /^(?:click|input|submit|focus|mouse|keys|scroll|waitFor\w*|driver|screenshot)\b/
const VALIDATING_CALL = /\bcall\b.*\b\w*(validate|assert|check|verify|ensure)\w*/i

export function karateNoAssertion(
  scenario: KarateScenario,
  filePath: string,
  ctx?: KarateProjectContext
): Issue[] {
  if (scenario.steps.some(s => s.keyword === 'Then')) return []
  if (scenario.steps.some(s => ASSERTION_TOKENS.test(s.text))) return []

  if (ctx) {
    for (const ref of ctx.extractClasspathCalls(scenario)) {
      const resolved = ctx.resolveClasspath(filePath, ref)
      if (resolved && ctx.isFeatureAsserting(resolved)) return []
    }
    for (const id of ctx.extractHelperCalls(scenario)) {
      const resolved = ctx.resolveHelperCall(filePath, id)
      if (resolved && ctx.isFeatureAsserting(resolved)) return []
    }
  }

  if (scenario.steps.some(s => VALIDATING_CALL.test(s.text))) return []

  // Mock servers answer requests, they do not assert.
  if (MOCK_SCENARIO_NAME.test(scenario.name.trim()) || scenario.steps.some(s => MOCK_STEP.test(s.text.trim()))) return []

  const makesRequest = scenario.steps.some(s => HTTP_METHOD_STEP.test(s.text))
  const callsUnresolved = scenario.steps.some(s => UNRESOLVED_CALL.test(s.text))
  const drivesUi = scenario.steps.some(s => DRIVER_STEP.test(s.text.trim()))

  // A scenario that sends a request and checks nothing is the real finding. One that only sets data up or
  // calls project code we cannot see into (shared helper features usually assert inside) is a weaker signal.
  const setupFile = isSetupFile(filePath)
  if (!makesRequest || setupFile) {
    const why = callsUnresolved
      ? 'it only calls helpers or features that could not be resolved — verify they assert, or add a match/status'
      : drivesUi
        ? 'it only drives the browser — add a match/assert on the result'
        : setupFile
          ? 'it sits in a setup/helper file and checks nothing — if other features call it for data, tag it @ignore'
          : 'it sends no request and checks nothing — if this is setup for other scenarios, tag it @ignore'
    return [{
      rule: 'karate-no-assertion',
      severity: 'warning',
      message: `Scenario "${scenario.name}" has no visible assertion: ${why}`,
      line: scenario.line
    }]
  }

  return [{
    rule: 'karate-no-assertion',
    severity: 'critical',
    message: `Scenario "${scenario.name}" has no Then, no match/status/assert, and no resolvable call to an asserting helper — it will always pass`,
    line: scenario.line
  }]
}
