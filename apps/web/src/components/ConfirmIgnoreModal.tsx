import { useState, useEffect } from 'react'
import type { RunIssue } from '../api.js'

export function ConfirmIgnoreModal({
  issue,
  onCancel,
  onConfirm
}: {
  issue: RunIssue
  onCancel: () => void
  onConfirm: (reason: string) => void
}) {
  const [reason, setReason] = useState('')

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>Ignore this issue?</h3>
        <p className="modal-body">
          <span className={`badge ${issue.severity}`}>{issue.severity}</span>{' '}
          <code>{issue.rule}</code><br />
          {issue.message}
        </p>
        <p className="muted small">
          This hides the issue from the dashboard for this project.
          It will come back if the underlying code changes (fingerprint: <code>{issue.fingerprint}</code>).
        </p>
        <label className="field">
          <span className="field-label">Reason (optional, for your team)</span>
          <textarea
            autoFocus
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="e.g. intentional diagnostic scenario"
            rows={3}
          />
        </label>
        <div className="modal-actions">
          <button className="ghost" onClick={onCancel}>Cancel</button>
          <button className="primary" onClick={() => onConfirm(reason.trim())}>Ignore this issue</button>
        </div>
      </div>
    </div>
  )
}
