import { useState } from 'react'
import type { GapAnalyzeResult, GapSuggestion } from '../api.js'
import {
  formatSuggestionAsFeature,
  formatSuggestionsAsMarkdown,
  triggerDownload
} from './gap-export.js'

function groupByEndpoint(suggestions: GapSuggestion[]): Array<{ key: string; verb: string; path: string; summary: string | null; domain: string | null; items: GapSuggestion[] }> {
  const map = new Map<string, { key: string; verb: string; path: string; summary: string | null; domain: string | null; items: GapSuggestion[] }>()
  for (const s of suggestions) {
    const key = `${s.targetVerb} ${s.targetPath}`
    const bucket = map.get(key) ?? {
      key,
      verb: s.targetVerb,
      path: s.targetPath,
      summary: s.targetSummary,
      domain: s.targetDomain,
      items: []
    }
    bucket.items.push(s)
    map.set(key, bucket)
  }
  return Array.from(map.values())
}

export function GapSuggestionsPanel({
  suggestions,
  projectSlug,
  running,
  analyzeError,
  lastResult,
  onAnalyze,
  onRefresh,
  onDryRun,
  onSetBlockedPaths,
  blockedPaths
}: {
  suggestions: GapSuggestion[]
  projectSlug: string
  running: boolean
  analyzeError: string | null
  lastResult: GapAnalyzeResult | null
  onAnalyze: () => void
  onRefresh: () => void
  onDryRun: () => void
  onSetBlockedPaths: (paths: string[]) => void
  blockedPaths: string[]
}) {
  const groups = groupByEndpoint(suggestions)
  const hasData = groups.length > 0
  const [showAdvanced, setShowAdvanced] = useState(false)

  function downloadMarkdown() {
    const content = formatSuggestionsAsMarkdown(projectSlug, suggestions)
    const date = new Date().toISOString().slice(0, 10)
    triggerDownload(content, `testpulse-gaps-${projectSlug}-${date}.md`, 'text/markdown')
  }

  return (
    <div className="panel">
      <div className="gap-header">
        <div>
          <h2>Gap analysis <span className="muted small">(Claude Haiku suggestions)</span></h2>
          <p className="muted small gap-caveat">
            Heuristic, not exhaustive. Always human-review before acting. Regenerates only when the endpoint or its existing coverage changes.
          </p>
        </div>
        <div className="gap-actions">
          {hasData && (
            <button className="ghost" onClick={downloadMarkdown} disabled={running}>
              Export as Markdown
            </button>
          )}
          {hasData && (
            <button className="ghost" onClick={onRefresh} disabled={running}>
              {running ? 'Running…' : 'Regenerate all'}
            </button>
          )}
          <button className="primary" onClick={onAnalyze} disabled={running}>
            {running ? 'Analysing…' : hasData ? 'Analyse new endpoints' : 'Run gap analysis'}
          </button>
        </div>
      </div>

      <div className="gap-advanced-toggle">
        <button className="ghost small" onClick={() => setShowAdvanced(!showAdvanced)}>
          {showAdvanced ? '▾' : '▸'} Privacy / advanced
        </button>
      </div>
      {showAdvanced && (
        <div className="gap-advanced">
          <div className="field">
            <span className="field-label">Blocked path globs (comma-separated) — endpoints matching these are not sent to the LLM</span>
            <input
              type="text"
              className="project"
              style={{ width: '100%' }}
              value={blockedPaths.join(', ')}
              placeholder="**/internal/**, /admin/**"
              onChange={e => onSetBlockedPaths(
                e.target.value.split(',').map(s => s.trim()).filter(Boolean)
              )}
            />
          </div>
          <button className="ghost small" onClick={onDryRun} disabled={running}>
            Dry run (see exactly what would be sent, no LLM call)
          </button>
        </div>
      )}

      {analyzeError && <div className="error" style={{ marginTop: 12 }}>Analysis failed: {analyzeError}</div>}

      {lastResult && !analyzeError && lastResult.dryRun && (
        <div className="gap-result muted small">
          <strong>Dry run.</strong> Would analyse {lastResult.wouldAnalyse} endpoints with {lastResult.model}. Skipped by block globs: {lastResult.skippedByBlock ?? 0}.
        </div>
      )}

      {lastResult && !analyzeError && !lastResult.dryRun && (
        <div className="gap-result muted small">
          Analysed {lastResult.generated > 0 || lastResult.cached > 0 || lastResult.failed ? '—' : 'done.'}
          {' '}generated {lastResult.generated} new suggestions,
          {' '}{lastResult.cached} cached,
          {lastResult.failed ? ` ${lastResult.failed} failed,` : ''}
          {lastResult.skippedByBlock ? ` ${lastResult.skippedByBlock} skipped by block globs.` : ''}
          {lastResult.message ? ` ${lastResult.message}` : ''}
        </div>
      )}

      {lastResult && lastResult.errors && lastResult.errors.length > 0 && (
        <div className="gap-errors">
          <div className="gap-errors-title">First error:</div>
          <pre>{lastResult.errors[0]}</pre>
          {lastResult.errors.length > 1 && (
            <div className="muted small">+ {lastResult.errors.length - 1} more errors (all likely the same cause).</div>
          )}
        </div>
      )}

      {!hasData && !running && (
        <div className="empty" style={{ marginTop: 16 }}>
          No suggestions yet. Upload an OpenAPI spec first, then click <strong>Run gap analysis</strong> above.
          Each uncovered or thinly-covered endpoint is analysed by Claude Haiku to identify missing test scenarios.
        </div>
      )}

      {hasData && (
        <div className="gap-groups">
          {groups.map(group => (
            <GapGroup key={group.key} group={group} />
          ))}
        </div>
      )}
    </div>
  )
}

function GapGroup({ group }: { group: { verb: string; path: string; summary: string | null; domain: string | null; items: GapSuggestion[] } }) {
  const [open, setOpen] = useState(true)
  return (
    <div className="gap-group">
      <div className="gap-group-header" onClick={() => setOpen(!open)}>
        <span className={`verb-pill verb-${group.verb.toLowerCase()}`}>{group.verb}</span>
        <code>{group.path}</code>
        {group.domain && <span className="muted small">· <code>{group.domain}</code></span>}
        <span className="muted small">· {group.items.length} suggestion{group.items.length !== 1 ? 's' : ''}</span>
        <span className="chevron">{open ? '▾' : '▸'}</span>
      </div>
      {group.summary && <div className="gap-summary muted small">{group.summary}</div>}
      {open && (
        <div className="gap-items">
          {group.items.map(item => <GapItem key={item.id} item={item} />)}
        </div>
      )}
    </div>
  )
}

function GapItem({ item }: { item: GapSuggestion }) {
  const [stepsOpen, setStepsOpen] = useState(false)

  function downloadFeature() {
    const { filename, content } = formatSuggestionAsFeature(item)
    triggerDownload(content, filename, 'text/x-gherkin')
  }

  return (
    <div className={`gap-item ${item.severity}`}>
      <div className="gap-item-head">
        <span className={`badge ${item.severity}`}>{item.severity}</span>
        <strong className="gap-title">{item.title}</strong>
      </div>
      {item.rationale && <div className="gap-rationale muted small">{item.rationale}</div>}
      <div className="gap-item-actions">
        <button className="ghost small" onClick={() => setStepsOpen(!stepsOpen)}>
          {stepsOpen ? 'Hide steps' : 'Show steps'}
        </button>
        <button className="ghost small" onClick={downloadFeature} title="Download scaffolded .feature file with these Gherkin steps">
          Download .feature
        </button>
      </div>
      {stepsOpen && (
        <pre className="gap-steps">
          {item.steps.join('\n')}
        </pre>
      )}
    </div>
  )
}
