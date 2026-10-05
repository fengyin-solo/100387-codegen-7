import {
  listDatingBatches,
  listOutboundLedger,
  listRows,
  saveDatingBatches,
  saveOutboundLedger,
  saveRows,
} from '@/data/local-store'
import type { ActionResult, DatingBatch, EntryRow, OutboundLedgerEntry } from '@/data/types'

const DATING_KEY = 'dating'
const PLACEHOLDER = '测年送检样例'

export type BatchDraft = {
  method: string
  sentDate: string
  expectedReturn: string
}

export type ManualDraft = {
  method: string
  sentDate: string
  expectedReturn: string
}

// 批次编组候选：只有待送检、且能按「同一送检来源（采样单位）+ 同一送检层位（采样层位）」成组的单据。
export type BatchGroup = {
  key: string
  source: string
  horizon: string
  entries: EntryRow[]
}

function isBlank(value: unknown): boolean {
  const text = String(value ?? '').trim()
  return text === '' || text.startsWith(PLACEHOLDER)
}

export function batchGroups(): BatchGroup[] {
  const groups = new Map<string, BatchGroup>()
  for (const row of listRows(DATING_KEY)) {
    if (String(row.status) !== '待送检') {
      continue
    }
    const source = String(row['采样单位'] ?? '').trim()
    const horizon = String(row['采样层位'] ?? '').trim()
    const key = `${source}@@${horizon}`
    const existing = groups.get(key)
    if (existing) {
      existing.entries.push(row)
    } else {
      groups.set(key, { key, source, horizon, entries: [row] })
    }
  }
  return [...groups.values()]
}

export function listBatches(): DatingBatch[] {
  return listDatingBatches()
}

function nextBatchNo(date: string): string {
  const compact = date.replace(/-/g, '')
  const sameDay = listDatingBatches().filter((batch) => batch.batchNo.includes(compact)).length
  return `BATCH-${compact}-${String(sameDay + 1).padStart(2, '0')}`
}

function nextLedgerId(): number {
  const ids = listOutboundLedger().map((item) => Number(item.id))
  return ids.length ? Math.max(...ids) + 1 : 1
}

// 库位在库房现有架位间轮转分配，只是为临时出库的样品做一个占位，不影响真实架位台账。
function assignRack(): string {
  const storage = listRows('storage')
  const rackCodes = storage
    .map((row) => String(row['架位编号'] ?? '').trim())
    .filter(Boolean)
  if (!rackCodes.length) {
    return '待分配架位'
  }
  const used = listOutboundLedger().filter((item) => item.status !== '已回库').length
  return rackCodes[used % rackCodes.length]
}

// 一次提交整组：登记送检方法、送检日期、预计返回，整组推进到已送检，并跨库房落临时出库台账。
// 口径：单据自定优先，批次默认只填空；单据原有手工值不覆盖，台账逐单标注口径。
export function submitBatch(ids: number[], source: string, horizon: string, draft: BatchDraft): ActionResult {
  if (!ids.length) {
    return { ok: false, message: '请先勾选同一送检来源、同一送检层位的测年送检单' }
  }
  if (!draft.method.trim()) {
    return { ok: false, message: '请登记整组的送检方法' }
  }
  if (!draft.sentDate.trim() || !draft.expectedReturn.trim()) {
    return { ok: false, message: '请登记送检日期和预计返回日' }
  }
  if (draft.expectedReturn < draft.sentDate) {
    return { ok: false, message: '预计返回日不能早于送检日期' }
  }

  const rows = listRows(DATING_KEY)
  const picked = rows.filter((row) => ids.includes(Number(row.id)))
  if (picked.length !== ids.length) {
    return { ok: false, message: '部分测年送检单已不存在，请刷新后重试' }
  }
  const invalid = picked.find(
    (row) =>
      String(row.status) !== '待送检' ||
      String(row['采样单位'] ?? '').trim() !== source ||
      String(row['采样层位'] ?? '').trim() !== horizon,
  )
  if (invalid) {
    return {
      ok: false,
      message: `送检单 ${invalid['送检编号']} 不是待送检，或送检来源/层位与编组不一致，不能混入本组`,
    }
  }

  const batchNo = nextBatchNo(draft.sentDate)
  const now = new Date()
  const stamp = `${draft.sentDate} ${String(now.getHours()).padStart(2, '0')}:${String(
    now.getMinutes(),
  ).padStart(2, '0')}`
  const batch: DatingBatch = {
    id: nextBatchId(),
    batchNo,
    source,
    horizon,
    method: draft.method.trim(),
    sentDate: draft.sentDate,
    expectedReturn: draft.expectedReturn,
    createdAt: stamp,
    entryIds: ids,
  }

  const idSet = new Set(ids)
  // 始终在副本上追加，避免 push 进缓存数组的同引用对象污染后续保存。
  const ledger = listOutboundLedger().map((item) => ({ ...item }))
  const nextRows = rows.map((row) => {
    if (!idSet.has(Number(row.id))) {
      return row
    }
    // 单据自定优先：原有手工值保留，批次默认值只补空。
    const method = isBlank(row['送检方法']) ? batch.method : String(row['送检方法'])
    const sentDate = isBlank(row['送检日期']) ? batch.sentDate : String(row['送检日期'])
    const expectedReturn = isBlank(row['预计返回'])
      ? batch.expectedReturn
      : String(row['预计返回'])
    const caliber =
      isBlank(row['送检方法']) && isBlank(row['送检日期']) && isBlank(row['预计返回'])
        ? '批次默认'
        : '单据自定'
    // 幂等：同一批号 + 送检编号已在台账里就不重复落账，不重复占用库位。
    const exists = ledger.some(
      (item) => item.batchNo === batchNo && item.datingCode === String(row['送检编号']),
    )
    if (!exists) {
      ledger.push({
        id: nextLedgerId(),
        batchNo,
        datingCode: String(row['送检编号']),
        source,
        horizon,
        rackCode: assignRack(),
        method,
        registerCaliber: caliber,
        logisticsNo: '',
        status: '临时出库',
        sentDate,
        returnedDate: '',
      })
    }
    return {
      ...row,
      status: '已送检',
      pending: true,
      abnormal: false,
      送检方法: method,
      送检日期: sentDate,
      预计返回: expectedReturn,
      送检批号: batchNo,
      登记口径: caliber,
    }
  })

  saveRows(DATING_KEY, nextRows)
  saveDatingBatches([...listDatingBatches(), batch])
  saveOutboundLedger(ledger)
  return { ok: true, message: `批次 ${batchNo} 已送出，共登记 ${ids.length} 单，并生成样品临时出库台账` }
}

function nextBatchId(): number {
  const ids = listDatingBatches().map((batch) => Number(batch.id))
  return ids.length ? Math.max(...ids) + 1 : 1
}

// 逐条回填物流号：同步写回送检单和临时出库台账。
export function fillLogistics(id: number, logisticsNo: string): ActionResult {
  const rows = listRows(DATING_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: '没有找到这张测年送检单' }
  }
  const code = String(rows[index]['送检批号'] ?? '')
  if (!code) {
    return { ok: false, message: '该送检单尚未随批次送出，暂不能回填物流号' }
  }
  const rowsNext = [...rows]
  rowsNext[index] = { ...rowsNext[index], 物流单号: logisticsNo.trim() }
  saveRows(DATING_KEY, rowsNext)

  const ledger = listOutboundLedger()
  const datingCode = String(rows[index]['送检编号'] ?? '')
  const lineIndex = ledger.findIndex((item) => item.batchNo === code && item.datingCode === datingCode)
  if (lineIndex >= 0) {
    const next = [...ledger]
    next[lineIndex] = { ...next[lineIndex], logisticsNo: logisticsNo.trim() }
    saveOutboundLedger(next)
  }
  return { ok: true, message: logisticsNo.trim() ? `物流号 ${logisticsNo.trim()} 已回填` : '已清空物流号' }
}

// 单据级手工修改送检方法/日期/预计返回：一律以单据口径为准，并同步批次台账。
export function manualAdjust(id: number, draft: ManualDraft): ActionResult {
  if (!draft.method.trim() || !draft.sentDate.trim() || !draft.expectedReturn.trim()) {
    return { ok: false, message: '送检方法、送检日期、预计返回日均需填写' }
  }
  if (draft.expectedReturn < draft.sentDate) {
    return { ok: false, message: '预计返回日不能早于送检日期' }
  }
  const rows = listRows(DATING_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: '没有找到这张测年送检单' }
  }
  if (String(rows[index].status) === '已归档') {
    return { ok: false, message: '已归档的测年送检单不允许再手工修改' }
  }
  const next = [...rows]
  next[index] = {
    ...next[index],
    送检方法: draft.method.trim(),
    送检日期: draft.sentDate,
    预计返回: draft.expectedReturn,
    登记口径: '单据自定',
  }
  saveRows(DATING_KEY, next)

  const batchNo = String(rows[index]['送检批号'] ?? '')
  if (batchNo) {
    const ledger = listOutboundLedger()
    const datingCode = String(rows[index]['送检编号'] ?? '')
    const lineIndex = ledger.findIndex(
      (item) => item.batchNo === batchNo && item.datingCode === datingCode,
    )
    if (lineIndex >= 0) {
      const nextLedger = [...ledger]
      nextLedger[lineIndex] = {
        ...nextLedger[lineIndex],
        method: draft.method.trim(),
        sentDate: draft.sentDate,
        registerCaliber: '单据自定',
      }
      saveOutboundLedger(nextLedger)
    }
  }
  return { ok: true, message: '已按单据口径保存，后续批次操作不再覆盖该单' }
}

// 状态推进后同步台账：退回收回样品，重新送检再次出库，归档自动回库。
export function syncLedgerStatus(id: number, status: string): void {
  const rows = listRows(DATING_KEY)
  const row = rows.find((item) => Number(item.id) === id)
  if (!row) {
    return
  }
  const batchNo = String(row['送检批号'] ?? '')
  const datingCode = String(row['送检编号'] ?? '')
  if (!batchNo) {
    return
  }
  const ledger = listOutboundLedger()
  const index = ledger.findIndex((item) => item.batchNo === batchNo && item.datingCode === datingCode)
  if (index < 0) {
    return
  }
  const today = new Date().toISOString().slice(0, 10)
  const next = [...ledger]
  if (status === '已退回') {
    next[index] = { ...next[index], status: '已回库', returnedDate: next[index].returnedDate || today }
  } else if (status === '已送检') {
    next[index] = { ...next[index], status: '临时出库', returnedDate: '' }
  } else if (status === '已归档') {
    next[index] = { ...next[index], status: '已回库', returnedDate: next[index].returnedDate || today }
  } else if (status === '检测中' || status === '已出结果') {
    next[index] = { ...next[index], status: status === '检测中' ? '临时出库' : '待回库' }
  }
  saveOutboundLedger(next)
}

// 按批号重复导入：已有批号下的送检编号跳过，不重复占用库位；仅补入新落账的样品。
export function importBatchLedger(batchNo: string): ActionResult {
  if (!batchNo.trim()) {
    return { ok: false, message: '请输入要重新导入的送检批号' }
  }
  const code = batchNo.trim()
  const batch = listDatingBatches().find((item) => item.batchNo === code)
  if (!batch) {
    return { ok: false, message: `系统中没有批号为 ${code} 的送检批次` }
  }
  const ledger = listOutboundLedger().map((item) => ({ ...item }))
  let added = 0
  for (const row of listRows(DATING_KEY)) {
    if (String(row['送检批号'] ?? '') !== code) {
      continue
    }
    const datingCode = String(row['送检编号'] ?? '')
    const duplicated = ledger.some((item) => item.batchNo === code && item.datingCode === datingCode)
    if (duplicated) {
      continue
    }
    ledger.push({
      id: nextLedgerId(),
      batchNo: code,
      datingCode,
      source: batch.source,
      horizon: batch.horizon,
      rackCode: assignRack(),
      method: String(row['送检方法'] ?? batch.method),
      registerCaliber: String(row['登记口径'] ?? '批次默认'),
      logisticsNo: String(row['物流单号'] ?? ''),
      status: '临时出库',
      sentDate: String(row['送检日期'] ?? batch.sentDate),
      returnedDate: '',
    })
    added += 1
  }
  saveOutboundLedger(ledger)
  return added === 0
    ? { ok: true, message: `批号 ${code} 的台账已存在，重复导入未重复占用库位` }
    : { ok: true, message: `批号 ${code} 补入 ${added} 条新台账，重复记录已自动跳过` }
}

export function listLedger(): OutboundLedgerEntry[] {
  return listOutboundLedger()
}

export function markLedgerReturned(ledgerId: number): ActionResult {
  const ledger = listOutboundLedger()
  const index = ledger.findIndex((item) => Number(item.id) === ledgerId)
  if (index < 0) {
    return { ok: false, message: '没有找到这条出库台账' }
  }
  if (ledger[index].status === '已回库') {
    return { ok: false, message: '该样品已回库，不用重复登记' }
  }
  const today = new Date().toISOString().slice(0, 10)
  const next = [...ledger]
  next[index] = { ...next[index], status: '已回库', returnedDate: today }
  saveOutboundLedger(next)
  return { ok: true, message: `${ledger[index].datingCode} 已回库，临时库位释放` }
}

export function createDatingEntry(input: {
  code: string
  sampleType: string
  source: string
  horizon: string
}): ActionResult {
  const rows = listRows(DATING_KEY)
  const code = input.code.trim()
  if (!code || !input.source.trim() || !input.horizon.trim()) {
    return { ok: false, message: '送检编号、送检来源、送检层位为必填项' }
  }
  if (rows.some((row) => String(row['送检编号']) === code)) {
    return { ok: false, message: `送检编号 ${code} 已存在` }
  }
  const nextId = rows.length ? Math.max(...rows.map((row) => Number(row.id))) + 1 : 1
  const row: EntryRow = {
    id: nextId,
    status: '待送检',
    pending: true,
    abnormal: false,
    送检编号: code,
    样品类型: input.sampleType.trim(),
    采样单位: input.source.trim(),
    采样层位: input.horizon.trim(),
    送检方法: '',
    送检日期: '',
    预计返回: '',
    送检批号: '',
    物流单号: '',
    登记口径: '',
    送检状态: '待送检',
  }
  saveRows(DATING_KEY, [...rows, row])
  return { ok: true, message: `测年送检单 ${code} 已登记，可在批次编组台成组送出` }
}
