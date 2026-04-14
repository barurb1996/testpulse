import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import type { CoverageTrendPoint } from '../api.js'

export function CoverageTrendChart({ trend }: { trend: CoverageTrendPoint[] }) {
  if (trend.length < 2) return null

  const data = trend.map(t => ({
    date: new Date(t.createdAt).toLocaleDateString(),
    percent: t.coveragePercent,
    covered: t.covered,
    total: t.total
  }))

  return (
    <div className="panel">
      <h2>Coverage over time</h2>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data}>
          <CartesianGrid stroke="#262a33" strokeDasharray="3 3" />
          <XAxis dataKey="date" stroke="#8b93a7" fontSize={12} />
          <YAxis domain={[0, 100]} stroke="#8b93a7" fontSize={12} tickFormatter={v => `${v}%`} />
          <Tooltip
            contentStyle={{ background: '#181b22', border: '1px solid #262a33', borderRadius: 8 }}
            formatter={(_v: number | string, _name: string, props: { payload?: { covered: number; total: number; percent: number } }) => {
              const p = props.payload
              if (!p) return [`${_v}%`, 'coverage']
              return [`${p.percent}% (${p.covered}/${p.total})`, 'coverage']
            }}
          />
          <Line type="monotone" dataKey="percent" stroke="#4ade80" strokeWidth={2} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
