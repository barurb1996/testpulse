import { useEffect, useState } from 'react'
import {
  fetchBranchComparison,
  fetchBranches,
  type BranchComparison,
  type BranchSummary
} from '../api.js'

function formatDelta(delta: number, suffix = ''): string {
  if (delta === 0) return `0${suffix}`
  return `${delta > 0 ? '+' : ''}${delta}${suffix}`
}

function toneForDelta(delta: number | null, bigger_is_better: boolean): 'good' | 'warn' | 'bad' | '' {
  if (delta === null) return ''
  if (delta === 0) return ''
  const good = bigger_is_better ? delta > 0 : delta < 0
  return good ? 'good' : 'bad'
}

export function BranchCompare({ project }: { project: string }) {
  const [open, setOpen] = useState(false)
  const [branches, setBranches] = useState<BranchSummary[]>([])
  const [base, setBase] = useState<string>('')
  const [compare, setCompare] = useState<string>('')
  const [report, setReport] = useState<BranchComparison | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || !project) return
    fetchBranches(project).then(bs => {
      setBranches(bs)
      if (bs.length >= 2) {
        setBase(prev => prev || bs[1].branch)
        setCompare(prev => prev || bs[0].branch)
      }
    }).catch(e => setError(String(e)))
  }, [open, project])

  useEffect(() => {
    if (!open || !project || !base || !compare || base === compare) { setReport(null); return }
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchBranchComparison(project, base, compare)
      .then(r => { if (!cancelled) setReport(r) })
      .catch(e => { if (!cancelled) setError(String(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, project, base, compare])

  return (
    <div className="panel">
      <div className="gap-advanced-toggle">
        <button className="ghost small" onClick={() => setOpen(!open)}>
          {open ? '▾' : '▸'} Branch comparison
        </button>
      </div>
      {open && (
        <div className="gap-advanced">
          {branches.length < 2 ? (
            <div className="muted small">At least 2 branches with runs are required to compare. Found: {branches.length}.</div>
          ) : (
            <>
              <div className="branch-selectors">
                <label className="field" style={{ margin: 0 }}>
                  <span className="field-label">Base</span>
                  <select value={base} onChange={e => setBase(e.target.value)}>
                    {branches.map(b => <option key={b.branch} value={b.branch}>{b.branch} ({b.runCount} runs)</option>)}
                  </select>
                </label>
                <label className="field" style={{ margin: 0 }}>
                  <span className="field-label">Compare</span>
                  <select value={compare} onChange={e => setCompare(e.target.value)}>
                    {branches.map(b => <option key={b.branch} value={b.branch}>{b.branch} ({b.runCount} runs)</option>)}
                  </select>
                </label>
              </div>

              {loading && <div className="empty">Loading comparison…</div>}
              {error && <div className="error">{error}</div>}
              {report && !report.error && <ComparisonView report={report} />}
              {report && report.error && <div className="muted">{report.error}</div>}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function ComparisonView({ report }: { report: BranchComparison }) {
  const scoreDelta = report.compare.score - report.base.score
  const healthDelta = (report.compare.healthScore ?? 0) - (report.base.healthScore ?? 0)
  const criticalsDelta = report.compare.criticals - report.base.criticals
  const coverageDelta = report.compare.coveragePercent !== null && report.base.coveragePercent !== null
    ? report.compare.coveragePercent - report.base.coveragePercent
    : null

  const sc = report.scenarioChanges

  return (
    <div>
      <div className="branch-headers">
        <div>
          <div className="muted small">Base</div>
          <strong>{report.base.branch}</strong>
          <div className="muted small">{new Date(report.base.createdAt).toLocaleDateString()}</div>
        </div>
        <div>
          <div className="muted small">Compare</div>
          <strong>{report.compare.branch}</strong>
          <div className="muted small">{new Date(report.compare.createdAt).toLocaleDateString()}</div>
        </div>
        <div className="muted small branch-delta-label">Δ</div>
      </div>

      <table className="branch-compare-table">
        <tbody>
          <MetricRow label="Static score" baseVal={`${report.base.score}/100`} compareVal={`${report.compare.score}/100`} delta={scoreDelta} tone={toneForDelta(scoreDelta, true)} />
          <MetricRow label="Health score" baseVal={report.base.healthScore !== null ? `${report.base.healthScore}/100` : '—'} compareVal={report.compare.healthScore !== null ? `${report.compare.healthScore}/100` : '—'} delta={healthDelta} tone={toneForDelta(healthDelta, true)} />
          <MetricRow label="Coverage" baseVal={report.base.coveragePercent !== null ? `${report.base.coveragePercent}%` : '—'} compareVal={report.compare.coveragePercent !== null ? `${report.compare.coveragePercent}%` : '—'} delta={coverageDelta} tone={toneForDelta(coverageDelta, true)} suffix="%" />
          <MetricRow label="Criticals" baseVal={String(report.base.criticals)} compareVal={String(report.compare.criticals)} delta={criticalsDelta} tone={toneForDelta(criticalsDelta, false)} />
        </tbody>
      </table>

      {(sc.newFailures.length > 0 || sc.fixed.length > 0) && (
        <div style={{ marginTop: 16 }}>
          {sc.newFailures.length > 0 && (
            <div className="regression-block new-failures">
              <h3>🔴 {sc.newFailures.length} scenarios failing on {report.compare.branch} but not on {report.base.branch}</h3>
              <ul className="digest-list">
                {sc.newFailures.slice(0, 10).map((f, i) => <li key={i}>{f.name} <span className="muted small">— {f.classname ?? f.suite}</span></li>)}
              </ul>
            </div>
          )}
          {sc.fixed.length > 0 && (
            <div className="regression-block fixed" style={{ marginTop: 12 }}>
              <h3>🟢 {sc.fixed.length} scenarios passing on {report.compare.branch} that failed on {report.base.branch}</h3>
              <ul className="digest-list">
                {sc.fixed.slice(0, 10).map((f, i) => <li key={i}>{f.name} <span className="muted small">— {f.classname ?? f.suite}</span></li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {(sc.slower.length > 0 || sc.faster.length > 0) && (
        <div style={{ marginTop: 16 }}>
          <div className="muted small"><strong>Timing changes</strong></div>
          <ul className="digest-list">
            {sc.slower.slice(0, 5).map((t, i) => <li key={`s${i}`}>🐢 {t.name} — <span className="score low">+{t.deltaMs}ms</span></li>)}
            {sc.faster.slice(0, 5).map((t, i) => <li key={`f${i}`}>🐇 {t.name} — <span className="score high">{t.deltaMs}ms</span></li>)}
          </ul>
        </div>
      )}
    </div>
  )
}

function MetricRow({ label, baseVal, compareVal, delta, tone, suffix }: { label: string; baseVal: string; compareVal: string; delta: number | null; tone: 'good' | 'warn' | 'bad' | ''; suffix?: string }) {
  return (
    <tr>
      <td className="muted">{label}</td>
      <td className="num">{baseVal}</td>
      <td className="num"><strong>{compareVal}</strong></td>
      <td className="num">
        {delta === null ? <span className="muted">—</span> : (
          <span className={tone === 'good' ? 'score high' : tone === 'bad' ? 'score low' : 'muted'}>
            {formatDelta(delta, suffix ?? '')}
          </span>
        )}
      </td>
    </tr>
  )
}
