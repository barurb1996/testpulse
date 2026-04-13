import { pgTable, uuid, text, integer, timestamp, jsonb } from 'drizzle-orm/pg-core'

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
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
  raw: jsonb('raw')
})

export type Project = typeof projects.$inferSelect
export type Run = typeof runs.$inferSelect
export type Issue = typeof issues.$inferSelect
