import type { ProjectSummary } from '../api.js'

function scoreTone(score: number | null): 'good' | 'warn' | 'bad' | undefined {
  if (score === null) return undefined
  if (score >= 80) return 'good'
  if (score >= 50) return 'warn'
  return 'bad'
}

export function ProjectPicker({
  projects,
  selected,
  onSelect
}: {
  projects: ProjectSummary[]
  selected: string
  onSelect: (slug: string) => void
}) {
  if (projects.length === 0) return null

  return (
    <div className="panel project-picker">
      <h2>Projects <span className="muted small">({projects.length})</span></h2>
      <div className="chip-row">
        {projects.map(p => {
          const tone = scoreTone(p.latestScore)
          const isSelected = p.slug === selected
          return (
            <button
              key={p.slug}
              className={`chip ${isSelected ? 'selected' : ''} ${tone ?? ''}`}
              onClick={() => onSelect(p.slug)}
            >
              <span className="chip-slug">{p.slug}</span>
              <span className="chip-meta">
                {p.latestScore !== null ? (
                  <span className={`chip-score ${tone ?? ''}`}>{p.latestScore}/100</span>
                ) : <span className="muted">—</span>}
                <span className="muted">·</span>
                <span>{p.runCount} {p.runCount === 1 ? 'run' : 'runs'}</span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
