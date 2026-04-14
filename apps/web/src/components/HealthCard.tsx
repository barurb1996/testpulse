import type { HealthReport } from '../api.js'

function scoreTone(s: number): 'good' | 'warn' | 'bad' {
  if (s >= 80) return 'good'
  if (s >= 50) return 'warn'
  return 'bad'
}

export function HealthCard({ report }: { report: HealthReport | null }) {
  if (!report || report.score === null) return null
  const tone = scoreTone(report.score)

  return (
    <div className="panel health-card">
      <div className="health-main">
        <div className="muted small hero-eyebrow">Project health</div>
        <div className={`health-score ${tone}`}>{report.score}<span className="health-score-unit">/100</span></div>
        <div className="muted small">weighted composite of quality, coverage, stability, and regressions</div>
      </div>
      <div className="health-components">
        {report.components.map(c => (
          <div key={c.name} className="health-component">
            <div className="health-component-row">
              <span className="health-component-name">{c.name}</span>
              <span className={`health-component-score ${scoreTone(c.score)}`}>{c.score}</span>
              <span className="muted small">× {c.weight}%</span>
            </div>
            <div className="health-bar">
              <div className={`health-bar-fill ${scoreTone(c.score)}`} style={{ width: `${c.score}%` }} />
            </div>
            <div className="muted small health-component-raw">{c.raw}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
