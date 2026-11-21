/** Files that are conventionally called by other features to prepare data, not tests of their own. */
export const SETUP_PATH = /(?:^|[\\/._-])(?:[Ii]nit|[Ss]etup|[Uu]tils?|[Rr]eusable|[Cc]ommon|[Hh]elpers?|[Pp]rerequisites?|[Ff]ixtures?)(?:[\\/._-]|[A-Z]|$)/

/**
 * Imperative scenario names ("Create item", "clean test instance") describe preparing or tearing down state.
 * Descriptive names ("creates a user") describe behaviour under test, so they do not match.
 */
export const SETUP_NAME = /^\s*(?:create|add|clean|cleanup|init|initialize|initialise|setup|set up|prepare|seed|load|import|register|delete|remove|reset|login|authenticate)\b/i

export function isSetupFile(filePath: string): boolean {
  return SETUP_PATH.test(filePath.split(/[\\/]/).slice(-3).join('/'))
}
