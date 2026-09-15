import { BrowserRouter, Routes, Route, Navigate, useSearchParams } from 'react-router-dom'
import type { ReactNode } from 'react'
import { AuthProvider, useAuth } from './lib/auth'
import { BottomNav } from './components/BottomNav'
import { Login } from './screens/Login'
import { Ma } from './screens/Ma'
import { Rides } from './screens/Rides'
import { Week } from './screens/Week'
import { Sablon } from './screens/Sablon'
import { Beallitasok } from './screens/Beallitasok'
import { More } from './screens/More'
import { Family } from './screens/Family'
import { Inbox } from './screens/Inbox'
import { Naplo } from './screens/Naplo'
import { Posta } from './screens/Posta'
import { Rendszer } from './screens/Rendszer'
import { OfflineBanner } from './components/OfflineBanner'
import { ToastProvider } from './components/Toast'
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

function RequireSysAdmin({ children }: { children: ReactNode }) {
  const { isSysAdmin } = useRole()
  if (!isSysAdmin) return <Navigate to="/egyeb" replace />
  return children
}

function LegacyInboxRedirect() {
  const [params] = useSearchParams()
  if (params.get('inbox') === '1') return <Navigate to="/uzenetek" replace />
  return null
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
    <ToastProvider>
    <div className="min-h-dvh">
      <OfflineBanner />
      <LegacyInboxRedirect />
      <Routes>
        <Route path="/" element={<Ma />} />
        <Route path="/het" element={<Week />} />
        <Route path="/het/uj" element={<Navigate to="/het" replace />} />
        <Route path="/fuvarok" element={<RequireParent><Rides /></RequireParent>} />
        <Route path="/uzenetek" element={<Inbox />} />
        <Route path="/egyeb" element={<RequireMore><More /></RequireMore>} />
        <Route path="/egyeb/orarend" element={<RequireFamilyLife><Sablon embedded /></RequireFamilyLife>} />
        <Route path="/egyeb/szunetek" element={<RequireAdmin><Beallitasok section="szunetek" /></RequireAdmin>} />
        <Route path="/egyeb/csalad" element={<RequireFamilyLife><Family /></RequireFamilyLife>} />
        <Route path="/egyeb/helyszinek" element={<RequireFamilyLife><Beallitasok section="helyszinek" /></RequireFamilyLife>} />
        <Route path="/egyeb/ertesitesek" element={<RequireMore><Beallitasok section="ertesitesek" /></RequireMore>} />
        <Route path="/egyeb/uzenet" element={<RequireAdmin><Beallitasok section="uzenet" /></RequireAdmin>} />
        <Route path="/egyeb/naptarak" element={<RequireAdmin><Beallitasok section="naptarak" /></RequireAdmin>} />
        <Route path="/egyeb/naplo" element={<RequireSysAdmin><Naplo /></RequireSysAdmin>} />
        <Route path="/egyeb/posta" element={<RequireSysAdmin><Posta /></RequireSysAdmin>} />
        <Route path="/egyeb/rendszer" element={<RequireSysAdmin><Rendszer /></RequireSysAdmin>} />
        <Route path="/fuvar" element={<Navigate to="/fuvarok" replace />} />
        <Route path="/esemeny" element={<Navigate to="/het" replace />} />
        <Route path="/sablon" element={<Navigate to="/egyeb/orarend" replace />} />
        <Route path="/beallitasok" element={<Navigate to="/egyeb" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <BottomNav />
    </div>
    </ToastProvider>
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
