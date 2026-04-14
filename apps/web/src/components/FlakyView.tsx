import { useEffect, useState } from 'react'
import { fetchFlaky, type FlakyReport, type FlakyScenario } from '../api.js'

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
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!project) return
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchFlaky(project)
      .then(r => { if (!cancelled) setReport(r) })
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

  if (report.flaky.length === 0) {
    return (
      <div className="panel empty">
        <p>
          Good news — no flaky scenarios detected across {report.totalScenariosTracked} tracked tests
          (minimum {report.minRuns} runs to qualify).
        </p>
      </div>
    )
  }

  const totalFlips = report.flaky.reduce((a, f) => a + f.flipCount, 0)

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
    </>
  )
}

function FlakyRow({ f }: { f: FlakyScenario }) {
  const [open, setOpen] = useState(false)
  const tone = passRateTone(f.passRate)

  return (
    <>
      <tr className="flaky-row" onClick={() => setOpen(!open)}>
        <td><strong>{f.name}</strong></td>
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
