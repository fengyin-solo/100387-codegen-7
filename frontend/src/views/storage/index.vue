<template>
  <section class="page" data-module="storage">
    <header class="page-head">
      <div>
        <h2>库房管理管理</h2>
        <p class="page-desc">维护库房架位，并承接测年送检批次跨业务面生成的样品临时出库台账。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记库房架位</button>
        <button class="btn" type="button" @click="exportRows">导出库房管理清单</button>
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
          <th>临时出库占用</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>
            <span v-if="occupiedByRack[String(row['架位编号'])]" class="tag tag-batch">
              临时占用 {{ occupiedByRack[String(row['架位编号'])] }} 件
            </span>
            <span v-else>—</span>
          </td>
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
          <td :colspan="columns.length + 3" class="empty-state">暂无库房管理数据，可先登记库房架位</td>
        </tr>
      </tbody>
    </table>

    <section class="panel ledger-panel">
      <div class="ledger-head">
        <div>
          <h3 class="panel-title">样品临时出库台账（测年送检批次自动落账）</h3>
          <p class="page-desc">同一批号重复导入不会重复占用库位；样品退回、归档或手工回库后释放临时库位。</p>
        </div>
        <form class="ledger-import" @submit.prevent="reimportBatch">
          <input v-model="batchNoInput" placeholder="输入送检批号重新导入" />
          <button class="btn" type="submit">重复导入同批号</button>
        </form>
      </div>

      <div class="stat-row">
        <article class="stat-card">
          <span class="stat-label">台账总条数</span>
          <strong class="stat-value">{{ ledger.length }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">临时出库在外</span>
          <strong class="stat-value">{{ activeLedger.length }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">已回库</span>
          <strong class="stat-value">{{ ledger.filter((item) => item.status === '已回库').length }}</strong>
        </article>
        <article class="stat-card">
          <span class="stat-label">物流待回填</span>
          <strong class="stat-value">{{ ledger.filter((item) => !item.logisticsNo && item.status !== '已回库').length }}</strong>
        </article>
      </div>

      <table class="data-table">
        <thead>
          <tr>
            <th>送检批号</th>
            <th>送检编号</th>
            <th>送检来源</th>
            <th>送检层位</th>
            <th>临时库位</th>
            <th>送检方法</th>
            <th>登记口径</th>
            <th>物流单号</th>
            <th>出库日期</th>
            <th>回库日期</th>
            <th>台账状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in ledger" :key="item.id">
            <td>{{ item.batchNo }}</td>
            <td>{{ item.datingCode }}</td>
            <td>{{ item.source }}</td>
            <td>{{ item.horizon }}</td>
            <td>{{ item.rackCode }}</td>
            <td>{{ item.method }}</td>
            <td><span class="tag" :class="item.registerCaliber === '单据自定' ? 'tag-manual' : 'tag-batch'">{{ item.registerCaliber }}</span></td>
            <td>{{ item.logisticsNo || '待回填' }}</td>
            <td>{{ item.sentDate }}</td>
            <td>{{ item.returnedDate || '—' }}</td>
            <td>{{ item.status }}</td>
            <td>
              <button
                v-if="item.status !== '已回库'"
                class="link"
                type="button"
                @click="markReturned(item.id)"
              >
                登记回库
              </button>
              <span v-else>—</span>
            </td>
          </tr>
          <tr v-if="!ledger.length">
            <td colspan="12" class="empty-state">暂无样品临时出库记录，批次送出后会自动生成</td>
          </tr>
        </tbody>
      </table>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条库房管理记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import {
  importBatchLedger,
  listLedger,
  markLedgerReturned,
} from '@/api/dating-service'
import type { EntryRow, OutboundLedgerEntry } from '@/data/types'

const meta = moduleMeta('storage')
const columns = ["架位编号", "库房名称", "存放器物类别", "架位层数", "容纳件数", "当前件数", "管理人", "架位状态"]
const actions = ["存放器物", "调整整理", "临时封存"]
const statuses = ["正常使用", "已满", "待整理", "临时封存"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const ledger = ref<OutboundLedgerEntry[]>([])
const batchNoInput = ref('')

const stats = computed(() => [
  { label: '架位总数', value: rows.value.length },
  { label: '临时出库在外样品', value: activeLedger.value.length },
  { label: '可用架位', value: rows.value.filter((row) => row.status === '正常使用').length },
])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const activeLedger = computed(() => ledger.value.filter((item) => item.status !== '已回库'))

const occupiedByRack = computed<Record<string, number>>(() => {
  const counter: Record<string, number> = {}
  for (const item of activeLedger.value) {
    counter[item.rackCode] = (counter[item.rackCode] ?? 0) + 1
  }
  return counter
})

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
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reimportBatch() {
  errorMessage.value = ''
  const result = importBatchLedger(batchNoInput.value)
  errorMessage.value = result.message
  reloadLedger()
}

function markReturned(id: number) {
  errorMessage.value = ''
  const result = markLedgerReturned(id)
  errorMessage.value = result.message
  reloadLedger()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '库房管理列表读取失败'
  }
}

function reloadLedger() {
  ledger.value = listLedger()
}

onMounted(() => {
  reload()
  reloadLedger()
})
</script>
