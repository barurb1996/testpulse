import { useEffect, useState } from 'react'
import {
  fetchProjects,
  fetchRuns,
  fetchRunDetail,
  type ProjectSummary,
  type Run,
  type RunDetail as RunDetailData
} from './api.js'
import { RunList } from './components/RunList.js'
import { ScoreChart } from './components/ScoreChart.js'
import { RunDetail } from './components/RunDetail.js'
import { ProjectPicker } from './components/ProjectPicker.js'

export function App() {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [projectsError, setProjectsError] = useState<string | null>(null)
  const [project, setProject] = useState<string>('')

  const [runs, setRuns] = useState<Run[]>([])
  const [runsError, setRunsError] = useState<string | null>(null)
  const [runsLoading, setRunsLoading] = useState(false)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<RunDetailData | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchProjects()
      .then(list => {
        if (cancelled) return
        setProjects(list)
        if (list.length > 0 && !project) setProject(list[0].slug)
      })
      .catch(e => { if (!cancelled) setProjectsError(String(e)) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!project) return
    let cancelled = false
    setRunsLoading(true)
    setRunsError(null)
    setSelectedId(null)
    setDetail(null)
    fetchRuns(project)
      .then(r => { if (!cancelled) setRuns(r) })
      .catch(e => { if (!cancelled) setRunsError(String(e)) })
      .finally(() => { if (!cancelled) setRunsLoading(false) })
    return () => { cancelled = true }
  }, [project])

  useEffect(() => {
    if (!selectedId) { setDetail(null); return }
    let cancelled = false
    setDetailLoading(true)
    fetchRunDetail(selectedId)
      .then(d => { if (!cancelled) setDetail(d) })
      .catch(e => { if (!cancelled) setRunsError(String(e)) })
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

      {projectsError && <div className="error">Failed to load projects: {projectsError}</div>}
      {!projectsError && projects.length === 0 && (
        <div className="panel empty">
          No projects yet — run the CLI with <code>--push</code> to record a run.
        </div>
      )}

      <ProjectPicker projects={projects} selected={project} onSelect={setProject} />

      {runsError && <div className="error">Failed to load: {runsError}</div>}
      {runsLoading && runs.length === 0 && <div className="empty">Loading…</div>}

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
