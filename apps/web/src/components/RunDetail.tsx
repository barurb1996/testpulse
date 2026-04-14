import { useEffect, useState, useMemo } from 'react'
import {
  fetchRegressions,
  fetchRunScenarios,
  type RegressionReport,
  type RunDetail as RunDetailData,
  type RunIssue,
  type ScenarioResult,
  type Severity
} from '../api.js'
import { RuleBreakdown } from './RuleBreakdown.js'
import { DomainBreakdown } from './DomainBreakdown.js'
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
  const [scenarios, setScenarios] = useState<ScenarioResult[]>([])
  const [counts, setCounts] = useState<{ pass: number; fail: number; skip: number; error: number } | null>(null)
  const [regressions, setRegressions] = useState<RegressionReport | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchRunScenarios(run.id)
      .then(r => {
        if (cancelled) return
        setScenarios(r.scenarios)
        setCounts(r.counts)
      })
      .catch(() => {})
    fetchRegressions(run.id)
      .then(r => { if (!cancelled) setRegressions(r) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [run.id])

  const failedScenarios = useMemo(
    () => scenarios.filter(s => s.status === 'fail' || s.status === 'error'),
    [scenarios]
  )

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
          {counts && counts.pass + counts.fail + counts.skip + counts.error > 0 && (
            <>
              <Stat label="Pass" value={counts.pass} tone="good" />
              <Stat label="Fail" value={counts.fail + counts.error} tone={(counts.fail + counts.error) > 0 ? 'bad' : 'good'} />
              {counts.skip > 0 && <Stat label="Skip" value={counts.skip} />}
            </>
          )}
        </div>
      </div>

      {regressions && (regressions.newFailures.length > 0 || regressions.fixed.length > 0) && (
        <div className="panel">
          <h2>Regressions vs previous run</h2>
          {regressions.newFailures.length > 0 && (
            <div className="regression-block new-failures">
              <h3>🔴 {regressions.newFailures.length} new failure{regressions.newFailures.length > 1 ? 's' : ''}</h3>
              <table>
                <thead><tr><th>Scenario</th><th>Suite / class</th><th>Previously</th><th>Failure</th></tr></thead>
                <tbody>
                  {regressions.newFailures.slice(0, 50).map((f, i) => (
                    <tr key={i}>
                      <td><strong>{f.name}</strong></td>
                      <td className="muted"><code>{f.classname ?? f.suite}</code></td>
                      <td><span className={`badge ${f.previousStatus === 'pass' ? 'info' : 'info'}`}>{f.previousStatus}</span></td>
                      <td className="muted small">{f.failureMessage ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {regressions.fixed.length > 0 && (
            <div className="regression-block fixed" style={{ marginTop: 16 }}>
              <h3>🟢 {regressions.fixed.length} fixed</h3>
              <table>
                <thead><tr><th>Scenario</th><th>Suite / class</th></tr></thead>
                <tbody>
                  {regressions.fixed.slice(0, 50).map((f, i) => (
                    <tr key={i}>
                      <td>{f.name}</td>
                      <td className="muted"><code>{f.classname ?? f.suite}</code></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {failedScenarios.length > 0 && (
        <div className="panel">
          <h2>Failed scenarios this run <span className="muted small">({failedScenarios.length})</span></h2>
          <table>
            <thead><tr><th>Scenario</th><th>Suite / class</th><th>Failure</th></tr></thead>
            <tbody>
              {failedScenarios.slice(0, 50).map(s => (
                <tr key={s.id}>
                  <td><strong>{s.name}</strong></td>
                  <td className="muted"><code>{s.classname ?? s.suite}</code></td>
                  <td className="muted small">{s.failureMessage ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <RuleBreakdown issues={visibleIssues} />
      <DomainBreakdown issues={visibleIssues} />

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
