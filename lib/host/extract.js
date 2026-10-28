// dsh-plugin-token-stats 宿主侧 —— 单 session 用量提取（纯函数）。
//
// 为什么要拆成纯函数：store 只负责 I/O、指纹与缓存；「事件流 → 一份用量」的折叠规则
// 必须能脱离宿主服务单测（喂临时 fixture 事件数组），也方便自检脚本直接把真实日志
// 解码结果喂进来核对数字。
//
// 事件契约（来自 dsh-session-persistence / dsh-session）：
//   { type, seq, time, data }，data.usage = { inputTokens, outputTokens,
//   cacheReadTokens?, cacheWriteTokens?, reasoningTokens?, totalTokens? }，
//   data.message.source = { provider, model }。
// 事件对象可能被 backend 冻结（shared-frozen），所以这里只读、不改、不 clone 事件本身。
//
// 峰谷分桶：官方 DeepSeek API 是峰时/闲时双价，所以每个模型的计数除总和 `models`
// 之外，还保留 `modelsPeak` / `modelsOffPeak`；daily 维度同理保留
// `dailyModelsPeak` / `dailyModelsOffPeak`。聚合层只拿这三份算成本，展示口径
// （tokens/requests/share）始终用总和，不受影响。
// 事件时间非法/缺失时按闲时桶归类（宁可不虚高成本），注释见 accumulateEvent。

import { isPeakTime } from './prices.js'

/** 一份用量计数器的字段（wire 里 totals / daily / models 都是这组字段）。 */
export const COUNTER_FIELDS = [
  'requests',
  'inputTokens',
  'outputTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
  'reasoningTokens',
  'totalTokens',
]

/** 缺省（宿主本地时区）分日键。 */
export function localDayKey(timeMs) {
  if (!Number.isFinite(timeMs)) return undefined
  const date = new Date(timeMs)
  const time = date.getTime()
  if (!Number.isFinite(time)) return undefined
  return `${String(date.getFullYear())}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

/** 按 IANA 时区分日；时区名非法时退回本地时区（永不抛错）。 */
export function createDayKey(timeZone) {
  if (typeof timeZone !== 'string' || timeZone.length === 0) return localDayKey
  const cached = DAY_FORMATTERS.get(timeZone)
  if (cached !== undefined) return cached
  let formatter
  try {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    // 触发一次格式化，非法时区会在这里抛 RangeError。
    formatter.format(new Date(0))
  } catch {
    DAY_FORMATTERS.set(timeZone, localDayKey)
    return localDayKey
  }
  const resolve = (timeMs) => {
    if (!Number.isFinite(timeMs)) return undefined
    const date = new Date(timeMs)
    if (!Number.isFinite(date.getTime())) return undefined
    try {
      let year
      let month
      let day
      for (const part of formatter.formatToParts(date)) {
        if (part.type === 'year') year = part.value
        else if (part.type === 'month') month = part.value
        else if (part.type === 'day') day = part.value
      }
      if (year === undefined || month === undefined || day === undefined) return localDayKey(timeMs)
      return `${year}-${month}-${day}`
    } catch {
      return localDayKey(timeMs)
    }
  }
  DAY_FORMATTERS.set(timeZone, resolve)
  return resolve
}

const DAY_FORMATTERS = new Map()

function pad2(value) {
  return value < 10 ? `0${String(value)}` : String(value)
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 非负整数计数器：负数、NaN、Infinity、字符串一律按 0（wire 要求非负整数）。 */
export function sanitizeToken(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0
  return Math.floor(value)
}

function finiteOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** 一份空计数器。 */
export function emptyCounters() {
  return {
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
  }
}

/** 深拷贝一份计数器（聚合返回的 wire 对象不与索引共享引用）。 */
export function cloneCounters(counters) {
  const result = emptyCounters()
  for (const field of COUNTER_FIELDS) result[field] = sanitizeToken(counters?.[field])
  return result
}

/** 把一份计数器累加进另一份（原地）。 */
export function addCounters(target, source) {
  for (const field of COUNTER_FIELDS) target[field] += sanitizeToken(source?.[field])
  return target
}

/** 只保留契约关心的 header 字段，并做类型归一（坏 header 不抛错）。 */
export function normalizeHeader(header) {
  const source = isRecord(header) ? header : {}
  const depth = source.delegationDepth
  return {
    id: typeof source.id === 'string' && source.id.length > 0 ? source.id : null,
    createdAt: finiteOrNull(source.createdAt),
    cwd: typeof source.cwd === 'string' && source.cwd.length > 0 ? source.cwd : null,
    parentSession:
      typeof source.parentSession === 'string' && source.parentSession.length > 0 ? source.parentSession : null,
    delegationDepth: typeof depth === 'number' && Number.isSafeInteger(depth) && depth > 0 ? depth : 0,
    ...(typeof source.agentPreset === 'string' && source.agentPreset.length > 0
      ? { agentPreset: source.agentPreset }
      : {}),
    ...(typeof source.origin === 'string' && source.origin.length > 0 ? { origin: source.origin } : {}),
  }
}

/** 从 assistant/message 的 data 里取 provider/model；缺失用 "unknown"。 */
export function modelOf(data) {
  const source = isRecord(data) && isRecord(data.message) ? data.message.source : undefined
  const provider =
    isRecord(source) && typeof source.provider === 'string' && source.provider.length > 0
      ? source.provider
      : 'unknown'
  const model =
    isRecord(source) && typeof source.model === 'string' && source.model.length > 0 ? source.model : 'unknown'
  return { provider, model, key: `${provider}/${model}` }
}

/** 该事件是否是带 usage 的 assistant/message。 */
export function isUsageEvent(event) {
  if (!isRecord(event) || event.type !== 'assistant/message') return false
  if (!isRecord(event.data)) return false
  return isRecord(event.data.usage)
}

/**
 * usage → 一份计数器。
 * totalTokens 缺失时按 input + output + cacheRead + cacheWrite + reasoning 兜底；
 * 所有字段都按非负整数处理（provider 偶尔回传 null/负数）。
 */
export function usageCounters(usage) {
  const inputTokens = sanitizeToken(usage?.inputTokens)
  const outputTokens = sanitizeToken(usage?.outputTokens)
  const cacheReadTokens = sanitizeToken(usage?.cacheReadTokens)
  const cacheWriteTokens = sanitizeToken(usage?.cacheWriteTokens)
  const reasoningTokens = sanitizeToken(usage?.reasoningTokens)
  const declared = sanitizeToken(usage?.totalTokens)
  const derived = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens + reasoningTokens
  return {
    requests: 1,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens,
    totalTokens: declared > 0 ? declared : derived,
  }
}

function addToCountersMap(map, key, counters) {
  const current = map[key]
  if (current === undefined) {
    map[key] = cloneCounters(counters)
    return
  }
  addCounters(current, counters)
}

/** map[outerKey][innerKey] 的计数器累加（dailyModels* 用）。 */
function addToNestedCountersMap(map, outerKey, innerKey, counters) {
  let inner = map[outerKey]
  if (inner === undefined) {
    inner = Object.create(null)
    map[outerKey] = inner
  }
  addToCountersMap(inner, innerKey, counters)
}

/** 创建折叠用的累加器（store 的活会话 overlay 也用它做增量）。 */
export function createUsageAccumulator(header, options = {}) {
  return {
    dayKey:
      typeof options.dayKey === 'function' ? options.dayKey : createDayKey(options.timeZone),
    title: typeof options.title === 'string' && options.title.length > 0 ? options.title : null,
    header: normalizeHeader(header),
    counters: emptyCounters(),
    models: Object.create(null),
    // 峰谷分桶：总和之外再留峰/闲两份，成本用它们精确计算（官方双价，不取平均）。
    modelsPeak: Object.create(null),
    modelsOffPeak: Object.create(null),
    daily: Object.create(null),
    dailyModels: Object.create(null),
    dailyModelsPeak: Object.create(null),
    dailyModelsOffPeak: Object.create(null),
    firstTime: null,
    lastTime: null,
    lastSeq: -1,
    events: 0,
  }
}

/**
 * 把一个事件折叠进累加器（原地）。返回是否计入了 usage。
 * 所有事件都会更新 lastSeq（overlay 去重要用整个事件流的 seq 上界，而不只是 usage 事件）。
 */
export function accumulateEvent(accumulator, event, dayKey) {
  if (!isRecord(accumulator) || !isRecord(event)) return false
  const resolveDay = typeof dayKey === 'function' ? dayKey : accumulator.dayKey
  accumulator.events += 1
  const seq = event.seq
  if (typeof seq === 'number' && Number.isSafeInteger(seq) && seq > accumulator.lastSeq) accumulator.lastSeq = seq
  if (!isRecord(event.data) || !isRecord(event.data.usage)) return false
  if (event.type !== 'assistant/message') return false

  const counters = usageCounters(event.data.usage)
  addCounters(accumulator.counters, counters)

  const model = modelOf(event.data)
  addToCountersMap(accumulator.models, model.key, counters)

  const time = finiteOrNull(event.time)
  // 峰谷桶由事件时间决定；时间缺失/非法按闲时（官方价里闲时更便宜，宁可低估不虚高）。
  const peak = isPeakTime(time)
  addToCountersMap(peak ? accumulator.modelsPeak : accumulator.modelsOffPeak, model.key, counters)

  if (time !== null) {
    if (accumulator.firstTime === null || time < accumulator.firstTime) accumulator.firstTime = time
    if (accumulator.lastTime === null || time > accumulator.lastTime) accumulator.lastTime = time
    const day = typeof resolveDay === 'function' ? resolveDay(time) : undefined
    if (typeof day === 'string' && day.length > 0) {
      addToCountersMap(accumulator.daily, day, counters)
      addToNestedCountersMap(accumulator.dailyModels, day, model.key, counters)
      addToNestedCountersMap(
        peak ? accumulator.dailyModelsPeak : accumulator.dailyModelsOffPeak,
        day,
        model.key,
        counters,
      )
    }
  }
  return true
}

function cloneCountersMap(map) {
  const result = {}
  for (const [key, counters] of Object.entries(isRecord(map) ? map : {})) result[key] = cloneCounters(counters)
  return result
}

function cloneNestedCountersMap(map) {
  const result = {}
  for (const [outerKey, inner] of Object.entries(isRecord(map) ? map : {})) {
    result[outerKey] = cloneCountersMap(inner)
  }
  return result
}

/** 累加器 → 提取结果（3.1 的字段；fingerprint/cachedAt 由 store 补）。 */
export function finishAccumulator(accumulator) {
  const header = normalizeHeader(accumulator.header)
  const title = typeof accumulator.title === 'string' && accumulator.title.length > 0 ? accumulator.title : null
  return {
    id: header.id,
    title,
    header,
    ...cloneCounters(accumulator.counters),
    models: cloneCountersMap(accumulator.models),
    modelsPeak: cloneCountersMap(accumulator.modelsPeak),
    modelsOffPeak: cloneCountersMap(accumulator.modelsOffPeak),
    daily: cloneCountersMap(accumulator.daily),
    dailyModels: cloneNestedCountersMap(accumulator.dailyModels),
    dailyModelsPeak: cloneNestedCountersMap(accumulator.dailyModelsPeak),
    dailyModelsOffPeak: cloneNestedCountersMap(accumulator.dailyModelsOffPeak),
    firstTime: finiteOrNull(accumulator.firstTime),
    lastTime: finiteOrNull(accumulator.lastTime),
    lastSeq: Number.isSafeInteger(accumulator.lastSeq) ? accumulator.lastSeq : -1,
    eventCount: Number.isSafeInteger(accumulator.events) ? accumulator.events : 0,
  }
}

/**
 * 提取一个 session 的用量。
 * @param {object} header - session header（snap.header / session.header 均可）。
 * @param {Array} events - persistence handle.read(0).events。
 * @param {{title?: string, dayKey?: (ms:number)=>string}} [options]
 */
export function extractSessionUsage(header, events, options = {}) {
  const accumulator = createUsageAccumulator(header, options)
  const list = Array.isArray(events) ? events : []
  for (const event of list) {
    try {
      accumulateEvent(accumulator, event, accumulator.dayKey)
    } catch {
      // 单个坏事件不能拖垮整个 session 的统计；它会自然体现在 eventCount 里。
    }
  }
  return finishAccumulator(accumulator)
}

/** 一份 header 对应的空用量（活的、尚未落盘的 session 用）。 */
export function emptyUsage(header, options = {}) {
  return finishAccumulator(createUsageAccumulator(header, options))
}

function minNullable(left, right) {
  if (left === null) return right
  if (right === null) return left
  return Math.min(left, right)
}

function maxNullable(left, right) {
  if (left === null) return right
  if (right === null) return left
  return Math.max(left, right)
}

function mergeCountersMap(leftMap, rightMap) {
  const result = {}
  for (const source of [leftMap, rightMap]) {
    for (const [key, counters] of Object.entries(isRecord(source) ? source : {})) {
      if (result[key] === undefined) result[key] = cloneCounters(counters)
      else addCounters(result[key], counters)
    }
  }
  return result
}

function mergeNestedCountersMap(leftMap, rightMap) {
  const result = {}
  for (const source of [leftMap, rightMap]) {
    for (const [outerKey, inner] of Object.entries(isRecord(source) ? source : {})) {
      if (result[outerKey] === undefined) result[outerKey] = cloneCountersMap(inner)
      else {
        for (const [key, counters] of Object.entries(isRecord(inner) ? inner : {})) addToCountersMap(result[outerKey], key, counters)
      }
    }
  }
  return result
}

/**
 * 合并两份用量（磁盘基线 + 活会话 overlay）。
 * 返回新对象，不修改入参：磁盘索引还在缓存里，绝不能被查询路径污染。
 */
export function mergeUsage(base, extra) {
  if (base === undefined || base === null) return extra
  if (extra === undefined || extra === null) return base
  const header = base.id !== null && base.id !== undefined ? base.header : extra.header
  const counters = emptyCounters()
  addCounters(counters, base)
  addCounters(counters, extra)
  return {
    id: base.id ?? extra.id ?? null,
    title: base.title ?? extra.title ?? null,
    header: normalizeHeader(header),
    ...counters,
    models: mergeCountersMap(base.models, extra.models),
    modelsPeak: mergeCountersMap(base.modelsPeak, extra.modelsPeak),
    modelsOffPeak: mergeCountersMap(base.modelsOffPeak, extra.modelsOffPeak),
    daily: mergeCountersMap(base.daily, extra.daily),
    dailyModels: mergeNestedCountersMap(base.dailyModels, extra.dailyModels),
    dailyModelsPeak: mergeNestedCountersMap(base.dailyModelsPeak, extra.dailyModelsPeak),
    dailyModelsOffPeak: mergeNestedCountersMap(base.dailyModelsOffPeak, extra.dailyModelsOffPeak),
    firstTime: minNullable(finiteOrNull(base.firstTime), finiteOrNull(extra.firstTime)),
    lastTime: maxNullable(finiteOrNull(base.lastTime), finiteOrNull(extra.lastTime)),
    lastSeq: Math.max(Number.isSafeInteger(base.lastSeq) ? base.lastSeq : -1, Number.isSafeInteger(extra.lastSeq) ? extra.lastSeq : -1),
    eventCount: (Number.isSafeInteger(base.eventCount) ? base.eventCount : 0) + (Number.isSafeInteger(extra.eventCount) ? extra.eventCount : 0),
  }
}
