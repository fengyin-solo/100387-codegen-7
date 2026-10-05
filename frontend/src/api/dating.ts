import type { ActionResult, EntryRow } from '@/data/types'
import { moduleMeta } from '@/api/local-service'
import {
  appendBatch,
  appendLedgerEntries,
  clearOverride,
  datingRows,
  getLedgerEntry,
  listBatches,
  listLedger,
  listOverrides,
  nextBatchNo,
  saveDatingRows,
  setOverride,
  type BatchFields,
  type DatingBatch,
  type OutLedgerEntry,
} from '@/data/dating-store'

// 动作 → 目标状态取自模块元数据，页面与服务共用一份口径。
export const actionTargets: Record<string, string> = moduleMeta('dating').actionTargets


// 测年送检的业务规则不走通用 runAction：编组、幂等台账、严格状态机都在这里收口。
export const DATING_METHODS = ['加速器质谱碳十四', '常规碳十四', '光释光测年', '热释光测年']

export type BatchSubmitInput = BatchFields & {
  ids: number[]
}

export type BatchSubmitResult = {
  ok: boolean
  message: string
  batchNo?: string
  divergences: string[]
}

export const BATCH_FIELDS: (keyof BatchFields)[] = ['送检方法', '送检日期', '预计返回日']

// 状态推进只允许沿主轴向前，退回/归档是终态，任何动作都不能把它们打回待送检。
const FORWARD: Record<string, string[]> = {
  待送检: ['已送检'],
  已送检: ['检测中'],
  检测中: ['已出结果', '已退回'],
  已出结果: ['已归档', '已退回'],
  已归档: [],
  已退回: [],
}

const TERMINAL_STATUSES = ['已归档', '已退回']

export function availableActions(status: string, logistics: string): string[] {
  const actions: string[] = []
  if (status === '待送检') {
    actions.push('手工修改')
  }
  if (status === '已送检' || status === '检测中') {
    actions.push('回填物流号')
  }
  if (status === '已送检' && logistics.trim() !== '') {
    actions.push('开始检测')
  }
  if (status === '检测中') {
    actions.push('登记结果')
  }
  if (status === '已出结果') {
    actions.push('归档报告')
  }
  if (status === '检测中' || status === '已出结果') {
    actions.push('退回单据')
  }
  return actions
}

export function batchGroups(rows: EntryRow[]): { 送检来源: string; 送检层位: string; ids: number[] }[] {
  const map = new Map<string, { 送检来源: string; 送检层位: string; ids: number[] }>()
  for (const row of rows) {
    if (String(row.status) !== '待送检') {
      continue
    }
    const source = String(row['送检来源'] ?? '')
    const layer = String(row['送检层位'] ?? '')
    const key = `${source}@@${layer}`
    const group = map.get(key) ?? { 送检来源: source, 送检层位: layer, ids: [] }
    group.ids.push(Number(row.id))
    map.set(key, group)
  }
  return [...map.values()]
}

function findRow(rows: EntryRow[], id: number): EntryRow | undefined {
  return rows.find((row) => Number(row.id) === id)
}

// 整组登记：一次提交送检方法、送检日期、预计返回日；已手工维护的口径保留，默认值只补空缺。
export function submitBatch(input: BatchSubmitInput): BatchSubmitResult {
  const ids = [...new Set(input.ids)]
  if (ids.length === 0) {
    return { ok: false, message: '请先勾选同一送检来源、同一送检层位的送检单', divergences: [] }
  }
  for (const field of BATCH_FIELDS) {
    if (!input[field] || input[field].trim() === '') {
      return { ok: false, message: `请填写批次默认${field}`, divergences: [] }
    }
  }
  const rows = datingRows()
  const targets = ids
    .map((id) => findRow(rows, id))
    .filter((row): row is EntryRow => Boolean(row))

  const missing = ids.filter((id) => !findRow(rows, id))
  if (missing.length) {
    return { ok: false, message: `送检单 ${missing.join('、')} 不存在`, divergences: [] }
  }
  const illegal = targets.filter((row) => String(row.status) !== '待送检')
  if (illegal.length) {
    return {
      ok: false,
      message: `只有待送检单据可编组送出：${illegal.map((row) => row['送检编号']).join('、')}`,
      divergences: [],
    }
  }
  const signature = new Set(
    targets.map((row) => `${String(row['送检来源'] ?? '')}@@${String(row['送检层位'] ?? '')}`),
  )
  if (signature.size > 1) {
    return { ok: false, message: '同一批次只允许包含同一送检来源、同一送检层位的单据', divergences: [] }
  }

  const overrides = listOverrides()
  const batchNo = nextBatchNo()
  const divergences: string[] = []

  const next = rows.map((row) => {
    if (!ids.includes(Number(row.id))) {
      return row
    }
    const manualFields = new Set(overrides[Number(row.id)] ?? [])
    const patch: Record<string, string> = {}
    for (const field of BATCH_FIELDS) {
      const kept = manualFields.has(field)
      patch[field] = kept ? String(row[field] ?? '') : input[field]
      if (kept && String(row[field] ?? '') !== input[field]) {
        divergences.push(`${String(row['送检编号'])} 的${field}按手工口径「${row[field]}」保留`)
      }
    }
    return {
      ...row,
      ...patch,
      批次号: batchNo,
      status: '已送检',
      pending: true,
      abnormal: false,
    }
  })
  saveDatingRows(next)

  const head = targets[0]
  const batch: DatingBatch = {
    批次号: batchNo,
    送检来源: String(head['送检来源'] ?? ''),
    送检层位: String(head['送检层位'] ?? ''),
    送检方法: input.送检方法,
    送检日期: input.送检日期,
    预计返回日: input.预计返回日,
    送出数量: targets.length,
  }
  appendBatch(batch)

  // 跨业务面：批次送出即在库房管理侧生成样品临时出库台账。
  const entries: OutLedgerEntry[] = targets.map((row) => ({
    批次号: batchNo,
    送检编号: String(row['送检编号']),
    送检来源: String(row['送检来源'] ?? ''),
    送检层位: String(row['送检层位'] ?? ''),
    样品类型: String(row['样品类型'] ?? ''),
    原库位: String(row['原库位'] ?? ''),
    出库日期: input.送检日期,
    物流号: '',
  }))
  appendLedgerEntries(entries)

  return {
    ok: true,
    batchNo,
    divergences,
    message:
      `批次 ${batchNo} 已送出，共 ${targets.length} 单（来源 ${batch.送检来源} / ${batch.送检层位}）` +
      (divergences.length ? `；${divergences.length} 处按手工口径保留` : ''),
  }
}

// 待送检阶段手工修改单据口径：登记为手工口径后，批次默认值不再覆盖。
export function manuallyEdit(id: number, patch: Partial<BatchFields>): ActionResult {
  const rows = datingRows()
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: '没有找到该测年送检单' }
  }
  if (String(rows[index].status) !== '待送检') {
    return { ok: false, message: '只有待送检单据允许手工修改送检口径' }
  }
  const next: EntryRow = { ...rows[index] }
  for (const field of BATCH_FIELDS) {
    const value = patch[field]
    if (value !== undefined) {
      next[field] = value
      if (value.trim() !== '') {
        setOverride(id, field)
      }
    }
  }
  rows[index] = next
  saveDatingRows(rows)
  return { ok: true, message: '已按手工口径登记，批次默认值将不再覆盖该字段' }
}

// 放弃手工口径，回到跟随批次默认值。
export function resetManualEdit(id: number): ActionResult {
  const rows = datingRows()
  const row = findRow(rows, id)
  if (!row) {
    return { ok: false, message: '没有找到该测年送检单' }
  }
  if (String(row.status) !== '待送检') {
    return { ok: false, message: '只有待送检单据允许调整手工口径' }
  }
  clearOverride(id)
  return { ok: true, message: '已清除手工口径标记，编组送出时采用批次默认值' }
}

// 批次送出后逐条回填物流号；台账侧随单据实时对齐。
export function fillLogistics(id: number, logistics: string): ActionResult {
  const value = logistics.trim()
  if (!value) {
    return { ok: false, message: '物流号不能为空' }
  }
  const rows = datingRows()
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: '没有找到该测年送检单' }
  }
  const status = String(rows[index].status)
  if (status !== '已送检' && status !== '检测中') {
    return { ok: false, message: '只有已送检、检测中的单据可以回填物流号' }
  }
  rows[index] = { ...rows[index], 物流号: value }
  saveDatingRows(rows)
  return { ok: true, message: `物流号 ${value} 已回填` }
}

export function advanceStatus(id: number, action: string, target: string): ActionResult {
  const rows = datingRows()
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: '没有找到该测年送检单' }
  }
  const current = String(rows[index].status)
  if (!FORWARD[current]?.includes(target)) {
    if (TERMINAL_STATUSES.includes(current)) {
      return { ok: false, message: `${current}单据为终态，不能再${action}或跳回待送检` }
    }
    return { ok: false, message: `状态必须沿 待送检→已送检→检测中→已出结果→已归档 推进，不能从「${current}」${action}` }
  }
  // 已送检 → 检测中 必须先逐条回填物流号。
  if (target === '检测中' && String(rows[index]['物流号'] ?? '').trim() === '') {
    return { ok: false, message: '请先回填物流号，再开始检测' }
  }
  rows[index] = {
    ...rows[index],
    status: target,
    pending: !TERMINAL_STATUSES.includes(target),
    abnormal: target === '已退回',
  }
  saveDatingRows(rows)
  return { ok: true, message: `已${action}，当前状态「${target}」` }
}

export type LedgerRow = OutLedgerEntry & { 台账状态: string }

export function ledgerRows(): LedgerRow[] {
  const byNo = new Map<string, EntryRow>()
  for (const row of datingRows()) {
    byNo.set(String(row['送检编号']), row)
  }
  return listLedger().map((item) => {
    const row = byNo.get(item.送检编号)
    return {
      ...item,
      物流号: item.物流号 || String(row?.['物流号'] ?? ''),
      台账状态: TERMINAL_STATUSES.includes(String(row?.status))
        ? String(row?.status === '已归档' ? '样品已归档' : '样品已退回')
        : '临时出库中',
    }
  })
}

export type LedgerStats = {
  batches: number
  samples: number
  occupied: number
}

export function ledgerStats(rows: LedgerRow[]): LedgerStats {
  const active = rows.filter((row) => row.台账状态 === '临时出库中')
  return {
    batches: new Set(rows.map((row) => row.批次号)).size,
    samples: rows.length,
    occupied: new Set(active.map((row) => row.原库位).filter(Boolean)).size,
  }
}

// 库房侧按批号重复导入：已存在的「批号+送检编号」直接跳过，不会重复占用库位。
export function importLedgerByBatch(batchNo: string): ActionResult & { added: number; skipped: number } {
  const no = batchNo.trim()
  if (!no) {
    return { ok: false, message: '请输入要导入的批次号', added: 0, skipped: 0 }
  }
  const targets = datingRows().filter((row) => String(row['批次号'] ?? '') === no)
  if (targets.length === 0) {
    return { ok: false, message: `测年送检中没有批号为 ${no} 的送出记录`, added: 0, skipped: 0 }
  }
  const entries: OutLedgerEntry[] = targets.map((row) => ({
    批次号: no,
    送检编号: String(row['送检编号']),
    送检来源: String(row['送检来源'] ?? ''),
    送检层位: String(row['送检层位'] ?? ''),
    样品类型: String(row['样品类型'] ?? ''),
    原库位: String(row['原库位'] ?? ''),
    出库日期: String(row['送检日期'] ?? ''),
    物流号: String(row['物流号'] ?? ''),
  }))
  const created = appendLedgerEntries(entries)
  const skipped = entries.length - created.length
  return {
    ok: true,
    added: created.length,
    skipped,
    message:
      `批号 ${no} 导入完成：新增 ${created.length} 条临时出库台账，跳过 ${skipped} 条已存在记录` +
      (skipped > 0 ? '（未重复占用库位）' : ''),
  }
}

export function recentBatches(): DatingBatch[] {
  return listBatches()
}

export function isManual(id: number, field: keyof BatchFields): boolean {
  return (listOverrides()[id] ?? []).includes(field)
}

export function ledgerEntryFor(row: EntryRow): OutLedgerEntry | undefined {
  const batchNo = String(row['批次号'] ?? '')
  if (!batchNo) {
    return undefined
  }
  return getLedgerEntry(batchNo, String(row['送检编号']))
}
