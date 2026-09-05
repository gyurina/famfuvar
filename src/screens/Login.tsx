import { useState } from 'react'
import { useAuth } from '../lib/auth'

export function Login() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await signIn(email, password)
    } catch (err: any) {
      setError(err.message ?? 'Bejelentkezés sikertelen')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-6"
         style={{ background: 'var(--color-bg)' }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">🚗</div>
          <h1 className="text-2xl font-bold">Família Fuvar</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
            Kézi fuvaregyeztetés egy helyen
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm mb-1.5" style={{ color: 'var(--color-muted)' }}>
              Email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
              autoComplete="email"
            />
          </div>

          <div>
            <label className="block text-sm mb-1.5" style={{ color: 'var(--color-muted)' }}>
              Jelszó
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
              autoComplete="current-password"
            />
          </div>

          {error && (
            <p className="text-sm text-red-400 bg-red-950 rounded-lg px-3 py-2">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl py-3.5 text-sm font-semibold transition-opacity disabled:opacity-50"
            style={{ background: 'var(--color-blue)', color: '#fff', minHeight: 44 }}
          >
            {loading ? 'Bejelentkezés…' : 'Bejelentkezés'}
          </button>
        </form>
      </div>
    </div>
  )
}
