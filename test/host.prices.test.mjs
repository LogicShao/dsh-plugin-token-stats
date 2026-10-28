// dsh-plugin-token-stats 宿主侧单测 —— 定价（契约 3.3 + 官方峰谷价）。
//
// 价格单位是「每 1M token 的美元价」；匹配顺序精确 → model 兜底 → 未命中按 0。
// 峰谷价：UTC 周一至五 01:00-04:00、06:00-10:00 为峰时，其余与周末为闲时。

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  computeCost,
  costOfModelBuckets,
  costOfModelCounters,
  findPrice,
  hasTimeAwarePrices,
  isPeakTime,
  normalizePrices,
  PEAK_WINDOW_LABEL,
  splitModelKey,
  timeBucketOf,
} from '../lib/host/prices.js'

const RAW_PRICES = {
  'opencode-go/deepseek-v4.1-flash': { input: 0.15, output: 0.6, cacheRead: 0.015, cacheWrite: 0.15 },
  'opencode-go/deepseek-v4-flash': { input: 0.1, output: 0.4, cacheRead: 0.01, cacheWrite: 0.1 },
  'deepseek-account/deepseek-flash': { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  'deepseek-flash': { input: 9, output: 9, cacheRead: 9, cacheWrite: 9 },
}

/** 官方 DeepSeek flash 峰谷价（USD / 1M tokens，2026-10-28 核对）。 */
const FLASH_BUCKET = {
  peak: { input: 0.3, cacheRead: 0.006, output: 1.2, cacheWrite: 0 },
  offPeak: { input: 0.15, cacheRead: 0.003, output: 0.6, cacheWrite: 0 },
}

test('normalizePrices：坏条目丢弃、缺失字段补 0、负数归零', () => {
  const prices = normalizePrices({
    'p/m': { input: 0.15, output: 0.6, cacheRead: 0.015, cacheWrite: 0.15 },
    'p/partial': { input: 1 },
    'p/negative': { input: -3, output: 2 },
    'p/broken': 'not-an-object',
    '': { input: 1 },
    'p/none': {},
  })
  assert.deepEqual(prices['p/m'], { input: 0.15, output: 0.6, cacheRead: 0.015, cacheWrite: 0.15 })
  assert.deepEqual(prices['p/partial'], { input: 1, output: 0, cacheRead: 0, cacheWrite: 0 })
  assert.deepEqual(prices['p/negative'], { input: 0, output: 2, cacheRead: 0, cacheWrite: 0 })
  assert.equal(prices['p/broken'], undefined)
  assert.equal(prices[''], undefined)
  assert.equal(prices['p/none'], undefined)
  assert.deepEqual(Object.keys(normalizePrices(undefined)), [])
})

test('findPrice：provider/model 精确优先，其次 model 兜底，未命中返回 matched=false', () => {
  const prices = normalizePrices(RAW_PRICES)
  const exact = findPrice(prices, 'opencode-go', 'deepseek-v4.1-flash')
  assert.equal(exact.matched, true)
  assert.equal(exact.source, 'exact')
  assert.equal(exact.key, 'opencode-go/deepseek-v4.1-flash')

  // provider 不同 → 退到 model 兜底键
  const loose = findPrice(prices, 'other-provider', 'deepseek-flash')
  assert.equal(loose.matched, true)
  assert.equal(loose.source, 'model')
  assert.equal(loose.key, 'deepseek-flash')

  const missing = findPrice(prices, 'unknown-provider', 'unknown-model')
  assert.deepEqual(missing, {
    key: 'unknown-provider/unknown-model',
    price: null,
    matched: false,
    source: 'none',
  })
  // exact 键优先于同名 model 兜底键（值 9）
  assert.equal(findPrice(prices, 'opencode-go', 'deepseek-v4.1-flash').price.input, 0.15)
})

test('computeCost：tokens/1e6 × 单价，非法输入归 0', () => {
  const price = { input: 0.15, output: 0.6, cacheRead: 0.015, cacheWrite: 0.15 }
  assert.equal(computeCost({ inputTokens: 1_000_000 }, price), 0.15)
  assert.equal(computeCost({ outputTokens: 1_000_000 }, price), 0.6)
  assert.equal(computeCost({ cacheReadTokens: 1_000_000 }, price), 0.015)
  assert.equal(computeCost({ cacheWriteTokens: 1_000_000 }, price), 0.15)
  assert.equal(computeCost({ inputTokens: 500_000, outputTokens: 500_000 }, price), 0.375)
  assert.equal(computeCost({ inputTokens: Number.NaN, outputTokens: -5 }, price), 0)
  assert.equal(computeCost(undefined, price), 0)
  assert.equal(computeCost({ inputTokens: 1_000_000 }, null), 0)
  assert.equal(computeCost({ inputTokens: 1_000_000 }, { input: Number.POSITIVE_INFINITY }), 0)
  // 免费的精确价格也算「命中」，成本 0
  const free = normalizePrices(RAW_PRICES)
  assert.equal(costOfModelCounters(free, 'deepseek-account/deepseek-flash', { inputTokens: 1_000_000 }), 0)
  assert.equal(findPrice(free, 'deepseek-account', 'deepseek-flash').matched, true)
})

test('costOfModelCounters：按 model key 查价并计成本', () => {
  const prices = normalizePrices(RAW_PRICES)
  const cost = costOfModelCounters(prices, 'opencode-go/deepseek-v4.1-flash', {
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
    cacheReadTokens: 1_000_000,
    cacheWriteTokens: 1_000_000,
  })
  assert.equal(Number(cost.toFixed(6)), 0.915)
  assert.equal(costOfModelCounters(prices, 'nope/none', { inputTokens: 1_000_000 }), 0)
})

test('splitModelKey：model 自身含 / 时只切第一段', () => {
  assert.deepEqual(splitModelKey('opencode-go/deepseek-v4.1-flash'), {
    provider: 'opencode-go',
    model: 'deepseek-v4.1-flash',
  })
  assert.deepEqual(splitModelKey('a/b/c'), { provider: 'a', model: 'b/c' })
  assert.deepEqual(splitModelKey('no-slash'), { provider: 'unknown', model: 'no-slash' })
  assert.deepEqual(splitModelKey(undefined), { provider: 'unknown', model: 'unknown' })
})

// ---------------------------------------------------------------------------
// 官方峰谷价
// ---------------------------------------------------------------------------

test('normalizePrices：峰谷形状两侧各自归一，缺字段补 0、缺一侧用另一侧兜底', () => {
  const prices = normalizePrices({
    'deepseek-account/deepseek-flash': FLASH_BUCKET,
    'p/only-peak': { peak: { input: 1, output: 2 } },
    'p/one-side-broken': { peak: 'nope', offPeak: { input: 3 } },
    'p/not-a-price': { foo: 1 },
  })
  assert.deepEqual(prices['deepseek-account/deepseek-flash'], {
    peak: { input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: 0 },
    offPeak: { input: 0.15, output: 0.6, cacheRead: 0.003, cacheWrite: 0 },
  })
  assert.deepEqual(prices['p/only-peak'], {
    peak: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
    offPeak: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
  })
  assert.deepEqual(prices['p/one-side-broken'], {
    peak: { input: 3, output: 0, cacheRead: 0, cacheWrite: 0 },
    offPeak: { input: 3, output: 0, cacheRead: 0, cacheWrite: 0 },
  })
  assert.equal(prices['p/not-a-price'], undefined, '既不是平铺也不是峰谷 → 丢弃')
  // 平铺形状保持旧结构（不额外包 kind 字段）
  assert.deepEqual(prices['opencode-go/deepseek-v4.1-flash'], undefined)
  const flat = normalizePrices(RAW_PRICES)
  assert.deepEqual(flat['opencode-go/deepseek-v4.1-flash'], {
    input: 0.15,
    output: 0.6,
    cacheRead: 0.015,
    cacheWrite: 0.15,
  })
})

test('isPeakTime：周四 UTC 边界含头不含尾；周六/周日任意时刻闲时', () => {
  const cases = [
    ['2026-10-29T00:59:00Z', false, '峰前最后一分钟'],
    ['2026-10-29T01:00:00Z', true, '01:00 起峰'],
    ['2026-10-29T03:59:00Z', true, '03:59 仍在峰'],
    ['2026-10-29T04:00:00Z', false, '04:00 结束峰'],
    ['2026-10-29T05:59:00Z', false, '两段之间闲时'],
    ['2026-10-29T06:00:00Z', true, '06:00 起峰'],
    ['2026-10-29T09:59:00Z', true, '09:59 仍在峰'],
    ['2026-10-29T10:00:00Z', false, '10:00 结束峰'],
    ['2026-10-29T14:30:00Z', false, '下午闲时'],
    ['2026-10-31T02:00:00Z', false, '周六闲时'],
    ['2026-11-01T07:00:00Z', false, '周日闲时'],
  ]
  for (const [iso, expected, label] of cases) {
    assert.equal(isPeakTime(Date.parse(iso)), expected, `${iso} ${label}`)
    assert.equal(timeBucketOf(Date.parse(iso)), expected ? 'peak' : 'offPeak', `${iso} bucket`)
  }
  assert.equal(isPeakTime(Number.NaN), false)
  assert.equal(isPeakTime(undefined), false)
  assert.equal(timeBucketOf(undefined), 'offPeak')
  assert.match(PEAK_WINDOW_LABEL, /09:00-12:00/u)
  assert.match(PEAK_WINDOW_LABEL, /14:00-18:00/u)
})

test('costOfModelBuckets：峰谷条目按桶分别计价后加总（不取平均）', () => {
  const prices = normalizePrices({ 'deepseek-account/deepseek-flash': FLASH_BUCKET })
  const peak = { inputTokens: 2_000_000, outputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 1_000_000 }
  const offPeak = { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 2_000_000, cacheWriteTokens: 0 }
  const all = { inputTokens: 3_000_000, outputTokens: 1_000_000, cacheReadTokens: 2_000_000, cacheWriteTokens: 1_000_000 }
  const cost = costOfModelBuckets(prices, 'deepseek-account/deepseek-flash', all, peak, offPeak)
  // 峰：2*0.30 + 1*1.2 + 1*0 = 1.8；闲：1*0.15 + 2*0.003 = 0.156
  assert.equal(Number(cost.toFixed(6)), 1.956)
  // 取平均的错误算法：input 0.225*3M + output 0.9*1M + cacheRead 0.0045*2M = 1.584
  assert.notEqual(Number(cost.toFixed(6)), 1.584)
  // 只有峰桶
  assert.equal(
    Number(costOfModelBuckets(prices, 'deepseek-account/deepseek-flash', all, peak).toFixed(6)),
    1.8,
  )
  // 只有闲桶
  assert.equal(
    Number(costOfModelBuckets(prices, 'deepseek-account/deepseek-flash', all, undefined, offPeak).toFixed(6)),
    0.156,
  )
  // 两个桶都缺：按闲时价兜底（外部老调用）
  assert.equal(
    Number(costOfModelBuckets(prices, 'deepseek-account/deepseek-flash', all).toFixed(6)),
    Number(
      (
        (3 / 1) * 0.15 +
        (1 / 1) * 0.6 +
        (2 / 1) * 0.003 +
        (1 / 1) * 0
      ).toFixed(6),
    ),
  )
  // 未定价
  assert.equal(costOfModelBuckets(prices, 'nope/none', all, peak, offPeak), 0)
})

test('costOfModelBuckets：平铺价条目与旧 computeCost 逐位一致', () => {
  const prices = normalizePrices(RAW_PRICES)
  const counters = {
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
    cacheReadTokens: 1_000_000,
    cacheWriteTokens: 1_000_000,
  }
  const flatPrice = prices['opencode-go/deepseek-v4.1-flash']
  const legacy = computeCost(counters, flatPrice)
  assert.equal(costOfModelBuckets(prices, 'opencode-go/deepseek-v4.1-flash', counters, counters, counters), legacy)
  // 峰谷条目走 costOfModelCounters 兼容入口时按闲时价
  const bucketPrices = normalizePrices({ 'deepseek-account/deepseek-flash': FLASH_BUCKET })
  const bucketLegacy = costOfModelCounters(bucketPrices, 'deepseek-account/deepseek-flash', counters)
  assert.equal(
    Number(bucketLegacy.toFixed(6)),
    Number(((1 * 0.15) + (1 * 0.6) + (1 * 0.003) + 0).toFixed(6)),
  )
})

test('findPrice / hasTimeAwarePrices：峰谷条目算命中；timeAware 只在有峰谷条目时为真', () => {
  const bucketPrices = normalizePrices({ 'deepseek-account/deepseek-flash': FLASH_BUCKET })
  const found = findPrice(bucketPrices, 'deepseek-account', 'deepseek-flash')
  assert.equal(found.matched, true)
  assert.equal(found.source, 'exact')
  assert.equal(hasTimeAwarePrices(bucketPrices), true)
  assert.equal(hasTimeAwarePrices(normalizePrices(RAW_PRICES)), false)
  assert.equal(hasTimeAwarePrices(undefined), false)
  // model 兜底键也能命中峰谷条目
  const loose = normalizePrices({ 'deepseek-flash': FLASH_BUCKET })
  assert.equal(findPrice(loose, 'deepseek-account', 'deepseek-flash').matched, true)
  assert.equal(findPrice(loose, 'deepseek-account', 'deepseek-flash').source, 'model')
})
