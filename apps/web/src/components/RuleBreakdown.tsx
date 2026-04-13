import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import type { RunIssue, Severity } from '../api.js'

const SEVERITY_COLOR: Record<Severity, string> = {
  critical: '#f87171',
  warning: '#fbbf24',
  info: '#8b93a7'
}

export function RuleBreakdown({ issues }: { issues: RunIssue[] }) {
  const counts = new Map<string, { rule: string; severity: Severity; count: number }>()
  for (const i of issues) {
    const bucket = counts.get(i.rule) ?? { rule: i.rule, severity: i.severity, count: 0 }
    bucket.count += 1
    bucket.severity = i.severity
    counts.set(i.rule, bucket)
  }
  const data = Array.from(counts.values()).sort((a, b) => b.count - a.count)

  if (data.length === 0) return null

  return (
    <div className="panel">
      <h2>Issues by rule</h2>
      <ResponsiveContainer width="100%" height={Math.max(180, data.length * 32)}>
        <BarChart data={data} layout="vertical" margin={{ left: 16, right: 24 }}>
          <XAxis type="number" stroke="#8b93a7" fontSize={12} allowDecimals={false} />
          <YAxis type="category" dataKey="rule" stroke="#8b93a7" fontSize={12} width={220} />
          <Tooltip
            contentStyle={{ background: '#181b22', border: '1px solid #262a33', borderRadius: 8 }}
            cursor={{ fill: 'rgba(255,255,255,0.03)' }}
          />
          <Bar dataKey="count" radius={[0, 4, 4, 0]}>
            {data.map((d, idx) => <Cell key={idx} fill={SEVERITY_COLOR[d.severity]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
