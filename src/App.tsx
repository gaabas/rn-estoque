import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  ArrowLeft, ArrowRight, Box, Check, ChevronRight, ClipboardList, Clock3, Egg, Leaf,
  Milk, PackageOpen, Plus, Search, ShoppingBasket, Warehouse, WifiOff, X,
} from 'lucide-react'
import {
  dateText, itemRecords, items, loadEntries, parseQuantity, quantityText, record, searchText, storageKey,
  type Change, type Entry, type Item,
} from './records'

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

function Dialog({ children, close, title }: { children: ReactNode; close: () => void; title: string }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    ref.current?.showModal()
  }, [])
  return <dialog ref={ref} aria-labelledby="panel-title"
    onCancel={event => { event.preventDefault(); close() }}
    onClick={event => { if (event.target === event.currentTarget) close() }}>
    <div className="sheet">
      <header className="sheet-header">
        <h2 id="panel-title">{title}</h2>
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

export default function App() {
  const writing = useRef(false)
  const [loadError, setLoadError] = useState(false)
  const [entries, setEntries] = useState<Entry[]>(() => {
    try { return loadEntries() } catch { return [] }
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

  const pending = items.filter(item => itemRecords(entries, item).order)
  const visible = items.filter(item => searchText(item.name).includes(searchText(query)))
  const current = selected && itemRecords(entries, selected)

  function navigate(next: 'stock' | 'orders') {
    setScreen(next)
    setError('')
    setFeedback(null)
  }

  function openItem(item: Item, next: Panel = 'actions') {
    setSelected(item)
    setPanel(next)
    setError('')
    setFeedback(null)
  }

  function closeItem() {
    setSelected(null)
    setError('')
    setFeedback(null)
  }

  async function commit(change: Change, result: Feedback['text'], undoLabel?: string) {
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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected) return
    const quantity = parseQuantity(input, selected.fractional)
    if (quantity === null && (panel !== 'details' || input.trim())) {
      setError(selected.fractional ? 'Digite uma quantidade válida, a partir de zero.' : 'Digite um número inteiro, a partir de zero.')
      return
    }
    const itemId = selected.id
    if (panel === 'count' && quantity !== null &&
      await commit({ itemId, type: 'count', quantity, unit: selected.unit, note: note.trim() }, 'Contagem salva neste aparelho.', 'Contagem desfeita')) {
      setPanel('actions')
    }
    if (panel === 'correct' && target && previous !== undefined && quantity !== null &&
      await commit({ itemId, type: 'correct', target, previous, quantity, note: note.trim() }, 'Correção salva neste aparelho.', 'Correção desfeita')) {
      setPanel('actions')
    }
    if (panel === 'details' && target &&
      await commit({ itemId, type: 'details', target, quantity, note: note.trim() }, 'Detalhes salvos neste aparelho.')) {
      setPanel('actions')
    }
  }

  function message(item?: Item) {
    return <>
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

  return <>
    <header className="masthead">
      <div className="shell brand">
        <span className="brand-icon"><Warehouse size={24} aria-hidden /></span>
        <div><strong>Rango in Natura</strong><span>Estoque da cozinha</span></div>
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
      <p className="demo"><span aria-hidden /> Protótipo · Dados fictícios guardados neste aparelho</p>
      {offline && <p className="offline" role="status"><WifiOff size={16} aria-hidden /> Sem conexão · Seus registros continuam neste aparelho.</p>}
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
                {itemRecords(entries, item).order && <span className="pending">Compra pendente</span>}
              </span>
              <ChevronRight className="chevron" size={19} aria-hidden />
            </button>
          </li>)}
        </ul> : <p className="empty">Nenhum insumo encontrado.</p>}
      </section> : <section aria-labelledby="orders-title">
        <div className="section-header">
          <h1 id="orders-title">Compras</h1>
          <span>{pending.length} {pending.length === 1 ? 'pendência' : 'pendências'}</span>
        </div>
        {!selected && message()}
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
              <button type="button" className="button primary" onClick={() =>
                commit({ itemId: item.id, type: 'close', target: order.id }, `${item.name}: compra concluída.`)}>
                <Check size={18} aria-hidden />Marcar como comprado
              </button>
            </div>
          </li>
        })}</ul> : <div className="empty"><PackageOpen size={29} aria-hidden /><p>Nenhuma compra pendente.</p></div>}
      </section>}
    </main>

    {selected && current && <Dialog title={selected.name} close={closeItem}>
      <div className="sheet-summary"><ItemIcon item={selected} /><LastCount item={selected} entries={entries} /></div>
      {message(selected)}
      {panel === 'actions' && <div className="panel-actions">
        <button type="button" className="button primary" onClick={() => openForm('count')}>
          <ClipboardList size={20} aria-hidden />Registrar quantidade<ArrowRight size={18} aria-hidden />
        </button>
        {current.order ? <button type="button" className="button warm" onClick={() => openForm('details')}>
          <ShoppingBasket size={20} aria-hidden />Compra pendente<ChevronRight size={18} aria-hidden />
        </button> : <button type="button" className="button secondary" onClick={() =>
          commit({ itemId: selected.id, type: 'open' }, 'Pedido aberto neste aparelho.', 'Pedido desfeito')}>
          <Plus size={20} aria-hidden />Pedir compra
        </button>}
        <div className="item-links">
          <button type="button" onClick={() => { setError(''); setPanel('history') }}><Clock3 size={17} aria-hidden />Ver histórico</button>
          {current.count && <button type="button" onClick={() => openForm('correct')}>Corrigir última contagem</button>}
        </div>
      </div>}
      {panel !== 'actions' && <button type="button" className="back" onClick={() => { setError(''); setPanel('actions') }}>
        <ArrowLeft size={17} aria-hidden />Voltar às ações
      </button>}
      {panel === 'history' && <section aria-label="Histórico">
        <h3>Histórico</h3>
        {current.history.length ? <ol className="history">{current.history.map(entry => <HistoryEntry key={entry.id} entry={entry} item={selected} />)}</ol>
          : <p className="muted">Ainda não há registros.</p>}
      </section>}
      {panel !== 'actions' && panel !== 'history' && <form onSubmit={submit}>
        <h3>{panel === 'details' ? 'Complementar pedido' : panel === 'correct' ? 'Corrigir última contagem' : 'Nova contagem'}</h3>
        <label htmlFor="quantity">{panel === 'details' ? 'Quantidade sugerida' : 'Quantidade conferida'}{panel === 'details' && <small> (opcional)</small>}</label>
        <div className="quantity-field">
          <input id="quantity" autoComplete="off" inputMode={selected.fractional ? 'decimal' : 'numeric'} value={input} onChange={event => setInput(event.target.value)} />
          <span>{selected.unit}</span>
        </div>
        <label htmlFor="note">{panel === 'count' ? 'Observação' : 'Motivo'}<small> (opcional)</small></label>
        <textarea id="note" rows={2} maxLength={400} value={note} onChange={event => setNote(event.target.value)} />
        <button type="submit" className="button primary"><Check size={18} aria-hidden />
          {panel === 'details' ? 'Salvar detalhes' : panel === 'correct' ? 'Salvar correção' : 'Salvar contagem'}
        </button>
      </form>}
    </Dialog>}
  </>
}
