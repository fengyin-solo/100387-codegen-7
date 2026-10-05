import { SEED_DATING_BATCHES, SEED_OUTBOUND_LEDGER, SEED_ROWS } from './seed'
import type { DatingBatch, EntryRow, OutboundLedgerEntry } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'field-archaeology-digital:entries'
const DATING_BATCH_KEY = 'field-archaeology-digital:dating-batches'
const OUTBOUND_LEDGER_KEY = 'field-archaeology-digital:outbound-ledger'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...fallback, ...parsed }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

// 通用集合存储：首次读取时用种子数据打底，之后浏览器里的改动优先。
function readCollection<T>(storageKey: string, fallback: T[]): T[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return clone(fallback)
  }
  const raw = window.localStorage.getItem(storageKey)
  if (!raw) {
    window.localStorage.setItem(storageKey, JSON.stringify(fallback))
    return clone(fallback)
  }
  try {
    return JSON.parse(raw) as T[]
  } catch {
    window.localStorage.setItem(storageKey, JSON.stringify(fallback))
    return clone(fallback)
  }
}

function writeCollection<T>(storageKey: string, items: T[]): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(storageKey, JSON.stringify(items))
  }
}

const collectionCache: Record<string, unknown[]> = {}

function loadCollection<T>(storageKey: string, fallback: T[]): T[] {
  if (!collectionCache[storageKey]) {
    collectionCache[storageKey] = readCollection(storageKey, fallback)
  }
  return collectionCache[storageKey] as T[]
}

export function listDatingBatches(): DatingBatch[] {
  return loadCollection(DATING_BATCH_KEY, SEED_DATING_BATCHES)
}

export function saveDatingBatches(items: DatingBatch[]): void {
  collectionCache[DATING_BATCH_KEY] = items
  writeCollection(DATING_BATCH_KEY, items)
}

export function listOutboundLedger(): OutboundLedgerEntry[] {
  return loadCollection(OUTBOUND_LEDGER_KEY, SEED_OUTBOUND_LEDGER)
}

export function saveOutboundLedger(items: OutboundLedgerEntry[]): void {
  collectionCache[OUTBOUND_LEDGER_KEY] = items
  writeCollection(OUTBOUND_LEDGER_KEY, items)
}
