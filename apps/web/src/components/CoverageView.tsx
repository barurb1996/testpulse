import { useCallback, useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import {
  fetchCoverage,
  fetchCoverageTrend,
  fetchGapSuggestions,
  runGapAnalysis,
  type CoverageReport,
  type CoverageTrendPoint,
  type GapAnalyzeResult,
  type GapSuggestion
} from '../api.js'
import { GapSuggestionsPanel } from './GapSuggestionsPanel.js'
import { CoverageTrendChart } from './CoverageTrendChart.js'

function percentTone(p: number): 'good' | 'warn' | 'bad' {
  if (p >= 80) return 'good'
  if (p >= 50) return 'warn'
  return 'bad'
}

export function CoverageView({ project }: { project: string }) {
  const [report, setReport] = useState<CoverageReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const [suggestions, setSuggestions] = useState<GapSuggestion[]>([])
  const [analysisRunning, setAnalysisRunning] = useState(false)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<GapAnalyzeResult | null>(null)
  const [blockedPaths, setBlockedPaths] = useState<string[]>([])
  const [trend, setTrend] = useState<CoverageTrendPoint[]>([])

  const reloadSuggestions = useCallback(async () => {
    if (!project) return
    try {
      const list = await fetchGapSuggestions(project)
      setSuggestions(list)
    } catch { /* non-fatal */ }
  }, [project])

  useEffect(() => {
    if (!project) return
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([
      fetchCoverage(project),
      fetchGapSuggestions(project).catch(() => [] as GapSuggestion[]),
      fetchCoverageTrend(project).catch(() => [] as CoverageTrendPoint[])
    ])
      .then(([r, s, t]) => {
        if (cancelled) return
        setReport(r)
        setSuggestions(s)
        setTrend(t)
      })
      .catch(e => { if (!cancelled) setError(String(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [project])

  async function onAnalyze(opts: { forceRefresh?: boolean; dryRun?: boolean }) {
    if (!project || analysisRunning) return
    setAnalysisRunning(true)
    setAnalysisError(null)
    try {
      const result = await runGapAnalysis(project, {
        forceRefresh: opts.forceRefresh,
        dryRun: opts.dryRun,
        blockedPaths: blockedPaths.length > 0 ? blockedPaths : undefined
      })
      setLastResult(result)
      if (result.error) setAnalysisError(result.error)
      if (!opts.dryRun) await reloadSuggestions()
    } catch (e) {
      setAnalysisError(String(e))
    } finally {
      setAnalysisRunning(false)
    }
  }

  if (loading && !report) return <div className="empty">Loading coverage…</div>
  if (error) return <div className="error">Failed to load coverage: {error}</div>
  if (!report) return null

  if (report.stats.totalTargets === 0) {
    return (
      <div className="panel empty coverage-empty">
        <h2>No coverage targets yet</h2>
        <p className="muted">
          Upload an OpenAPI / Swagger spec to start measuring coverage:
        </p>
        <pre className="command">
          testpulse ingest-openapi ./openapi.yaml \
{'\n    '}--push http://localhost:3001 \
{'\n    '}--project {project}
        </pre>
        <p className="muted small">
          The spec's operations (tagged by the first path segment or the <code>tags</code> field) become the target surface.
          Each pushed run's extracted endpoints — including those reached transitively through Karate helpers — are matched against it.
        </p>
      </div>
    )
  }

  const { stats, byDomain, uncovered, covered, orphans } = report
  const tone = percentTone(stats.coveragePercent)

  const chartData = byDomain.map(d => ({
    domain: d.domain,
    covered: d.covered,
    uncovered: d.total - d.covered
  }))

  return (
    <>
      <div className="panel hero">
        <div className="hero-label muted small">Coverage</div>
        <div className="stat-row">
          <HeroStat label="Covered" value={`${stats.coveragePercent}%`} tone={tone} big />
          <HeroStat label="Endpoints covered" value={`${stats.coveredCount}/${stats.totalTargets}`} />
          <HeroStat label="Gap" value={stats.uncoveredCount} tone={stats.uncoveredCount > 0 ? 'bad' : 'good'} />
          <HeroStat label="Orphan calls" value={stats.orphanCount} tone={stats.orphanCount > 0 ? 'warn' : 'good'} />
        </div>
      </div>

      <CoverageTrendChart trend={trend} />

      {chartData.length > 0 && (
        <div className="panel">
          <h2>Coverage by domain</h2>
          <ResponsiveContainer width="100%" height={Math.max(220, chartData.length * 36)}>
            <BarChart data={chartData} layout="vertical" margin={{ left: 16, right: 24 }}>
              <XAxis type="number" stroke="#8b93a7" fontSize={12} allowDecimals={false} />
              <YAxis type="category" dataKey="domain" stroke="#8b93a7" fontSize={12} width={160} />
              <Tooltip contentStyle={{ background: '#181b22', border: '1px solid #262a33', borderRadius: 8 }} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
              <Bar dataKey="covered" stackId="c" fill="#4ade80" />
              <Bar dataKey="uncovered" stackId="c" fill="#f87171" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {uncovered.length > 0 && (
        <div className="panel">
          <h2>Uncovered endpoints <span className="muted small">({uncovered.length})</span></h2>
          <table>
            <thead>
              <tr>
                <th>Verb</th>
                <th>Path</th>
                <th>Operation</th>
                <th>Domain</th>
              </tr>
            </thead>
            <tbody>
              {uncovered.slice(0, 200).map(t => (
                <tr key={t.id}>
                  <td><span className={`verb-pill verb-${t.verb.toLowerCase()}`}>{t.verb}</span></td>
                  <td><code>{t.path}</code></td>
                  <td>{t.summary ?? t.operationId ?? <span className="muted">—</span>}</td>
                  <td>{t.domain ? <code>{t.domain}</code> : <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {uncovered.length > 200 && (
            <div className="muted small" style={{ marginTop: 8 }}>
              + {uncovered.length - 200} more — showing first 200.
            </div>
          )}
        </div>
      )}

      {orphans.length > 0 && (
        <div className="panel">
          <h2>Orphan calls <span className="muted small">({orphans.length})</span></h2>
          <p className="muted small">Endpoints hit by tests but not declared in the uploaded spec — possibly outdated spec, shadow endpoints, or test-only routes.</p>
          <table>
            <thead>
              <tr><th>Verb</th><th>Path</th></tr>
            </thead>
            <tbody>
              {orphans.slice(0, 100).map((o, idx) => (
                <tr key={idx}>
                  <td><span className={`verb-pill verb-${o.verb.toLowerCase()}`}>{o.verb}</span></td>
                  <td><code>{o.path}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <GapSuggestionsPanel
        suggestions={suggestions}
        projectSlug={project}
        running={analysisRunning}
        analyzeError={analysisError}
        lastResult={lastResult}
        blockedPaths={blockedPaths}
        onSetBlockedPaths={setBlockedPaths}
        onAnalyze={() => onAnalyze({ forceRefresh: false })}
        onRefresh={() => onAnalyze({ forceRefresh: true })}
        onDryRun={() => onAnalyze({ dryRun: true })}
      />

      {covered.length > 0 && (
        <div className="panel">
          <h2>Covered endpoints <span className="muted small">({covered.length})</span></h2>
          <table>
            <thead>
              <tr><th>Verb</th><th>Path</th><th>Operation</th><th>Domain</th></tr>
            </thead>
            <tbody>
              {covered.slice(0, 200).map(t => (
                <tr key={t.id}>
                  <td><span className={`verb-pill verb-${t.verb.toLowerCase()}`}>{t.verb}</span></td>
                  <td><code>{t.path}</code></td>
                  <td>{t.summary ?? t.operationId ?? <span className="muted">—</span>}</td>
                  <td>{t.domain ? <code>{t.domain}</code> : <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
