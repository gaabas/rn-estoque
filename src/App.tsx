import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  ArrowLeft, ArrowRight, Box, Check, ChevronRight, ClipboardList, Clock3, ChevronDown, Egg, Leaf,
  Milk, Minus, PackageOpen, Plus, RefreshCw, Search, Settings, ShoppingBasket, Warehouse, WifiOff, X,
} from 'lucide-react'
import {
  dateText, itemRecords, items, loadEntries, parseQuantity, quantityText, record, searchText, storageKey,
  type Change, type Entry, type Item,
} from './records'

import type { ConnectedStock } from './connectedStock'
import { usePwaUpdate } from './usePwaUpdate'

const groupIcons = { Laticínios: Milk, Despensa: Box, Proteínas: Egg, Hortifruti: Leaf }
type Panel = 'actions' | 'count' | 'correct' | 'details' | 'history'
type Feedback = { text: string; undo?: { id: string; label: string } }

function ItemIcon({ item }: { item: Item }) {
  const Icon = groupIcons[item.group]
  return <span className="item-icon" data-group={item.group}><Icon size={20} aria-hidden /></span>
}

function LastCount({ item, entries }: { item: Item; entries: Entry[] }) {
  const { count, quantity } = itemRecords(entries, item)
  if (!count || quantity === undefined) return <span className="muted">Sem contagem</span>
  return <span className="last-count">
    <strong>{quantityText(quantity, item.unit)}</strong>
    <span aria-hidden>·</span>
    <time dateTime={count.at}>{dateText(count.at)}</time>
  </span>
}

function Dialog({ children, close, title, open = true }: { children: ReactNode; close: () => void; title: string; open?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const dialog = ref.current
    if (open && !dialog?.open) dialog?.showModal()
    if (!open && dialog?.open) dialog.close()
  }, [open])
  return <dialog ref={ref} aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); close() }}
    onClick={event => { if (event.target === event.currentTarget) close() }}>
    <div className="sheet">
      <header className="sheet-header">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="icon-button" onClick={close} aria-label="Fechar painel"><X size={22} /></button>
      </header>
      {children}
    </div>
  </dialog>
}

function HistoryEntry({ entry, item }: { entry: Entry; item: Item }) {
  let title: string
  let value: string | undefined
  let note: string | undefined
  switch (entry.type) {
    case 'count':
      title = 'Contagem física'
      value = quantityText(entry.quantity, entry.unit)
      note = entry.note
      break
    case 'correct':
      title = 'Contagem corrigida'
      value = `${quantityText(entry.previous, item.unit)} → ${quantityText(entry.quantity, item.unit)}`
      note = entry.note
      break
    case 'open':
      title = 'Pedido aberto'
      break
    case 'details':
      title = 'Pedido complementado'
      value = entry.quantity === null ? undefined : `Sugestão de compra: ${quantityText(entry.quantity, item.unit)}`
      note = entry.note
      break
    case 'close':
      title = 'Pedido concluído'
      break
    case 'undo':
      title = entry.label
      break
  }
  return <li>
    <strong>{title}</strong>
    {value && <p>{value}</p>}
    {note && <p>{note}</p>}
    <small><time dateTime={entry.at}>{dateText(entry.at)}</time> · {entry.author}</small>
  </li>
}

export default function App({ connected, accessTools }: { connected?: ConnectedStock, accessTools?: ReactNode }) {
  const writing = useRef(false)
  const applyUpdate = usePwaUpdate()
  const [settings, setSettings] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshNotice, setRefreshNotice] = useState('')
  const refreshIcon = useRef<SVGSVGElement>(null)
  const updateBlocked = useRef(false)
  const [loadError, setLoadError] = useState(false)
  const [localEntries, setEntries] = useState<Entry[]>(() => {
    try { return connected ? [] : loadEntries() } catch { return [] }
  })
  const [screen, setScreen] = useState<'stock' | 'orders'>('stock')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Item | null>(null)
  const [panel, setPanel] = useState<Panel>('actions')
  const [input, setInput] = useState('')
  const [note, setNote] = useState('')
  const [target, setTarget] = useState<string | null>(null)
  const [previous, setPrevious] = useState<number | undefined>()
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [error, setError] = useState('')
  const [offline, setOffline] = useState(!navigator.onLine)

  useEffect(() => {
    const connectionChanged = () => setOffline(!navigator.onLine)
    const refresh = () => {
      if (connected) return
      try { setEntries(loadEntries()); setLoadError(false) } catch { setLoadError(true) }
    }
    const sync = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) refresh()
    }
    refresh()
    window.addEventListener('online', connectionChanged)
    window.addEventListener('offline', connectionChanged)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener('online', connectionChanged)
      window.removeEventListener('offline', connectionChanged)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const catalog = connected?.items ?? items
  const entries = connected?.entries ?? localEntries
  const pending = catalog.filter(item => itemRecords(entries, item).order)
  const visible = catalog.filter(item => searchText(item.name).includes(searchText(query)))
  const current = selected && itemRecords(entries, selected)
  const quickCount = Boolean(connected && panel === 'actions')
  const formPanel = quickCount ? 'count' : panel
  const step = selected?.fractional ? 0.25 : 1
  const typedQuantity = selected ? parseQuantity(input, selected.fractional) : null
  const itemBlocked = selected ? connected?.blocked(selected.id) : false

  function navigate(next: 'stock' | 'orders') {
    setScreen(next)
    setError('')
    setFeedback(null)
  }

  function openItem(item: Item, next: Panel = 'actions') {
    setSelected(item)
    setPanel(next)
    setInput('')
    setNote('')
    setError('')
    setFeedback(null)
  }

  function closeItem() {
    setSelected(null)
    setError('')
    setFeedback(null)
  }

  async function commit(change: Change, result: Feedback['text'], undoLabel?: string) {
    if (connected) {
      const accepted = connected.send(change)
      if (accepted) setError('')
      return accepted
    }
    if (writing.current) return false
    writing.current = true
    try {
      const { entries: next, entry } = await record(change)
      setEntries(next)
      setLoadError(false)
      if (!entry) {
        setError(change.type === 'open' ? 'Já existe uma compra pendente.' : 'O registro mudou. Volte e confira os dados atualizados.')
        return false
      }
      setError('')
      setFeedback({ text: result, undo: undoLabel ? { id: entry.id, label: undoLabel } : undefined })
      return true
    } catch {
      setError('Não foi possível salvar neste aparelho. Tente novamente.')
      return false
    } finally {
      writing.current = false
    }
  }

  function openForm(next: 'count' | 'correct' | 'details') {
    if (!current) return
    const value = next === 'correct' ? current.quantity : next === 'details' ? current.details?.quantity : null
    setInput(value == null ? '' : String(value).replace('.', ','))
    setNote(next === 'details' ? current.details?.note ?? '' : '')
    setTarget(next === 'details' ? current.order?.id ?? null : current.count?.id ?? null)
    setPrevious(current.quantity)
    setError('')
    setFeedback(null)
    setPanel(next)
  }

  function stepQuantity(direction: -1 | 1) {
    const digits = selected?.fractional ? Math.max(2, Math.min(20, input.trim().split(/[.,]/)[1]?.length ?? 0)) : 0
    const next = Math.max(0, (typedQuantity ?? 0) + direction * step)
    setInput(Number(next.toFixed(digits)).toLocaleString('pt-BR', { useGrouping: false, maximumFractionDigits: digits }))
    setError('')
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected) return
    const quantity = typedQuantity
    if (quantity === null && (formPanel !== 'details' || input.trim())) {
      setError(selected.fractional ? 'Digite uma quantidade válida, a partir de zero.' : 'Digite um número inteiro, a partir de zero.')
      return
    }
    const itemId = selected.id
    if (formPanel === 'count' && quantity !== null &&
      await commit({ itemId, type: 'count', quantity, unit: selected.unit, note: note.trim() }, 'Contagem salva neste aparelho.', 'Contagem desfeita')) {
      setInput('')
      setNote('')
      setPanel('actions')
    }
    if (formPanel === 'correct' && target && previous !== undefined && quantity !== null &&
      await commit({ itemId, type: 'correct', target, previous, quantity, note: note.trim() }, 'Correção salva neste aparelho.', 'Correção desfeita')) {
      setInput('')
      setNote('')
      setPanel('actions')
    }
    if (formPanel === 'details' && target &&
      await commit({ itemId, type: 'details', target, quantity, note: note.trim() }, 'Detalhes salvos neste aparelho.')) {
      setInput('')
      setNote('')
      setPanel('actions')
    }
  }

  function syncStatus(item: Item, inline = false) {
    const state = connected?.statuses[item.id]
    if (!state) return null
    return <>
      {state.phase === 'sending' && <span role="status">Enviando…</span>}
      {state.phase === 'saved' && <span role="status">Salvo</span>}
      {state.phase === 'failed' && <span className="error" role="alert">{state.message}</span>}
      {!inline && state.phase === 'failed' && state.retry &&
        <button type="button" className="button secondary" aria-label={`Tentar de novo: ${item.name}`}
          onClick={() => connected?.retry(item.id)}>Tentar de novo</button>}
      {!inline && state.phase === 'saved' && state.undo &&
        <button type="button" className="button secondary" onClick={() => {
          const undo = state.undo!
          connected?.send({ itemId: item.id, type: 'undo', target: undo.id, label: undo.label })
        }}>Desfazer</button>}
    </>
  }

  function message(item?: Item) {
    return <>
      {item && connected?.statuses[item.id] && <div
        className={connected.statuses[item.id]?.phase === 'failed' ? 'sync-failure' : 'feedback'}>
        {syncStatus(item)}
      </div>}
      {error && <p className="error" role="alert">{error}</p>}
      {feedback && <div className="feedback">
        <span role="status"><Check size={17} aria-hidden />{feedback.text}</span>
        {item && feedback.undo && <button type="button" onClick={() => {
          const undo = feedback.undo!
          commit({ itemId: item.id, type: 'undo', target: undo.id, label: undo.label }, `${undo.label}.`)
        }}>Desfazer</button>}
      </div>}
    </>
  }

  useEffect(() => {
    updateBlocked.current = Boolean(selected || settings || connected?.sending)
  }, [selected, settings, connected?.sending])

  async function refreshFromHeader() {
    if (!connected || refreshing) return
    setRefreshing(true)
    setRefreshNotice('')
    const spin = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? undefined
      : refreshIcon.current?.animate(
        [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }],
        { duration: 500, easing: 'ease-in-out' },
      )
    const rotation = spin?.finished.catch(() => undefined)
    if (applyUpdate) {
      await rotation
      setRefreshing(false)
      if (!updateBlocked.current) applyUpdate()
      return
    }
    const [success] = await Promise.all([connected.refresh(), rotation])
    setRefreshing(false)
    if (success) setRefreshNotice('Lista atualizada.')
  }

  return <>
    <header className="masthead">
      <div className="shell brand">
        <span className="brand-icon"><Warehouse size={24} aria-hidden /></span>
        <div className="brand-text"><strong>Rango in Natura</strong><span>Estoque da cozinha</span></div>
        {connected && <div className="masthead-actions">
          <button type="button" className="masthead-button"
            aria-label={applyUpdate ? 'Atualizar aplicativo' : 'Atualizar lista'}
            title={applyUpdate ? 'Nova versão disponível' : 'Atualizar lista'}
            disabled={refreshing || Boolean(applyUpdate && connected.sending)}
            onClick={() => void refreshFromHeader()}>
            <RefreshCw ref={refreshIcon} size={21} aria-hidden />
            {applyUpdate && <i className="update-dot" aria-hidden />}
          </button>
          <button type="button" className="masthead-button" aria-label="Configurações" title="Configurações"
            aria-haspopup="dialog" onClick={() => setSettings(true)}>
            <Settings size={22} aria-hidden />
          </button>
        </div>}
      </div>
    </header>
    <main className="shell">
      <nav className="navigation" aria-label="Telas principais">
        <button type="button" aria-current={screen === 'stock' ? 'page' : undefined} onClick={() => navigate('stock')}>
          <ClipboardList size={19} aria-hidden />Estoque
        </button>
        <button type="button" aria-current={screen === 'orders' ? 'page' : undefined} onClick={() => navigate('orders')}>
          <ShoppingBasket size={19} aria-hidden />Compras
          {pending.length > 0 && <span className="nav-count">{pending.length}</span>}
        </button>
      </nav>
      {!connected && <p className="demo"><span aria-hidden /> Protótipo · Dados fictícios guardados neste aparelho</p>}
      <span className="refresh-notice" role="status">{refreshing ? (applyUpdate ? 'Atualizando aplicativo…' : 'Atualizando lista…') : refreshNotice}</span>
      {connected?.error && <p role="alert" className="error">{connected.error}</p>}
      {connected?.loading && <p role="status">Carregando estoque…</p>}
      {!connected && applyUpdate && !selected && <div className="update">
        <span role="status">Atualização disponível</span>
        <button type="button" onClick={() => { if (!writing.current) applyUpdate() }}>Atualizar agora</button>
      </div>}
      {offline && <p className="offline" role="status"><WifiOff size={16} aria-hidden /> {connected ? 'Sem conexão · A lista pode estar desatualizada.' : 'Sem conexão · Seus registros continuam neste aparelho.'}</p>}
      {loadError && <p className="error" role="alert">Não foi possível ler os registros deste aparelho.</p>}

      {screen === 'stock' ? <section aria-labelledby="stock-title">
        <div className="section-header">
          <h1 id="stock-title">Estoque</h1>
          <span>{visible.length} {visible.length === 1 ? 'insumo' : 'insumos'}</span>
        </div>
        <div className="search">
          <Search size={20} aria-hidden />
          <input type="search" aria-label="Buscar insumo" placeholder="Buscar insumo" value={query} onChange={event => setQuery(event.target.value)} />
        </div>
        {visible.length ? <ul className="stock-list">
          {visible.map(item => <li key={item.id}>
            <button type="button" className="stock-row" onClick={() => openItem(item)}>
              <ItemIcon item={item} />
              <span className="item-description">
                <strong>{item.name}</strong>
                <LastCount item={item} entries={entries} />
                {syncStatus(item, true)}
                {itemRecords(entries, item).order && <span className="pending">Compra pendente</span>}
              </span>
              <ChevronRight className="chevron" size={19} aria-hidden />
            </button>
            {connected?.statuses[item.id]?.phase === 'failed' && connected.statuses[item.id]?.retry &&
              <button type="button" className="button secondary" aria-label={`Tentar de novo: ${item.name}`}
                onClick={() => connected.retry(item.id)}>Tentar de novo</button>}
          </li>)}
        </ul> : <p className="empty">Nenhum insumo encontrado.</p>}
      </section> : <section aria-labelledby="orders-title">
        <div className="section-header">
          <h1 id="orders-title">Compras</h1>
          <span>{pending.length} {pending.length === 1 ? 'pendência' : 'pendências'}</span>
        </div>
        {!selected && message()}
        {connected && catalog.filter(item => {
          const status = connected.statuses[item.id]
          return status?.kind === 'close'
        }).map(item => <div className="connected-result" key={item.id}>
          <span>{item.name}</span>{syncStatus(item)}
        </div>)}
        {pending.length ? <ul className="order-list">{pending.map(item => {
          const { order, details } = itemRecords(entries, item)
          if (!order) return null
          return <li className="order-card" key={order.id}>
            <div className="order-header">
              <ItemIcon item={item} /><div><h2>{item.name}</h2><LastCount item={item} entries={entries} /></div>
            </div>
            {details?.note && <p>{details.note}</p>}
            {details?.quantity != null && <p>Sugestão de compra: <strong>{quantityText(details.quantity, item.unit)}</strong></p>}
            <div className="order-actions">
              <button type="button" className="button secondary" onClick={() => openItem(item, 'history')}><Clock3 size={17} aria-hidden />Histórico</button>
              {(!connected || connected.canClose) && <button type="button" className="button primary"
                disabled={connected?.blocked(item.id)} onClick={() =>
                commit({ itemId: item.id, type: 'close', target: order.id }, `${item.name}: compra concluída.`)}>
                <Check size={18} aria-hidden />Marcar como comprado
              </button>}
            </div>
          </li>
        })}</ul> : <div className="empty"><PackageOpen size={29} aria-hidden /><p>Nenhuma compra pendente.</p></div>}
      </section>}
    </main>

    {connected && <Dialog title="Configurações" open={settings} close={() => setSettings(false)}>
      <div className="settings-sheet">
        {connected.name && <p className="muted">{connected.name}</p>}
        {connected.canClose && accessTools}
        <button type="button" className="button secondary" disabled={connected.sending} onClick={connected.signOut}>Sair</button>
      </div>
    </Dialog>}

    {selected && current && <Dialog title={selected.name} close={closeItem}>
      <div className="sheet-summary"><ItemIcon item={selected} /><LastCount item={selected} entries={entries} /></div>
      {message(selected)}
      {panel !== 'actions' && <button type="button" className="back" onClick={() => {
        if (panel !== 'history') { setInput(''); setNote('') }
        setError('')
        setPanel('actions')
      }}>
        <ArrowLeft size={17} aria-hidden />Voltar às ações
      </button>}
      {(formPanel === 'count' || formPanel === 'correct' || formPanel === 'details') && <form
        className={quickCount ? 'quick-count' : undefined} onSubmit={submit}>
        {!quickCount && <h3>{formPanel === 'details' ? 'Complementar pedido' : formPanel === 'correct' ? 'Corrigir última contagem' : 'Nova contagem'}</h3>}
        <label htmlFor="quantity">{formPanel === 'details' ? 'Quantidade sugerida' : 'Quantidade conferida'}{formPanel === 'details' && <small> (opcional)</small>}</label>
        <div className={quickCount ? 'quantity-stepper' : undefined}>
          {quickCount && <button type="button" className="icon-button" aria-label="Diminuir quantidade"
            disabled={itemBlocked || typedQuantity === null || typedQuantity === 0} onClick={() => stepQuantity(-1)}>
            <Minus size={24} aria-hidden />
          </button>}
          <div className={quickCount ? 'quantity-stepper-value' : 'quantity-field'}>
            <input id="quantity" autoComplete="off" inputMode={selected.fractional ? 'decimal' : 'numeric'}
              value={input} disabled={quickCount && itemBlocked} placeholder={quickCount ? '0' : undefined}
              onChange={event => setInput(event.target.value)} />
            <span>{selected.unit}</span>
          </div>
          {quickCount && <button type="button" className="icon-button" aria-label="Aumentar quantidade"
            disabled={itemBlocked || (typedQuantity ?? 0) + step > Number.MAX_SAFE_INTEGER}
            onClick={() => stepQuantity(1)}><Plus size={24} aria-hidden />
          </button>}
        </div>
        {quickCount ? <>
          <small className="quantity-hint">Toque no valor para digitar</small>
          <details className="count-note">
            <summary><ChevronDown size={16} aria-hidden />Observação <small>(opcional)</small></summary>
            <textarea aria-label="Observação" rows={2} maxLength={400} value={note}
              disabled={itemBlocked} onChange={event => setNote(event.target.value)} />
          </details>
        </> : <>
          <label htmlFor="note">{formPanel === 'count' ? 'Observação' : 'Motivo'}<small> (opcional)</small></label>
          <textarea id="note" rows={2} maxLength={400} value={note} onChange={event => setNote(event.target.value)} />
        </>}
        <button type="submit" className="button primary" disabled={itemBlocked || (quickCount && typedQuantity === null)}>
          <Check size={18} aria-hidden />
          {formPanel === 'details' ? 'Salvar detalhes' : formPanel === 'correct' ? 'Salvar correção' : 'Salvar contagem'}
        </button>
      </form>}
      {panel === 'actions' && <div className="panel-actions">
        {!quickCount && <button type="button" className="button primary" onClick={() => openForm('count')}>
          <ClipboardList size={20} aria-hidden />Registrar quantidade<ArrowRight size={18} aria-hidden />
        </button>}
        {current.order ? <button type="button" className="button warm" disabled={connected?.blocked(selected.id)} onClick={() => openForm('details')}>
          <ShoppingBasket size={20} aria-hidden />{connected ? 'Complementar pedido' : 'Compra pendente'}<ChevronRight size={18} aria-hidden />
        </button> : <button type="button" className="button secondary" disabled={connected?.blocked(selected.id)} onClick={() =>
          commit({ itemId: selected.id, type: 'open' }, 'Pedido aberto neste aparelho.', 'Pedido desfeito')}>
          <Plus size={20} aria-hidden />Pedir compra
        </button>}
        <div className="item-links">
          <button type="button" onClick={() => { setError(''); setPanel('history') }}><Clock3 size={17} aria-hidden />Ver histórico</button>
          {current.count && <button type="button" disabled={connected?.blocked(selected.id)} onClick={() => openForm('correct')}>Corrigir última contagem</button>}
        </div>
      </div>}
      {panel === 'history' && <section aria-label="Histórico">
        <h3>Histórico</h3>
        {current.history.length ? <ol className="history">{current.history.map(entry => <HistoryEntry key={entry.id} entry={entry} item={selected} />)}</ol>
          : <p className="muted">Ainda não há registros.</p>}
      </section>}
    </Dialog>}
  </>
}
