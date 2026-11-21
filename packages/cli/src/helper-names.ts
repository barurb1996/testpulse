/**
 * Names projects give to their shared-helper namespaces (`helpers.sleep()`, `utils.pause()`, `fixtures.x`).
 * Matching is case-insensitive and whole-word, so `Utils`, `testUtils` is NOT matched but `utils` and `HelperFunctions` are.
 */
export const HELPER_NAMESPACES = [
  'helpers', 'helper', 'helperFunctions', 'helperFunction', 'helperFns',
  'utils', 'util', 'utilities', 'tools', 'tool', 'fixtures', 'fixture',
  'support', 'common', 'commons', 'lib'
]

const NS = HELPER_NAMESPACES.join('|')

/** Methods that, called on a helper namespace, mean "wait a fixed time". */
export const SLEEP_METHODS = ['sleep', 'pause', 'delay']

/** Source fragment matching `<namespace>.sleep(` and friends. */
export const HELPER_SLEEP_SOURCE = `\\b(?:${NS})\\.(?:${SLEEP_METHODS.join('|')})\\s*\\(`

export const HELPER_SLEEP_RE = new RegExp(HELPER_SLEEP_SOURCE, 'i')

const NS_SET = new Set(HELPER_NAMESPACES.map(n => n.toLowerCase()))
export function isHelperNamespace(name: string): boolean {
  return NS_SET.has(name.toLowerCase())
}
export function isSleepMethod(name: string): boolean {
  return SLEEP_METHODS.includes(name.toLowerCase())
}
