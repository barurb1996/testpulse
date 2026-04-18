import { pgTable, uuid, text, integer, timestamp, jsonb } from 'drizzle-orm/pg-core'

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  slackWebhookUrl: text('slack_webhook_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
})

export const runs = pgTable('runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  commitSha: text('commit_sha'),
  branch: text('branch'),
  score: integer('score').notNull(),
  totalIssues: integer('total_issues').notNull(),
  criticalIssues: integer('critical_issues').notNull(),
  filesScanned: integer('files_scanned').notNull(),
  healthScore: integer('health_score'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
})

export const issues = pgTable('issues', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id').notNull().references(() => runs.id, { onDelete: 'cascade' }),
  file: text('file').notNull(),
  line: integer('line').notNull(),
  rule: text('rule').notNull(),
  severity: text('severity').notNull(),
  message: text('message').notNull(),
  fingerprint: text('fingerprint'),
  scenarioName: text('scenario_name'),
  raw: jsonb('raw')
})

export const runEndpoints = pgTable('run_endpoints', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id').notNull().references(() => runs.id, { onDelete: 'cascade' }),
  verb: text('verb').notNull(),
  path: text('path').notNull(),
  file: text('file'),
  line: integer('line'),
  scenarioName: text('scenario_name')
})

export const scenarioRuns = pgTable('scenario_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id').notNull().references(() => runs.id, { onDelete: 'cascade' }),
  suite: text('suite').notNull(),
  name: text('name').notNull(),
  classname: text('classname'),
  status: text('status').notNull(),
  durationMs: integer('duration_ms'),
  failureMessage: text('failure_message'),
  failureDetail: text('failure_detail')
})

export const coverageTargets = pgTable('coverage_targets', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  verb: text('verb').notNull(),
  path: text('path').notNull(),
  operationId: text('operation_id'),
  summary: text('summary'),
  domain: text('domain'),
  source: text('source').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
})

export const gapSuggestions = pgTable('gap_suggestions', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  targetId: uuid('target_id').notNull().references(() => coverageTargets.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  rationale: text('rationale'),
  severity: text('severity').notNull(),
  steps: jsonb('steps').notNull(),
  endpointHash: text('endpoint_hash').notNull(),
  model: text('model'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
})

export const apiTokens = pgTable('api_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  name: text('name').notNull(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
})

export const ignores = pgTable('ignores', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  fingerprint: text('fingerprint').notNull(),
  rule: text('rule'),
  file: text('file'),
  line: integer('line'),
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
})

export type Project = typeof projects.$inferSelect
export type Run = typeof runs.$inferSelect
export type Issue = typeof issues.$inferSelect
export type Ignore = typeof ignores.$inferSelect
export type RunEndpoint = typeof runEndpoints.$inferSelect
export type ScenarioRun = typeof scenarioRuns.$inferSelect
export type CoverageTarget = typeof coverageTargets.$inferSelect
export type GapSuggestion = typeof gapSuggestions.$inferSelect
