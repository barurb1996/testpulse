import { useState, useMemo } from 'react'
import type { RunDetail as RunDetailData, RunIssue, Severity } from '../api.js'
import { RuleBreakdown } from './RuleBreakdown.js'
import { ConfirmIgnoreModal } from './ConfirmIgnoreModal.js'

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

export function RunDetail({
  data,
  onClose,
  onIgnore
}: {
  data: RunDetailData
  onClose: () => void
  onIgnore: (issue: RunIssue, reason: string) => Promise<void>
}) {
  const { run, issues } = data
  const [showIgnored, setShowIgnored] = useState(false)
  const [pending, setPending] = useState<RunIssue | null>(null)

  const visibleIssues = useMemo(() => showIgnored ? issues : issues.filter(i => !i.isIgnored), [issues, showIgnored])
  const ignoredCount = issues.filter(i => i.isIgnored).length
  const sev = countBy(visibleIssues, i => i.severity)

  const byRule = new Map<string, RunIssue[]>()
  for (const issue of visibleIssues) {
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

  async function handleConfirm(reason: string) {
    if (!pending) return
    await onIgnore(pending, reason)
    setPending(null)
  }

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
          <div className="run-actions">
            {ignoredCount > 0 && (
              <label className="toggle">
                <input type="checkbox" checked={showIgnored} onChange={e => setShowIgnored(e.target.checked)} />
                <span>Show {ignoredCount} ignored</span>
              </label>
            )}
            <button className="ghost" onClick={onClose}>close</button>
          </div>
        </div>

        <div className="stat-row">
          <Stat label="Score" value={`${run.score}/100`} tone={run.score >= 80 ? 'good' : run.score >= 50 ? 'warn' : 'bad'} />
          <Stat label="Files" value={run.filesScanned} />
          <Stat label="Critical" value={sev.critical ?? 0} tone={(sev.critical ?? 0) > 0 ? 'bad' : 'good'} />
          <Stat label="Warning" value={sev.warning ?? 0} tone={(sev.warning ?? 0) > 0 ? 'warn' : 'good'} />
          <Stat label="Info" value={sev.info ?? 0} />
        </div>
      </div>

      <RuleBreakdown issues={visibleIssues} />

      <div className="panel">
        <h2>Issues</h2>
        {ruleGroups.length === 0 ? (
          <div className="empty">
            {issues.length === 0 ? 'No issues in this run.' : 'All issues are ignored — toggle above to see them.'}
          </div>
        ) : (
          ruleGroups.map(([rule, list]) => (
            <RuleGroup
              key={rule}
              rule={rule}
              list={list}
              onIgnoreClick={setPending}
            />
          ))
        )}
      </div>

      {pending && (
        <ConfirmIgnoreModal
          issue={pending}
          onCancel={() => setPending(null)}
          onConfirm={handleConfirm}
        />
      )}
    </>
  )
}

function RuleGroup({
  rule,
  list,
  onIgnoreClick
}: {
  rule: string
  list: RunIssue[]
  onIgnoreClick: (issue: RunIssue) => void
}) {
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
            <li key={idx} className={i.isIgnored ? 'ignored' : ''}>
              <div className="issue-row">
                <div className="issue-text">
                  <code className="file">{stripCwd(i.file)}</code><span className="muted">:{i.line}</span>
                  <div className="issue-msg">{i.message}</div>
                </div>
                {!i.isIgnored && i.fingerprint && (
                  <button
                    className="ghost small"
                    onClick={(e) => { e.stopPropagation(); onIgnoreClick(i) }}
                    title={`Ignore this issue · fingerprint ${i.fingerprint}`}
                  >
                    Ignore
                  </button>
                )}
                {i.isIgnored && <span className="badge info">ignored</span>}
              </div>
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
