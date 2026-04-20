import { useCallback, useEffect, useState } from 'react'
import {
  addIgnore,
  fetchIgnores,
  fetchProjects,
  fetchRuns,
  fetchRunDetail,
  removeIgnore,
  type IgnoreEntry,
  type ProjectSummary,
  type Run,
  type RunDetail as RunDetailData,
  type RunIssue
} from './api.js'
import { RunList } from './components/RunList.js'
import { ScoreChart } from './components/ScoreChart.js'
import { RunDetail } from './components/RunDetail.js'
import { ProjectPicker } from './components/ProjectPicker.js'
import { IgnoresPanel } from './components/IgnoresPanel.js'
import { CoverageView } from './components/CoverageView.js'
import { LandingView } from './components/LandingView.js'
import { FlakyView } from './components/FlakyView.js'
import { ProjectSettingsPanel } from './components/ProjectSettingsPanel.js'
import { HealthCard } from './components/HealthCard.js'
import { DigestPanel } from './components/DigestPanel.js'
import { HealthTrendChart } from './components/HealthTrendChart.js'
import { BranchCompare } from './components/BranchCompare.js'
import { LoginGate } from './components/LoginGate.js'
import { AdminView } from './components/AdminView.js'
import { RepoScanPanel } from './components/RepoScanPanel.js'
import { MfaSetupPanel } from './components/MfaSetupPanel.js'
import { fetchHealth, fetchHealthTrend, type HealthReport, type HealthTrendPoint } from './api.js'

type View = 'about' | 'dashboard' | 'coverage' | 'flaky' | 'admin'
const DEMO_PROJECT_SLUG = 'demo-acme-bank'

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

  const [ignores, setIgnores] = useState<IgnoreEntry[]>([])
  const [view, setView] = useState<View>('about')
  const [health, setHealth] = useState<HealthReport | null>(null)
  const [adminPassword, setAdminPassword] = useState<string | null>(() => localStorage.getItem('tp-admin-pw'))
  const [adminMfaCode, setAdminMfaCode] = useState<string | null>(() => sessionStorage.getItem('tp-admin-mfa'))
  const [adminRequired, setAdminRequired] = useState(false)
  const [healthTrend, setHealthTrend] = useState<HealthTrendPoint[]>([])

  useEffect(() => {
    fetch('/health').then(r => r.json()).then((d: { adminConfigured?: boolean }) => {
      if (d.adminConfigured) setAdminRequired(true)
    }).catch(() => {})
  }, [])

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

  const loadIgnores = useCallback(async () => {
    if (!project) return
    try {
      const list = await fetchIgnores(project)
      setIgnores(list)
    } catch { /* non-fatal */ }
  }, [project])

  useEffect(() => {
    if (!project) return
    let cancelled = false
    setRunsLoading(true)
    setRunsError(null)
    setSelectedId(null)
    setDetail(null)
    Promise.all([
      fetchRuns(project),
      fetchIgnores(project).catch(() => [] as IgnoreEntry[]),
      fetchHealth(project).catch(() => null as HealthReport | null),
      fetchHealthTrend(project).catch(() => [] as HealthTrendPoint[])
    ])
      .then(([r, igs, h, ht]) => {
        if (cancelled) return
        setRuns(r)
        setIgnores(igs)
        setHealth(h)
        setHealthTrend(ht)
      })
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

  async function handleIgnore(issue: RunIssue, reason: string) {
    if (!project || !issue.fingerprint) return
    try {
      await addIgnore(project, {
        fingerprint: issue.fingerprint,
        rule: issue.rule,
        file: issue.file,
        line: issue.line,
        reason: reason || undefined
      })
      await Promise.all([loadIgnores(), selectedId ? fetchRunDetail(selectedId).then(setDetail) : Promise.resolve()])
    } catch (e) {
      setRunsError(String(e))
    }
  }

  async function handleUnignore(fingerprint: string) {
    if (!project) return
    try {
      await removeIgnore(project, fingerprint)
      await Promise.all([loadIgnores(), selectedId ? fetchRunDetail(selectedId).then(setDetail) : Promise.resolve()])
    } catch (e) {
      setRunsError(String(e))
    }
  }

  const latest = runs[0]

  if (adminRequired && !adminPassword) {
    return <LoginGate onLogin={(pw, mfa) => {
      localStorage.setItem('tp-admin-pw', pw)
      setAdminPassword(pw)
      if (mfa) { sessionStorage.setItem('tp-admin-mfa', mfa); setAdminMfaCode(mfa) }
    }} />
  }

  return (
    <div className="container">
      <header>
        <h1>Test<span className="accent">pulse</span></h1>
        <nav className="tabs">
          <button className={view === 'about' ? 'tab active' : 'tab'} onClick={() => setView('about')}>About</button>
          <button className={view === 'dashboard' ? 'tab active' : 'tab'} onClick={() => setView('dashboard')}>Dashboard</button>
          <button className={view === 'coverage' ? 'tab active' : 'tab'} onClick={() => setView('coverage')}>Coverage</button>
          <button className={view === 'flaky' ? 'tab active' : 'tab'} onClick={() => setView('flaky')}>Flaky</button>
          {adminPassword && <button className={view === 'admin' ? 'tab active' : 'tab'} onClick={() => setView('admin')}>Admin</button>}
        </nav>
        <input
          className="project"
          value={project}
          placeholder="project-slug"
          onChange={e => setProject(e.target.value)}
        />
      </header>

      {view === 'about' && (
        <LandingView onTryDemo={() => { setProject(DEMO_PROJECT_SLUG); setView('dashboard') }} />
      )}
      {view !== 'about' && (<>
      {projectsError && <div className="error">Failed to load projects: {projectsError}</div>}
      {!projectsError && projects.length === 0 && (
        <div className="panel empty">
          No projects yet — run the CLI with <code>--push</code> to record a run.
        </div>
      )}

      <ProjectPicker projects={projects} selected={project} onSelect={setProject} />

      {view === 'coverage' && project && <CoverageView project={project} />}
      {view === 'flaky' && project && <FlakyView project={project} />}
      {view === 'admin' && adminPassword && (
        <>
          <AdminView adminPassword={adminPassword} mfaCode={adminMfaCode ?? undefined} />
          {project && <RepoScanPanel project={project} adminPassword={adminPassword} mfaCode={adminMfaCode ?? undefined} />}
          <MfaSetupPanel adminPassword={adminPassword} mfaCode={adminMfaCode ?? undefined} />
        </>
      )}
      {(view === 'dashboard') && (<>

      {runsError && <div className="error">Failed to load: {runsError}</div>}
      {runsLoading && runs.length === 0 && <div className="empty">Loading…</div>}

      <HealthCard report={health} />
      <HealthTrendChart trend={healthTrend} />

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
      {detail && (
        <RunDetail
          data={detail}
          onClose={() => setSelectedId(null)}
          onIgnore={handleIgnore}
        />
      )}

      <IgnoresPanel ignores={ignores} onRemove={handleUnignore} />
      {project && <ProjectSettingsPanel project={project} onSaved={loadIgnores} />}
      {project && <BranchCompare project={project} />}
      {project && <DigestPanel project={project} />}
      </>)}
      </>)}
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
