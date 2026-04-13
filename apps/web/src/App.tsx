import { useEffect, useState } from 'react'
import { fetchRuns, fetchRunDetail, type Run, type RunDetail as RunDetailData } from './api.js'
import { RunList } from './components/RunList.js'
import { ScoreChart } from './components/ScoreChart.js'
import { RunDetail } from './components/RunDetail.js'

export function App() {
  const [project, setProject] = useState('testpulse-demo')
  const [runs, setRuns] = useState<Run[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<RunDetailData | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setSelectedId(null)
    setDetail(null)
    fetchRuns(project)
      .then(r => { if (!cancelled) setRuns(r) })
      .catch(e => { if (!cancelled) setError(String(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [project])

  useEffect(() => {
    if (!selectedId) { setDetail(null); return }
    let cancelled = false
    setDetailLoading(true)
    fetchRunDetail(selectedId)
      .then(d => { if (!cancelled) setDetail(d) })
      .catch(e => { if (!cancelled) setError(String(e)) })
      .finally(() => { if (!cancelled) setDetailLoading(false) })
    return () => { cancelled = true }
  }, [selectedId])

  const latest = runs[0]

  return (
    <div className="container">
      <header>
        <h1>Test<span className="accent">pulse</span></h1>
        <input
          className="project"
          value={project}
          placeholder="project-slug"
          onChange={e => setProject(e.target.value)}
        />
      </header>

      {error && <div className="error">Failed to load: {error}</div>}
      {loading && runs.length === 0 && <div className="empty">Loading…</div>}

      {latest && (
        <div className="panel hero">
          <div className="hero-label muted small">Latest run</div>
          <div className="stat-row">
            <HeroStat label="Score" value={`${latest.score}/100`} tone={latest.score >= 80 ? 'good' : latest.score >= 50 ? 'warn' : 'bad'} big />
            <HeroStat label="Critical" value={latest.criticalIssues} tone={latest.criticalIssues > 0 ? 'bad' : 'good'} />
            <HeroStat label="Total issues" value={latest.totalIssues} />
            <HeroStat label="Files scanned" value={latest.filesScanned} />
            <HeroStat label="When" value={new Date(latest.createdAt).toLocaleString()} />
          </div>
        </div>
      )}

      <ScoreChart runs={runs} />
      <RunList runs={runs} selectedId={selectedId} onSelect={setSelectedId} />

      {detailLoading && <div className="empty">Loading run details…</div>}
      {detail && <RunDetail data={detail} onClose={() => setSelectedId(null)} />}
    </div>
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
