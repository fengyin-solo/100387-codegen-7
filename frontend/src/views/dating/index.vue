<template>
  <section class="page" data-module="dating">
    <header class="page-head">
      <div>
        <h2>测年送检管理</h2>
        <p class="page-desc">按同一送检来源、同一送检层位编组批量送出；再逐条回填物流号；状态严格沿 待送检→已送检→检测中→已出结果→已归档 推进。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出测年送检清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>送检编号</span>
        <input v-model="filters['送检编号']" placeholder="按送检编号检索" />
      </label>
      <label class="filter-item">
        <span>送检来源</span>
        <input v-model="filters['送检来源']" placeholder="按送检来源检索" />
      </label>
      <label class="filter-item">
        <span>送检层位</span>
        <input v-model="filters['送检层位']" placeholder="按送检层位检索" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <!-- 批次编组台 -->
    <div class="panel">
      <div class="panel-head">
        <h3>批次编组台</h3>
        <span class="panel-tip">同一编组必须是同一送检来源、同一送检层位；批次默认值只补未手工维护的字段，手工口径优先保留。</span>
      </div>

      <div class="group-strip">
        <span class="strip-label">待送检编组：</span>
        <button
          v-for="group in groups"
          :key="groupKey(group)"
          class="chip"
          :class="{ active: anchor && anchor.source === group.送检来源 && anchor.layer === group.送检层位 }"
          type="button"
          @click="anchorGroup(group)"
        >
          {{ group.送检来源 }} / {{ group.送检层位 }} · {{ group.ids.length }} 单
        </button>
        <span v-if="!groups.length" class="panel-tip">暂无待送检单据可编组</span>
        <button v-if="anchor" class="link" type="button" @click="clearAnchor">取消编组</button>
      </div>

      <div v-if="anchor" class="batch-form">
        <label class="filter-item">
          <span>批次默认送检方法</span>
          <select v-model="batchDraft['送检方法']">
            <option value="" disabled>请选择送检方法</option>
            <option v-for="method in methods" :key="method" :value="method">{{ method }}</option>
          </select>
        </label>
        <label class="filter-item">
          <span>批次默认送检日期</span>
          <input v-model="batchDraft['送检日期']" type="date" />
        </label>
        <label class="filter-item">
          <span>批次默认预计返回日</span>
          <input v-model="batchDraft['预计返回日']" type="date" />
        </label>
        <button class="btn primary" type="button" :disabled="!selectedIds.size" @click="submit">
          整组送出（已勾选 {{ selectedIds.size }} 单）
        </button>
      </div>
      <p v-if="lastDivergences.length" class="warn-text">
        本次送出有 {{ lastDivergences.length }} 处采用手工口径：{{ lastDivergences.join('；') }}
      </p>
    </div>

    <!-- 物流号逐条回填 -->
    <div v-if="shippedRows.length" class="panel">
      <div class="panel-head">
        <h3>物流号逐条回填（批次送出后）</h3>
        <span class="panel-tip">已送检单据需先回填物流号，才能推进到检测中。</span>
      </div>
      <table class="data-table compact">
        <thead>
          <tr><th>批次号</th><th>送检编号</th><th>送检来源/层位</th><th>物流号</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="row in shippedRows" :key="'ship-' + row.id">
            <td>{{ row['批次号'] || '—' }}</td>
            <td>{{ row['送检编号'] }}</td>
            <td>{{ row['送检来源'] }} / {{ row['送检层位'] }}</td>
            <td>{{ row['物流号'] || '待回填' }}</td>
            <td class="row-actions">
              <button class="link" type="button" @click="openLogistics(row)">
                {{ row['物流号'] ? '修改物流号' : '回填物流号' }}
              </button>
              <button
                v-if="!String(row['物流号'] ?? '').trim()"
                class="link disabled"
                type="button"
                disabled
                title="需先回填物流号"
              >
                开始检测
              </button>
              <button v-else class="link" type="button" @click="doAction('开始检测', row)">开始检测</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th class="col-check">
            <input
              type="checkbox"
              :checked="allAnchorSelected"
              :disabled="!anchor"
              title="全选当前编组"
              @change="toggleAllAnchor"
            />
          </th>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td class="col-check">
            <input
              type="checkbox"
              :checked="selectedIds.has(Number(row.id))"
              :disabled="!canSelect(row)"
              @change="toggleRow(row)"
            />
          </td>
          <td v-for="column in columns" :key="column">
            {{ row[column] || '—' }}
            <em
              v-if="isBatchField(column) && manualMarks[Number(row.id)]?.includes(column)"
              class="manual-tag"
              title="该字段为手工口径，批次默认值不覆盖"
            >手</em>
          </td>
          <td>
            <span :class="{ 'abnormal-tag': row.abnormal }">{{ row.status }}</span>
          </td>
          <td class="row-actions">
            <button
              v-for="action in actionList(row)"
              :key="action"
              class="link"
              type="button"
              @click="doAction(action, row)"
            >
              {{ action }}
            </button>
            <span v-if="!actionList(row).length" class="panel-tip">终态，无可用动作</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无符合条件的测年送检单</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条测年送检记录</span>
      <span v-if="infoMessage" class="success-text">{{ infoMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <!-- 手工修改送检口径 -->
    <div v-if="editingRow" class="modal-mask" @click.self="editingRow = null">
      <div class="modal">
        <h3>手工修改送检口径 · {{ editingRow['送检编号'] }}</h3>
        <p class="panel-tip">手工维护后按手工口径执行；编组送出时留空或未标记的字段仍取批次默认值。</p>
        <label class="modal-field">
          <span>送检方法</span>
          <select v-model="editDraft['送检方法']">
            <option value="">跟随批次默认值</option>
            <option v-for="method in methods" :key="method" :value="method">{{ method }}</option>
          </select>
        </label>
        <label class="modal-field">
          <span>送检日期</span>
          <input v-model="editDraft['送检日期']" type="date" placeholder="留空则跟随批次默认值" />
        </label>
        <label class="modal-field">
          <span>预计返回日</span>
          <input v-model="editDraft['预计返回日']" type="date" placeholder="留空则跟随批次默认值" />
        </label>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="dropManual">恢复为跟随批次默认</button>
          <button class="btn" type="button" @click="editingRow = null">取消</button>
          <button class="btn primary" type="button" @click="saveManual">保存手工口径</button>
        </div>
      </div>
    </div>

    <!-- 回填物流号 -->
    <div v-if="logisticsRow" class="modal-mask" @click.self="logisticsRow = null">
      <div class="modal">
        <h3>回填物流号 · {{ logisticsRow['送检编号'] }}</h3>
        <p class="panel-tip">所属批次 {{ logisticsRow['批次号'] }}，逐条回填后单据即可进入检测中。</p>
        <label class="modal-field">
          <span>物流号</span>
          <input v-model="logisticsDraft" placeholder="例如顺丰/圆通单号" @keyup.enter="saveLogistics" />
        </label>
        <div class="modal-actions">
          <button class="btn" type="button" @click="logisticsRow = null">取消</button>
          <button class="btn primary" type="button" @click="saveLogistics">保存</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import { downloadEntries, filterRows } from '@/api/local-service'
import {
  DATING_METHODS,
  actionTargets,
  advanceStatus,
  availableActions,
  batchGroups,
  fillLogistics,
  isManual,
  manuallyEdit,
  resetManualEdit,
  submitBatch,
  type BatchSubmitInput,
} from '@/api/dating'
import { datingRows } from '@/data/dating-store'
import type { BatchFields } from '@/data/dating-store'
import type { EntryRow } from '@/data/types'

const MODULE_KEY = 'dating'
const columns = ['送检编号', '送检来源', '送检层位', '样品类型', '送检方法', '送检日期', '预计返回日', '物流号', '批次号', '原库位']
const statuses = ['待送检', '已送检', '检测中', '已出结果', '已归档', '已退回']
const methods = DATING_METHODS
const actionTargetMap = actionTargets

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const infoMessage = ref('')
const filters = ref<Record<string, string>>({})

const groups = ref<{ 送检来源: string; 送检层位: string; ids: number[] }[]>([])
const anchor = ref<{ source: string; layer: string } | null>(null)
const selectedIds = ref<Set<number>>(new Set())
const batchDraft = reactive<BatchFields>({ 送检方法: '', 送检日期: '', 预计返回日: '' })
const lastDivergences = ref<string[]>([])

const editingRow = ref<EntryRow | null>(null)
const editDraft = reactive<BatchFields>({ 送检方法: '', 送检日期: '', 预计返回日: '' })
const logisticsRow = ref<EntryRow | null>(null)
const logisticsDraft = ref('')

const manualMarks = ref<Record<number, string[]>>({})

const shippedRows = computed(() => rows.value.filter((row) => String(row.status) === '已送检'))

const stats = computed(() => [
  { label: '待送检数', value: rows.value.filter((row) => row.status === '待送检').length },
  { label: '检测中数', value: rows.value.filter((row) => row.status === '检测中').length },
  { label: '已归档数', value: rows.value.filter((row) => row.status === '已归档').length },
])

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const anchorRowIds = computed(() => {
  if (!anchor.value) {
    return new Set<number>()
  }
  return new Set(
    rows.value
      .filter(
        (row) =>
          String(row.status) === '待送检' &&
          String(row['送检来源']) === anchor.value?.source &&
          String(row['送检层位']) === anchor.value?.layer,
      )
      .map((row) => Number(row.id)),
  )
})

const allAnchorSelected = computed(() => {
  const ids = anchorRowIds.value
  return ids.size > 0 && [...ids].every((id) => selectedIds.value.has(id))
})

function isBatchField(column: string): column is keyof BatchFields {
  return column === '送检方法' || column === '送检日期' || column === '预计返回日'
}

function groupKey(group: { 送检来源: string; 送检层位: string }): string {
  return `${group.送检来源}@@${group.送检层位}`
}

function actionList(row: EntryRow): string[] {
  return availableActions(String(row.status), String(row['物流号'] ?? ''))
}

function canSelect(row: EntryRow): boolean {
  if (String(row.status) !== '待送检') {
    return false
  }
  if (!anchor.value) {
    return false
  }
  return (
    String(row['送检来源']) === anchor.value.source &&
    String(row['送检层位']) === anchor.value.layer
  )
}

function toggleRow(row: EntryRow) {
  if (!canSelect(row)) {
    return
  }
  const id = Number(row.id)
  const next = new Set(selectedIds.value)
  if (next.has(id)) {
    next.delete(id)
  } else {
    next.add(id)
  }
  selectedIds.value = next
}

function toggleAllAnchor() {
  const ids = anchorRowIds.value
  const next = new Set(selectedIds.value)
  if (allAnchorSelected.value) {
    for (const id of ids) {
      next.delete(id)
    }
  } else {
    for (const id of ids) {
      next.add(id)
    }
  }
  selectedIds.value = next
}

function anchorGroup(group: { 送检来源: string; 送检层位: string; ids: number[] }) {
  anchor.value = { source: group.送检来源, layer: group.送检层位 }
  // 预选该编组当前在筛选结果中可见的待送检单。
  selectedIds.value = new Set(
    rows.value
      .filter(
        (row) =>
          String(row.status) === '待送检' &&
          String(row['送检来源']) === group.送检来源 &&
          String(row['送检层位']) === group.送检层位,
      )
      .map((row) => Number(row.id)),
  )
}

function clearAnchor() {
  anchor.value = null
  selectedIds.value = new Set()
  lastDivergences.value = []
}

function flash(message: string) {
  infoMessage.value = message
  errorMessage.value = ''
}

function fail(message: string) {
  errorMessage.value = message
  infoMessage.value = ''
}

function submit() {
  const input: BatchSubmitInput = { ...batchDraft, ids: [...selectedIds.value] }
  const result = submitBatch(input)
  if (!result.ok) {
    fail(result.message)
    return
  }
  lastDivergences.value = result.divergences
  flash(result.message)
  batchDraft['送检方法'] = ''
  batchDraft['送检日期'] = ''
  batchDraft['预计返回日'] = ''
  clearAnchor()
  reload()
}

function openManual(row: EntryRow) {
  editingRow.value = row
  editDraft['送检方法'] = String(row['送检方法'] ?? '')
  editDraft['送检日期'] = String(row['送检日期'] ?? '')
  editDraft['预计返回日'] = String(row['预计返回日'] ?? '')
}

function saveManual() {
  if (!editingRow.value) {
    return
  }
  const result = manuallyEdit(Number(editingRow.value.id), { ...editDraft })
  if (!result.ok) {
    fail(result.message)
    return
  }
  flash(result.message)
  editingRow.value = null
  reload()
}

function dropManual() {
  if (!editingRow.value) {
    return
  }
  const result = resetManualEdit(Number(editingRow.value.id))
  if (!result.ok) {
    fail(result.message)
    return
  }
  flash(result.message)
  editingRow.value = null
  reload()
}

function openLogistics(row: EntryRow) {
  logisticsRow.value = row
  logisticsDraft.value = String(row['物流号'] ?? '')
}

function saveLogistics() {
  if (!logisticsRow.value) {
    return
  }
  const result = fillLogistics(Number(logisticsRow.value.id), logisticsDraft.value)
  if (!result.ok) {
    fail(result.message)
    return
  }
  flash(result.message)
  logisticsRow.value = null
  reload()
}

function doAction(action: string, row: EntryRow) {
  if (action === '手工修改') {
    openManual(row)
    return
  }
  if (action === '回填物流号') {
    openLogistics(row)
    return
  }
  if (action === '退回单据' && !window.confirm(`确认退回送检单 ${row['送检编号']}？退回后为终态，不能再回到待送检。`)) {
    return
  }
  const target = actionTargetMap[action]
  if (!target) {
    fail(`未登记动作「${action}」`)
    return
  }
  const result = advanceStatus(Number(row.id), action, target)
  if (!result.ok) {
    fail(result.message)
    return
  }
  flash(result.message)
  reload()
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(MODULE_KEY)
}

function refreshGroups() {
  groups.value = batchGroups(datingRows())
}

function refreshManualMarks() {
  const marks: Record<number, string[]> = {}
  for (const row of datingRows()) {
    const fields = (['送检方法', '送检日期', '预计返回日'] as const).filter((field) =>
      isManual(Number(row.id), field),
    )
    if (fields.length) {
      marks[Number(row.id)] = fields
    }
  }
  manualMarks.value = marks
}

function reload() {
  errorMessage.value = ''
  infoMessage.value = ''
  try {
    // 列表仍走通用过滤口径；编组、台账、状态机走测年专用服务。
    const matched = filterRows(datingRows(), filters.value)
    rows.value = matched
    total.value = matched.length
    refreshGroups()
    refreshManualMarks()
    // 编组锚点若已不在待送检编组里（整组送出后），自动收起。
    if (anchor.value && !groups.value.some(
      (group) => group.送检来源 === anchor.value?.source && group.送检层位 === anchor.value?.layer,
    )) {
      anchor.value = null
      selectedIds.value = new Set()
    } else {
      selectedIds.value = new Set([...selectedIds.value].filter((id) => matched.some((row) => Number(row.id) === id)))
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : '测年送检列表读取失败')
  }
}

onMounted(reload)
</script>
