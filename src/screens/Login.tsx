import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { copy } from '../copy'
import { Icon } from '../components/Icon'

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
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : copy.login.failed
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-6"
         style={{ background: 'var(--color-bg)' }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="mb-3" style={{ display: 'flex', justifyContent: 'center' }}>
            <Icon name="steering-wheel" size={48} weight="fill" color="var(--color-accent-ink)" />
          </div>
          <h1 className="text-2xl font-bold">{copy.app.name}</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
            {copy.app.tagline}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm mb-1.5" style={{ color: 'var(--color-muted)' }}>
              {copy.login.email}
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full rounded-xl px-4 py-3 text-sm outline-none"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
              autoComplete="email"
            />
          </div>

          <div>
            <label className="block text-sm mb-1.5" style={{ color: 'var(--color-muted)' }}>
              {copy.login.password}
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full rounded-xl px-4 py-3 text-sm outline-none"
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
            {loading ? copy.login.submitting : copy.login.submit}
          </button>
        </form>
      </div>
    </div>
  )
}
