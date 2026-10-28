// dsh-plugin-token-stats 宿主侧单测 —— 定价（契约 3.3）。
//
// 价格单位是「每 1M token 的美元价」；匹配顺序精确 → model 兜底 → 未命中按 0。

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  computeCost,
  costOfModelCounters,
  findPrice,
  normalizePrices,
  splitModelKey,
} from '../lib/host/prices.js'

const RAW_PRICES = {
  'opencode-go/deepseek-v4.1-flash': { input: 0.15, output: 0.6, cacheRead: 0.015, cacheWrite: 0.15 },
  'opencode-go/deepseek-v4-flash': { input: 0.1, output: 0.4, cacheRead: 0.01, cacheWrite: 0.1 },
  'deepseek-account/deepseek-flash': { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  'deepseek-flash': { input: 9, output: 9, cacheRead: 9, cacheWrite: 9 },
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
