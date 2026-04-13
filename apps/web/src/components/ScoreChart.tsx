import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import type { Run } from '../api.js'

export function ScoreChart({ runs }: { runs: Run[] }) {
  const data = [...runs].reverse().map(r => ({
    date: new Date(r.createdAt).toLocaleDateString(),
    score: r.score,
    critical: r.criticalIssues
  }))

  return (
    <div className="panel">
      <h2>Quality score over time</h2>
      {data.length === 0 ? (
        <div className="empty">No runs yet</div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={data}>
            <CartesianGrid stroke="#262a33" strokeDasharray="3 3" />
            <XAxis dataKey="date" stroke="#8b93a7" fontSize={12} />
            <YAxis domain={[0, 100]} stroke="#8b93a7" fontSize={12} />
            <Tooltip contentStyle={{ background: '#181b22', border: '1px solid #262a33', borderRadius: 8 }} />
            <Line type="monotone" dataKey="score" stroke="#a78bfa" strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
