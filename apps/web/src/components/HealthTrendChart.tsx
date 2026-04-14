import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import type { HealthTrendPoint } from '../api.js'

export function HealthTrendChart({ trend }: { trend: HealthTrendPoint[] }) {
  if (trend.length < 2) return null
  const data = trend.map(t => ({
    date: new Date(t.createdAt).toLocaleDateString(),
    static: t.staticScore,
    health: t.healthScore ?? null
  }))

  return (
    <div className="panel">
      <h2>Project health over time</h2>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data}>
          <CartesianGrid stroke="#262a33" strokeDasharray="3 3" />
          <XAxis dataKey="date" stroke="#8b93a7" fontSize={12} />
          <YAxis domain={[0, 100]} stroke="#8b93a7" fontSize={12} />
          <Tooltip contentStyle={{ background: '#181b22', border: '1px solid #262a33', borderRadius: 8 }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line type="monotone" dataKey="static" name="Static score" stroke="#a78bfa" strokeWidth={2} dot={{ r: 2 }} />
          <Line type="monotone" dataKey="health" name="Composite health" stroke="#4ade80" strokeWidth={2} dot={{ r: 2 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
