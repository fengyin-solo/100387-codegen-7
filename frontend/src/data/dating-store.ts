import { listRows, saveRows } from './local-store'
import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 测年送检是「单据 + 批次编组 + 跨库房临时出库台账」的组合态：
// 单据本身仍放在通用 entries 存储里，批次口径、手工修改标记、临时台账放这里。
const DATING_KEY = 'dating'
const META_KEY = 'field-archaeology-digital:dating-meta:v1'

export type BatchFields = {
  送检方法: string
  送检日期: string
  预计返回日: string
}

export type DatingBatch = BatchFields & {
  批次号: string
  送检来源: string
  送检层位: string
  送出数量: number
}

// 样品临时出库台账：跨业务面写到库房管理侧，一份批次对应多份样品。
export type OutLedgerEntry = {
  批次号: string
  送检编号: string
  送检来源: string
  送检层位: string
  样品类型: string
  原库位: string
  出库日期: string
  物流号: string
}

export type OverrideMap = Record<number, (keyof BatchFields)[]>

type DatingMeta = {
  batches: DatingBatch[]
  ledger: OutLedgerEntry[]
  overrides: OverrideMap
  seq: number
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export function ledgerKey(批次号: string, 送检编号: string): string {
  return `${批次号}@@${送检编号}`
}

// 首次打开时：已带批号的示例单据自动派生一份台账，保证两个业务面口径一致。
function seedMeta(): DatingMeta {
  const overrides: OverrideMap = {}
  const ledger: OutLedgerEntry[] = []
  for (const row of SEED_ROWS[DATING_KEY] ?? []) {
    const batchNo = String(row['批次号'] ?? '')
    if (!batchNo) {
      continue
    }
    // 示例里 C14-20260921 的方法/预计返回日与批次默认值不一致，视为手工口径。
    if (String(row['送检编号']) === 'C14-20260921') {
      overrides[Number(row.id)] = ['送检方法', '预计返回日']
    }
    ledger.push({
      批次号: batchNo,
      送检编号: String(row['送检编号']),
      送检来源: String(row['送检来源']),
      送检层位: String(row['送检层位']),
      样品类型: String(row['样品类型']),
      原库位: String(row['原库位'] ?? ''),
      出库日期: String(row['送检日期'] ?? today()),
      物流号: String(row['物流号'] ?? ''),
    })
  }
  return {
    batches: [
      {
        批次号: 'PC-20260925-01',
        送检来源: 'H7',
        送检层位: '第4层',
        送检方法: '加速器质谱碳十四',
        送检日期: '2026-09-25',
        预计返回日: '2026-10-25',
        送出数量: 2,
      },
      {
        批次号: 'PC-20260920-01',
        送检来源: 'M2',
        送检层位: '第6层',
        送检方法: '加速器质谱碳十四',
        送检日期: '2026-09-20',
        预计返回日: '2026-10-20',
        送出数量: 1,
      },
      {
        批次号: 'PC-20260915-01',
        送检来源: 'M2',
        送检层位: '第6层',
        送检方法: '加速器质谱碳十四',
        送检日期: '2026-09-15',
        预计返回日: '2026-10-10',
        送出数量: 1,
      },
      {
        批次号: 'PC-20260902-01',
        送检来源: 'H1',
        送检层位: '第2层',
        送检方法: '常规碳十四',
        送检日期: '2026-09-02',
        预计返回日: '2026-10-02',
        送出数量: 1,
      },
      {
        批次号: 'PC-20260910-01',
        送检来源: 'H1',
        送检层位: '第2层',
        送检方法: '加速器质谱碳十四',
        送检日期: '2026-09-10',
        预计返回日: '2026-10-10',
        送出数量: 1,
      },
    ],
    ledger,
    overrides,
    seq: 2,
  }
}

let cache: DatingMeta | null = null

function readMeta(): DatingMeta {
  if (cache) {
    return cache
  }
  const fallback = seedMeta()
  if (typeof window === 'undefined' || !window.localStorage) {
    cache = fallback
    return cache
  }
  const raw = window.localStorage.getItem(META_KEY)
  if (!raw) {
    cache = fallback
    return cache
  }
  try {
    cache = { ...fallback, ...(JSON.parse(raw) as DatingMeta) }
  } catch {
    cache = fallback
  }
  return cache
}

function persist(meta: DatingMeta): void {
  cache = meta
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(META_KEY, JSON.stringify(meta))
  }
}

export function datingRows(): EntryRow[] {
  return listRows(DATING_KEY)
}

export function saveDatingRows(rows: EntryRow[]): void {
  saveRows(DATING_KEY, rows)
}

export function listBatches(): DatingBatch[] {
  return readMeta().batches
}

export function listLedger(): OutLedgerEntry[] {
  return readMeta().ledger
}

export function listOverrides(): OverrideMap {
  return readMeta().overrides
}

// 物流号以单据为准，台账展示时实时对齐，避免两边各存一份口径漂移。
export function getLedgerEntry(批次号: string, 送检编号: string): OutLedgerEntry | undefined {
  return readMeta().ledger.find(
    (item) => item.批次号 === 批次号 && item.送检编号 === 送检编号,
  )
}

export function nextBatchNo(): string {
  const meta = readMeta()
  meta.seq += 1
  persist(meta)
  return `PC-${today().replace(/-/g, '')}-${String(meta.seq).padStart(2, '0')}`
}

export function appendBatch(batch: DatingBatch): void {
  const meta = readMeta()
  meta.batches.unshift(batch)
  persist(meta)
}

export function appendLedgerEntries(entries: OutLedgerEntry[]): OutLedgerEntry[] {
  const meta = readMeta()
  const existed = new Set(meta.ledger.map((item) => ledgerKey(item.批次号, item.送检编号)))
  const created = entries.filter((item) => !existed.has(ledgerKey(item.批次号, item.送检编号)))
  meta.ledger = [...created, ...meta.ledger]
  persist(meta)
  return created
}

export function setOverride(id: number, field: keyof BatchFields): void {
  const meta = readMeta()
  const fields = new Set(meta.overrides[id] ?? [])
  fields.add(field)
  meta.overrides[id] = [...fields]
  persist(meta)
}

export function clearOverride(id: number): void {
  const meta = readMeta()
  delete meta.overrides[id]
  persist(meta)
}
