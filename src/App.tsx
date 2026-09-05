import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import { BottomNav } from './components/BottomNav'
import { Login } from './screens/Login'
import { Ma } from './screens/Ma'
import { Fuvartabla } from './screens/Fuvartabla'
import { Het } from './screens/Het'
import { Sablon } from './screens/Sablon'
import { Beallitasok } from './screens/Beallitasok'

function AppShell() {
  const { session, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <div className="text-4xl animate-pulse">🚗</div>
      </div>
    )
  }

  if (!session) return <Login />

  return (
    <div className="min-h-dvh">
      <Routes>
        <Route path="/"            element={<Ma />} />
        <Route path="/fuvar"       element={<Fuvartabla />} />
        <Route path="/het"         element={<Het />} />
        <Route path="/sablon"      element={<Sablon />} />
        <Route path="/beallitasok" element={<Beallitasok />} />
        <Route path="*"            element={<Navigate to="/" replace />} />
      </Routes>
      <BottomNav />
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppShell />
      </BrowserRouter>
    </AuthProvider>
  )
}
