// dsh-plugin-token-stats 宿主侧单测 —— store（契约 3.4 / 2.2 / 2.3）。
//
// 用假 persistence / sessions / sessionQuery 驱动真实 store：验证增量指纹、活会话
// overlay 去重、原子缓存、坏缓存重建、空/坏服务降级。全部落在系统临时目录，
// 不读写真实 ~/.dsh。

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { normalizePrices } from '../lib/host/prices.js'
import { createStore, fingerprintMatches, PersistenceUnavailableError } from '../lib/host/store.js'

const TZ = 'UTC'
const PRICES = normalizePrices({
  'opencode-go/deepseek-v4.1-flash': { input: 0.15, output: 0.6, cacheRead: 0.015, cacheWrite: 0.15 },
})
const BASE_TIME = Date.parse('2026-10-26T12:00:00Z')
const DAY = 86400000

function usageEvent(seq, time, usage, provider = 'opencode-go', model = 'deepseek-v4.1-flash') {
  return { type: 'assistant/message', seq, time, data: { message: { source: { provider, model } }, usage } }
}

function makePersistence() {
  const records = new Map()
  const calls = { list: 0, open: [], read: [], close: 0 }
  return {
    records,
    calls,
    async list() {
      calls.list += 1
      return [...records.entries()].map(([id, record]) => ({
        header: record.header,
        sizeBytes: record.sizeBytes,
        eventCount: record.eventCount,
        revision: record.revision,
      }))
    },
    async open(id) {
      calls.open.push(id)
      const record = records.get(id)
      if (record === undefined) throw new Error(`session "${id}" not found`)
      return {
        header: record.header,
        async read(offset = 0) {
          calls.read.push(id)
          return { events: record.events.slice(offset) }
        },
        async close() {
          calls.close += 1
        },
      }
    },
  }
}

function putSession(persistence, id, { entries = [], createdAt = 1000, cwd = 'D:\\proj\\agent_workspace' } = {}) {
  const events = entries.map((entry, index) =>
    usageEvent(index, entry.time, entry.usage, entry.provider, entry.model),
  )
  const record = {
    header: { id, version: 4, createdAt, cwd, parentSession: null, delegationDepth: 0 },
    events,
    sizeBytes: 100 + events.length,
    eventCount: events.length,
    revision: `rev-${events.length}`,
  }
  persistence.records.set(id, record)
  return record
}

/** 模拟持久化追加：事件与指纹一起变（sizeBytes / eventCount / revision）。 */
function appendToSession(persistence, id, entry) {
  const record = persistence.records.get(id)
  const seq = record.events.length
  record.events.push(usageEvent(seq, entry.time, entry.usage, entry.provider, entry.model))
  record.eventCount = record.events.length
  record.sizeBytes = 100 + record.events.length
  record.revision = `rev-${record.events.length}`
  return record
}

function makeSessions() {
  const live = new Map()
  return {
    live,
    get: (id) => live.get(id),
    list: () => [...live.values()],
    add(session) {
      live.set(session.id, session)
      return session
    },
    remove(id) {
      live.delete(id)
    },
  }
}

function liveSession(id, headerExtra = {}) {
  return {
    id,
    header: {
      id,
      version: 4,
      createdAt: BASE_TIME - DAY,
      cwd: 'D:\\proj\\agent_workspace',
      parentSession: null,
      delegationDepth: 0,
      ...headerExtra,
    },
  }
}

function makeLogger() {
  const lines = { info: [], warn: [], error: [] }
  const push = (name) => (...args) => lines[name].push(args.map(String).join(' '))
  return { lines, info: push('info'), warn: push('warn'), error: push('error') }
}

async function tempCacheFile(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'token-stats-store-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return { dir, file: path.join(dir, 'usage-index.v2.json') }
}

function makeStore(persistence, sessions, cacheFile, overrides = {}) {
  const logger = overrides.logger ?? makeLogger()
  const store = createStore({
    getPersistence: () => persistence,
    getSessions: () => sessions,
    cacheFile,
    prices: PRICES,
    currency: 'USD',
    usdToCny: 7.1,
    timeZone: TZ,
    readConcurrency: 2,
    now: () => BASE_TIME,
    logger,
    ...overrides,
  })
  return { store, logger: overrides.logger ?? logger }
}

test('首次刷新：读全部会话、写原子缓存、汇总可查', async (t) => {
  const persistence = makePersistence()
  putSession(persistence, 's1', { entries: [{ time: BASE_TIME, usage: { inputTokens: 100, totalTokens: 100 } }] })
  putSession(persistence, 's2', {
    entries: [{ time: BASE_TIME - DAY, usage: { inputTokens: 200, totalTokens: 200 } }],
  })
  const { file, dir } = await tempCacheFile(t)
  const sessions = makeSessions()
  const { store } = makeStore(persistence, sessions, file)

  const body = await store.getSummary({ days: 0 })
  assert.equal(body.index.sessions, 2)
  assert.equal(body.index.stale, false)
  assert.equal(body.totals.requests, 2)
  assert.equal(body.totals.inputTokens, 300)
  assert.deepEqual(persistence.calls.open.sort(), ['s1', 's2'])

  const raw = await readFile(file, 'utf8')
  const parsed = JSON.parse(raw)
  assert.equal(parsed.version, 2, '缓存格式升级到 v2')
  assert.deepEqual(Object.keys(parsed.sessions).sort(), ['s1', 's2'])
  assert.equal(parsed.sessions.s1.fingerprint.eventCount, 1)
  assert.equal(parsed.sessions.s1.requests, 1)
  assert.equal(typeof parsed.savedAt, 'number')
  // v2 必须带峰谷分桶字段（缺了会被判损坏重建）
  assert.equal(typeof parsed.sessions.s1.modelsPeak, 'object')
  assert.equal(typeof parsed.sessions.s1.modelsOffPeak, 'object')
  assert.equal(typeof parsed.sessions.s1.dailyModelsPeak, 'object')
  assert.equal(typeof parsed.sessions.s1.dailyModelsOffPeak, 'object')
  assert.deepEqual(await readdir(dir), ['usage-index.v2.json'], '临时文件已被 rename 掉，不留垃圾')
  store.dispose()
})

test('增量：指纹不变不重读，只有变化的会话才重读', async (t) => {
  const persistence = makePersistence()
  putSession(persistence, 's1', { entries: [{ time: BASE_TIME, usage: { inputTokens: 100, totalTokens: 100 } }] })
  putSession(persistence, 's2', { entries: [{ time: BASE_TIME, usage: { inputTokens: 200, totalTokens: 200 } }] })
  const { file } = await tempCacheFile(t)
  const { store } = makeStore(persistence, makeSessions(), file)

  await store.refresh({ force: true })
  const opensAfterFirst = persistence.calls.open.length
  assert.equal(opensAfterFirst, 2)

  const listedBefore = persistence.calls.list
  await store.refresh({ force: true })
  assert.equal(persistence.calls.open.length, opensAfterFirst, '指纹没变，不重读日志')
  assert.equal(persistence.calls.list, listedBefore + 1)

  appendToSession(persistence, 's1', { time: BASE_TIME, usage: { inputTokens: 50, totalTokens: 50 } })
  await store.refresh({ force: true })
  assert.equal(persistence.calls.open.length, opensAfterFirst + 1, '只有 s1 重读')
  assert.equal(persistence.calls.open[opensAfterFirst], 's1')
  const body = await store.getSummary({ days: 0 })
  assert.equal(body.totals.requests, 3)
  assert.equal(body.totals.inputTokens, 350, '重读整段替换，不重复计数')
  store.dispose()
})

test('缓存跨实例命中：指纹一致时零次日志读取', async (t) => {
  const persistence = makePersistence()
  putSession(persistence, 's1', { entries: [{ time: BASE_TIME, usage: { inputTokens: 100, totalTokens: 100 } }] })
  putSession(persistence, 's2', { entries: [{ time: BASE_TIME, usage: { inputTokens: 200, totalTokens: 200 } }] })
  const { file } = await tempCacheFile(t)
  const first = makeStore(persistence, makeSessions(), file)
  const firstBody = await first.store.getSummary({ days: 0 })
  first.store.dispose()

  // 新实例：同一个持久化数据 + 同一份缓存 → 完全不需要 open()
  const opensBefore = persistence.calls.open.length
  const second = makeStore(persistence, makeSessions(), file)
  const secondBody = await second.store.getSummary({ days: 0 })
  assert.equal(persistence.calls.open.length, opensBefore, '缓存命中不读日志')
  assert.equal(secondBody.totals.totalTokens, firstBody.totals.totalTokens)
  assert.equal(secondBody.index.sessions, 2)
  assert.ok(second.logger.lines.info.some((line) => line.includes('从缓存恢复 2 个会话')))
  second.store.dispose()
})

test('坏缓存：JSON 损坏 / 版本不符 / 缺 v2 分桶字段都忽略重建', async (t) => {
  const persistence = makePersistence()
  putSession(persistence, 's1', { entries: [{ time: BASE_TIME, usage: { inputTokens: 100, totalTokens: 100 } }] })
  const { file } = await tempCacheFile(t)

  await writeFile(file, 'not-json{{{', 'utf8')
  const broken = makeStore(persistence, makeSessions(), file)
  const body = await broken.store.getSummary({ days: 0 })
  assert.equal(body.totals.requests, 1)
  assert.equal(persistence.calls.open.length, 1)
  assert.ok(broken.logger.lines.warn.some((line) => line.includes('缓存 JSON 损坏')))
  const rebuilt = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(rebuilt.version, 2)
  assert.equal(rebuilt.sessions.s1.requests, 1)
  broken.store.dispose()

  // 版本不符（v1 内容写在 v2 文件名下）：忽略重建
  await writeFile(file, JSON.stringify({ version: 1, sessions: { s1: {} } }), 'utf8')
  let opensBefore = persistence.calls.open.length
  const stale = makeStore(persistence, makeSessions(), file)
  const staleBody = await stale.store.getSummary({ days: 0 })
  assert.equal(staleBody.totals.requests, 1)
  assert.equal(persistence.calls.open.length, opensBefore + 1, '版本不符 → 重建')
  assert.ok(stale.logger.lines.warn.some((line) => line.includes('缓存版本或结构不符')))
  stale.store.dispose()

  // v2 版本号但缺峰谷分桶字段（结构不完整）：同样当损坏重建
  await writeFile(
    file,
    JSON.stringify({
      version: 2,
      savedAt: 1,
      sessions: {
        s1: {
          id: 's1',
          header: { id: 's1' },
          models: {},
          daily: {},
          dailyModels: {},
          fingerprint: { sizeBytes: 101, eventCount: 1, lastSeq: 0 },
        },
      },
    }),
    'utf8',
  )
  opensBefore = persistence.calls.open.length
  const incomplete = makeStore(persistence, makeSessions(), file)
  const incompleteBody = await incomplete.store.getSummary({ days: 0 })
  assert.equal(incompleteBody.totals.requests, 1)
  assert.equal(persistence.calls.open.length, opensBefore + 1, '缺 v2 字段 → 重建')
  assert.ok(
    incomplete.logger.lines.warn.some((line) => line.includes('缓存条目结构不完整')),
    '结构不完整要告警',
  )
  incomplete.store.dispose()
})

test('旧 v1 缓存文件不读取：只认 usage-index.v2.json', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'token-stats-v1-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const v1File = path.join(dir, 'usage-index.v2.json')
  const v2File = path.join(dir, 'usage-index.v2.json')
  // 旧文件里放一份「有效但本插件不会读」的 v1 缓存，应被完全忽略
  await writeFile(
    v1File,
    JSON.stringify({ version: 1, savedAt: 1, sessions: { ghost: { id: 'ghost', fingerprint: {}, requests: 99 } } }),
    'utf8',
  )
  const persistence = makePersistence()
  putSession(persistence, 's1', { entries: [{ time: BASE_TIME, usage: { inputTokens: 100, totalTokens: 100 } }] })
  const { store } = makeStore(persistence, makeSessions(), v2File)
  const body = await store.getSummary({ days: 0 })
  assert.equal(body.index.sessions, 1, '只索引真实会话，不受旧 v1 缓存影响')
  assert.equal(body.totals.sessionsScanned, 1)
  assert.equal(persistence.calls.open.length, 1)
  const written = JSON.parse(await readFile(v2File, 'utf8'))
  assert.equal(written.version, 2)
  assert.deepEqual(Object.keys(written.sessions), ['s1'])
  store.dispose()
})

test('单会话读取失败：其余会话照常统计，失败会话只警告', async (t) => {
  const persistence = makePersistence()
  putSession(persistence, 's1', { entries: [{ time: BASE_TIME, usage: { inputTokens: 100, totalTokens: 100 } }] })
  putSession(persistence, 's2', { entries: [{ time: BASE_TIME, usage: { inputTokens: 200, totalTokens: 200 } }] })
  const originalOpen = persistence.open.bind(persistence)
  persistence.open = async (id, mode) => {
    if (id === 's2') throw new Error('boom')
    return originalOpen(id, mode)
  }
  const { file } = await tempCacheFile(t)
  const { store, logger } = makeStore(persistence, makeSessions(), file)
  const body = await store.getSummary({ days: 0 })
  assert.equal(body.totals.requests, 1)
  assert.equal(body.index.sessions, 1)
  assert.ok(logger.lines.warn.some((line) => line.includes('读取会话 s2 失败')))
  store.dispose()
})

test('list() 抛错：降级为空数据 + stale=true，不抛出', async (t) => {
  const persistence = makePersistence()
  putSession(persistence, 's1', { entries: [{ time: BASE_TIME, usage: { inputTokens: 100, totalTokens: 100 } }] })
  persistence.list = async () => {
    throw new Error('list exploded')
  }
  const { file } = await tempCacheFile(t)
  const { store, logger } = makeStore(persistence, makeSessions(), file)
  const body = await store.getSummary({ days: 7 })
  assert.equal(body.index.stale, true)
  assert.equal(body.index.sessions, 0)
  assert.equal(body.totals.requests, 0)
  assert.equal(body.daily.length, 7)
  assert.ok(logger.lines.error.some((line) => line.includes('刷新索引失败')))
  store.dispose()
})

test('persistence 缺失：getSummary 抛 PersistenceUnavailableError（路由转 503）', async (t) => {
  const { file } = await tempCacheFile(t)
  const { store } = makeStore(undefined, makeSessions(), file)
  await assert.rejects(store.getSummary({}), (error) => {
    assert.equal(error instanceof PersistenceUnavailableError, true)
    assert.equal(error.code, 'persistence-unavailable')
    return true
  })
  const info = await store.refresh({ force: true })
  assert.equal(info.stale, true)
  store.dispose()
})

test('活会话 overlay：seq 去重、重读整体替换、结束后不重复计数', async (t) => {
  const persistence = makePersistence()
  putSession(persistence, 's1', { entries: [{ time: BASE_TIME, usage: { inputTokens: 100, totalTokens: 100 } }] })
  const sessions = makeSessions()
  const live = sessions.add(liveSession('s1'))
  const { file } = await tempCacheFile(t)
  // liveRereadMs: 0 → 每次刷新都重读活会话，方便验证「整段替换」路径
  const { store } = makeStore(persistence, sessions, file, { liveRereadMs: 0 })

  let body = await store.getSummary({ days: 0 })
  assert.equal(body.totals.requests, 1)
  assert.equal(body.sessions[0].live, true)

  const liveEvent = usageEvent(1, BASE_TIME, { inputTokens: 10, totalTokens: 10 })
  store.handleSessionEvent(live, liveEvent)
  body = await store.getSummary({ days: 0 })
  assert.equal(body.totals.requests, 2, 'overlay 立刻可见')
  store.handleSessionEvent(live, liveEvent)
  body = await store.getSummary({ days: 0 })
  assert.equal(body.totals.requests, 2, '同一 seq 重复事件不重复计数')

  // 模拟持久化落盘：磁盘现在也有 seq1；重读后整体替换，不能变成 4
  appendToSession(persistence, 's1', { time: BASE_TIME, usage: { inputTokens: 10, totalTokens: 10 } })
  await store.refresh({ force: true })
  body = await store.getSummary({ days: 0 })
  assert.equal(body.totals.requests, 2, '磁盘重读 + overlay 替换后不重复')
  assert.equal(body.totals.inputTokens, 110)
  const effective = store.effectiveSessions()
  assert.equal(effective[0].requests, 2)
  assert.equal(effective[0].lastSeq, 1)

  // 已包含在磁盘基线里的旧事件再回调，应被 seq 边界挡住
  store.handleSessionEvent(live, liveEvent)
  body = await store.getSummary({ days: 0 })
  assert.equal(body.totals.requests, 2)

  // 会话结束后从 sessions.list() 消失：活标记消失，数字保持
  sessions.remove('s1')
  body = await store.getSummary({ days: 0 })
  assert.equal(body.sessions[0].live, false)
  assert.equal(body.totals.requests, 2)
  store.dispose()
})

test('活会话在重读间隔内：跳过磁盘重读但总量仍准确', async (t) => {
  const persistence = makePersistence()
  putSession(persistence, 's1', { entries: [{ time: BASE_TIME, usage: { inputTokens: 100, totalTokens: 100 } }] })
  const sessions = makeSessions()
  const live = sessions.add(liveSession('s1'))
  const { file } = await tempCacheFile(t)
  const { store } = makeStore(persistence, sessions, file) // 默认 liveRereadMs=5min
  await store.refresh({ force: true })
  const opensAfterFirst = persistence.calls.open.length

  store.handleSessionEvent(live, usageEvent(1, BASE_TIME, { inputTokens: 10, totalTokens: 10 }))
  appendToSession(persistence, 's1', { time: BASE_TIME, usage: { inputTokens: 10, totalTokens: 10 } })
  await store.refresh({ force: true })
  assert.equal(persistence.calls.open.length, opensAfterFirst, '活会话未到重读间隔，不碰磁盘')
  const body = await store.getSummary({ days: 0 })
  assert.equal(body.totals.requests, 2)
  assert.equal(body.totals.inputTokens, 110)
  store.dispose()
})

test('未落盘的 pending 活会话：overlay 也能出现在汇总里', async (t) => {
  const persistence = makePersistence() // list() 为空
  const sessions = makeSessions()
  const live = sessions.add(liveSession('pending-1'))
  const { file } = await tempCacheFile(t)
  const { store } = makeStore(persistence, sessions, file)
  await store.refresh({ force: true })
  assert.equal(store.indexInfo().sessions, 0)

  store.handleSessionEvent(live, usageEvent(0, BASE_TIME, { inputTokens: 42, totalTokens: 42 }))
  const body = await store.getSummary({ days: 0 })
  assert.equal(body.totals.requests, 1)
  assert.equal(body.totals.totalTokens, 42)
  assert.equal(body.sessions[0].id, 'pending-1')
  assert.equal(body.sessions[0].live, true)
  assert.equal(persistence.calls.open.length, 0, 'pending 会话没有可读日志')
  store.dispose()
})

test('缓存写入失败只警告，查询照常返回', async (t) => {
  const persistence = makePersistence()
  putSession(persistence, 's1', { entries: [{ time: BASE_TIME, usage: { inputTokens: 100, totalTokens: 100 } }] })
  const dir = await mkdtemp(path.join(os.tmpdir(), 'token-stats-badcache-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const blocked = path.join(dir, 'not-a-dir')
  await writeFile(blocked, 'x', 'utf8')
  const cacheFile = path.join(blocked, 'usage-index.v2.json')
  const { store, logger } = makeStore(persistence, makeSessions(), cacheFile)
  const body = await store.getSummary({ days: 0 })
  assert.equal(body.totals.requests, 1)
  assert.ok(logger.lines.warn.some((line) => line.includes('缓存目录失败') || line.includes('写入缓存失败')))
  store.dispose()
})

test('会话从 list() 消失后：索引与缓存同步收缩', async (t) => {
  const persistence = makePersistence()
  putSession(persistence, 's1', { entries: [{ time: BASE_TIME, usage: { inputTokens: 100, totalTokens: 100 } }] })
  putSession(persistence, 's2', { entries: [{ time: BASE_TIME, usage: { inputTokens: 200, totalTokens: 200 } }] })
  const { file } = await tempCacheFile(t)
  const { store } = makeStore(persistence, makeSessions(), file)
  await store.refresh({ force: true })
  persistence.records.delete('s2')
  const body = await store.getSummary({ days: 0, refresh: '1' })
  assert.equal(body.index.sessions, 1)
  assert.equal(body.totals.requests, 1)
  const parsed = JSON.parse(await readFile(file, 'utf8'))
  assert.deepEqual(Object.keys(parsed.sessions), ['s1'])
  store.dispose()
})

test('标题（可选增强）：sessionQuery 可用时补上并持久化', async (t) => {
  const persistence = makePersistence()
  putSession(persistence, 's1', { entries: [{ time: BASE_TIME, usage: { inputTokens: 100, totalTokens: 100 } }] })
  const { file } = await tempCacheFile(t)
  const sessionQuery = {
    async readTitleSnapshots(ids) {
      return ids.map((id) => ({ sessionId: id, status: 'fulfilled', value: { session: { id }, title: `标题 ${id}` } }))
    },
  }
  const { store } = makeStore(persistence, makeSessions(), file, { getSessionQuery: () => sessionQuery })
  let body = await store.getSummary({ days: 0 })
  // 标题是后台拉取，首次响应可能是 null 也可能已经补上（取决于微任务时序）——两者都合法。
  assert.ok(body.sessions[0].title === null || body.sessions[0].title === '标题 s1')
  await new Promise((resolve) => setTimeout(resolve, 30))
  body = await store.getSummary({ days: 0 })
  assert.equal(body.sessions[0].title, '标题 s1')
  await store.refresh({ force: true })
  const parsed = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(parsed.sessions.s1.title, '标题 s1')
  store.dispose()
})

test('指纹比对：缺判据 / 只有单侧字段时保守返回 false', () => {
  assert.equal(fingerprintMatches({ sizeBytes: 10, revision: 'a' }, { sizeBytes: 10, revision: 'a' }), true)
  assert.equal(fingerprintMatches({ sizeBytes: 10 }, { sizeBytes: 11 }), false)
  assert.equal(fingerprintMatches({ revision: 'a' }, { revision: 'a' }), true)
  assert.equal(fingerprintMatches({ sizeBytes: 10 }, { eventCount: 3 }), false, '没有共同判据 → 不能复用')
  assert.equal(fingerprintMatches({ sizeBytes: 10 }, {}), false)
  assert.equal(fingerprintMatches(undefined, undefined), false)
  assert.equal(fingerprintMatches({ sizeBytes: 10, eventCount: 1 }, { sizeBytes: 10, eventCount: 2 }), false)
})
