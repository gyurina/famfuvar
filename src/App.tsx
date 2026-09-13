import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { AuthProvider, useAuth } from './lib/auth'
import { BottomNav } from './components/BottomNav'
import { Login } from './screens/Login'
import { Ma } from './screens/Ma'
import { Rides } from './screens/Rides'
import { Week } from './screens/Week'
import { Sablon } from './screens/Sablon'
import { Esemeny } from './screens/Esemeny'
import { Beallitasok } from './screens/Beallitasok'
import { More } from './screens/More'
import { Family } from './screens/Family'
import { OfflineBanner } from './components/OfflineBanner'
import { Icon } from './components/Icon'
import { useRole } from './hooks/useRole'

function RequireParent({ children }: { children: ReactNode }) {
  const { canSeeRides } = useRole()
  if (!canSeeRides) return <Navigate to="/" replace />
  return children
}

function RequireMore({ children }: { children: ReactNode }) {
  const { canSeeMore } = useRole()
  if (!canSeeMore) return <Navigate to="/" replace />
  return children
}

function RequireFamilyLife({ children }: { children: ReactNode }) {
  const { isBabysitter, isChild } = useRole()
  if (isChild) return <Navigate to="/" replace />
  if (isBabysitter) return <Navigate to="/egyeb" replace />
  return children
}

function RequireAdmin({ children }: { children: ReactNode }) {
  const { isAdmin } = useRole()
  if (!isAdmin) return <Navigate to="/egyeb" replace />
  return children
}

function AppShell() {
  const { session, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <Icon name="steering-wheel" size={44} className="animate-pulse" />
      </div>
    )
  }

  if (!session) return <Login />

  return (
    <div className="min-h-dvh">
      <OfflineBanner />
      <Routes>
        <Route path="/" element={<Ma />} />
        <Route path="/het" element={<Week />} />
        <Route path="/het/uj" element={<Esemeny />} />
        <Route path="/fuvarok" element={<RequireParent><Rides /></RequireParent>} />
        <Route path="/egyeb" element={<RequireMore><More /></RequireMore>} />
        <Route path="/egyeb/orarend" element={<RequireFamilyLife><Sablon embedded /></RequireFamilyLife>} />
        <Route path="/egyeb/szunetek" element={<RequireAdmin><Beallitasok section="szunetek" /></RequireAdmin>} />
        <Route path="/egyeb/csalad" element={<RequireFamilyLife><Family /></RequireFamilyLife>} />
        <Route path="/egyeb/helyszinek" element={<RequireFamilyLife><Beallitasok section="helyszinek" /></RequireFamilyLife>} />
        <Route path="/egyeb/ertesitesek" element={<RequireMore><Beallitasok section="ertesitesek" /></RequireMore>} />
        <Route path="/fuvar" element={<Navigate to="/fuvarok" replace />} />
        <Route path="/esemeny" element={<Navigate to="/het" replace />} />
        <Route path="/sablon" element={<Navigate to="/egyeb/orarend" replace />} />
        <Route path="/beallitasok" element={<Navigate to="/egyeb" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
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
