import { createClient, type Session } from '@supabase/supabase-js'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { dateText } from './records'
import './style.css'
import './piloto.css'

const supabase = createClient(
  import.meta.env.VITE_ESTOQUE_SUPABASE_URL,
  import.meta.env.VITE_ESTOQUE_SUPABASE_KEY,
  { auth: { storageKey: 'rn-estoque-piloto-auth' } },
)

const labels = { count: 'Contagem física', open: 'Pedido aberto', close: 'Compra concluída' }
type Action = keyof typeof labels
type RecordEntry = { id: string, action: Action, at: string, quantity: number | null }
type Snapshot = {
  item_id: string
  item_name: string
  unit: string
  count: { quantity: number, at: string } | null
  pending_id: string | null
  history: RecordEntry[]
}
type Command = {
  operation: Action
  item: string
  request_id: string
  amount: number | null
  expected_order: string | null
}

function PilotStock() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [quantity, setQuantity] = useState('')
  const [retry, setRetry] = useState<Command | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const sending = useRef(false)
  const revision = useRef(0)

  async function refresh() {
    if (sending.current) return
    const current = ++revision.current
    const result = await supabase.rpc('rn_estoque_piloto', {
      operation: 'read', item: null, request_id: null, amount: null, expected_order: null,
    })
    if (revision.current !== current) return
    if (result.error) {
      setError(result.error.code === '42501' ? 'Esta conta ainda não tem acesso ao Estoque.' : 'Não foi possível atualizar. Confira a conexão e tente de novo.')
      if (result.error.code === '42501') setSnapshot(null)
      return
    }
    setSnapshot(result.data as Snapshot)
    setError('')
  }

  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible') void refresh()
    }
    void refresh()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    window.addEventListener('online', onVisible)
    return () => {
      ++revision.current
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
      window.removeEventListener('online', onVisible)
    }
  }, [])

  async function send(command: Command) {
    if (sending.current) return
    sending.current = true
    ++revision.current
    setBusy(true)
    setMessage('')
    setError('')
    const result = await supabase.rpc('rn_estoque_piloto', command)
    sending.current = false
    setBusy(false)
    if (result.error) {
      if (!result.status || result.status >= 500) {
        setRetry(command)
        setError('O envio ainda não foi confirmado. Tente de novo quando tiver conexão.')
      } else {
        setRetry(null)
        if (result.error.code === '55000') {
          await refresh()
          setError('A situação da compra mudou. Confira a lista atualizada.')
        } else {
          setError(result.error.code === '42501' ? 'Esta conta ainda não tem acesso ao Estoque.' : 'Não foi possível salvar. Confira os dados.')
        }
      }
      return
    }
    setRetry(null)
    setSnapshot(result.data as Snapshot)
    if (command.operation === 'count') setQuantity('')
    setMessage('Salvo')
  }

  function update(operation: Action, amount: number | null = null) {
    if (!snapshot || retry) return
    void send({
      operation, item: snapshot.item_id, request_id: crypto.randomUUID(), amount,
      expected_order: operation === 'close' ? snapshot.pending_id : null,
    })
  }

  function count(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!/^\d{1,7}$/.test(quantity.trim()) || Number(quantity) > 1000000) {
      setError('Digite uma quantidade inteira de 0 a 1.000.000.')
      return
    }
    update('count', Number(quantity))
  }

  return <>
    <div className="pilot-actions">
      <button type="button" disabled={busy} onClick={() => void refresh()}>Atualizar lista</button>
      <button type="button" disabled={busy} onClick={() => void supabase.auth.signOut({ scope: 'local' })}>Sair</button>
    </div>
    {error && <p role="alert" className="error">{error}</p>}
    {message && <p role="status">{message}</p>}
    {retry && <button type="button" disabled={busy} onClick={() => void send(retry)}>Tentar de novo</button>}
    {snapshot && <>
      <section className="pilot-card" aria-labelledby="item-heading">
        <h2 id="item-heading">{snapshot.item_name}</h2>
        {snapshot.count
          ? <p>Última contagem: {snapshot.count.quantity} {snapshot.unit} <time dateTime={snapshot.count.at}>{dateText(snapshot.count.at)}</time></p>
          : <p>Sem contagem</p>}
        <form onSubmit={count}>
          <label htmlFor="pilot-quantity">Quantidade conferida</label>
          <input id="pilot-quantity" inputMode="numeric" value={quantity} disabled={busy || Boolean(retry)}
            onChange={event => setQuantity(event.target.value)} required />
          <button type="submit" disabled={busy || Boolean(retry)}>Registrar quantidade</button>
        </form>
      </section>
      <section className="pilot-card" aria-labelledby="orders-heading">
        <h2 id="orders-heading">Compras</h2>
        <p>{snapshot.pending_id ? 'Compra pendente' : 'Nenhuma compra pendente.'}</p>
        <button type="button" disabled={busy || Boolean(retry)}
          onClick={() => update(snapshot.pending_id ? 'close' : 'open')}>
          {snapshot.pending_id ? 'Marcar como comprado' : 'Pedir compra'}
        </button>
      </section>
      <section className="pilot-card" aria-labelledby="history-heading">
        <h2 id="history-heading">Histórico</h2>
        {snapshot.history.length === 0 ? <p>Sem registros.</p> : <ul>{snapshot.history.map(entry =>
          <li key={entry.id}>{labels[entry.action]}{entry.quantity !== null && ` · ${entry.quantity} ${snapshot.unit}`}
            <time dateTime={entry.at}>{dateText(entry.at)}</time>
          </li>,
        )}</ul>}
      </section>
    </>}
  </>
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
    {session && <PilotStock key={session.user.id} />}
  </main>
}

createRoot(document.getElementById('root')!).render(<Pilot />)
