// dsh-plugin-token-stats 宿主侧 —— 用量索引引擎（唯一做 I/O 的模块）。
//
// 职责：
//   1. 增量索引：persistence.list() 的 sizeBytes/eventCount/revision 指纹未变就不读日志；
//   2. 活会话 overlay：session/event 里 seq 超出磁盘基线的新 usage 事件先记在内存；
//      下次磁盘重读时整段替换，靠 seq 边界避免重复计数；
//   3. 磁盘缓存：{version, savedAt, sessions} 原子写（tmp + rename），坏文件/版本不符忽略重建；
//   4. 把有效 session 数组交给 aggregateSummary 生成 wire 对象。
//
// 所有宿主服务都以 getter 形式延迟读取（服务可能比插件晚挂载、也可能整块缺失），
// 任何一步失败都只降级不抛：HTTP 路由和模型工具看到的永远是「有数据或空数据」。

import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { aggregateSummary } from './aggregate.js'
import {
  accumulateEvent,
  cloneCounters,
  createDayKey,
  createUsageAccumulator,
  emptyUsage,
  extractSessionUsage,
  finishAccumulator,
  mergeUsage,
  normalizeHeader,
} from './extract.js'

/**
 * 缓存文件格式版本：v2 起每个 session 带峰谷分桶（modelsPeak/modelsOffPeak/
 * dailyModelsPeak/dailyModelsOffPeak）。v1 文件（旧文件名 usage-index.v1.json）
 * 不读取，直接按全新索引重建 —— 旧缓存没有峰谷桶，继续用会把官方峰谷价算错。
 */
export const CACHE_VERSION = 2

/**
 * 活会话的磁盘重读间隔：活会话的增量由 session/event overlay 实时覆盖，
 * 周期性重读只是兜底（例如插件热重载时错过了会话前段事件）。
 */
export const LIVE_REREAD_MIN_MS = 5 * 60 * 1000

/** persistence 服务缺失：路由层据此回 503。 */
export class PersistenceUnavailableError extends Error {
  constructor() {
    super('session persistence is not available in this deployment')
    this.name = 'PersistenceUnavailableError'
    this.code = 'persistence-unavailable'
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function numberOrNull(value, { nonNegative = true } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  if (nonNegative && value < 0) return null
  return value
}

function messageOf(error) {
  if (error instanceof Error) return error.message
  return String(error)
}

function normalizeLogger(logger) {
  const noop = () => {}
  const pick = (name) => {
    const fn = logger?.[name]
    return typeof fn === 'function' ? fn.bind(logger) : noop
  }
  return { info: pick('info'), warn: pick('warn'), error: pick('error') }
}

function clampPositiveInteger(value, fallback, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const integer = Math.trunc(value)
  if (integer < min) return fallback
  return Math.min(integer, max)
}

/** persistence.list() 快照里能当指纹的字段。 */
export function fingerprintFromSnapshot(snapshot) {
  return {
    sizeBytes: numberOrNull(snapshot?.sizeBytes),
    eventCount: numberOrNull(snapshot?.eventCount),
    revision: typeof snapshot?.revision === 'string' ? snapshot.revision : null,
  }
}

/**
 * 指纹比对：参与了比较且全部相等的判据才算「没变化」。
 * 一个可比较字段都没有（例如未落盘的 pending 会话）时返回 false —— 宁可多读一次。
 */
export function fingerprintMatches(left, right) {
  if (!isRecord(left) || !isRecord(right)) return false
  let compared = false
  const leftSize = numberOrNull(left.sizeBytes)
  const rightSize = numberOrNull(right.sizeBytes)
  if (leftSize !== null && rightSize !== null) {
    if (leftSize !== rightSize) return false
    compared = true
  } else if (leftSize !== null || rightSize !== null) {
    return false
  }
  const leftCount = numberOrNull(left.eventCount)
  const rightCount = numberOrNull(right.eventCount)
  if (leftCount !== null && rightCount !== null) {
    if (leftCount !== rightCount) return false
    compared = true
  }
  if (typeof left.revision === 'string' && typeof right.revision === 'string') {
    if (left.revision !== right.revision) return false
    compared = true
  } else if (typeof left.revision === 'string' || typeof right.revision === 'string') {
    return false
  }
  return compared
}

function sanitizeCountersMap(raw) {
  const result = {}
  for (const [key, value] of Object.entries(isRecord(raw) ? raw : {})) {
    if (typeof key !== 'string' || key.length === 0) continue
    result[key] = cloneCounters(value)
  }
  return result
}

function sanitizeNestedCountersMap(raw) {
  const result = {}
  for (const [outerKey, inner] of Object.entries(isRecord(raw) ? raw : {})) {
    if (typeof outerKey !== 'string' || outerKey.length === 0) continue
    result[outerKey] = sanitizeCountersMap(inner)
  }
  return result
}

/** v2 缓存条目必须带齐峰谷分桶字段；缺任意一个都视为损坏，触发重建。 */
function hasBucketShape(raw) {
  return (
    isRecord(raw?.modelsPeak) &&
    isRecord(raw?.modelsOffPeak) &&
    isRecord(raw?.dailyModelsPeak) &&
    isRecord(raw?.dailyModelsOffPeak)
  )
}

/** 缓存条目归一：坏字段按空值，缺关键字段（含 v2 峰谷桶）的条目直接丢弃（触发重建）。 */
function normalizeCachedUsage(id, raw) {
  if (!isRecord(raw) || !isRecord(raw.fingerprint)) return undefined
  if (!hasBucketShape(raw)) return undefined
  const header = normalizeHeader(raw.header)
  const fingerprint = {
    sizeBytes: numberOrNull(raw.fingerprint.sizeBytes),
    eventCount: numberOrNull(raw.fingerprint.eventCount),
    revision: typeof raw.fingerprint.revision === 'string' ? raw.fingerprint.revision : null,
    lastSeq: Number.isSafeInteger(raw.fingerprint.lastSeq) ? raw.fingerprint.lastSeq : -1,
  }
  const counters = cloneCounters(raw)
  return {
    id: typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : id,
    title: typeof raw.title === 'string' && raw.title.length > 0 ? raw.title : null,
    header,
    ...counters,
    models: sanitizeCountersMap(raw.models),
    modelsPeak: sanitizeCountersMap(raw.modelsPeak),
    modelsOffPeak: sanitizeCountersMap(raw.modelsOffPeak),
    daily: sanitizeCountersMap(raw.daily),
    dailyModels: sanitizeNestedCountersMap(raw.dailyModels),
    dailyModelsPeak: sanitizeNestedCountersMap(raw.dailyModelsPeak),
    dailyModelsOffPeak: sanitizeNestedCountersMap(raw.dailyModelsOffPeak),
    firstTime: numberOrNull(raw.firstTime),
    lastTime: numberOrNull(raw.lastTime),
    lastSeq: Number.isSafeInteger(raw.lastSeq) ? raw.lastSeq : fingerprint.lastSeq,
    eventCount: Number.isSafeInteger(raw.eventCount) ? raw.eventCount : 0,
    fingerprint,
    cachedAt: typeof raw.cachedAt === 'number' && Number.isFinite(raw.cachedAt) ? raw.cachedAt : 0,
  }
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length)
  if (items.length === 0) return results
  const width = Math.max(1, Math.min(limit, items.length))
  let cursor = 0
  const runners = Array.from({ length: width }, async () => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      const item = items[index]
      try {
        results[index] = await worker(item, index)
      } catch (error) {
        results[index] = { status: 'rejected', id: item?.id, error }
      }
    }
  })
  await Promise.all(runners)
  return results
}

/** interval 的最小兜底，防止配置成 0 导致忙循环。 */
function normalizeInterval(value, fallback) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback
  return Math.trunc(value)
}

/**
 * 创建索引用 store。
 * @param {object} options
 * @param {Function} [options.getPersistence] - 返回 sessionPersistence 服务（缺失返回 undefined）。
 * @param {Function} [options.getSessions] - 返回 sessions 服务。
 * @param {Function} [options.getSessionQuery] - 返回 sessionQuery 服务（可选，用于标题）。
 * @param {object} [options.persistence] - 测试/自检可直接注入服务对象。
 * @param {string|null} [options.cacheFile] - 缓存文件绝对路径。
 * @param {object} [options.prices] - normalizePrices() 结果。
 * @param {string} [options.currency]
 * @param {number} [options.usdToCny]
 * @param {string} [options.timeZone]
 * @param {number} [options.readConcurrency]
 * @param {number} [options.refreshIntervalMs]
 * @param {number} [options.liveRereadMs] - 活会话磁盘重读间隔（测试可设 0 强制重读）。
 * @param {{info: Function, warn: Function, error: Function}} [options.logger]
 * @param {Function} [options.now]
 */
export function createStore(options = {}) {
  const now = typeof options.now === 'function' ? options.now : Date.now
  const logger = normalizeLogger(options.logger)
  const dayKey = createDayKey(options.timeZone)
  const cacheFile =
    typeof options.cacheFile === 'string' && options.cacheFile.length > 0 ? options.cacheFile : null
  const prices = isRecord(options.prices) ? options.prices : Object.create(null)
  const currency = typeof options.currency === 'string' && options.currency.length > 0 ? options.currency : 'USD'
  const usdToCny =
    typeof options.usdToCny === 'number' && Number.isFinite(options.usdToCny) && options.usdToCny >= 0
      ? options.usdToCny
      : 7.1
  const timeZone = typeof options.timeZone === 'string' && options.timeZone.length > 0 ? options.timeZone : undefined
  const readConcurrency = clampPositiveInteger(options.readConcurrency, 3, 1, 16)
  const refreshIntervalMs = normalizeInterval(options.refreshIntervalMs, 15000)
  const liveRereadMs =
    typeof options.liveRereadMs === 'number' && Number.isFinite(options.liveRereadMs) && options.liveRereadMs >= 0
      ? options.liveRereadMs
      : LIVE_REREAD_MIN_MS

  /** id → 磁盘基线的提取结果（含 fingerprint / cachedAt），会被写入缓存。 */
  let diskUsage = new Map()
  /** id → 最近一次 list() 的指纹快照。 */
  let snapshots = new Map()
  /** id → { header, acc, events, lastSeq }：磁盘基线之后的活会话增量。 */
  let overlays = new Map()
  /** id → 活会话 header（尚未落盘/尚未出现在 list() 里的 session 也能显示）。 */
  let liveHeaders = new Map()

  let cacheLoaded = false
  let bootstrapped = false
  let titlesFetched = false
  let refreshPromise = null
  let lastRefreshAt = 0
  let lastError = null
  let dirty = false
  let closed = false
  /** 最近一次刷新里单会话读失败的个数（诊断用）。 */
  let failedSessions = 0

  /** 延迟读取宿主服务：允许服务比插件晚挂载。 */
  function service(name) {
    const getterName = `get${name.charAt(0).toUpperCase()}${name.slice(1)}`
    const getter = options[getterName]
    if (typeof getter === 'function') {
      try {
        return getter()
      } catch {
        return undefined
      }
    }
    const direct = options[name]
    return direct === undefined ? undefined : direct
  }

  function persistenceOf() {
    const persistence = service('persistence')
    if (persistence === undefined || persistence === null) return undefined
    if (typeof persistence.list !== 'function' || typeof persistence.open !== 'function') return undefined
    return persistence
  }

  function listLiveSessions() {
    const sessions = service('sessions')
    if (sessions === undefined || sessions === null) return []
    try {
      const list = typeof sessions.list === 'function' ? sessions.list() : []
      return Array.isArray(list) ? list : []
    } catch {
      return []
    }
  }

  function liveIdsSet() {
    const ids = new Set()
    for (const session of listLiveSessions()) {
      const id = session?.id ?? session?.header?.id
      if (typeof id === 'string' && id.length > 0) ids.add(id)
    }
    return ids
  }

  function buildOverlay(header, events) {
    const accumulator = createUsageAccumulator(header, { dayKey })
    const kept = []
    let lastSeq = -1
    for (const event of Array.isArray(events) ? events : []) {
      const seq = event?.seq
      if (typeof seq === 'number' && Number.isSafeInteger(seq)) {
        if (seq <= lastSeq) continue
        lastSeq = seq
      }
      if (accumulateEvent(accumulator, event, dayKey)) kept.push(event)
    }
    return { header: normalizeHeader(header), acc: accumulator, events: kept, lastSeq }
  }

  /**
   * 重读磁盘后整段替换 overlay：seq 已经被磁盘覆盖的部分丢弃，剩下的重建累加器。
   * 这就是契约 3.4 的「防重复计数」落点。
   */
  function reconcileOverlays(nextDisk, nextLiveHeaders) {
    const nextOverlays = new Map()
    for (const [id, overlay] of overlays) {
      const disk = nextDisk.get(id)
      const diskLastSeq = disk !== undefined && Number.isSafeInteger(disk.lastSeq) ? disk.lastSeq : -1
      const kept = overlay.events.filter((event) => {
        const seq = event?.seq
        if (typeof seq !== 'number' || !Number.isSafeInteger(seq)) return true
        return seq > diskLastSeq
      })
      if (kept.length === 0) continue
      const header = overlay.header ?? nextLiveHeaders.get(id) ?? disk?.header ?? { id }
      nextOverlays.set(id, buildOverlay(header, kept))
    }
    overlays = nextOverlays
  }

  async function readOne(persistence, entry) {
    let handle
    try {
      handle = await persistence.open(entry.id, 'read')
      let events = []
      let header = entry.header
      try {
        const result = typeof handle?.read === 'function' ? await handle.read(0) : undefined
        if (isRecord(result) && Array.isArray(result.events)) events = result.events
        if (isRecord(result) && isRecord(result.header) && typeof result.header.id === 'string') header = result.header
      } finally {
        try {
          if (typeof handle?.close === 'function') await handle.close()
        } catch {
          // 关闭失败不影响已经读到的数据
        }
      }
      const cachedTitle = diskUsage.get(entry.id)?.title
      const usage = extractSessionUsage(header, events, {
        title: typeof cachedTitle === 'string' ? cachedTitle : null,
        dayKey,
      })
      usage.fingerprint = { ...entry.fingerprint, lastSeq: usage.lastSeq }
      usage.cachedAt = now()
      return { status: 'fulfilled', id: entry.id, usage }
    } catch (error) {
      try {
        if (typeof handle?.close === 'function') await handle.close()
      } catch {
        // 忽略
      }
      return { status: 'rejected', id: entry.id, error }
    }
  }

  async function loadCacheOnce() {
    if (cacheLoaded) return
    cacheLoaded = true
    if (cacheFile === null) return
    let text
    try {
      text = await readFile(cacheFile, 'utf8')
    } catch (error) {
      if (error?.code !== 'ENOENT') logger.warn(`token-stats: 读取缓存失败（将重建索引）：${messageOf(error)}`)
      return
    }
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      logger.warn('token-stats: 缓存 JSON 损坏（将重建索引）')
      return
    }
    if (!isRecord(parsed) || parsed.version !== CACHE_VERSION || !isRecord(parsed.sessions)) {
      logger.warn('token-stats: 缓存版本或结构不符（将重建索引）')
      return
    }
    const loaded = new Map()
    for (const [id, raw] of Object.entries(parsed.sessions)) {
      if (typeof id !== 'string' || id.length === 0) continue
      const usage = normalizeCachedUsage(id, raw)
      if (usage !== undefined) loaded.set(id, usage)
    }
    if (loaded.size === 0 && Object.keys(parsed.sessions).length > 0) {
      logger.warn('token-stats: 缓存条目结构不完整（缺峰谷分桶等 v2 字段，将重建索引）')
    }
    diskUsage = loaded
    logger.info(`token-stats: 从缓存恢复 ${loaded.size} 个会话（无需重读日志）`)
  }

  async function writeCache() {
    if (cacheFile === null || closed) return
    const payload = {
      version: CACHE_VERSION,
      savedAt: now(),
      sessions: Object.fromEntries(diskUsage),
    }
    let text
    try {
      text = JSON.stringify(payload)
    } catch (error) {
      logger.warn(`token-stats: 序列化缓存失败（跳过写入）：${messageOf(error)}`)
      return
    }
    try {
      await mkdir(dirname(cacheFile), { recursive: true })
    } catch (error) {
      logger.warn(`token-stats: 创建缓存目录失败（跳过写入）：${messageOf(error)}`)
      return
    }
    const temporary = `${cacheFile}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`
    try {
      await writeFile(temporary, text, 'utf8')
      await rename(temporary, cacheFile)
    } catch (error) {
      logger.warn(`token-stats: 写入缓存失败（不影响本次查询）：${messageOf(error)}`)
      try {
        await rm(temporary, { force: true })
      } catch {
        // 临时文件清理失败无所谓
      }
    }
  }

  /**
   * 标题是可选增强：sessionQuery 会重新读日志，代价不低，所以只在首次索引成功后
   * 拉一次，失败就保持 null（客户端按契约用 cwd basename + 创建日期兜底）。
   */
  function fetchTitles(ids) {
    const query = service('sessionQuery')
    if (query === undefined || query === null || typeof query.readTitleSnapshots !== 'function') return
    const slice = ids.slice(0, 500)
    if (slice.length === 0) return
    Promise.resolve()
      .then(() => query.readTitleSnapshots(slice))
      .then((results) => {
        if (closed || !Array.isArray(results)) return
        let changed = false
        for (let index = 0; index < results.length; index += 1) {
          const result = results[index]
          if (!isRecord(result) || result.status !== 'fulfilled') continue
          const value = result.value
          let title = isRecord(value) && typeof value.title === 'string' ? value.title.trim() : ''
          if (title.length === 0) continue
          const id =
            (isRecord(value) && isRecord(value.session) && typeof value.session.id === 'string'
              ? value.session.id
              : undefined) ??
            (typeof result.sessionId === 'string' ? result.sessionId : undefined) ??
            slice[index]
          if (typeof id !== 'string') continue
          const usage = diskUsage.get(id)
          if (usage === undefined) continue
          if (usage.title === title) continue
          usage.title = title
          changed = true
        }
        if (changed) {
          dirty = true
          writeCache().catch(() => {})
        }
      })
      .catch((error) => logger.warn(`token-stats: 读取会话标题失败（忽略）：${messageOf(error)}`))
  }

  async function runRefresh() {
    const startedAt = now()
    const persistence = persistenceOf()
    if (persistence === undefined) {
      lastError = new PersistenceUnavailableError()
      lastRefreshAt = now()
      bootstrapped = true
      return indexInfo()
    }
    let fatal = null
    failedSessions = 0
    try {
      await loadCacheOnce()
      const listed = await persistence.list()
      const liveSessions = listLiveSessions()
      const nextLiveHeaders = new Map()
      const liveIds = new Set()
      for (const session of liveSessions) {
        const header = session?.header
        const id = typeof session?.id === 'string' ? session.id : typeof header?.id === 'string' ? header.id : undefined
        if (id === undefined) continue
        liveIds.add(id)
        nextLiveHeaders.set(id, normalizeHeader(header ?? { id }))
      }

      const nextDisk = new Map()
      const nextSnapshots = new Map()
      const reads = []
      const seen = new Set()
      const currentTime = now()
      for (const snapshot of Array.isArray(listed) ? listed : []) {
        try {
          const header = isRecord(snapshot) && isRecord(snapshot.header) ? snapshot.header : undefined
          const id =
            typeof header?.id === 'string' && header.id.length > 0
              ? header.id
              : typeof snapshot?.id === 'string' && snapshot.id.length > 0
                ? snapshot.id
                : undefined
          if (id === undefined || seen.has(id)) continue
          seen.add(id)
          const fingerprint = fingerprintFromSnapshot(snapshot)
          nextSnapshots.set(id, fingerprint)
          const cached = diskUsage.get(id)
          const live = liveIds.has(id)
          const rereadDue =
            !live ||
            liveRereadMs === 0 ||
            currentTime - (typeof cached?.cachedAt === 'number' ? cached.cachedAt : 0) >= liveRereadMs
          if (cached !== undefined && rereadDue) {
            if (fingerprintMatches(cached.fingerprint, fingerprint)) {
              nextDisk.set(id, cached)
              continue
            }
          } else if (cached !== undefined && !rereadDue) {
            // 活会话：指纹变了（正在追加）但还没到重读间隔；磁盘基线保持旧值，
            // 新事件由 overlay 实时补上，总量仍然准确。
            nextDisk.set(id, cached)
            continue
          }
          reads.push({ id, header: header ?? { id }, fingerprint })
        } catch (error) {
          failedSessions += 1
          logger.warn(`token-stats: 解析会话快照失败（跳过）：${messageOf(error)}`)
        }
      }

      const results = await mapLimit(reads, readConcurrency, (entry) => readOne(persistence, entry))
      for (const result of results) {
        if (result === undefined) continue
        if (result.status === 'fulfilled') {
          nextDisk.set(result.id, result.usage)
          dirty = true
          continue
        }
        failedSessions += 1
        const cached = diskUsage.get(result.id)
        if (cached !== undefined) nextDisk.set(result.id, cached)
        logger.warn(`token-stats: 读取会话 ${String(result.id)} 失败（保留旧数据）：${messageOf(result.error)}`)
      }

      // 注意：nextDisk 只由本轮 list() 的会话和保留下来的缓存条目组成，
      // 已经从 list() 消失且不再活跃的会话自然被剔出（缓存随之收缩）。

      reconcileOverlays(nextDisk, nextLiveHeaders)
      // overlay 的 header 跟随最新活会话；活会话已结束且没有磁盘基线时丢弃残影。
      for (const id of [...overlays.keys()]) {
        const header = nextLiveHeaders.get(id)
        if (header !== undefined) overlays.get(id).header = header
        if (!nextDisk.has(id) && header === undefined) overlays.delete(id)
      }

      // 会话集合变化（新增/删除）也要落盘：单纯复用缓存条目时 dirty 不一定被置位。
      let membershipChanged = nextDisk.size !== diskUsage.size
      if (!membershipChanged) {
        for (const id of nextDisk.keys()) {
          if (!diskUsage.has(id)) {
            membershipChanged = true
            break
          }
        }
      }
      diskUsage = nextDisk
      snapshots = nextSnapshots
      liveHeaders = nextLiveHeaders
      bootstrapped = true
      lastRefreshAt = now()
      lastError = fatal
      if (membershipChanged) dirty = true
      if (dirty) {
        dirty = false
        await writeCache()
      }
      if (!titlesFetched) {
        titlesFetched = true
        fetchTitles([...seen])
      }
      logger.info(
        `token-stats: 索引完成 ${indexInfo().sessions} sessions / ${indexInfo().events} events` +
          `（用时 ${Math.max(0, now() - startedAt)}ms${failedSessions > 0 ? `，${failedSessions} 个会话读取失败` : ''}）`,
      )
    } catch (error) {
      fatal = error
      lastError = error
      lastRefreshAt = now()
      bootstrapped = true
      logger.error(`token-stats: 刷新索引失败（本轮使用旧数据）：${messageOf(error)}`)
    }
    return indexInfo()
  }

  function indexInfo() {
    let events = 0
    for (const usage of diskUsage.values()) {
      if (Number.isSafeInteger(usage.eventCount) && usage.eventCount > 0) events += usage.eventCount
      else if (Number.isSafeInteger(usage.lastSeq) && usage.lastSeq >= 0) events += usage.lastSeq + 1
    }
    return {
      sessions: diskUsage.size,
      events,
      building: refreshPromise !== null,
      stale: lastError !== null,
      cacheFile,
      lastError: lastError === null ? null : messageOf(lastError),
      lastRefreshAt,
    }
  }

  /** 刷新索引；同一时刻只跑一轮。force=false 时受 refreshIntervalMs 节流。 */
  function refresh(refreshOptions = {}) {
    if (closed) return Promise.resolve(indexInfo())
    if (refreshPromise !== null) return refreshPromise
    const force = refreshOptions?.force === true
    if (!force && bootstrapped && now() - lastRefreshAt < refreshIntervalMs) return Promise.resolve(indexInfo())
    refreshPromise = runRefresh().finally(() => {
      refreshPromise = null
    })
    return refreshPromise
  }

  /** 有效 session 数组 = 磁盘基线 + 活会话 overlay（聚合只读，不写回索引）。 */
  function effectiveSessions() {
    const liveIds = liveIdsSet()
    const ids = new Set([...diskUsage.keys(), ...overlays.keys(), ...liveHeaders.keys()])
    const rows = []
    for (const id of ids) {
      const header =
        liveHeaders.get(id) ?? diskUsage.get(id)?.header ?? overlays.get(id)?.header ?? { id }
      const base = diskUsage.get(id) ?? emptyUsage(header, { dayKey })
      const overlay = overlays.get(id)
      const merged = overlay === undefined ? base : mergeUsage(base, finishAccumulator(overlay.acc))
      rows.push({ ...merged, id: merged.id ?? id, live: liveIds.has(id) })
    }
    return rows
  }

  /**
   * 生成聚合响应（契约 3.2）。
   * @param {{days?: number|string, limitSessions?: number|string, refresh?: string|number|boolean}} [query]
   * @throws {PersistenceUnavailableError} persistence 缺失时（路由转 503）。
   */
  async function getSummary(query = {}) {
    if (closed) throw new Error('token-stats: store 已卸载')
    if (persistenceOf() === undefined) throw new PersistenceUnavailableError()
    const force = query?.refresh === true || query?.refresh === 1 || query?.refresh === '1'
    if (refreshPromise !== null) await refreshPromise.catch(() => {})
    else if (!bootstrapped || force) await refresh({ force: true })
    else if (now() - lastRefreshAt >= refreshIntervalMs) {
      // 后台刷新，不阻塞这次查询（UI 轮询会周期性触发这里）。
      refresh({ force: false }).catch((error) =>
        logger.warn(`token-stats: 后台刷新失败：${messageOf(error)}`),
      )
    }
    return aggregateSummary({
      sessions: effectiveSessions(),
      index: indexInfo(),
      query: { days: query?.days, limitSessions: query?.limitSessions },
      now: now(),
      timeZone,
      prices,
      currency,
      usdToCny,
    })
  }

  /**
   * 活会话事件入口：只在 seq 超过磁盘基线时累加，重复事件靠 seq 去重。
   * 契约 2.3 要求监听器自己 try/catch，任何异常都不能抛回会话提交路径。
   */
  function handleSessionEvent(session, event) {
    try {
      if (closed) return
      const id =
        typeof session?.id === 'string' && session.id.length > 0
          ? session.id
          : typeof session?.header?.id === 'string'
            ? session.header.id
            : undefined
      if (id === undefined) return
      if (!isRecord(event) || event.type !== 'assistant/message') return
      if (!isRecord(event.data) || !isRecord(event.data.usage)) return
      const seq = event?.seq
      const disk = diskUsage.get(id)
      const diskLastSeq = disk !== undefined && Number.isSafeInteger(disk.lastSeq) ? disk.lastSeq : -1
      if (typeof seq === 'number' && Number.isSafeInteger(seq) && seq <= diskLastSeq) return
      let overlay = overlays.get(id)
      if (overlay === undefined) {
        const header = normalizeHeader(session.header ?? liveHeaders.get(id) ?? disk?.header ?? { id })
        overlay = buildOverlay(header, [])
        overlays.set(id, overlay)
      }
      if (typeof seq === 'number' && Number.isSafeInteger(seq)) {
        if (seq <= overlay.lastSeq) return
        overlay.lastSeq = seq
      }
      if (!accumulateEvent(overlay.acc, event, dayKey)) return
      overlay.events.push(event)
      dirty = true
    } catch (error) {
      logger.warn(`token-stats: 处理活会话事件失败（忽略）：${messageOf(error)}`)
    }
  }

  function dispose() {
    closed = true
    overlays.clear()
    liveHeaders.clear()
    snapshots.clear()
    diskUsage.clear()
    refreshPromise = null
  }

  return {
    getSummary,
    refresh,
    handleSessionEvent,
    indexInfo,
    effectiveSessions,
    dispose,
    // 便于单测/诊断（不是 wire API）
    fingerprints: () => new Map(snapshots),
    cacheFile,
  }
}
