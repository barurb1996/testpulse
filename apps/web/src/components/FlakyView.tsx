import { useEffect, useState } from 'react'
import {
  fetchFlaky,
  fetchSlowest,
  type FlakyReport,
  type FlakyScenario,
  type SlowScenario
} from '../api.js'

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`
}

function statusGlyph(status: string): string {
  if (status === 'pass') return '✓'
  if (status === 'fail' || status === 'error') return '✗'
  if (status === 'skip') return '○'
  return '?'
}

function statusClass(status: string): string {
  if (status === 'pass') return 'good'
  if (status === 'fail' || status === 'error') return 'bad'
  return 'muted'
}

function passRateTone(p: number): 'good' | 'warn' | 'bad' {
  if (p >= 90) return 'good'
  if (p >= 60) return 'warn'
  return 'bad'
}

export function FlakyView({ project }: { project: string }) {
  const [report, setReport] = useState<FlakyReport | null>(null)
  const [slowest, setSlowest] = useState<SlowScenario[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!project) return
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([
      fetchFlaky(project),
      fetchSlowest(project).then(r => r.slowest).catch(() => [] as SlowScenario[])
    ])
      .then(([r, s]) => { if (cancelled) return; setReport(r); setSlowest(s) })
      .catch(e => { if (!cancelled) setError(String(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [project])

  if (loading && !report) return <div className="empty">Loading flaky analysis…</div>
  if (error) return <div className="error">Failed to load flaky: {error}</div>
  if (!report) return null

  if (report.totalScenariosTracked === 0) {
    return (
      <div className="panel empty coverage-empty">
        <h2>No scenario run history yet</h2>
        <p className="muted">
          Flaky detection needs test outcomes. Push JUnit XML alongside your next analysis:
        </p>
        <pre className="command">testpulse ./tests \
  --junit &apos;**/target/karate-reports/junit-*.xml&apos; \
  --push http://localhost:3001 \
  --project {project}</pre>
        <p className="muted small">
          Karate, Cucumber JS/Java, and Playwright all emit JUnit XML. Point <code>--junit</code> at any glob that matches them.
        </p>
      </div>
    )
  }

  const totalFlips = report.flaky.reduce((a, f) => a + f.flipCount, 0)
  const hasFlaky = report.flaky.length > 0

  return (
    <>
      <div className="panel hero">
        <div className="hero-label muted small">Flaky detection</div>
        <div className="stat-row">
          <HeroStat label="Flaky scenarios" value={report.flaky.length} tone={report.flaky.length > 0 ? 'bad' : 'good'} big />
          <HeroStat label="Total flip events" value={totalFlips} tone="warn" />
          <HeroStat label="Tracked scenarios" value={report.totalScenariosTracked} />
          <HeroStat label="Min runs to qualify" value={report.minRuns} />
        </div>
      </div>

      {hasFlaky ? (
        <div className="panel">
          <h2>Flaky scenarios <span className="muted small">(most flips first)</span></h2>
          <table>
            <thead>
              <tr>
                <th>Scenario</th>
                <th>Suite / class</th>
                <th className="num">Runs</th>
                <th className="num">Pass / Fail</th>
                <th className="num">Pass rate</th>
                <th className="num">Flips</th>
                <th>History (oldest → newest)</th>
              </tr>
            </thead>
            <tbody>
              {report.flaky.map((f, idx) => <FlakyRow key={idx} f={f} />)}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="panel empty">
          <p>No flaky scenarios detected across {report.totalScenariosTracked} tracked tests.</p>
        </div>
      )}

      {slowest.length > 0 && (
        <div className="panel">
          <h2>Slowest scenarios <span className="muted small">(top {slowest.length} by avg duration)</span></h2>
          <table>
            <thead>
              <tr>
                <th>Scenario</th>
                <th>Suite / class</th>
                <th className="num">Runs</th>
                <th className="num">Avg</th>
                <th className="num">p95</th>
                <th className="num">Max</th>
              </tr>
            </thead>
            <tbody>
              {slowest.map((s, i) => (
                <tr key={i}>
                  <td>
                    <strong>{s.name}</strong>
                    {s.fails > 0 && <span className="muted small"> · {s.fails} fail{s.fails > 1 ? 's' : ''}</span>}
                  </td>
                  <td className="muted"><code>{s.classname ?? s.suite}</code></td>
                  <td className="num">{s.appearances}</td>
                  <td className="num"><strong>{formatDuration(s.avgMs)}</strong></td>
                  <td className="num muted">{formatDuration(s.p95Ms)}</td>
                  <td className="num muted">{formatDuration(s.maxMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

function shortHint(rule: string): string {
  if (rule === 'karate-configure-retry-in-scenario') return 'retry cfg'
  if (rule === 'karate-excessive-retry-window') return 'long retry'
  if (rule === 'karate-retry-plus-sleep') return 'retry+sleep'
  if (rule === 'karate-explicit-sleep') return 'sleep'
  return rule
}

function FlakyRow({ f }: { f: FlakyScenario }) {
  const [open, setOpen] = useState(false)
  const tone = passRateTone(f.passRate)

  return (
    <>
      <tr className="flaky-row" onClick={() => setOpen(!open)}>
        <td>
          <strong>{f.name}</strong>
          {f.staticHints && f.staticHints.length > 0 && (
            <div className="hint-row">
              {f.staticHints.map(h => (
                <span key={h} className="hint-pill" title={h}>{shortHint(h)}</span>
              ))}
            </div>
          )}
        </td>
        <td className="muted">
          {f.classname && <><code>{f.classname}</code><br /></>}
          <code>{f.suite}</code>
        </td>
        <td className="num">{f.appearances}</td>
        <td className="num">{f.passes} / {f.fails}</td>
        <td className="num"><span className={`score ${tone === 'good' ? 'high' : tone === 'warn' ? 'med' : 'low'}`}>{f.passRate}%</span></td>
        <td className="num"><strong>{f.flipCount}</strong></td>
        <td className="flaky-history">
          {f.history.slice(-20).map((h, i) => (
            <span key={i} className={`flaky-dot ${statusClass(h.status)}`} title={`${h.status} · ${new Date(h.createdAt).toLocaleString()}`}>
              {statusGlyph(h.status)}
            </span>
          ))}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={7}>
            <div className="flaky-expand">
              <div className="muted small" style={{ marginBottom: 6 }}>Latest failures:</div>
              {f.history.filter(h => h.status === 'fail' || h.status === 'error').slice(-3).reverse().map((h, i) => (
                <div key={i} className="flaky-failure">
                  <code className="muted small">{new Date(h.createdAt).toLocaleString()}</code>
                  {h.failureMessage && <div>{h.failureMessage}</div>}
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function HeroStat({ label, value, tone, big }: { label: string; value: string | number; tone?: 'good' | 'warn' | 'bad'; big?: boolean }) {
  return (
    <div className={`stat ${tone ?? ''} ${big ? 'big' : ''}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  )
}
