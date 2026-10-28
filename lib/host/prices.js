// dsh-plugin-token-stats 宿主侧 —— 定价与成本估算（纯函数）。
//
// 价格表来自 cordis.patch.yml 的 config.prices，单位是「每 1M token 的美元价」：
//   { "provider/model": { input, output, cacheRead, cacheWrite }, "model": {...} }
// 匹配顺序按契约 3.3：provider/model 精确 → model 兜底 → 未命中按 0 计价并记入
// prices.unmatchedModels。这里不做任何 I/O，方便单测与自检脚本复用。

const PRICE_FIELDS = ['input', 'output', 'cacheRead', 'cacheWrite']

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonNegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

/** 一条价格的归一化：缺字段按 0；四项全非法的条目直接丢弃。 */
function normalizePrice(raw) {
  if (!isRecord(raw)) return undefined
  let recognized = false
  const price = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  for (const field of PRICE_FIELDS) {
    if (Object.hasOwn(raw, field)) {
      recognized = true
      price[field] = nonNegative(raw[field])
    }
  }
  return recognized ? price : undefined
}

/**
 * 归一化整张价格表。键保持原样（"provider/model" 或 "model"）。
 * 返回 null 原型对象，避免 `__proto__` 之类的键污染原型。
 */
export function normalizePrices(raw) {
  const table = Object.create(null)
  if (!isRecord(raw)) return table
  for (const [key, value] of Object.entries(raw)) {
    if (typeof key !== 'string' || key.trim().length === 0) continue
    const price = normalizePrice(value)
    if (price !== undefined) table[key.trim()] = price
  }
  return table
}

/**
 * 按契约顺序找价格。
 * @returns {{key: string, price: object|null, matched: boolean, source: 'exact'|'model'|'none'}}
 */
export function findPrice(prices, provider, model) {
  const table = isRecord(prices) ? prices : {}
  const safeProvider = typeof provider === 'string' && provider.length > 0 ? provider : 'unknown'
  const safeModel = typeof model === 'string' && model.length > 0 ? model : 'unknown'
  const exactKey = `${safeProvider}/${safeModel}`
  const exact = table[exactKey]
  if (isRecord(exact)) return { key: exactKey, price: exact, matched: true, source: 'exact' }
  const loose = table[safeModel]
  if (isRecord(loose)) return { key: safeModel, price: loose, matched: true, source: 'model' }
  return { key: exactKey, price: null, matched: false, source: 'none' }
}

/** 把 "provider/model" 拆回 { provider, model }（model 自身可能含 "/"）。 */
export function splitModelKey(key) {
  const text = typeof key === 'string' ? key : ''
  const slash = text.indexOf('/')
  if (slash <= 0 || slash === text.length - 1) return { provider: 'unknown', model: text.length > 0 ? text : 'unknown' }
  return { provider: text.slice(0, slash), model: text.slice(slash + 1) }
}

/**
 * 成本 = Σ tokens/1e6 * 单价（USD）。
 * 价格缺失/非法、计数器非法都按 0，绝不产生 NaN/Infinity。
 */
export function computeCost(counters, price) {
  if (!isRecord(price) || !isRecord(counters)) return 0
  const million = 1e6
  const cost =
    (nonNegative(counters.inputTokens) / million) * nonNegative(price.input) +
    (nonNegative(counters.outputTokens) / million) * nonNegative(price.output) +
    (nonNegative(counters.cacheReadTokens) / million) * nonNegative(price.cacheRead) +
    (nonNegative(counters.cacheWriteTokens) / million) * nonNegative(price.cacheWrite)
  return Number.isFinite(cost) && cost > 0 ? cost : 0
}

/** 按 model key + 价格表算一条成本（聚合、工具文本、自检脚本共用）。 */
export function costOfModelCounters(prices, key, counters) {
  const { provider, model } = splitModelKey(key)
  const found = findPrice(prices, provider, model)
  return found.matched ? computeCost(counters, found.price) : 0
}
