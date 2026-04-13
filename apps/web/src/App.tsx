import { useEffect, useState } from 'react'
import { fetchRuns, type Run } from './api.js'
import { RunList } from './components/RunList.js'
import { ScoreChart } from './components/ScoreChart.js'

export function App() {
  const [project, setProject] = useState('testpulse-demo')
  const [runs, setRuns] = useState<Run[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchRuns(project)
      .then(r => { if (!cancelled) setRuns(r) })
      .catch(e => { if (!cancelled) setError(String(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [project])

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

      <ScoreChart runs={runs} />
      <RunList runs={runs} />
    </div>
  )
}
