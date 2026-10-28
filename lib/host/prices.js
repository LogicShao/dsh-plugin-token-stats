// dsh-plugin-token-stats 宿主侧 —— 定价与成本估算（纯函数）。
//
// 价格表来自 cordis.patch.yml 的 config.prices，单位是「每 1M token 的美元价」。
// 支持两种形状：
//   1. 平铺：{ input, output, cacheRead, cacheWrite } —— 单一价格（如 opencode-go 订阅通道）；
//   2. 峰谷：{ peak: {...}, offPeak: {...} } —— 官方 DeepSeek API 的峰时/闲时双价。
// 匹配顺序按契约 3.3：provider/model 精确 → model 兜底 → 未命中按 0 计价并记入
// prices.unmatchedModels。
//
// 官方 DeepSeek 峰时定义（api-docs.deepseek.com/quick_start/pricing，2026-10-28 核对）：
//   UTC 周一至周五 01:00–04:00、06:00–10:00（北京时间 09:00–12:00、14:00–18:00），
//   边界含头不含尾；其余（含周六/周日任意时刻）为闲时。
//   北京时间固定 UTC+8、无夏令时。中国法定节假日官方按闲时计费，但本实现没有节假日
//   日历：节假日白天会被算成峰时，是已知偏差（宁可高估，不取平均价）。
//
// 计费字段映射：input = 缓存未命中输入；cacheRead = 缓存命中输入；output = 输出；
// cacheWrite 官方无此项，恒为 0。

const PRICE_FIELDS = ['input', 'output', 'cacheRead', 'cacheWrite']

/** UTC 峰时窗口（含头不含尾）。 */
export const PEAK_WINDOWS_UTC = [
  [1, 4],
  [6, 10],
]

/** 给 UI / wire 用的峰时描述。 */
export const PEAK_WINDOW_LABEL =
  '北京时间周一至周五 09:00-12:00、14:00-18:00（UTC 01:00-04:00、06:00-10:00），周末与其余时段为闲时'

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonNegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

/** 一条平铺价格的归一化：缺字段按 0；四项全非法的条目返回 undefined。 */
function normalizeFlatPrice(raw) {
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

/** 该价格条目是否是峰谷双价形状。 */
export function isPeakPriceEntry(price) {
  return isRecord(price) && (isRecord(price.peak) || isRecord(price.offPeak))
}

/** 一条价格条目归一化：平铺保持平铺；峰谷两侧各自归一（缺一侧时用另一侧兜底）。 */
function normalizePriceEntry(raw) {
  if (!isRecord(raw)) return undefined
  if (isPeakPriceEntry(raw)) {
    const peak = normalizeFlatPrice(raw.peak)
    const offPeak = normalizeFlatPrice(raw.offPeak)
    if (peak === undefined && offPeak === undefined) return undefined
    return { peak: peak ?? offPeak, offPeak: offPeak ?? peak }
  }
  return normalizeFlatPrice(raw)
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
    const price = normalizePriceEntry(value)
    if (price !== undefined) table[key.trim()] = price
  }
  return table
}

/** 价格表里是否有任一峰谷条目（决定 wire 的 prices.timeAware）。 */
export function hasTimeAwarePrices(prices) {
  if (!isRecord(prices)) return false
  for (const price of Object.values(prices)) {
    if (isPeakPriceEntry(price)) return true
  }
  return false
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
  if (slash <= 0 || slash === text.length - 1) {
    return { provider: 'unknown', model: text.length > 0 ? text : 'unknown' }
  }
  return { provider: text.slice(0, slash), model: text.slice(slash + 1) }
}

/**
 * 是否处于官方峰时（UTC 周一至周五 01:00–04:00、06:00–10:00）。
 * 时间非法/缺失一律按闲时（宁可不虚高）。
 */
export function isPeakTime(timeMs) {
  if (typeof timeMs !== 'number' || !Number.isFinite(timeMs)) return false
  const date = new Date(timeMs)
  if (!Number.isFinite(date.getTime())) return false
  const weekday = date.getUTCDay() // 0 = 周日, 6 = 周六
  if (weekday === 0 || weekday === 6) return false
  const hour = date.getUTCHours()
  for (const [start, end] of PEAK_WINDOWS_UTC) {
    if (hour >= start && hour < end) return true
  }
  return false
}

/** 事件时间 → 'peak' | 'offPeak'（时间非法按 offPeak）。 */
export function timeBucketOf(timeMs) {
  return isPeakTime(timeMs) ? 'peak' : 'offPeak'
}

/**
 * 成本 = Σ tokens/1e6 * 单价（USD）。只认平铺价格形状。
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

/**
 * 按 model key + 峰谷分桶算一条成本。
 * - 峰谷价条目：peak 桶用 peak 价、offPeak 桶用 offPeak 价，两者相加（不取平均）；
 * - 平铺价条目：退回按 allCounters 计价（与旧算法完全一致）；
 * - 未命中价格：0（由调用方记入 unmatchedModels）。
 * 若桶信息整体缺失（外部调用方只给 allCounters），峰谷条目按闲时价兜底。
 * @param {object} prices
 * @param {string} key - "provider/model"
 * @param {object} allCounters - 总和计数器（展示口径）
 * @param {object} [peakCounters] - 峰时桶
 * @param {object} [offPeakCounters] - 闲时桶
 */
export function costOfModelBuckets(prices, key, allCounters, peakCounters, offPeakCounters) {
  const { provider, model } = splitModelKey(key)
  const found = findPrice(prices, provider, model)
  if (!found.matched) return 0
  if (isPeakPriceEntry(found.price)) {
    const hasPeak = isRecord(peakCounters)
    const hasOffPeak = isRecord(offPeakCounters)
    if (!hasPeak && !hasOffPeak) return computeCost(allCounters, found.price.offPeak)
    return (
      computeCost(hasPeak ? peakCounters : undefined, found.price.peak) +
      computeCost(hasOffPeak ? offPeakCounters : undefined, found.price.offPeak)
    )
  }
  return computeCost(allCounters, found.price)
}

/**
 * 按 model key + 价格表算一条成本（兼容旧调用）。
 * 峰谷条目在没有时间桶信息时按闲时价兜底；聚合层统一走 costOfModelBuckets。
 */
export function costOfModelCounters(prices, key, counters) {
  const { provider, model } = splitModelKey(key)
  const found = findPrice(prices, provider, model)
  if (!found.matched) return 0
  if (isPeakPriceEntry(found.price)) return computeCost(counters, found.price.offPeak)
  return computeCost(counters, found.price)
}
