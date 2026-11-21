export const items = [
  { id: 'creme-de-leite', name: 'Creme de leite', group: 'Laticínios', unit: 'caixas', fractional: false },
  { id: 'farinha-de-trigo', name: 'Farinha de trigo', group: 'Despensa', unit: 'kg', fractional: true },
  { id: 'arroz', name: 'Arroz', group: 'Despensa', unit: 'kg', fractional: true },
  { id: 'feijao', name: 'Feijão', group: 'Despensa', unit: 'kg', fractional: true },
  { id: 'frango', name: 'Peito de frango', group: 'Proteínas', unit: 'kg', fractional: true },
  { id: 'cebola', name: 'Cebola', group: 'Hortifruti', unit: 'kg', fractional: true },
  { id: 'tomate', name: 'Tomate', group: 'Hortifruti', unit: 'kg', fractional: true },
  { id: 'azeite', name: 'Azeite', group: 'Despensa', unit: 'garrafas', fractional: false },
  { id: 'ovos', name: 'Ovos', group: 'Proteínas', unit: 'unidades', fractional: false },
  { id: 'leite', name: 'Leite integral', group: 'Laticínios', unit: 'litros', fractional: true },
] as const

export type Item = (typeof items)[number]
type Action =
  | { type: 'count'; quantity: number; unit: Item['unit']; note: string }
  | { type: 'correct'; target: string; previous: number; quantity: number; note: string }
  | { type: 'open' }
  | { type: 'details'; target: string; quantity: number | null; note: string }
  | { type: 'close'; target: string }
  | { type: 'undo'; target: string; label: string }

export type Entry = Action & { id: string; itemId: Item['id']; at: string; author: string }
export type Change = Action & { itemId: Item['id'] }

export const storageKey = 'rn-estoque-demo-v1'
const demoAuthor = 'Equipe (demonstração)'
const seed: Entry[] = [
  { id: 'demo-creme', itemId: 'creme-de-leite', at: '2026-11-18T11:30:00-03:00', author: demoAuthor, type: 'count', quantity: 4, unit: 'caixas', note: '' },
  { id: 'demo-arroz', itemId: 'arroz', at: '2026-11-18T11:32:00-03:00', author: demoAuthor, type: 'count', quantity: 12, unit: 'kg', note: '' },
  { id: 'demo-feijao', itemId: 'feijao', at: '2026-11-18T11:34:00-03:00', author: demoAuthor, type: 'count', quantity: 5, unit: 'kg', note: '' },
  { id: 'demo-frango', itemId: 'frango', at: '2026-11-18T11:35:00-03:00', author: demoAuthor, type: 'count', quantity: 6.5, unit: 'kg', note: '' },
  { id: 'demo-cebola', itemId: 'cebola', at: '2026-11-18T11:40:00-03:00', author: demoAuthor, type: 'count', quantity: 3, unit: 'kg', note: '' },
  { id: 'demo-ovos', itemId: 'ovos', at: '2026-11-18T11:45:00-03:00', author: demoAuthor, type: 'count', quantity: 18, unit: 'unidades', note: '' },
]

export function loadEntries(): Entry[] {
  const saved = localStorage.getItem(storageKey)
  if (saved === null) return seed
  const entries = JSON.parse(saved)
  if (!Array.isArray(entries)) throw new Error('Registros locais ilegíveis.')
  return entries
}

export function itemRecords(entries: Entry[], item: Item) {
  const history = entries.filter(entry => entry.itemId === item.id).reverse()
  const undone = new Set(history.flatMap(entry => entry.type === 'undo' ? [entry.target] : []))
  const active = history.filter(entry => !undone.has(entry.id))
  const count = active.find(entry => entry.type === 'count')
  const correction = count && active.find(
    (entry): entry is Extract<Entry, { type: 'correct' }> => entry.type === 'correct' && entry.target === count.id,
  )
  const order = active.find(entry =>
    entry.type === 'open' && !active.some(other => other.type === 'close' && other.target === entry.id))
  const details = order && active.find(
    (entry): entry is Extract<Entry, { type: 'details' }> => entry.type === 'details' && entry.target === order.id,
  )
  return {
    history,
    count,
    quantity: correction?.quantity ?? count?.quantity,
    order,
    details,
  }
}

export async function record(change: Change) {
  const save = () => writeEntry(change)
  return navigator.locks ? navigator.locks.request(storageKey, save) : save()
}

function writeEntry(change: Change) {
  const entries = loadEntries()
  const item = items.find(candidate => candidate.id === change.itemId)!
  const current = itemRecords(entries, item)
  if (change.type === 'open' && current.order) return { entries, entry: null }
  if ((change.type === 'close' || change.type === 'details') && current.order?.id !== change.target) {
    return { entries, entry: null }
  }
  if (change.type === 'undo') {
    const original = current.history.find(entry => entry.id === change.target)
    if (!original || (original.type === 'open' && current.order?.id !== original.id)) {
      return { entries, entry: null }
    }
  }
  if (change.type === 'correct' &&
    (current.count?.id !== change.target || current.quantity !== change.previous)) {
    return { entries, entry: null }
  }

  const entry = { ...change, id: crypto.randomUUID(), at: new Date().toISOString(), author: demoAuthor }
  const next = [...entries, entry]
  localStorage.setItem(storageKey, JSON.stringify(next))
  return { entries: next, entry }
}

export function parseQuantity(value: string, fractional: boolean) {
  const input = value.trim()
  const pattern = fractional ? /^\d+(?:[.,]\d+)?$/ : /^\d+$/
  if (!pattern.test(input)) return null
  const quantity = Number(input.replace(',', '.'))
  return Number.isFinite(quantity) && quantity <= Number.MAX_SAFE_INTEGER ? quantity : null
}

export const quantityText = (quantity: number, unit: string) =>
  `${quantity.toLocaleString('pt-BR', { maximumFractionDigits: 20 })} ${unit}`

export const dateText = (date: string) => new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
}).format(new Date(date))

export const searchText = (value: string) =>
  value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('pt-BR').trim()
