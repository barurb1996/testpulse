import { useState } from 'react'
import type { CoverageHistoryEntry } from '../api.js'

export function CoverageHistory({ history }: { history: CoverageHistoryEntry[] }) {
  const entriesWithChanges = history.filter(h => h.gained.length > 0 || h.lost.length > 0)
  if (entriesWithChanges.length === 0) return null

  return (
    <div className="panel">
      <h2>Coverage history <span className="muted small">(runs with gains or losses)</span></h2>
      <div className="coverage-history">
        {entriesWithChanges.map(entry => <HistoryEntry key={entry.runId} entry={entry} />)}
      </div>
    </div>
  )
}

function HistoryEntry({ entry }: { entry: CoverageHistoryEntry }) {
  const [open, setOpen] = useState(false)
  const when = new Date(entry.createdAt).toLocaleString()
  return (
    <div className="history-entry">
      <div className="history-entry-header" onClick={() => setOpen(!open)}>
        <span className="muted small">{when}</span>
        <span className="muted small">· {entry.totalCovered}/{entry.totalTargets} covered</span>
        {entry.gained.length > 0 && <span className="badge info" style={{ color: 'var(--good)', borderColor: 'var(--good)' }}>+{entry.gained.length} gained</span>}
        {entry.lost.length > 0 && <span className="badge critical">−{entry.lost.length} lost</span>}
        <span className="chevron">{open ? '▾' : '▸'}</span>
      </div>
      {open && (
        <div className="history-entry-body">
          {entry.gained.length > 0 && (
            <div>
              <div className="muted small" style={{ color: 'var(--good)', marginBottom: 4 }}>Gained</div>
              <ul className="history-endpoint-list">
                {entry.gained.map((e, i) => (
                  <li key={i}>
                    <span className={`verb-pill verb-${e.verb.toLowerCase()}`}>{e.verb}</span>
                    <code>{e.path}</code>
                    {e.summary && <span className="muted small"> — {e.summary}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {entry.lost.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div className="muted small" style={{ color: 'var(--bad)', marginBottom: 4 }}>Lost</div>
              <ul className="history-endpoint-list">
                {entry.lost.map((e, i) => (
                  <li key={i}>
                    <span className={`verb-pill verb-${e.verb.toLowerCase()}`}>{e.verb}</span>
                    <code>{e.path}</code>
                    {e.summary && <span className="muted small"> — {e.summary}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
