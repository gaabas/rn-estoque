import type { Session } from '@supabase/supabase-js'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { supabase, useConnectedStock } from './connectedStock'
import './style.css'
import './piloto.css'

type KitchenSession = { id: string, token: string }

const kitchenKey = 'rn-estoque-cozinha'
const signOutBuyer = () => { void supabase.auth.signOut({ scope: 'local' }) }

function KitchenInvites() {
  const [url, setUrl] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = String(new FormData(event.currentTarget).get('name')).trim()
    setBusy(true)
    setUrl('')
    setError('')
    setStatus('')
    const { data, error: failure } = await supabase.rpc('rn_estoque_cozinha_gerar_convite', { name })
    setBusy(false)
    if (failure || !data?.token) {
      setError(failure?.code === '22023' ? 'Confira o nome.' : 'Não foi possível gerar o link.')
      return
    }
    const link = new URL(location.pathname, location.origin)
    link.hash = 'convite=' + data.token
    setUrl(link.href)
    setStatus('Link pronto. Envie apenas para a pessoa convidada.')
  }

  return <details className="kitchen-invites">
    <summary>Acessos da cozinha</summary>
    <form onSubmit={invite}>
      <label htmlFor="invite-name">Nome da pessoa</label>
      <input id="invite-name" name="name" maxLength={50} autoComplete="off" required />
      <button type="submit" className="button secondary" disabled={busy}>Gerar link de acesso</button>
    </form>
    {error && <p role="alert" className="error">{error}</p>}
    {status && <p role="status">{status}</p>}
    {url && <div className="invite-link">
      <input aria-label="Link de acesso" value={url} readOnly onFocus={event => event.currentTarget.select()} />
      <button type="button" className="button secondary" onClick={async () => {
        try {
          await navigator.clipboard.writeText(url)
          setStatus('Link copiado.')
        } catch {
          setStatus('Selecione o campo do link para copiar.')
        }
      }}>Copiar link</button>
      <small>Válido por 48 horas e para um único uso.</small>
    </div>}
  </details>
}

function PilotStock({ id, token, signOut }: { id: string, token?: string, signOut: () => void }) {
  const connected = useConnectedStock(id, token, signOut)
  return <App connected={connected} accessTools={!token && <KitchenInvites />} />
}

function readKitchenSession(): KitchenSession | null {
  try {
    const saved = JSON.parse(localStorage.getItem(kitchenKey) ?? 'null') as KitchenSession | null
    return saved && typeof saved.id === 'string' && /^[a-f0-9]{64}$/.test(saved.token) ? saved : null
  } catch { return null }
}

function Pilot() {
  const [buyer, setBuyer] = useState<Session | null | undefined>()
  const [kitchen, setKitchen] = useState(readKitchenSession)
  const [invite, setInvite] = useState(() => new URLSearchParams(location.hash.slice(1)).get('convite'))
  const [invitedName, setInvitedName] = useState<string | null>()
  const [buyerForm, setBuyerForm] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, current) => setBuyer(current))
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!invite) return
    let active = true
    void supabase.rpc('rn_estoque_cozinha_convite', { token: invite }).then(({ data, error: failure }) => {
      if (!active) return
      setInvitedName(data?.name ?? null)
      if (failure) setError('Não foi possível abrir o convite. Confira a conexão e recarregue a página.')
    })
    return () => { active = false }
  }, [invite])

  const signOutKitchen = useCallback(() => {
    setKitchen(null)
    setBuyerForm(false)
    try { localStorage.removeItem(kitchenKey) } catch { /* Storage may be unavailable. */ }
    if (kitchen) void supabase.rpc('rn_estoque_cozinha_sair', { session_token: kitchen.token })
  }, [kitchen])

  async function enter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const pin = String(form.get('pin') ?? '')
    if (invite && pin !== form.get('confirmation')) {
      setError('Os PINs estão diferentes. Digite o mesmo número nos dois campos.')
      return
    }
    setBusy(true)
    setError('')
    if (buyerForm && !invite) {
      const { error: failure } = await supabase.auth.signInWithPassword({
        email: String(form.get('email')).trim(), password: String(form.get('password')),
      })
      if (failure) setError('Não foi possível entrar. Confira o e-mail e a senha.')
    } else {
      const { data, error: failure } = invite
        ? await supabase.rpc('rn_estoque_cozinha_ativar', { token: invite, pin })
        : await supabase.rpc('rn_estoque_cozinha_entrar', { username: String(form.get('username')).trim(), pin })
      if (data?.token && data?.id) {
        if (buyer) await supabase.auth.signOut({ scope: 'local' })
        if (kitchen) void supabase.rpc('rn_estoque_cozinha_sair', { session_token: kitchen.token })
        try { localStorage.setItem(kitchenKey, JSON.stringify(data)) } catch { /* The current session still works. */ }
        if (invite) history.replaceState(null, '', location.pathname + location.search)
        setInvite(null)
        setKitchen(data)
      } else if (failure) {
        setError('Não foi possível entrar. Confira a conexão e tente novamente.')
      } else if (data?.limited) {
        setError('Muitas tentativas. Aguarde 10 minutos ou peça um novo link ao Gabriel.')
      } else {
        setError(invite ? 'O link venceu ou já foi usado. Peça outro ao Gabriel.' : 'Nome ou PIN incorreto. Se esqueceu o PIN, peça um novo link ao Gabriel.')
      }
    }
    setBusy(false)
  }

  if (!invite && kitchen) return <PilotStock key={kitchen.id} id={kitchen.id} token={kitchen.token} signOut={signOutKitchen} />
  if (!invite && buyer) return <PilotStock key={buyer.user.id} id={buyer.user.id} signOut={signOutBuyer} />

  const pinField = (id: string, label: string, name: string) => <>
    <label htmlFor={id}>{label}</label>
    <input id={id} name={name} type="password" inputMode="numeric" autoComplete={invite ? 'new-password' : 'current-password'}
      minLength={6} maxLength={6} pattern="[0-9]{6}" required />
  </>

  return <main className="shell pilot">
    <h1>Estoque</h1>
    {invite && invitedName && <h2>{invitedName}</h2>}
    {invite && invitedName === undefined && <p role="status">Abrindo convite…</p>}
    {invite && invitedName === null && !error && <p role="alert">O link venceu ou já foi usado. Peça outro ao Gabriel.</p>}
    {!invite && buyer === undefined && <p role="status">Carregando sessão…</p>}
    {((invite && invitedName) || (!invite && buyer === null)) && <form className="pilot-card" onSubmit={enter}>
      {invite ? <>
        <p>Escolha um PIN de seis números para entrar no Estoque.</p>
        {pinField('setup-pin', 'Escolha seu PIN', 'pin')}
        {pinField('repeat-pin', 'Repita seu PIN', 'confirmation')}
      </> : buyerForm ? <>
        <label htmlFor="pilot-email">E-mail</label>
        <input id="pilot-email" name="email" type="email" autoComplete="username" required />
        <label htmlFor="pilot-password">Senha</label>
        <input id="pilot-password" name="password" type="password" autoComplete="current-password" required />
      </> : <>
        <label htmlFor="kitchen-name">Nome</label>
        <input id="kitchen-name" name="username" autoComplete="username" maxLength={50} required />
        {pinField('kitchen-pin', 'PIN', 'pin')}
      </>}
      <button type="submit" disabled={busy}>{invite ? 'Começar' : 'Entrar'}</button>
    </form>}
    {error && <p role="alert" className="error">{error}</p>}
    {!invite && buyer === null && <button type="button" className="pilot-access-switch" onClick={() => {
      setError('')
      setBuyerForm(!buyerForm)
    }}>{buyerForm ? 'Acesso da cozinha' : 'Acesso do Gabriel'}</button>}
  </main>
}

createRoot(document.getElementById('root')!).render(<Pilot />)
