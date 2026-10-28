// dsh-plugin-token-stats 宿主侧单测 —— 事件 → 单 session 用量（契约 3.1）。
//
// 全部用合成事件 fixture，不依赖真实 ~/.dsh；分日时区通过 timeZone 参数固定，
// 因此任意机器、任意本地时区跑出来的结果一致。

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createDayKey,
  emptyCounters,
  extractSessionUsage,
  localDayKey,
  mergeUsage,
  modelOf,
  normalizeHeader,
  usageCounters,
} from '../lib/host/extract.js'

const DAY = 86400000
/** 2026-10-25T16:30:00Z：UTC 还是 25 日，Asia/Shanghai 已经是 26 日 00:30。 */
const TZ_BOUNDARY = Date.parse('2026-10-25T16:30:00Z')

function usageEvent(seq, time, provider, model, usage) {
  return {
    type: 'assistant/message',
    seq,
    time,
    data: {
      message: { source: { kind: 'model', provider, model } },
      usage,
    },
  }
}

test('基本提取：requests / tokens / models / daily / 时间边界', () => {
  const events = [
    { type: 'user/message', seq: 0, time: TZ_BOUNDARY - 5000, data: {} },
    usageEvent(1, TZ_BOUNDARY, 'opencode-go', 'deepseek-v4.1-flash', {
      inputTokens: 100,
      outputTokens: 200,
      cacheReadTokens: 300,
      cacheWriteTokens: 0,
      totalTokens: 600,
    }),
    { type: 'assistant/message', seq: 2, time: TZ_BOUNDARY + 1000, data: {} }, // 没有 usage，不计
    usageEvent(3, TZ_BOUNDARY + 2000, 'opencode-go', 'deepseek-v4.1-flash', {
      inputTokens: 1,
      outputTokens: 2,
      cacheReadTokens: 3,
      cacheWriteTokens: 4,
      totalTokens: 10,
    }),
    { type: 'step/end', seq: 4, time: TZ_BOUNDARY + 3000, data: {} },
  ]
  const usage = extractSessionUsage(
    { id: 's1', createdAt: 111, cwd: 'D:\\proj\\agent_workspace', parentSession: null, delegationDepth: 0 },
    events,
    { timeZone: 'UTC' },
  )
  assert.equal(usage.id, 's1')
  assert.equal(usage.requests, 2)
  assert.equal(usage.inputTokens, 101)
  assert.equal(usage.outputTokens, 202)
  assert.equal(usage.cacheReadTokens, 303)
  assert.equal(usage.cacheWriteTokens, 4)
  assert.equal(usage.totalTokens, 610)
  assert.equal(usage.firstTime, TZ_BOUNDARY)
  assert.equal(usage.lastTime, TZ_BOUNDARY + 2000)
  assert.equal(usage.lastSeq, 4, 'lastSeq 取整个事件流的最大 seq，overlay 去重要用')
  assert.equal(usage.eventCount, 5)
  assert.deepEqual(Object.keys(usage.models), ['opencode-go/deepseek-v4.1-flash'])
  const model = usage.models['opencode-go/deepseek-v4.1-flash']
  assert.equal(model.requests, 2)
  assert.equal(model.totalTokens, 610)
  assert.equal(Object.keys(usage.daily).length, 1, 'UTC 下同一日')
  const daily = Object.values(usage.daily)[0]
  assert.equal(daily.requests, 2)
  assert.equal(daily.totalTokens, 610)
  // dailyModels 是内部额外字段：按日 × 模型，供范围成本精确计算
  const dayModels = Object.values(usage.dailyModels)[0]
  assert.equal(dayModels['opencode-go/deepseek-v4.1-flash'].totalTokens, 610)
})

test('缺字段兜底：totalTokens 由分项求和、cache/reasoning 缺省 0、非法值归零', () => {
  const events = [
    usageEvent(0, TZ_BOUNDARY, 'p', 'm', {
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: undefined,
      cacheWriteTokens: null,
      reasoningTokens: -3,
      totalTokens: 'not-a-number',
    }),
    usageEvent(1, TZ_BOUNDARY + 1, 'p', 'm', { inputTokens: 1, outputTokens: 2, reasoningTokens: 3 }),
    usageEvent(2, TZ_BOUNDARY + 2, 'p', 'm', { inputTokens: 0, outputTokens: 0, totalTokens: 0 }),
  ]
  const usage = extractSessionUsage({ id: 's2' }, events, { timeZone: 'UTC' })
  assert.equal(usage.requests, 3)
  // 第 1 条：10 + 5 = 15；第 2 条：1 + 2 + 3 = 6；第 3 条：0
  assert.equal(usage.totalTokens, 21)
  assert.equal(usage.reasoningTokens, 3)
  assert.equal(usage.cacheReadTokens, 0)
  assert.equal(usage.cacheWriteTokens, 0)
  const counters = usageCounters({ inputTokens: -5, outputTokens: 2.9, totalTokens: Number.NaN })
  assert.deepEqual(counters, {
    requests: 1,
    inputTokens: 0,
    outputTokens: 2,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    totalTokens: 2,
  })
})

test('未知模型与缺失 source：归到 unknown/unknown', () => {
  const events = [
    usageEvent(0, TZ_BOUNDARY, undefined, undefined, { inputTokens: 1, outputTokens: 1 }),
    { type: 'assistant/message', seq: 1, time: TZ_BOUNDARY, data: { usage: { inputTokens: 2, outputTokens: 2 } } },
  ]
  const usage = extractSessionUsage({ id: 's3' }, events, { timeZone: 'UTC' })
  assert.equal(usage.requests, 2)
  assert.deepEqual(Object.keys(usage.models), ['unknown/unknown'])
  assert.equal(usage.models['unknown/unknown'].totalTokens, 6)
  assert.deepEqual(modelOf({}), { provider: 'unknown', model: 'unknown', key: 'unknown/unknown' })
})

test('时区分桶：同一时刻 UTC 与 Asia/Shanghai 落在不同日', () => {
  const utcDay = createDayKey('UTC')(TZ_BOUNDARY)
  const shanghaiDay = createDayKey('Asia/Shanghai')(TZ_BOUNDARY)
  assert.equal(utcDay, '2026-10-25')
  assert.equal(shanghaiDay, '2026-10-26')

  const events = [usageEvent(0, TZ_BOUNDARY, 'p', 'm', { inputTokens: 1, outputTokens: 1 })]
  const inShanghai = extractSessionUsage({ id: 's4' }, events, { timeZone: 'Asia/Shanghai' })
  const inUtc = extractSessionUsage({ id: 's4' }, events, { timeZone: 'UTC' })
  assert.deepEqual(Object.keys(inShanghai.daily), ['2026-10-26'])
  assert.deepEqual(Object.keys(inUtc.daily), ['2026-10-25'])
})

test('跨日事件分桶；本地时区键格式合法', () => {
  const events = [
    usageEvent(0, TZ_BOUNDARY, 'p', 'm', { inputTokens: 1, outputTokens: 0 }),
    usageEvent(1, TZ_BOUNDARY + DAY, 'p', 'm', { inputTokens: 2, outputTokens: 0 }),
  ]
  const usage = extractSessionUsage({ id: 's5' }, events, { timeZone: 'UTC' })
  assert.deepEqual(Object.keys(usage.daily).sort(), ['2026-10-25', '2026-10-26'])
  assert.match(localDayKey(TZ_BOUNDARY), /^\d{4}-\d{2}-\d{2}$/u)
  assert.equal(localDayKey(Number.NaN), undefined)
  assert.equal(createDayKey('Not/AZone')(TZ_BOUNDARY), localDayKey(TZ_BOUNDARY), '非法时区退回本地')
})

test('坏事件不抛错；header 缺字段安全归一', () => {
  const events = [null, 42, {}, { type: 'assistant/message', seq: 1, data: null }, usageEvent(2, TZ_BOUNDARY, 'p', 'm', { inputTokens: 1, outputTokens: 1 })]
  const usage = extractSessionUsage(undefined, events, { timeZone: 'UTC' })
  assert.equal(usage.requests, 1)
  assert.equal(usage.id, null)
  assert.equal(usage.lastSeq, 2)
  assert.deepEqual(normalizeHeader(undefined), {
    id: null,
    createdAt: null,
    cwd: null,
    parentSession: null,
    delegationDepth: 0,
  })
  assert.equal(extractSessionUsage({ id: 's6' }, undefined).requests, 0)
})

test('mergeUsage 合并磁盘基线与活会话 overlay', () => {
  const header = { id: 's7', createdAt: 1, cwd: 'C:\\a', parentSession: 'parent', delegationDepth: 1 }
  const base = extractSessionUsage(header, [usageEvent(0, TZ_BOUNDARY, 'p', 'm', { inputTokens: 10, outputTokens: 1 })], {
    timeZone: 'UTC',
    title: '基线标题',
  })
  const overlay = extractSessionUsage({ id: 's7' }, [usageEvent(3, TZ_BOUNDARY + DAY, 'p', 'm', { inputTokens: 5, outputTokens: 2 })], {
    timeZone: 'UTC',
  })
  const merged = mergeUsage(base, overlay)
  assert.equal(merged.requests, 2)
  assert.equal(merged.inputTokens, 15)
  assert.equal(merged.totalTokens, 18)
  assert.equal(merged.title, '基线标题')
  assert.equal(merged.lastSeq, 3)
  assert.equal(Object.keys(merged.daily).length, 2)
  assert.equal(merged.models['p/m'].requests, 2)
  assert.equal(mergeUsage(base, undefined), base)
  assert.deepEqual(mergeUsage(undefined, base), base)
  assert.deepEqual(emptyCounters().requests, 0)
})
