/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  // 动作的源状态白名单：登记后只有当前状态命中的动作才允许推进；不登记则保持宽松校验。
  allowedFrom?: Record<string, string[]>
  metrics: string[]
}

// 测年送检批次：同一送检来源（采样单位）、同一送检层位（采样层位）的单据一次编组送出。
export type DatingBatch = {
  id: number
  batchNo: string
  source: string
  horizon: string
  method: string
  sentDate: string
  expectedReturn: string
  createdAt: string
  entryIds: number[]
}

// 样品临时出库台账：批次送出后跨到库房业务面落一份，库位按「批号 + 送检编号」幂等占用。
export type OutboundLedgerEntry = {
  id: number
  batchNo: string
  datingCode: string
  source: string
  horizon: string
  rackCode: string
  method: string
  registerCaliber: string
  logisticsNo: string
  status: string
  sentDate: string
  returnedDate: string
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
