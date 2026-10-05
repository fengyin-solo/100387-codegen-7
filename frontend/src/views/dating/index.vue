<template>
  <section class="page" data-module="dating">
    <header class="page-head">
      <div>
        <h2>测年送检管理</h2>
        <p class="page-desc">
          同一送检来源、同一送检层位的送检单可在批次编组台一次成组送出；单据自定值优先于批次默认值，退回或归档后不可跳回待送检。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出送检清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <div class="tabs">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="tab"
        :class="{ active: activeTab === tab.key }"
        type="button"
        @click="switchTab(tab.key)"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- 页签一：送检单台账 -->
    <div v-if="activeTab === 'entries'">
      <div class="sub-bar">
        <button class="btn primary" type="button" @click="openCreate">登记测年送检单</button>
        <p class="status-legend">
          <span v-for="item in statusSummary" :key="item.status" class="legend-item">
            {{ item.status }}：{{ item.count }}
          </span>
        </p>
      </div>

      <form class="filter-bar" @submit.prevent="reload">
        <label class="filter-item">
          <span>送检编号</span>
          <input v-model="filters['送检编号']" placeholder="按送检编号检索" />
        </label>
        <label class="filter-item">
          <span>送检来源</span>
          <input v-model="filters['采样单位']" placeholder="按采样单位检索" />
        </label>
        <label class="filter-item">
          <span>送检层位</span>
          <input v-model="filters['采样层位']" placeholder="按采样层位检索" />
        </label>
        <label class="filter-item">
          <span>送检批号</span>
          <input v-model="filters['送检批号']" placeholder="按批号检索" />
        </label>
        <button class="btn" type="submit">查询</button>
        <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
      </form>

      <table class="data-table">
        <thead>
          <tr>
            <th>送检编号</th>
            <th>样品类型</th>
            <th>送检来源</th>
            <th>送检层位</th>
            <th>送检方法</th>
            <th>送检日期</th>
            <th>预计返回</th>
            <th>送检批号</th>
            <th>物流单号</th>
            <th>登记口径</th>
            <th>当前状态</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="String(row.id)">
            <td>{{ row['送检编号'] ?? '—' }}</td>
            <td>{{ row['样品类型'] || '—' }}</td>
            <td>{{ row['采样单位'] || '—' }}</td>
            <td>{{ row['采样层位'] || '—' }}</td>
            <td>{{ row['送检方法'] || '—' }}</td>
            <td>{{ row['送检日期'] || '—' }}</td>
            <td>{{ row['预计返回'] || '—' }}</td>
            <td>{{ row['送检批号'] || '—' }}</td>
            <td>
              <div class="inline-edit">
                <input
                  :value="logisticsDraft[Number(row.id)] ?? String(row['物流单号'] ?? '')"
                  :disabled="!row['送检批号'] || row.status === '已归档'"
                  placeholder="送出后回填"
                  @input="logisticsDraft[Number(row.id)] = ($event.target as HTMLInputElement).value"
                />
                <button
                  v-if="row['送检批号'] && row.status !== '已归档'"
                  class="link"
                  type="button"
                  @click="saveLogistics(row)"
                >
                  回填
                </button>
              </div>
            </td>
            <td>
              <span class="tag" :class="caliberClass(row)">{{ row['登记口径'] || '未登记' }}</span>
            </td>
            <td>{{ row.status }}</td>
            <td class="row-actions">
              <button
                v-for="action in allowedActions(meta, String(row.status))"
                :key="action"
                class="link"
                type="button"
                @click="runAction(action, row)"
              >
                {{ action }}
              </button>
              <button
                v-if="row.status !== '已归档'"
                class="link"
                type="button"
                @click="openManual(row)"
              >
                手工修改
              </button>
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td colspan="12" class="empty-state">暂无符合条件的测年送检单，可先登记或到批次编组台成组送出</td>
          </tr>
        </tbody>
      </table>

      <footer class="page-foot">
        <span>共 {{ total }} 条测年送检记录</span>
        <span v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</span>
      </footer>
    </div>

    <!-- 页签二：批次编组台 -->
    <div v-if="activeTab === 'batches'">
      <section class="panel">
        <h3 class="panel-title">待编组（仅待送检单据，按送检来源 + 送检层位自动成组）</h3>
        <p v-if="!groups.length" class="empty-state">暂无可编组的待送检单据</p>
        <article v-for="group in groups" :key="group.key" class="group-card">
          <header class="group-head">
            <div>
              <strong>{{ group.source }} · {{ group.horizon }}</strong>
              <span class="group-meta">共 {{ group.entries.length }} 单待送检</span>
            </div>
            <label class="check-all">
              <input
                type="checkbox"
                :checked="isGroupAllChecked(group)"
                @change="toggleGroupAll(group, ($event.target as HTMLInputElement).checked)"
              />
              全选本组
            </label>
          </header>
          <table class="data-table inner-table">
            <thead>
              <tr>
                <th class="col-check">勾选</th>
                <th>送检编号</th>
                <th>样品类型</th>
                <th>送检方法</th>
                <th>送检日期</th>
                <th>预计返回</th>
                <th>登记口径</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="entry in group.entries" :key="String(entry.id)">
                <td>
                  <input
                    type="checkbox"
                    :checked="selected[group.key]?.includes(Number(entry.id))"
                    @change="toggleOne(group, Number(entry.id), ($event.target as HTMLInputElement).checked)"
                  />
                </td>
                <td>{{ entry['送检编号'] }}</td>
                <td>{{ entry['样品类型'] || '—' }}</td>
                <td>{{ entry['送检方法'] || '—' }}</td>
                <td>{{ entry['送检日期'] || '—' }}</td>
                <td>{{ entry['预计返回'] || '—' }}</td>
                <td>
                  <span class="tag" :class="caliberClass(entry)">{{ entry['登记口径'] || '未登记' }}</span>
                </td>
              </tr>
            </tbody>
          </table>
          <form class="group-form" @submit.prevent="submitGroup(group)">
            <label class="filter-item">
              <span>整组送检方法</span>
              <input v-model="draftFor(group.key).method" placeholder="如 碳十四(AMS)" />
            </label>
            <label class="filter-item">
              <span>送检日期</span>
              <input v-model="draftFor(group.key).sentDate" type="date" />
            </label>
            <label class="filter-item">
              <span>预计返回日</span>
              <input v-model="draftFor(group.key).expectedReturn" type="date" />
            </label>
            <button class="btn primary" type="submit">
              整组送出（{{ selected[group.key]?.length || 0 }} 单）
            </button>
          </form>
          <p class="caliber-note">口径：单据上已手工登记的方法/日期保留（标“单据自定”），批次默认值只补空白单。</p>
        </article>
      </section>

      <section class="panel">
        <h3 class="panel-title">已送出批次（逐条回填物流号）</h3>
        <p v-if="!batches.length" class="empty-state">还没有送出的批次</p>
        <article v-for="batch in batches" :key="batch.batchNo" class="group-card">
          <header class="group-head">
            <div>
              <strong>{{ batch.batchNo }}</strong>
              <span class="group-meta">
                {{ batch.source }} · {{ batch.horizon }} · 方法 {{ batch.method }} ·
                送检 {{ batch.sentDate }} · 预计返回 {{ batch.expectedReturn }}
              </span>
            </div>
            <span class="group-meta">编组时间 {{ batch.createdAt }}</span>
          </header>
          <table class="data-table inner-table">
            <thead>
              <tr>
                <th>送检编号</th>
                <th>当前状态</th>
                <th>送检方法</th>
                <th>物流单号</th>
                <th>口径</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="entry in batchEntries(batch)"
                :key="String(entry.id)"
                :class="{ 'row-conflict': String(entry['送检方法']) !== batch.method }"
              >
                <td>{{ entry['送检编号'] }}</td>
                <td>{{ entry.status }}</td>
                <td>{{ entry['送检方法'] || '—' }}</td>
                <td>
                  <div class="inline-edit">
                    <input
                      :value="logisticsDraft[Number(entry.id)] ?? String(entry['物流单号'] ?? '')"
                      :disabled="entry.status === '已归档'"
                      placeholder="逐条回填"
                      @input="logisticsDraft[Number(entry.id)] = ($event.target as HTMLInputElement).value"
                    />
                    <button
                      v-if="entry.status !== '已归档'"
                      class="link"
                      type="button"
                      @click="saveLogistics(entry)"
                    >
                      回填
                    </button>
                  </div>
                </td>
                <td>
                  <span class="tag" :class="caliberClass(entry)">
                    {{ entry['登记口径'] || '批次默认' }}
                    <template v-if="String(entry['送检方法']) !== batch.method"> · 与批次默认不一致</template>
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </article>
      </section>

      <footer class="page-foot">
        <span>批次送出后会在库房管理自动生成样品临时出库台账</span>
        <span v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</span>
      </footer>
    </div>

    <!-- 登记送检单 -->
    <div v-if="createOpen" class="modal-mask" @click.self="createOpen = false">
      <div class="modal">
        <h3>登记测年送检单</h3>
        <label class="form-line"><span>送检编号 *</span><input v-model="createForm.code" placeholder="如 DATI-0011" /></label>
        <label class="form-line"><span>样品类型</span><input v-model="createForm.sampleType" placeholder="如 木炭样品" /></label>
        <label class="form-line"><span>送检来源（采样单位）*</span><input v-model="createForm.source" placeholder="如 探方T0304" /></label>
        <label class="form-line"><span>送检层位（采样层位）*</span><input v-model="createForm.horizon" placeholder="如 第3层" /></label>
        <div class="modal-actions">
          <button class="btn" type="button" @click="createOpen = false">取消</button>
          <button class="btn primary" type="button" @click="submitCreate">保存登记</button>
        </div>
      </div>
    </div>

    <!-- 手工修改 -->
    <div v-if="manualOpen" class="modal-mask" @click.self="manualOpen = false">
      <div class="modal">
        <h3>手工修改 {{ manualForm.code }}</h3>
        <p class="caliber-note">修改后该单按“单据自定”口径执行，后续任何批次操作都不再覆盖。</p>
        <label class="form-line"><span>送检方法</span><input v-model="manualForm.method" /></label>
        <label class="form-line"><span>送检日期</span><input v-model="manualForm.sentDate" type="date" /></label>
        <label class="form-line"><span>预计返回日</span><input v-model="manualForm.expectedReturn" type="date" /></label>
        <div class="modal-actions">
          <button class="btn" type="button" @click="manualOpen = false">取消</button>
          <button class="btn primary" type="button" @click="submitManual">保存口径</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  allowedActions,
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import {
  batchGroups,
  createDatingEntry,
  fillLogistics,
  listBatches,
  manualAdjust,
  submitBatch,
  syncLedgerStatus,
  type BatchGroup,
} from '@/api/dating-service'
import type { DatingBatch, EntryRow } from '@/data/types'

const meta = moduleMeta('dating')
const statuses = ['待送检', '已送检', '检测中', '已出结果', '已归档', '已退回']

const tabs = [
  { key: 'entries', label: '送检单台账' },
  { key: 'batches', label: '批次编组台' },
] as const

const activeTab = ref<(typeof tabs)[number]['key']>('entries')
const rows = ref<EntryRow[]>([])
const total = ref(0)
const message = ref('')
const messageOk = ref(true)
const filters = ref<Record<string, string>>({})
const groups = ref<BatchGroup[]>([])
const batches = ref<DatingBatch[]>([])
const selected = reactive<Record<string, number[]>>({})
const drafts = reactive<Record<string, { method: string; sentDate: string; expectedReturn: string }>>({})
const logisticsDraft = reactive<Record<number, string>>({})

const createOpen = ref(false)
const createForm = reactive({ code: '', sampleType: '', source: '', horizon: '' })
const manualOpen = ref(false)
const manualForm = reactive({ id: 0, code: '', method: '', sentDate: '', expectedReturn: '' })

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function notify(ok: boolean, text: string) {
  messageOk.value = ok
  message.value = text
}

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const stats = computed(() => [
  { label: '送检总数', value: rows.value.length },
  { label: '待送检', value: rows.value.filter((row) => row.status === '待送检').length },
  { label: '检测中', value: rows.value.filter((row) => row.status === '检测中').length },
  {
    label: '已出结果',
    value: rows.value.filter((row) => row.status === '已出结果').length,
  },
  {
    label: '物流待回填',
    value: rows.value.filter((row) => row['送检批号'] && !row['物流单号'] && row.status !== '已归档').length,
  },
])

function caliberClass(row: EntryRow): string {
  if (row['登记口径'] === '单据自定') {
    return 'tag-manual'
  }
  if (row['登记口径'] === '批次默认') {
    return 'tag-batch'
  }
  return ''
}

function draftFor(key: string) {
  if (!drafts[key]) {
    drafts[key] = { method: '', sentDate: today(), expectedReturn: '' }
  }
  return drafts[key]
}

function isGroupAllChecked(group: BatchGroup): boolean {
  const picked = selected[group.key] ?? []
  return group.entries.length > 0 && group.entries.every((entry) => picked.includes(Number(entry.id)))
}

function toggleGroupAll(group: BatchGroup, checked: boolean) {
  selected[group.key] = checked ? group.entries.map((entry) => Number(entry.id)) : []
}

function toggleOne(group: BatchGroup, id: number, checked: boolean) {
  const current = new Set(selected[group.key] ?? [])
  if (checked) {
    current.add(id)
  } else {
    current.delete(id)
  }
  selected[group.key] = [...current]
}

function batchEntries(batch: DatingBatch): EntryRow[] {
  return batch.entryIds
    .map((id) => rows.value.find((row) => Number(row.id) === id))
    .filter((row): row is EntryRow => Boolean(row))
}

function resetFilters() {
  filters.value = {}
  reload()
}

function switchTab(key: (typeof tabs)[number]['key']) {
  activeTab.value = key
  message.value = ''
  reloadGroups()
  reloadBatches()
}

function exportRows() {
  downloadEntries(meta.key)
}

function reload() {
  const payload = listEntries(meta.key, filters.value)
  rows.value = payload.items
  total.value = payload.total
}

function reloadGroups() {
  groups.value = batchGroups()
}

function reloadBatches() {
  batches.value = listBatches()
}

function runAction(action: string, row: EntryRow) {
  const result = applyAction(meta.key, Number(row.id), action)
  notify(result.ok, result.message)
  if (!result.ok) {
    return
  }
  syncLedgerStatus(Number(row.id), meta.actionTargets[action])
  reload()
  reloadGroups()
  reloadBatches()
}

function submitGroup(group: BatchGroup) {
  const ids = selected[group.key] ?? []
  const draft = draftFor(group.key)
  const result = submitBatch(ids, group.source, group.horizon, draft)
  notify(result.ok, result.message)
  if (!result.ok) {
    return
  }
  selected[group.key] = []
  reload()
  reloadGroups()
  reloadBatches()
}

function saveLogistics(row: EntryRow) {
  const value = logisticsDraft[Number(row.id)] ?? String(row['物流单号'] ?? '')
  const result = fillLogistics(Number(row.id), value)
  notify(result.ok, result.message)
  if (result.ok) {
    reload()
    reloadBatches()
  }
}

function openCreate() {
  Object.assign(createForm, { code: '', sampleType: '', source: '', horizon: '' })
  createOpen.value = true
}

function submitCreate() {
  const result = createDatingEntry(createForm)
  notify(result.ok, result.message)
  if (!result.ok) {
    return
  }
  createOpen.value = false
  reload()
  reloadGroups()
}

function openManual(row: EntryRow) {
  Object.assign(manualForm, {
    id: Number(row.id),
    code: String(row['送检编号'] ?? ''),
    method: String(row['送检方法'] ?? ''),
    sentDate: String(row['送检日期'] ?? ''),
    expectedReturn: String(row['预计返回'] ?? ''),
  })
  manualOpen.value = true
}

function submitManual() {
  const result = manualAdjust(manualForm.id, manualForm)
  notify(result.ok, result.message)
  if (!result.ok) {
    return
  }
  manualOpen.value = false
  reload()
  reloadBatches()
}

onMounted(() => {
  reload()
  reloadGroups()
  reloadBatches()
})
</script>
