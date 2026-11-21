import type { Session } from '@supabase/supabase-js'
import { useEffect, useState, type FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { supabase, useConnectedStock } from './connectedStock'
import './style.css'
import './piloto.css'

function PilotStock({ session }: { session: Session }) {
  return <App connected={useConnectedStock(session)} />
}

function Pilot() {
  const [session, setSession] = useState<Session | null | undefined>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, current) => setSession(current))
    return () => subscription.unsubscribe()
  }, [])

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setBusy(true)
    setError('')
    const result = await supabase.auth.signInWithPassword({
      email: String(form.get('email')).trim(), password: String(form.get('password')),
    })
    if (result.error) setError('Não foi possível entrar. Confira o e-mail e a senha.')
    setBusy(false)
  }

  if (session) return <PilotStock key={session.user.id} session={session} />

  return <main className="shell pilot">
    <h1>Estoque</h1>
    <p>Prévia conectada · Dados de teste</p>
    {session === undefined && <p role="status">Carregando sessão…</p>}
    {session === null && <form className="pilot-card" onSubmit={signIn}>
      <label htmlFor="pilot-email">E-mail</label>
      <input id="pilot-email" name="email" type="email" autoComplete="username" required />
      <label htmlFor="pilot-password">Senha</label>
      <input id="pilot-password" name="password" type="password" autoComplete="current-password" required />
      {error && <p role="alert" className="error">{error}</p>}
      <button type="submit" disabled={busy}>Entrar</button>
    </form>}
  </main>
}

createRoot(document.getElementById('root')!).render(<Pilot />)
