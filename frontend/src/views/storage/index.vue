<template>
  <section class="page" data-module="storage">
    <header class="page-head">
      <div>
        <h2>库房管理</h2>
        <p class="page-desc">维护库房架位，并承接测年送检跨业务面的样品临时出库台账：批次送出自动登记，重复导入同一批号不重复占用库位。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记库房架位</button>
        <button class="btn" type="button" @click="exportRows">导出库房架位清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无库房架位数据，可先登记库房架位</td>
        </tr>
      </tbody>
    </table>

    <!-- 样品临时出库台账（跨业务面：测年批次送出） -->
    <div class="panel">
      <div class="panel-head">
        <h3>样品临时出库台账</h3>
        <span class="panel-tip">测年批次送出时自动登记；按批号手工导入为幂等操作，同一批号重复导入不会重复占用库位。</span>
      </div>

      <div class="stat-row">
        <article class="stat-card">
          <span class="stat-label">涉及批号</span>
          <strong class="stat-value">{{ ledgerStat.batches }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">临时出库样品</span>
          <strong class="stat-value">{{ ledgerStat.samples }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">占用库位数</span>
          <strong class="stat-value">{{ ledgerStat.occupied }}</strong>
        </article>
      </div>

      <form class="filter-bar" @submit.prevent="importBatch">
        <label class="filter-item">
          <span>按批号导入台账</span>
          <input v-model="importBatchNo" placeholder="例如 PC-20261005-01" />
        </label>
        <button class="btn primary" type="submit">导入批号</button>
        <label class="filter-item">
          <span>批号筛选</span>
          <input v-model="ledgerFilter['批次号']" placeholder="按批号筛选" />
        </label>
        <label class="filter-item">
          <span>送检编号筛选</span>
          <input v-model="ledgerFilter['送检编号']" placeholder="按送检编号筛选" />
        </label>
        <button class="btn ghost" type="button" @click="ledgerFilter = { 批次号: '', 送检编号: '' }">清除筛选</button>
      </form>

      <table class="data-table compact">
        <thead>
          <tr>
            <th>批次号</th>
            <th>送检编号</th>
            <th>送检来源</th>
            <th>送检层位</th>
            <th>样品类型</th>
            <th>原库位</th>
            <th>出库日期</th>
            <th>物流号</th>
            <th>台账状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in visibleLedger" :key="ledgerKeyOf(item)">
            <td>{{ item.批次号 }}</td>
            <td>{{ item.送检编号 }}</td>
            <td>{{ item.送检来源 }}</td>
            <td>{{ item.送检层位 }}</td>
            <td>{{ item.样品类型 }}</td>
            <td>{{ item.原库位 || '—' }}</td>
            <td>{{ item.出库日期 }}</td>
            <td>{{ item.物流号 || '待回填' }}</td>
            <td>{{ item.台账状态 }}</td>
          </tr>
          <tr v-if="!visibleLedger.length">
            <td colspan="9" class="empty-state">暂无样品临时出库记录，测年批次送出后自动生成</td>
          </tr>
        </tbody>
      </table>
    </div>

    <footer class="page-foot">
      <span>共 {{ total }} 条库房架位记录</span>
      <span v-if="infoMessage" class="success-text">{{ infoMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { importLedgerByBatch, ledgerRows, ledgerStats } from '@/api/dating'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('storage')
const columns = ['架位编号', '库房名称', '存放器物类别', '架位层数', '容纳件数', '当前件数', '管理人', '架位状态']
const actions = ['存放器物', '调整整理', '临时封存']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const infoMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const stats = ref([{ label: '架位总数', value: 0 }, { label: '已满架位', value: 0 }, { label: '可用架位', value: 0 }])

const importBatchNo = ref('')
const ledgerFilter = reactive<{ 批次号: string; 送检编号: string }>({ 批次号: '', 送检编号: '' })
const ledgerVersion = ref(0)

const allLedger = computed(() => {
  ledgerVersion.value
  return ledgerRows()
})

const visibleLedger = computed(() =>
  allLedger.value.filter(
    (item) =>
      item.批次号.includes(ledgerFilter['批次号'].trim()) &&
      item.送检编号.includes(ledgerFilter['送检编号'].trim()),
  ),
)

const ledgerStat = computed(() => ledgerStats(allLedger.value))

function ledgerKeyOf(item: { 批次号: string; 送检编号: string }): string {
  return `${item.批次号}@@${item.送检编号}`
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '库房架位登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  infoMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  infoMessage.value = result.message
  reload()
}

function importBatch() {
  errorMessage.value = ''
  infoMessage.value = ''
  const result = importLedgerByBatch(importBatchNo.value)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  infoMessage.value = result.message
  importBatchNo.value = ''
  ledgerVersion.value += 1
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    stats.value = [
      { label: '架位总数', value: payload.total },
      { label: '已满架位', value: payload.items.filter((row) => String(row.status) === '已满').length },
      { label: '可用架位', value: payload.items.filter((row) => String(row.status) !== '已满').length },
    ]
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '库房管理列表读取失败'
  }
}

onMounted(reload)
</script>
