// dsh-plugin-token-stats 宿主侧 —— 聚合（纯函数）。
//
// 输入是 store 产出的「每个 session 一份用量」数组，输出是契约 3.2 的 wire 对象。
// 唯一的“环境”读取是缺省时区名（Intl），其余全部由入参决定，因此可以脱离宿主单测。
//
// 关于 daily / dailyModels 的分工：
//   daily        → 分日计数器（wire 的 daily 用它补零）
//   dailyModels  → 分日 × 模型计数器（按范围精确算成本 / byModel 用）
//   dailyModelsPeak / dailyModelsOffPeak → 分日 × 模型 × 峰/闲桶（官方峰谷双价用）
// days=0（全部历史）时 totals/byModel 直接用 session 级累计值，这样即使个别事件缺 time、
// 没进 daily bucket，也不会漏统计；days>0 时按 daily/dailyModels* 过滤范围。
//
// 成本口径：一切成本都走 costOfModelBuckets() —— 峰谷价格条目分别用 peak/offPeak
// 两个桶计价后相加（绝不取平均）；平铺价格条目（opencode-go 订阅通道）按总和计价，
// 与旧算法逐位一致。tokens/requests/share 等展示字段始终用总和，口径不变。

import {
  addCounters,
  cloneCounters,
  createDayKey,
  emptyCounters,
  sanitizeToken,
} from './extract.js'
import {
  costOfModelBuckets,
  findPrice,
  hasTimeAwarePrices,
  PEAK_WINDOW_LABEL,
  splitModelKey,
} from './prices.js'

export const DEFAULT_DAYS = 30
export const DEFAULT_LIMIT = 100
export const MAX_LIMIT = 500
/** 全部历史时给 daily 补零的硬上界（防止坏时间戳造出几万条日桶）。 */
export const MAX_RANGE_DAYS = 3660

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/u
const DAY_MS = 86400000

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function pad2(value) {
  return value < 10 ? `0${String(value)}` : String(value)
}

/** 保留 digits 位小数；NaN/Infinity 一律 → 0（wire 要求可 JSON 化的有限数）。 */
export function roundNumber(value, digits = 6) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  const factor = 10 ** digits
  const rounded = Math.round(value * factor) / factor
  return Number.isFinite(rounded) ? rounded : 0
}

/** days 查询参数：0=全部历史，正整数=最近 N 天（含今天），非法值回落 30。 */
export function normalizeDays(value) {
  if (value === undefined || value === null || value === '') return DEFAULT_DAYS
  const parsed = typeof value === 'number' ? value : Number(String(value).trim())
  if (!Number.isFinite(parsed)) return DEFAULT_DAYS
  const days = Math.trunc(parsed)
  if (days === 0) return 0
  if (days < 1 || days > MAX_RANGE_DAYS) return DEFAULT_DAYS
  return days
}

/** limitSessions：默认 100，夹到 1..500。 */
export function normalizeLimit(value) {
  if (value === undefined || value === null || value === '') return DEFAULT_LIMIT
  const parsed = typeof value === 'number' ? value : Number(String(value).trim())
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT
  const limit = Math.trunc(parsed)
  if (limit < 1) return 1
  return Math.min(limit, MAX_LIMIT)
}

export function isDayKey(value) {
  return typeof value === 'string' && DAY_PATTERN.test(value)
}

function parseDayKey(day) {
  if (!isDayKey(day)) return undefined
  const year = Number(day.slice(0, 4))
  const month = Number(day.slice(5, 7))
  const date = Number(day.slice(8, 10))
  if (month < 1 || month > 12 || date < 1 || date > 31) return undefined
  return { year, month, date }
}

function formatUtcDay(timestamp) {
  const date = new Date(timestamp)
  return `${String(date.getUTCFullYear())}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`
}

/** 日历日加减（按 UTC 纯日历算术，不受夏令时影响，输入输出都是 YYYY-MM-DD）。 */
export function shiftDayKey(day, delta) {
  const parsed = parseDayKey(day)
  if (parsed === undefined || !Number.isInteger(delta)) return day
  const timestamp = Date.UTC(parsed.year, parsed.month - 1, parsed.date) + delta * DAY_MS
  return formatUtcDay(timestamp)
}

/** toDay − fromDay 的整数天数。 */
export function diffDays(fromDay, toDay) {
  const from = parseDayKey(fromDay)
  const to = parseDayKey(toDay)
  if (from === undefined || to === undefined) return 0
  return Math.round((Date.UTC(to.year, to.month - 1, to.date) - Date.UTC(from.year, from.month - 1, from.date)) / DAY_MS)
}

/** 一个月有多少天（day 是 YYYY-MM-DD）。 */
export function daysInMonthOf(day) {
  const parsed = parseDayKey(day)
  if (parsed === undefined) return 30
  return new Date(Date.UTC(parsed.year, parsed.month, 0)).getUTCDate()
}

function inRange(day, startDay, endDay) {
  return isDayKey(day) && day >= startDay && day <= endDay
}

function localTimeZone() {
  try {
    const name = Intl.DateTimeFormat().resolvedOptions().timeZone
    return typeof name === 'string' && name.length > 0 ? name : 'local'
  } catch {
    return 'local'
  }
}

/** 把 source（day → model → counters）累加进 target（Map<day, Map<key, counters>>）。 */
function foldNestedCountersInto(target, source) {
  for (const [outerKey, inner] of Object.entries(isRecord(source) ? source : {})) {
    if (!isDayKey(outerKey) || !isRecord(inner)) continue
    let outerMap = target.get(outerKey)
    if (outerMap === undefined) {
      outerMap = new Map()
      target.set(outerKey, outerMap)
    }
    for (const [key, counters] of Object.entries(inner)) {
      const current = outerMap.get(key)
      if (current === undefined) outerMap.set(key, cloneCounters(counters))
      else addCounters(current, counters)
    }
  }
}

/** 合并全历史的日汇总与三张分日模型表（总和 / 峰时 / 闲时）。 */
function foldDayTables(sessions) {
  const dayTotals = new Map()
  const dayModels = new Map()
  const dayModelsPeak = new Map()
  const dayModelsOffPeak = new Map()
  for (const session of sessions) {
    const daily = isRecord(session?.daily) ? session.daily : {}
    for (const [day, counters] of Object.entries(daily)) {
      if (!isDayKey(day)) continue
      let target = dayTotals.get(day)
      if (target === undefined) {
        target = emptyCounters()
        dayTotals.set(day, target)
      }
      addCounters(target, counters)
    }
    foldNestedCountersInto(dayModels, session?.dailyModels)
    foldNestedCountersInto(dayModelsPeak, session?.dailyModelsPeak)
    foldNestedCountersInto(dayModelsOffPeak, session?.dailyModelsOffPeak)
  }
  return { dayTotals, dayModels, dayModelsPeak, dayModelsOffPeak }
}

const EMPTY_MODEL_MAP = new Map()

/**
 * 一组（model → counters）的三份映射 → 成本。
 * 峰谷价格条目按 peak/offPeak 桶分别计价并加总；平铺条目按总和计价。
 */
function foldCost(models, modelsPeak, modelsOffPeak, prices) {
  const keys = new Set([...models.keys(), ...modelsPeak.keys(), ...modelsOffPeak.keys()])
  let cost = 0
  for (const key of keys) {
    cost += costOfModelBuckets(prices, key, models.get(key), modelsPeak.get(key), modelsOffPeak.get(key))
  }
  return cost
}

/** 某一天的成本（三张日模型表可能只在其中一张里有该模型）。 */
function dayCost(day, tables, prices) {
  const models = tables.dayModels.get(day) ?? EMPTY_MODEL_MAP
  const peak = tables.dayModelsPeak.get(day) ?? EMPTY_MODEL_MAP
  const offPeak = tables.dayModelsOffPeak.get(day) ?? EMPTY_MODEL_MAP
  if (models.size === 0 && peak.size === 0 && offPeak.size === 0) return 0
  return foldCost(models, peak, offPeak, prices)
}

/** 某个日窗口内的计数器与成本（today / last7 / 本月预测共用）。 */
function foldWindow(tables, prices, startDay, endDay) {
  const counters = emptyCounters()
  for (const [day, value] of tables.dayTotals) {
    if (inRange(day, startDay, endDay)) addCounters(counters, value)
  }
  let cost = 0
  const modelDays = new Set([
    ...tables.dayModels.keys(),
    ...tables.dayModelsPeak.keys(),
    ...tables.dayModelsOffPeak.keys(),
  ])
  for (const day of modelDays) {
    if (inRange(day, startDay, endDay)) cost += dayCost(day, tables, prices)
  }
  return { counters, cost }
}

/**
 * 单 session 在查询范围内的折叠。
 * days=0：直接取 session 级累计值（含缺 time 的事件）；
 * days>0：按 daily / dailyModels* 过滤。返回总和 + 峰/闲三份模型映射。
 */
function foldSession(session, startDay, endDay, allHistory) {
  const counters = emptyCounters()
  const models = new Map()
  const modelsPeak = new Map()
  const modelsOffPeak = new Map()

  const addModelCounters = (target, key, countersOfModel) => {
    const current = target.get(key)
    if (current === undefined) target.set(key, cloneCounters(countersOfModel))
    else addCounters(current, countersOfModel)
  }
  const addWholeModelMap = (target, source) => {
    for (const [key, value] of Object.entries(isRecord(source) ? source : {})) {
      addModelCounters(target, key, value)
    }
  }
  const addRangeModelMap = (target, source) => {
    for (const [day, dayMap] of Object.entries(isRecord(source) ? source : {})) {
      if (!inRange(day, startDay, endDay) || !isRecord(dayMap)) continue
      for (const [key, value] of Object.entries(dayMap)) addModelCounters(target, key, value)
    }
  }

  if (allHistory) {
    addCounters(counters, session)
    addWholeModelMap(models, session?.models)
    addWholeModelMap(modelsPeak, session?.modelsPeak)
    addWholeModelMap(modelsOffPeak, session?.modelsOffPeak)
    return { counters, models, modelsPeak, modelsOffPeak }
  }
  const daily = isRecord(session?.daily) ? session.daily : {}
  for (const [day, value] of Object.entries(daily)) {
    if (inRange(day, startDay, endDay)) addCounters(counters, value)
  }
  addRangeModelMap(models, session?.dailyModels)
  addRangeModelMap(modelsPeak, session?.dailyModelsPeak)
  addRangeModelMap(modelsOffPeak, session?.dailyModelsOffPeak)
  return { counters, models, modelsPeak, modelsOffPeak }
}

function projectName(cwd) {
  if (typeof cwd !== 'string' || cwd.length === 0) return 'unknown'
  const normalized = cwd.replace(/[\\/]+$/u, '')
  const segments = normalized.split(/[\\/]/u)
  const name = segments[segments.length - 1]
  return typeof name === 'string' && name.length > 0 ? name : normalized.length > 0 ? normalized : 'unknown'
}

function shareOf(value, total) {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return 0
  return roundNumber(value / total, 4)
}

function withCost(counters, costUsd, usdToCny) {
  return {
    totals: cloneCounters(counters),
    costUsd: roundNumber(costUsd, 6),
    costCny: roundNumber(costUsd * usdToCny, 6),
  }
}

/**
 * 聚合入口。
 * @param {object} input
 * @param {Array} input.sessions - store 的有效 session 用量（已合并活会话 overlay，可能带 live 标记）。
 * @param {{days?: number|string, limitSessions?: number|string}} [input.query]
 * @param {number} [input.now] - 当前时间（epoch ms），测试注入。
 * @param {string} [input.timeZone] - 分日时区名，缺省用宿主本地时区。
 * @param {object} [input.prices] - normalizePrices() 的结果。
 * @param {number} [input.usdToCny]
 * @param {string} [input.currency]
 * @param {object} [input.index] - store 的索引概况。
 */
export function aggregateSummary(input = {}) {
  const sessions = Array.isArray(input.sessions) ? input.sessions.filter(isRecord) : []
  const now = typeof input.now === 'number' && Number.isFinite(input.now) ? input.now : Date.now()
  const timeZone = typeof input.timeZone === 'string' && input.timeZone.length > 0 ? input.timeZone : localTimeZone()
  const prices = isRecord(input.prices) ? input.prices : Object.create(null)
  const currency = typeof input.currency === 'string' && input.currency.length > 0 ? input.currency : 'USD'
  const usdToCny =
    typeof input.usdToCny === 'number' && Number.isFinite(input.usdToCny) && input.usdToCny >= 0
      ? input.usdToCny
      : 7.1
  const days = normalizeDays(input.query?.days)
  const limitSessions = normalizeLimit(input.query?.limitSessions)

  const dayKey = createDayKey(timeZone)
  const endDay = dayKey(now) ?? localTimeZoneDayFallback(now)
  const allHistory = days === 0
  const tables = foldDayTables(sessions)

  // 活跃日（有请求的日历日）：连续天数、首末日、daily 补零都以它为准。
  const activeDays = new Set()
  for (const [day, counters] of tables.dayTotals) {
    if (sanitizeToken(counters.requests) > 0) activeDays.add(day)
  }
  const sortedActiveDays = [...activeDays].sort()
  const firstActiveDay = sortedActiveDays.length > 0 ? sortedActiveDays[0] : null

  // 查询范围：days=0 从首个活跃日到今天（坏时间戳造成超长跨度时夹到 MAX_RANGE_DAYS）。
  let startDay
  if (allHistory) {
    startDay = firstActiveDay ?? endDay
    if (diffDays(startDay, endDay) > MAX_RANGE_DAYS) startDay = shiftDayKey(endDay, -MAX_RANGE_DAYS)
    if (startDay > endDay) startDay = endDay
  } else {
    startDay = shiftDayKey(endDay, -(days - 1))
  }

  // 逐 session 折叠范围数据，同时汇总 byModel / byProject / 会话排行。
  const totalsCounters = emptyCounters()
  const byModelMap = new Map()
  const byModelPeak = new Map()
  const byModelOffPeak = new Map()
  const byProjectMap = new Map()
  const sessionRows = []
  let rangeCostUsd = 0

  const addIntoModelMap = (target, key, counters) => {
    const current = target.get(key)
    if (current === undefined) target.set(key, cloneCounters(counters))
    else addCounters(current, counters)
  }

  for (const session of sessions) {
    const header = isRecord(session.header) ? session.header : {}
    const id = typeof session.id === 'string' && session.id.length > 0 ? session.id : header.id
    const folded = foldSession(session, startDay, endDay, allHistory)
    const costUsd = foldCost(folded.models, folded.modelsPeak, folded.modelsOffPeak, prices)
    addCounters(totalsCounters, folded.counters)
    rangeCostUsd += costUsd

    for (const [key, counters] of folded.models) addIntoModelMap(byModelMap, key, counters)
    for (const [key, counters] of folded.modelsPeak) addIntoModelMap(byModelPeak, key, counters)
    for (const [key, counters] of folded.modelsOffPeak) addIntoModelMap(byModelOffPeak, key, counters)

    if (sanitizeToken(folded.counters.requests) <= 0 && sanitizeToken(folded.counters.totalTokens) <= 0) continue

    const cwd = typeof header.cwd === 'string' ? header.cwd : typeof session.cwd === 'string' ? session.cwd : ''
    const project = projectName(cwd)
    let projectRow = byProjectMap.get(cwd)
    if (projectRow === undefined) {
      projectRow = { cwd, name: project, sessions: 0, counters: emptyCounters(), costUsd: 0 }
      byProjectMap.set(cwd, projectRow)
    }
    projectRow.sessions += 1
    addCounters(projectRow.counters, folded.counters)
    projectRow.costUsd += costUsd

    // 会话主模型 = 范围内 tokens 最多的模型；范围外再退回 session 级 models。
    let primaryModel = null
    let primaryTokens = -1
    for (const [key, counters] of folded.models) {
      const tokens = sanitizeToken(counters.totalTokens)
      if (tokens > primaryTokens) {
        primaryTokens = tokens
        primaryModel = key
      }
    }
    if (primaryModel === null && isRecord(session.models)) {
      for (const [key, counters] of Object.entries(session.models)) {
        const tokens = sanitizeToken(counters?.totalTokens)
        if (tokens > primaryTokens) {
          primaryTokens = tokens
          primaryModel = key
        }
      }
    }

    const createdAt =
      typeof header.createdAt === 'number' && Number.isFinite(header.createdAt) ? header.createdAt : 0
    const lastActivity =
      typeof session.lastTime === 'number' && Number.isFinite(session.lastTime)
        ? session.lastTime
        : createdAt

    sessionRows.push({
      id: typeof id === 'string' ? id : null,
      title: typeof session.title === 'string' && session.title.length > 0 ? session.title : null,
      cwd,
      project,
      createdAt,
      lastActivity,
      totals: cloneCounters(folded.counters),
      costUsd: roundNumber(costUsd, 6),
      costCny: roundNumber(costUsd * usdToCny, 6),
      primaryModel,
      live: session.live === true,
      parentSession: typeof header.parentSession === 'string' ? header.parentSession : null,
      isSubagent: typeof header.parentSession === 'string' || sanitizeToken(header.delegationDepth) > 0,
    })
  }

  // ---- daily：range 内逐日补零 -------------------------------------------------
  const rangeSpanDays = Math.max(0, diffDays(startDay, endDay))
  const daily = []
  for (let offset = 0; offset <= rangeSpanDays; offset += 1) {
    const day = shiftDayKey(startDay, offset)
    const counters = tables.dayTotals.get(day) ?? emptyCounters()
    const cost = dayCost(day, tables, prices)
    daily.push({ day, ...withCost(counters, cost, usdToCny) })
  }

  // ---- byModel ----------------------------------------------------------------
  const byModel = []
  let matchedModels = 0
  const unmatchedModels = []
  for (const [key, counters] of byModelMap) {
    const { provider, model } = splitModelKey(key)
    const found = findPrice(prices, provider, model)
    if (found.matched) matchedModels += 1
    else if (!unmatchedModels.includes(key)) unmatchedModels.push(key)
    byModel.push({
      key,
      provider,
      model,
      priced: found.matched,
      ...withCost(
        counters,
        found.matched
          ? costOfModelBuckets(prices, key, counters, byModelPeak.get(key), byModelOffPeak.get(key))
          : 0,
        usdToCny,
      ),
      share: 0,
    })
  }
  byModel.sort((left, right) => compareRank(left.totals, right.totals, left.key, right.key))
  for (const row of byModel) row.share = shareOf(row.totals.totalTokens, totalsCounters.totalTokens)

  // ---- byProject --------------------------------------------------------------
  const byProject = [...byProjectMap.values()]
    .map((row) => ({
      cwd: row.cwd,
      name: row.name,
      sessions: row.sessions,
      ...withCost(row.counters, row.costUsd, usdToCny),
    }))
    .sort((left, right) => compareRank(left.totals, right.totals, left.cwd, right.cwd))

  // ---- 会话排行：token 降序，其次 lastActivity --------------------------------
  sessionRows.sort((left, right) => {
    const byTokens = sanitizeToken(right.totals.totalTokens) - sanitizeToken(left.totals.totalTokens)
    if (byTokens !== 0) return byTokens
    const byActivity = right.lastActivity - left.lastActivity
    if (byActivity !== 0) return byActivity
    return String(left.id ?? '').localeCompare(String(right.id ?? ''))
  })
  const limitedSessionRows = sessionRows.slice(0, limitSessions)

  // ---- 今日 / 昨日 / 近 7 天 / 近 30 天（都从全历史日表算） --------------------
  const yesterdayDay = shiftDayKey(endDay, -1)
  const todayWindow = foldWindow(tables, prices, endDay, endDay)
  const yesterdayWindow = foldWindow(tables, prices, yesterdayDay, yesterdayDay)
  const last7Window = foldWindow(tables, prices, shiftDayKey(endDay, -6), endDay)
  const last30Window = foldWindow(tables, prices, shiftDayKey(endDay, -29), endDay)

  // ---- totals ----------------------------------------------------------------
  const totals = {
    ...cloneCounters(totalsCounters),
    sessions: sessionRows.length,
    // 索引里的全部会话数（含没有任何 usage 事件的零用量会话）；
    // sessions 仍是「范围内有 usage 的会话数」——两个数字一起给 UI
    // 展示「扫描 N 个会话，其中 M 个有用量」。
    sessionsScanned: sessions.length,
    activeDays: daily.reduce((count, row) => (sanitizeToken(row.totals.requests) > 0 ? count + 1 : count), 0),
    firstDay: daily.find((row) => sanitizeToken(row.totals.requests) > 0)?.day ?? null,
    lastDay: [...daily].reverse().find((row) => sanitizeToken(row.totals.requests) > 0)?.day ?? null,
    costUsd: roundNumber(rangeCostUsd, 6),
    costCny: roundNumber(rangeCostUsd * usdToCny, 6),
  }

  // ---- highlights -------------------------------------------------------------
  const busiestAny =
    daily.length === 0
      ? undefined
      : daily.reduce((best, row) =>
          sanitizeToken(row.totals.totalTokens) > sanitizeToken(best.totals.totalTokens) ? row : best,
        )
  const busyDayRow =
    busiestAny !== undefined && sanitizeToken(busiestAny.totals.totalTokens) > 0 ? busiestAny : undefined
  const longestRow =
    limitedSessionRows.length === 0
      ? undefined
      : limitedSessionRows.reduce((best, row) =>
          sanitizeToken(row.totals.totalTokens) > sanitizeToken(best.totals.totalTokens) ? row : best,
        )
  const cacheDenominator =
    sanitizeToken(totalsCounters.inputTokens) +
    sanitizeToken(totalsCounters.cacheReadTokens) +
    sanitizeToken(totalsCounters.cacheWriteTokens)

  const monthStartDay = `${endDay.slice(0, 7)}-01`
  const monthDays = daysInMonthOf(endDay)
  const elapsedDays = Number(endDay.slice(8, 10))
  const monthSoFar = foldWindow(tables, prices, monthStartDay, endDay)
  const projectedMonthUsd =
    elapsedDays > 0 ? monthSoFar.cost + (monthSoFar.cost / elapsedDays) * (monthDays - elapsedDays) : 0

  const topModelRow = byModel.length > 0 ? byModel[0] : undefined

  const highlights = {
    streakDays: computeStreak(activeDays, endDay),
    busiestDay:
      busyDayRow === undefined
        ? null
        : {
            day: busyDayRow.day,
            totalTokens: sanitizeToken(busyDayRow.totals.totalTokens),
            costUsd: roundNumber(busyDayRow.costUsd, 6),
          },
    longestSession:
      longestRow === undefined
        ? null
        : {
            id: longestRow.id,
            title: longestRow.title,
            project: longestRow.project,
            totalTokens: sanitizeToken(longestRow.totals.totalTokens),
            costUsd: roundNumber(longestRow.costUsd, 6),
          },
    avgTokensPerRequest: roundNumber(
      sanitizeToken(totalsCounters.requests) > 0
        ? sanitizeToken(totalsCounters.totalTokens) / sanitizeToken(totalsCounters.requests)
        : 0,
      2,
    ),
    cacheHitRate: cacheDenominator > 0 ? roundNumber(sanitizeToken(totalsCounters.cacheReadTokens) / cacheDenominator, 4) : 0,
    topModel:
      topModelRow === undefined
        ? null
        : {
            key: topModelRow.key,
            totalTokens: sanitizeToken(topModelRow.totals.totalTokens),
            share: topModelRow.share,
          },
    projectedMonthUsd: roundNumber(projectedMonthUsd, 6),
  }

  const index = isRecord(input.index)
    ? {
        sessions: sanitizeToken(input.index.sessions),
        events: sanitizeToken(input.index.events),
        building: input.index.building === true,
        stale: input.index.stale === true,
        cacheFile: typeof input.index.cacheFile === 'string' ? input.index.cacheFile : null,
      }
    : { sessions: 0, events: 0, building: false, stale: false, cacheFile: null }

  // prices 里 timeAware 表示「至少有一条峰谷价」；peakWindow 只在峰谷模式下给出，
  // 方便 UI 解释为什么同一天的单价会变（官方价按 UTC 时段分峰闲，不取平均）。
  const timeAware = hasTimeAwarePrices(prices)
  const pricesInfo = {
    currency,
    usdToCny,
    matchedModels,
    unmatchedModels: unmatchedModels.sort(),
    timeAware,
    ...(timeAware ? { peakWindow: PEAK_WINDOW_LABEL } : {}),
  }

  return {
    version: 1,
    generatedAt: now,
    timeZone,
    index,
    range: { days, startDay, endDay },
    totals,
    today: { day: endDay, ...withCost(todayWindow.counters, todayWindow.cost, usdToCny) },
    yesterday: { day: yesterdayDay, ...withCost(yesterdayWindow.counters, yesterdayWindow.cost, usdToCny) },
    last7Days: withCost(last7Window.counters, last7Window.cost, usdToCny),
    last30Days: withCost(last30Window.counters, last30Window.cost, usdToCny),
    daily,
    byModel,
    byProject,
    sessions: limitedSessionRows,
    highlights,
    prices: pricesInfo,
  }
}

function compareRank(leftTotals, rightTotals, leftTie, rightTie) {
  const byTokens = sanitizeToken(rightTotals?.totalTokens) - sanitizeToken(leftTotals?.totalTokens)
  if (byTokens !== 0) return byTokens
  const byRequests = sanitizeToken(rightTotals?.requests) - sanitizeToken(leftTotals?.requests)
  if (byRequests !== 0) return byRequests
  return String(leftTie ?? '').localeCompare(String(rightTie ?? ''))
}

/** 截至今天（今天没用则截至昨天）的连续使用天数。 */
export function computeStreak(activeDays, endDay) {
  if (!(activeDays instanceof Set) || !isDayKey(endDay)) return 0
  let cursor = activeDays.has(endDay) ? endDay : shiftDayKey(endDay, -1)
  let streak = 0
  while (activeDays.has(cursor)) {
    streak += 1
    cursor = shiftDayKey(cursor, -1)
    if (streak > MAX_RANGE_DAYS) break
  }
  return streak
}

function localTimeZoneDayFallback(now) {
  const date = new Date(now)
  if (!Number.isFinite(date.getTime())) return '1970-01-01'
  return `${String(date.getFullYear())}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}
