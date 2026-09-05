import React, { createContext, useContext, useEffect, useState } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { Person } from '../types'

interface AuthCtx {
  session: Session | null
  user: User | null
  person: Person | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

const Ctx = createContext<AuthCtx | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [person, setPerson] = useState<Person | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (data.session) loadPerson(data.session.user.id)
      else setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_evt, s) => {
      setSession(s)
      if (s) loadPerson(s.user.id)
      else { setPerson(null); setLoading(false) }
    })
    return () => subscription.unsubscribe()
  }, [])

  async function loadPerson(authUserId: string) {
    const { data } = await supabase
      .from('person')
      .select('*')
      .eq('auth_user_id', authUserId)
      .single()
    setPerson(data)
    setLoading(false)
  }

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  return (
    <Ctx.Provider value={{ session, user: session?.user ?? null, person, loading, signIn, signOut }}>
      {children}
    </Ctx.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth must be inside AuthProvider')
  return ctx
}
