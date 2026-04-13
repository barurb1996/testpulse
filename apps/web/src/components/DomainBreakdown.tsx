import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import type { RunIssue } from '../api.js'

const WRAPPER_DIRS = new Set([
  'features', 'tests', 'test', 'e2e', 'specs', 'spec',
  'steps', 'step-definitions', 'scenarios', 'src'
])

function longestCommonPrefix(paths: string[]): string {
  if (paths.length === 0) return ''
  let prefix = paths[0]
  for (const p of paths.slice(1)) {
    while (!p.startsWith(prefix)) {
      prefix = prefix.slice(0, -1)
      if (prefix === '') return ''
    }
  }
  const lastSlash = prefix.lastIndexOf('/')
  return lastSlash === -1 ? prefix : prefix.slice(0, lastSlash + 1)
}

function deriveDomain(file: string, commonPrefix: string): string {
  const rel = file.slice(commonPrefix.length)
  const segments = rel.split('/').filter(Boolean)
  let idx = 0
  while (idx < segments.length - 1 && WRAPPER_DIRS.has(segments[idx])) idx++
  return segments[idx] ?? 'root'
}

export function DomainBreakdown({ issues }: { issues: RunIssue[] }) {
  if (issues.length < 2) return null

  const prefix = longestCommonPrefix(issues.map(i => i.file))
  const totals = new Map<string, { total: number; critical: number; warning: number; info: number }>()

  for (const issue of issues) {
    const domain = deriveDomain(issue.file, prefix)
    const bucket = totals.get(domain) ?? { total: 0, critical: 0, warning: 0, info: 0 }
    bucket.total += 1
    bucket[issue.severity] += 1
    totals.set(domain, bucket)
  }

  const sorted = Array.from(totals.entries())
    .map(([domain, b]) => ({ domain, ...b }))
    .sort((a, b) => b.total - a.total)

  if (sorted.length < 2) return null

  const top = sorted.slice(0, 10)
  const max = top[0].total
  const totalAll = sorted.reduce((acc, r) => acc + r.total, 0)

  return (
    <div className="panel">
      <h2>Issues by domain <span className="muted small">(top {top.length})</span></h2>
      <ResponsiveContainer width="100%" height={Math.max(200, top.length * 34)}>
        <BarChart data={top} layout="vertical" margin={{ left: 16, right: 80, top: 4, bottom: 4 }}>
          <XAxis type="number" stroke="#8b93a7" fontSize={12} allowDecimals={false} />
          <YAxis type="category" dataKey="domain" stroke="#8b93a7" fontSize={12} width={160} />
          <Tooltip
            contentStyle={{ background: '#181b22', border: '1px solid #262a33', borderRadius: 8 }}
            cursor={{ fill: 'rgba(255,255,255,0.03)' }}
          />
          <Bar dataKey="critical" stackId="sev" fill="#f87171" />
          <Bar dataKey="warning"  stackId="sev" fill="#fbbf24" />
          <Bar dataKey="info"     stackId="sev" fill="#8b93a7" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>

      <table className="domain-table">
        <thead>
          <tr>
            <th>Domain</th>
            <th className="num">Critical</th>
            <th className="num">Warning</th>
            <th className="num">Info</th>
            <th className="num">Total</th>
            <th className="num">Share</th>
          </tr>
        </thead>
        <tbody>
          {top.map(row => (
            <tr key={row.domain}>
              <td><code>{row.domain}</code></td>
              <td className="num">{row.critical > 0 ? <span className="score low">{row.critical}</span> : <span className="muted">0</span>}</td>
              <td className="num">{row.warning > 0 ? <span className="score med">{row.warning}</span> : <span className="muted">0</span>}</td>
              <td className="num">{row.info > 0 ? <span className="muted">{row.info}</span> : <span className="muted">0</span>}</td>
              <td className="num"><strong>{row.total}</strong></td>
              <td className="num muted">{Math.round((row.total / totalAll) * 100)}%</td>
            </tr>
          ))}
        </tbody>
      </table>

      {sorted.length > top.length && (
        <div className="muted small" style={{ marginTop: 8 }}>
          + {sorted.length - top.length} more domains with {sorted.slice(top.length).reduce((a, r) => a + r.total, 0)} issues between them.
        </div>
      )}

      {max < totalAll * 0.15 && (
        <div className="muted small" style={{ marginTop: 8 }}>
          Heads up: issues are spread evenly — no single domain dominates.
        </div>
      )}
    </div>
  )
}
