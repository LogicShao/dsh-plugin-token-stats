// dsh-plugin-token-stats 宿主侧单测 —— 聚合 wire schema（契约 3.2）。
//
// 用合成 session 用量驱动 aggregateSummary；now / timeZone 全部注入，
// 因此 daily 补零、今日/昨日、本月预测的断言与运行机器无关。

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  aggregateSummary,
  computeStreak,
  daysInMonthOf,
  diffDays,
  normalizeDays,
  normalizeLimit,
  shiftDayKey,
} from '../lib/host/aggregate.js'
import { extractSessionUsage } from '../lib/host/extract.js'
import { normalizePrices } from '../lib/host/prices.js'

const TZ = 'UTC'
const NOW = Date.parse('2026-10-26T12:00:00Z')
const PRICES = normalizePrices({
  'opencode-go/deepseek-v4.1-flash': { input: 0.15, output: 0.6, cacheRead: 0.015, cacheWrite: 0.15 },
  'opencode-go/deepseek-v4-flash': { input: 0.1, output: 0.4, cacheRead: 0.01, cacheWrite: 0.1 },
})

function msOf(day) {
  return Date.parse(`${day}T12:00:00Z`)
}

function usageEvent(seq, time, provider, model, usage) {
  return {
    type: 'assistant/message',
    seq,
    time,
    data: { message: { source: { kind: 'model', provider, model } }, usage },
  }
}

/**
 * 造一份 session 用量。
 * entries: [{day, provider, model, usage}]
 */
function makeSession(id, spec = {}) {
  const {
    cwd = 'D:\\proj\\agent_workspace',
    createdAt = msOf('2026-10-01'),
    parentSession = null,
    delegationDepth = 0,
    title = null,
    live = false,
    entries = [],
  } = spec
  const events = entries.map((entry, index) =>
    usageEvent(index, msOf(entry.day), entry.provider ?? 'opencode-go', entry.model ?? 'deepseek-v4.1-flash', entry.usage),
  )
  const usage = extractSessionUsage({ id, createdAt, cwd, parentSession, delegationDepth }, events, {
    timeZone: TZ,
    title,
  })
  if (live) usage.live = true
  return usage
}

function counters(overrides = {}) {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, ...overrides }
}

function aggregate(sessions, query = {}, overrides = {}) {
  return aggregateSummary({
    sessions,
    query,
    now: NOW,
    timeZone: TZ,
    prices: PRICES,
    usdToCny: 7.1,
    currency: 'USD',
    index: { sessions: sessions.length, events: 0, building: false, stale: false, cacheFile: 'x.json' },
    ...overrides,
  })
}

test('days=7：daily 正好 7 条并补零，范围外事件不计入 totals', () => {
  const session = makeSession('s1', {
    entries: [
      { day: '2026-10-19', usage: counters({ inputTokens: 999, totalTokens: 999 }) }, // 范围外
      { day: '2026-10-20', usage: counters({ inputTokens: 100, totalTokens: 100 }) },
      { day: '2026-10-26', usage: counters({ inputTokens: 50, totalTokens: 50 }) },
    ],
  })
  const body = aggregate([session], { days: 7 })
  assert.deepEqual(body.range, { days: 7, startDay: '2026-10-20', endDay: '2026-10-26' })
  assert.equal(body.daily.length, 7)
  assert.deepEqual(
    body.daily.map((row) => row.day),
    ['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26'],
  )
  assert.equal(body.daily[0].totals.requests, 1)
  assert.equal(body.daily[1].totals.requests, 0, '中间补零')
  assert.equal(body.daily[6].totals.requests, 1)
  assert.equal(body.totals.requests, 2)
  assert.equal(body.totals.inputTokens, 150)
  assert.equal(body.totals.activeDays, 2)
  assert.equal(body.totals.firstDay, '2026-10-20')
  assert.equal(body.totals.lastDay, '2026-10-26')
  assert.equal(body.totals.sessions, 1)
  // totals 与 daily 求和一致
  const summed = body.daily.reduce((sum, row) => sum + row.totals.totalTokens, 0)
  assert.equal(summed, body.totals.totalTokens)
})

test('days=0：全部历史，daily 从首个活跃日补零到今天', () => {
  const session = makeSession('s1', {
    entries: [
      { day: '2026-09-01', usage: counters({ inputTokens: 10, totalTokens: 10 }) },
      { day: '2026-10-26', usage: counters({ inputTokens: 20, totalTokens: 20 }) },
    ],
  })
  const body = aggregate([session], { days: 0 })
  assert.equal(body.range.days, 0)
  assert.equal(body.range.startDay, '2026-09-01')
  assert.equal(body.range.endDay, '2026-10-26')
  assert.equal(body.daily.length, diffDays('2026-09-01', '2026-10-26') + 1)
  assert.equal(body.daily[0].day, '2026-09-01')
  assert.equal(body.totals.requests, 2)
  assert.equal(body.totals.totalTokens, 30)
  assert.equal(body.totals.activeDays, 2)
})

test('查询参数归一：days 默认 30 / 非法回落 / 0 保留；limitSessions 夹到 1..500', () => {
  assert.equal(normalizeDays(undefined), 30)
  assert.equal(normalizeDays('7'), 7)
  assert.equal(normalizeDays(0), 0)
  assert.equal(normalizeDays(9999), 30)
  assert.equal(normalizeDays(-1), 30)
  assert.equal(normalizeDays('abc'), 30)
  assert.equal(normalizeLimit(undefined), 100)
  assert.equal(normalizeLimit(0), 1)
  assert.equal(normalizeLimit(999), 500)
  assert.equal(normalizeLimit('50'), 50)

  const body = aggregate([], {})
  assert.equal(body.range.days, 30)
  assert.equal(body.daily.length, 30)
})

test('会话排行：按 tokens 降序、limit 生效、字段齐全', () => {
  const sessions = [
    makeSession('s-small', {
      cwd: 'C:/x/small',
      entries: [{ day: '2026-10-26', usage: counters({ inputTokens: 5, totalTokens: 5 }) }],
    }),
    makeSession('s-big', {
      cwd: 'D:\\proj\\agent_workspace',
      parentSession: 's-parent',
      delegationDepth: 1,
      title: '大会话',
      live: true,
      entries: [{ day: '2026-10-25', usage: counters({ inputTokens: 100, totalTokens: 100 }) }],
    }),
    makeSession('s-mid', {
      cwd: 'D:\\proj\\other',
      entries: [{ day: '2026-10-24', usage: counters({ inputTokens: 50, totalTokens: 50 }) }],
    }),
  ]
  const body = aggregate(sessions, { days: 7, limitSessions: 2 })
  assert.equal(body.sessions.length, 2)
  assert.equal(body.sessions[0].id, 's-big')
  assert.equal(body.sessions[0].title, '大会话')
  assert.equal(body.sessions[0].live, true)
  assert.equal(body.sessions[0].isSubagent, true)
  assert.equal(body.sessions[0].parentSession, 's-parent')
  assert.equal(body.sessions[0].primaryModel, 'opencode-go/deepseek-v4.1-flash')
  assert.equal(body.sessions[0].project, 'agent_workspace')
  assert.equal(body.sessions[1].id, 's-mid')
  assert.equal(body.totals.sessions, 3, 'totals.sessions 统计范围内有活动的会话，不受 limit 影响')

  const clamped = aggregate(sessions, { days: 7, limitSessions: 9999 })
  assert.equal(clamped.sessions.length, 3, '最多返回全部 3 条（上限 500 不截断）')
})

test('byModel：按 tokens 降序、share 0..1、未定价模型成本 0 并进 unmatchedModels', () => {
  const session = makeSession('s1', {
    entries: [
      {
        day: '2026-10-26',
        provider: 'opencode-go',
        model: 'deepseek-v4.1-flash',
        usage: counters({ inputTokens: 1_000_000, totalTokens: 1_000_000 }),
      },
      {
        day: '2026-10-26',
        provider: 'mystery',
        model: 'unknown-model',
        usage: counters({ inputTokens: 500_000, totalTokens: 500_000 }),
      },
    ],
  })
  const body = aggregate([session], { days: 7 })
  assert.equal(body.byModel.length, 2)
  assert.equal(body.byModel[0].key, 'opencode-go/deepseek-v4.1-flash')
  assert.equal(body.byModel[0].priced, true)
  assert.equal(body.byModel[0].totals.totalTokens, 1_000_000)
  assert.equal(body.byModel[0].costUsd, 0.15)
  assert.equal(body.byModel[0].share, 0.6667)
  assert.equal(body.byModel[1].key, 'mystery/unknown-model')
  assert.equal(body.byModel[1].priced, false)
  assert.equal(body.byModel[1].costUsd, 0)
  assert.deepEqual(body.prices, {
    currency: 'USD',
    usdToCny: 7.1,
    matchedModels: 1,
    unmatchedModels: ['mystery/unknown-model'],
  })
  const shareSum = body.byModel.reduce((sum, row) => sum + row.share, 0)
  assert.equal(Number(shareSum.toFixed(4)), 1)
})

test('byProject：同 cwd 合并、name 取 basename、按 tokens 降序', () => {
  const sessions = [
    makeSession('s1', {
      cwd: 'D:\\proj\\agent_workspace',
      entries: [{ day: '2026-10-26', usage: counters({ inputTokens: 10, totalTokens: 10 }) }],
    }),
    makeSession('s2', {
      cwd: 'D:\\proj\\agent_workspace',
      entries: [{ day: '2026-10-26', usage: counters({ inputTokens: 20, totalTokens: 20 }) }],
    }),
    makeSession('s3', {
      cwd: 'C:/other/repo',
      entries: [{ day: '2026-10-26', usage: counters({ inputTokens: 5, totalTokens: 5 }) }],
    }),
  ]
  const body = aggregate(sessions, { days: 7 })
  assert.equal(body.byProject.length, 2)
  assert.equal(body.byProject[0].cwd, 'D:\\proj\\agent_workspace')
  assert.equal(body.byProject[0].name, 'agent_workspace')
  assert.equal(body.byProject[0].sessions, 2)
  assert.equal(body.byProject[0].totals.totalTokens, 30)
  assert.equal(body.byProject[1].name, 'repo')
})

test('今日 / 昨日 / 近 7 天 / 近 30 天：各自窗口独立计算', () => {
  const session = makeSession('s1', {
    entries: [
      { day: '2026-10-26', usage: counters({ inputTokens: 1, totalTokens: 1 }) },
      { day: '2026-10-25', usage: counters({ inputTokens: 2, totalTokens: 2 }) },
      { day: '2026-10-16', usage: counters({ inputTokens: 4, totalTokens: 4 }) },
      { day: '2026-09-01', usage: counters({ inputTokens: 8, totalTokens: 8 }) },
    ],
  })
  const body = aggregate([session], { days: 7 })
  assert.equal(body.today.day, '2026-10-26')
  assert.equal(body.today.totals.totalTokens, 1)
  assert.equal(body.yesterday.day, '2026-10-25')
  assert.equal(body.yesterday.totals.totalTokens, 2)
  assert.equal(body.last7Days.totals.totalTokens, 3, '近 7 天窗口 10-20..10-26')
  assert.equal(body.last30Days.totals.totalTokens, 7, '近 30 天窗口包含 10-16，不含 09-01')
  assert.equal(body.totals.totalTokens, 3, '请求范围仍是 days=7')
})

test('highlights：连续天数 / 最忙一天 / 最长会话 / 均值 / 缓存命中率 / 主力模型 / 本月预测', () => {
  const sessions = [
    makeSession('s1', {
      entries: [
        { day: '2026-10-26', usage: counters({ inputTokens: 100, cacheReadTokens: 300, totalTokens: 400 }) },
        { day: '2026-10-25', usage: counters({ inputTokens: 100, totalTokens: 100 }) },
        { day: '2026-10-24', usage: counters({ inputTokens: 100, totalTokens: 100 }) },
        { day: '2026-10-22', usage: counters({ inputTokens: 999_900, totalTokens: 999_900 }) }, // 断档 + 最忙
      ],
    }),
    makeSession('s2', {
      entries: [{ day: '2026-10-21', usage: counters({ outputTokens: 500, totalTokens: 500 }) }],
    }),
  ]
  const body = aggregate(sessions, { days: 7 })
  assert.equal(body.highlights.streakDays, 3, '今天/昨天/前天连续，10-23 之前已断')
  assert.deepEqual(body.highlights.busiestDay, {
    day: '2026-10-22',
    totalTokens: 999_900,
    costUsd: Number(((999_900 / 1_000_000) * 0.15).toFixed(6)),
  })
  assert.equal(body.highlights.longestSession.id, 's1')
  assert.equal(body.highlights.longestSession.totalTokens, 1_000_500)
  assert.equal(body.highlights.avgTokensPerRequest, Number((1_001_000 / 5).toFixed(2)))
  // cacheRead / (input + cacheRead + cacheWrite)
  assert.equal(body.highlights.cacheHitRate, Number((300 / (1_000_000 + 300)).toFixed(4)))
  assert.equal(body.highlights.topModel.key, 'opencode-go/deepseek-v4.1-flash')
  assert.equal(body.highlights.topModel.share, 1)
  // 本月（10-01..10-26）成本：只有 input/output/cacheRead 计价，10-26 的 cacheRead 300 * 0.015/1e6
  const cacheCost = (300 / 1_000_000) * 0.015
  const monthCost = body.daily.reduce((sum, row) => sum + row.costUsd, 0)
  assert.ok(monthCost > 0)
  assert.ok(cacheCost > 0)
  const projected = monthCost + (monthCost / 26) * 5
  assert.ok(
    Math.abs(body.highlights.projectedMonthUsd - projected) < 1e-6,
    `本月预测 ${String(body.highlights.projectedMonthUsd)} 应约等于 ${String(projected)}`,
  )
})

test('空数据：所有字段存在且为零值/null，仍然满足 wire 形状', () => {
  const body = aggregate([], { days: 7 })
  assert.equal(body.version, 1)
  assert.equal(body.timeZone, TZ)
  assert.equal(body.generatedAt, NOW)
  assert.equal(body.range.days, 7)
  assert.equal(body.daily.length, 7)
  for (const row of body.daily) {
    assert.equal(row.totals.requests, 0)
    assert.equal(row.costUsd, 0)
    assert.equal(row.costCny, 0)
  }
  assert.equal(body.totals.requests, 0)
  assert.equal(body.totals.sessions, 0)
  assert.equal(body.totals.sessionsScanned, 0)
  assert.equal(body.totals.activeDays, 0)
  assert.equal(body.totals.firstDay, null)
  assert.equal(body.totals.lastDay, null)
  assert.equal(body.totals.costUsd, 0)
  assert.deepEqual(body.byModel, [])
  assert.deepEqual(body.byProject, [])
  assert.deepEqual(body.sessions, [])
  assert.deepEqual(body.highlights, {
    streakDays: 0,
    busiestDay: null,
    longestSession: null,
    avgTokensPerRequest: 0,
    cacheHitRate: 0,
    topModel: null,
    projectedMonthUsd: 0,
  })
  assert.deepEqual(body.prices, { currency: 'USD', usdToCny: 7.1, matchedModels: 0, unmatchedModels: [] })
  assert.equal(body.today.totals.requests, 0)
  assert.equal(body.yesterday.totals.requests, 0)
})

test('数值不变量：token 字段是非负整数、成本 6 位小数、share 0..1、JSON 可序列化', () => {
  const session = makeSession('s1', {
    entries: [
      { day: '2026-10-26', usage: counters({ inputTokens: 1_234_567, outputTokens: 89, cacheReadTokens: 7_654_321, totalTokens: 8_888_977 }) },
    ],
  })
  const body = aggregate([session], { days: 30 })
  const text = JSON.stringify(body)
  assert.equal(typeof text, 'string')
  assert.equal(text.includes('NaN'), false)
  assert.equal(text.includes('Infinity'), false)
  for (const row of [body.totals, body.today.totals, ...body.daily.map((item) => item.totals), ...body.byModel.map((item) => item.totals)]) {
    for (const field of ['requests', 'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens', 'totalTokens']) {
      const value = row[field]
      assert.equal(Number.isInteger(value) && value >= 0, true, `${field} 必须是非负整数，实际 ${String(value)}`)
    }
  }
  assert.equal(Number.isInteger(body.highlights.avgTokensPerRequest * 100), true)
  assert.ok(body.highlights.cacheHitRate >= 0 && body.highlights.cacheHitRate <= 1)
  for (const row of body.byModel) assert.ok(row.share >= 0 && row.share <= 1)
})

test('wire schema：CONTRACT 3.2 的字段齐全、类型正确、顺序符合约定', () => {
  const session = makeSession('s1', {
    entries: [
      { day: '2026-10-26', usage: counters({ inputTokens: 1000, outputTokens: 20, totalTokens: 1020 }) },
      { day: '2026-10-25', usage: counters({ inputTokens: 500, totalTokens: 500 }) },
    ],
  })
  const body = aggregate([session], { days: 7 })
  const COUNTER_KEYS = [
    'requests',
    'inputTokens',
    'outputTokens',
    'cacheReadTokens',
    'cacheWriteTokens',
    'reasoningTokens',
    'totalTokens',
  ]
  for (const key of [
    'version',
    'generatedAt',
    'timeZone',
    'index',
    'range',
    'totals',
    'today',
    'yesterday',
    'last7Days',
    'last30Days',
    'daily',
    'byModel',
    'byProject',
    'sessions',
    'highlights',
    'prices',
  ]) {
    assert.ok(Object.hasOwn(body, key), `缺少顶层字段 ${key}`)
  }
  assert.equal(body.version, 1)
  for (const key of ['sessions', 'events', 'building', 'stale', 'cacheFile']) {
    assert.ok(Object.hasOwn(body.index, key), `index 缺少 ${key}`)
  }
  for (const key of ['days', 'startDay', 'endDay']) assert.ok(Object.hasOwn(body.range, key))
  for (const key of [...COUNTER_KEYS, 'sessions', 'sessionsScanned', 'activeDays', 'firstDay', 'lastDay', 'costUsd', 'costCny']) {
    assert.ok(Object.hasOwn(body.totals, key), `totals 缺少 ${key}`)
  }
  for (const field of COUNTER_KEYS) assert.equal(Number.isInteger(body.totals[field]), true)
  for (const bucket of [body.today, body.yesterday, body.last7Days, body.last30Days]) {
    assert.equal(typeof bucket.totals, 'object')
    assert.equal(typeof bucket.costUsd, 'number')
    assert.equal(typeof bucket.costCny, 'number')
  }
  assert.equal(body.today.day, '2026-10-26')
  assert.equal(body.yesterday.day, '2026-10-25')
  assert.equal(body.daily.length, 7)
  assert.deepEqual(Object.keys(body.daily[0]).sort(), ['costCny', 'costUsd', 'day', 'totals'])
  assert.deepEqual(Object.keys(body.byModel[0]).sort(), [
    'costCny',
    'costUsd',
    'key',
    'model',
    'priced',
    'provider',
    'share',
    'totals',
  ])
  assert.deepEqual(Object.keys(body.byProject[0]).sort(), ['costCny', 'costUsd', 'cwd', 'name', 'sessions', 'totals'])
  assert.deepEqual(Object.keys(body.sessions[0]).sort(), [
    'costCny',
    'costUsd',
    'createdAt',
    'cwd',
    'id',
    'isSubagent',
    'lastActivity',
    'live',
    'parentSession',
    'primaryModel',
    'project',
    'title',
    'totals',
  ])
  for (const key of [
    'streakDays',
    'busiestDay',
    'longestSession',
    'avgTokensPerRequest',
    'cacheHitRate',
    'topModel',
    'projectedMonthUsd',
  ]) {
    assert.ok(Object.hasOwn(body.highlights, key), `highlights 缺少 ${key}`)
  }
  assert.deepEqual(Object.keys(body.prices).sort(), ['currency', 'matchedModels', 'unmatchedModels', 'usdToCny'])
  // daily 升序 / byModel 与 sessions 降序
  const dayList = body.daily.map((row) => row.day)
  assert.deepEqual(dayList, [...dayList].sort())
  const tokens = body.sessions.map((row) => row.totals.totalTokens)
  assert.deepEqual(tokens, [...tokens].sort((left, right) => right - left))
})

test('零用量会话：sessionsScanned 计入索引总数，sessions 只算范围内有 usage 的', () => {
  const withUsage = makeSession('s1', {
    entries: [{ day: '2026-10-26', usage: counters({ inputTokens: 10, totalTokens: 10 }) }],
  })
  const zeroUsage = makeSession('s-zero', { entries: [] })
  const body = aggregate([withUsage, zeroUsage], { days: 7 })
  assert.equal(body.totals.sessionsScanned, 2, '索引到的全部会话（含零用量）')
  assert.equal(body.totals.sessions, 1, '范围内有 usage 的会话数')
  assert.equal(body.totals.requests, 1)
  assert.deepEqual(body.sessions.map((row) => row.id), ['s1'], '零用量会话不进排行')
  assert.equal(body.byProject.length, 1, '零用量会话不进项目分布')
})

test('工具函数：日键加减 / 天数差 / 月天数 / 连续天数', () => {
  assert.equal(shiftDayKey('2026-10-01', -1), '2026-09-30')
  assert.equal(shiftDayKey('2026-03-01', -1), '2026-02-28')
  assert.equal(shiftDayKey('2024-02-28', 1), '2024-02-29')
  assert.equal(shiftDayKey('not-a-day', 1), 'not-a-day')
  assert.equal(diffDays('2026-10-20', '2026-10-26'), 6)
  assert.equal(daysInMonthOf('2026-02-15'), 28)
  assert.equal(daysInMonthOf('2024-02-15'), 29)
  assert.equal(computeStreak(new Set(['2026-10-24', '2026-10-25', '2026-10-26']), '2026-10-26'), 3)
  assert.equal(computeStreak(new Set(['2026-10-24', '2026-10-25']), '2026-10-26'), 2, '今天没用则从昨天数')
  assert.equal(computeStreak(new Set(), '2026-10-26'), 0)
})
