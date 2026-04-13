import { useState } from 'react'
import type { RunDetail as RunDetailData, RunIssue, Severity } from '../api.js'
import { RuleBreakdown } from './RuleBreakdown.js'

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2 }

function countBy<T, K extends string>(arr: T[], key: (t: T) => K): Record<K, number> {
  const out = {} as Record<K, number>
  for (const item of arr) {
    const k = key(item)
    out[k] = (out[k] ?? 0) + 1
  }
  return out
}

function stripCwd(file: string): string {
  const idx = file.indexOf('/src/')
  return idx >= 0 ? '...' + file.slice(idx) : file
}

export function RunDetail({ data, onClose }: { data: RunDetailData; onClose: () => void }) {
  const { run, issues } = data
  const sev = countBy(issues, i => i.severity)

  const byRule = new Map<string, RunIssue[]>()
  for (const issue of issues) {
    const bucket = byRule.get(issue.rule) ?? []
    bucket.push(issue)
    byRule.set(issue.rule, bucket)
  }
  const ruleGroups = Array.from(byRule.entries())
    .sort(([, a], [, b]) => {
      const sevDiff = SEVERITY_ORDER[a[0].severity] - SEVERITY_ORDER[b[0].severity]
      if (sevDiff !== 0) return sevDiff
      return b.length - a.length
    })

  return (
    <>
      <div className="panel run-summary">
        <div className="run-summary-header">
          <div>
            <h2>Run detail</h2>
            <div className="muted small">
              {new Date(run.createdAt).toLocaleString()}
              {run.branch && <> · <code>{run.branch}</code></>}
              {run.commitSha && <> · <code>{run.commitSha.slice(0, 7)}</code></>}
            </div>
          </div>
          <button className="ghost" onClick={onClose}>close</button>
        </div>

        <div className="stat-row">
          <Stat label="Score" value={`${run.score}/100`} tone={run.score >= 80 ? 'good' : run.score >= 50 ? 'warn' : 'bad'} />
          <Stat label="Files" value={run.filesScanned} />
          <Stat label="Critical" value={sev.critical ?? 0} tone={(sev.critical ?? 0) > 0 ? 'bad' : 'good'} />
          <Stat label="Warning" value={sev.warning ?? 0} tone={(sev.warning ?? 0) > 0 ? 'warn' : 'good'} />
          <Stat label="Info" value={sev.info ?? 0} />
        </div>
      </div>

      <RuleBreakdown issues={issues} />

      <div className="panel">
        <h2>Issues</h2>
        {ruleGroups.length === 0 ? (
          <div className="empty">No issues in this run.</div>
        ) : (
          ruleGroups.map(([rule, list]) => (
            <RuleGroup key={rule} rule={rule} list={list} />
          ))
        )}
      </div>
    </>
  )
}

function RuleGroup({ rule, list }: { rule: string; list: RunIssue[] }) {
  const [open, setOpen] = useState(true)
  const severity = list[0].severity
  return (
    <div className={`rule-group ${severity}`}>
      <div className="rule-group-header" onClick={() => setOpen(!open)}>
        <span className={`badge ${severity}`}>{severity}</span>
        <code>{rule}</code>
        <span className="muted">{list.length} {list.length === 1 ? 'issue' : 'issues'}</span>
        <span className="chevron">{open ? '▾' : '▸'}</span>
      </div>
      {open && (
        <ul className="issue-list">
          {list.map((i, idx) => (
            <li key={idx}>
              <code className="file">{stripCwd(i.file)}</code><span className="muted">:{i.line}</span>
              <div className="issue-msg">{i.message}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: 'good' | 'warn' | 'bad' }) {
  return (
    <div className={`stat ${tone ?? ''}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  )
}
