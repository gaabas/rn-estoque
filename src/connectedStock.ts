import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import type { Change, Entry, Item } from './records'

export const supabase = createClient(
  import.meta.env.VITE_ESTOQUE_SUPABASE_URL,
  import.meta.env.VITE_ESTOQUE_SUPABASE_KEY,
  { auth: { storageKey: 'rn-estoque-piloto-auth' } },
)

type Snapshot = {
  items: Item[]
  entries: Entry[]
  canClose: boolean
  name: string
  revision: number
}
type Status = {
  command: Entry
  kind: Change['type']
  phase: 'sending' | 'saved' | 'failed'
  retry?: boolean
  message?: string
  undo?: { id: string, label: string }
}

export type ConnectedStock = Omit<Snapshot, 'revision'> & {
  loading: boolean
  error: string
  sending: boolean
  statuses: Record<string, Status>
  blocked: (itemId: string) => boolean
  send: (change: Change) => boolean
  retry: (itemId: string) => void
  refresh: () => void
  signOut: () => void
}

const undoLabels = { count: 'Contagem desfeita', correct: 'Correção desfeita', open: 'Pedido desfeito' }
const empty: Snapshot = { items: [], entries: [], canClose: false, name: '', revision: -1 }

export function useConnectedStock(id: string, kitchenToken: string | undefined, signOutAccount: () => void): ConnectedStock {
  const key = 'rn-estoque-confirmado:' + id
  const request = useCallback((change: Change | null, request_id: string | null) =>
    kitchenToken
      ? supabase.rpc('rn_estoque_cozinha_operacao', { session_token: kitchenToken, change, request_id })
      : supabase.rpc('rn_estoque_operacao', { change, request_id }), [kitchenToken])
  const [snapshot, setSnapshot] = useState<Snapshot>(() => {
    try { return JSON.parse(localStorage.getItem(key) ?? 'null') ?? empty } catch { return empty }
  })
  const draftKey = key + ':envios'
  const [statuses, setStatuses] = useState<Record<string, Status>>(() => {
    try {
      const drafts: Entry[] = JSON.parse(localStorage.getItem(draftKey) ?? '[]')
      return Object.fromEntries(drafts.map(command => [command.itemId, {
        command, kind: command.type, phase: 'failed', retry: true, message: 'Envio sem confirmação. Tente de novo.',
      }]))
    } catch { return {} }
  })
  const current = useRef(statuses)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const denied = useRef(false)
  const alive = useRef(true)
  const latest = useRef(snapshot.revision)
  const reads = useRef(0)

  const accept = useCallback((data: Snapshot) => {
    if (denied.current || data.revision < latest.current) return
    latest.current = data.revision
    setSnapshot(data)
    try { localStorage.setItem(key, JSON.stringify(data)) } catch { /* The connected app also works without disk cache. */ }
  }, [key])

  const rejectAccess = useCallback(() => {
    denied.current = true
    latest.current = -1
    setSnapshot(empty)
    current.current = {}
    setStatuses({})
    try { localStorage.removeItem(key); localStorage.removeItem(draftKey) } catch { /* Storage may be disabled. */ }
    setError('Esta conta ainda não tem acesso ao Estoque.')
  }, [draftKey, key])

  const refresh = useCallback(async () => {
    const read = ++reads.current
    const result = await request(null, null)
    if (!alive.current || read !== reads.current) return
    setLoading(false)
    if (result.error) {
      if (kitchenToken && result.error.code === '28000') {
        rejectAccess()
        signOutAccount()
      } else if (result.error.code === '42501') rejectAccess()
      else setError('Não foi possível atualizar. A lista pode estar desatualizada.')
      return
    }
    denied.current = false
    accept(result.data as Snapshot)
    setError('')
  }, [accept, kitchenToken, rejectAccess, request, signOutAccount])

  useEffect(() => {
    alive.current = true
    function onVisible() {
      if (document.visibilityState === 'visible') void refresh()
    }
    void refresh()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    window.addEventListener('online', onVisible)
    return () => {
      alive.current = false
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
      window.removeEventListener('online', onVisible)
    }
  }, [refresh])

  function status(next: Status) {
    current.current = { ...current.current, [next.command.itemId]: next }
    setStatuses(current.current)
    try {
      const drafts = Object.values(current.current)
        .filter(item => item.phase === 'sending' || item.retry).map(item => item.command)
      localStorage.setItem(draftKey, JSON.stringify(drafts))
    } catch { /* Keep drafts in memory when storage is disabled. */ }
  }

  async function submit(command: Entry) {
    const { id, at: _at, author: _author, ...change } = command
    status({ command, kind: command.type, phase: 'sending' })
    const result = await request(change, id)
    if (!alive.current || denied.current) return
    if (result.error) {
      if (kitchenToken && result.error.code === '28000') {
        signOutAccount()
        return
      }
      const retry = result.status === 0 || result.status >= 500
      const conflicted = result.error.code === '55000'
      status({ command, kind: command.type, phase: 'failed', retry, message: retry
        ? 'Envio sem confirmação. Tente de novo.'
        : conflicted && command.type === 'open'
          ? 'Já existe uma compra pendente. Você pode complementar o pedido.'
          : conflicted ? 'O registro mudou. Confira a lista antes de tentar novamente.'
            : result.error.code === '42501' ? 'Sua conta não tem permissão para essa ação.'
              : 'Não foi possível salvar. Confira os dados.' })
      if (conflicted) void refresh()
      return
    }
    accept(result.data as Snapshot)
    const label = command.type in undoLabels ? undoLabels[command.type as keyof typeof undoLabels] : undefined
    status({ command, kind: command.type, phase: 'saved', undo: label ? { id, label } : undefined })
  }

  function blocked(itemId: string) {
    const state = current.current[itemId]
    return state?.phase === 'sending' || (state?.phase === 'failed' && Boolean(state.retry))
  }

  const optimistic = Object.values(statuses).filter(state => state.phase === 'sending')
  const confirmed = new Set(snapshot.entries.map(entry => entry.id))

  return {
    ...snapshot,
    entries: [...snapshot.entries, ...optimistic.map(state => state.command).filter(entry => !confirmed.has(entry.id))],
    statuses, loading, error, blocked, sending: optimistic.length > 0,
    refresh: () => void refresh(),
    send(change) {
      if (blocked(change.itemId) || denied.current) return false
      void submit({ ...change, id: crypto.randomUUID(), at: new Date().toISOString(), author: snapshot.name })
      return true
    },
    retry(itemId) {
      const state = current.current[itemId]
      if (state?.phase === 'failed' && state.retry) void submit(state.command)
    },
    signOut() {
      if (Object.values(current.current).some(state => state.phase === 'sending')) return
      try { localStorage.removeItem(key) } catch { /* Storage may be disabled. */ }
      signOutAccount()
    },
  }
}
