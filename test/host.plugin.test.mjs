// dsh-plugin-token-stats 宿主侧单测 —— HTTP 路由 + 模型工具 + 插件入口。
//
// 不启动 HTTP / DSH：用假 connection.fetch.register、假 tools.register、假 ctx 驱动，
// 验证契约 2.4 / 2.5 / 3.2 的注册形状、状态码、header 与工具输出。

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { apply as applyPlugin, name as PLUGIN_NAME } from '../lib/index.js'
import { aggregateSummary } from '../lib/host/aggregate.js'
import {
  CACHE_RELATIVE_PATH,
  defaultCacheFile,
  resolveConfig,
  resolveDshHome,
  unwrapConfig,
} from '../lib/host/config.js'
import { extractSessionUsage } from '../lib/host/extract.js'
import { normalizePrices } from '../lib/host/prices.js'
import {
  createSummaryRoute,
  handleSummaryRequest,
  parseSummaryQuery,
  registerSummaryRoute,
  SUMMARY_ROUTE_PATH,
} from '../lib/host/routes.js'
import { createTokenStatsDefinition, formatSummaryText, registerTokenStatsTool } from '../lib/host/tool.js'
import { PersistenceUnavailableError } from '../lib/host/store.js'

const TZ = 'UTC'
const NOW = Date.parse('2026-10-26T12:00:00Z')
const PRICES = normalizePrices({
  'opencode-go/deepseek-v4.1-flash': { input: 0.15, output: 0.6, cacheRead: 0.015, cacheWrite: 0.15 },
})

function usageEvent(seq, time, usage) {
  return {
    type: 'assistant/message',
    seq,
    time,
    data: {
      message: { source: { provider: 'opencode-go', model: 'deepseek-v4.1-flash' } },
      usage,
    },
  }
}

function sampleBody() {
  const usage = extractSessionUsage(
    { id: 's1', createdAt: NOW - 1000, cwd: 'D:\\proj\\agent_workspace', parentSession: null, delegationDepth: 0 },
    [usageEvent(0, NOW, { inputTokens: 1000, outputTokens: 200, totalTokens: 1200 })],
    { timeZone: TZ },
  )
  return aggregateSummary({
    sessions: [usage],
    query: { days: 7 },
    now: NOW,
    timeZone: TZ,
    prices: PRICES,
    currency: 'USD',
    usdToCny: 7.1,
    index: { sessions: 1, events: 1, building: false, stale: false, cacheFile: 'usage-index.v2.json' },
  })
}

function makeLogger() {
  const lines = { info: [], warn: [], error: [] }
  const push = (name) => (...args) => lines[name].push(args.map(String).join(' '))
  return { lines, info: push('info'), warn: push('warn'), error: push('error') }
}

async function jsonOf(response) {
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8')
  assert.equal(response.headers.get('cache-control'), 'no-store')
  return JSON.parse(await response.text())
}

test('GET /api/token-stats.summary：200 + JSON + no-store，query 透传给 store', async () => {
  const captured = {}
  const store = {
    async getSummary(query) {
      captured.query = query
      return sampleBody()
    },
  }
  const request = new Request(
    'http://127.0.0.1:58223/api/token-stats.summary?days=7&limitSessions=20&refresh=1',
  )
  const response = await handleSummaryRequest(store, request)
  assert.equal(response.status, 200)
  const body = await jsonOf(response)
  assert.equal(body.version, 1)
  assert.equal(body.timeZone, TZ)
  assert.equal(Array.isArray(body.daily), true)
  assert.deepEqual(captured.query, { days: '7', limitSessions: '20', refresh: '1' })
})

test('路由错误：persistence 缺失 → 503 JSON；其它异常 → 500 JSON', async () => {
  const missing = await handleSummaryRequest(
    {
      async getSummary() {
        throw new PersistenceUnavailableError()
      },
    },
    new Request('http://x/api/token-stats.summary'),
  )
  assert.equal(missing.status, 503)
  const missingBody = await jsonOf(missing)
  assert.match(missingBody.error, /persistence/iu)

  const boom = await handleSummaryRequest(
    {
      async getSummary() {
        throw new Error('boom')
      },
    },
    new Request('http://x/api/token-stats.summary'),
  )
  assert.equal(boom.status, 500)
  assert.equal((await jsonOf(boom)).error, 'boom')
})

test('parseSummaryQuery：坏 URL 退回空对象', () => {
  assert.deepEqual(parseSummaryQuery(undefined), {})
  assert.deepEqual(parseSummaryQuery({ url: '' }), {})
  assert.deepEqual(parseSummaryQuery({ url: 'http://x/api/token-stats.summary?days=0' }), { days: '0' })
})

test('注册形状：ctx.inject(["connection"]) + fetch.register({path, methods, requestBody})', async () => {
  const logger = makeLogger()
  let injected
  let route
  const disposers = []
  const connection = { fetch: { register: (value) => (route = value, () => {}) } }
  const ctx = {
    logger,
    inject(deps, callback) {
      injected = deps
      callback({
        connection,
        effect(fn) {
          const disposer = fn()
          if (typeof disposer === 'function') disposers.push(disposer)
        },
      })
    },
  }
  const store = { async getSummary() { return sampleBody() } }
  registerSummaryRoute(ctx, { store, logger })
  assert.deepEqual(injected, ['connection'])
  assert.equal(route.path, '/api/token-stats.summary')
  assert.deepEqual(route.methods, ['GET'])
  assert.equal(route.requestBody, 'buffered')
  assert.equal(typeof route.fetch, 'function')

  const response = await route.fetch(new Request('http://x/api/token-stats.summary?days=7'))
  assert.equal(response.status, 200)
  assert.equal((await jsonOf(response)).version, 1)
  while (disposers.length > 0) disposers.pop()()
})

test('注册降级：connection 缺失只告警；ctx 没有 inject 时直接走 ctx.connection', () => {
  const logger = makeLogger()
  let injected = false
  const ctxMissing = {
    logger,
    inject(deps, callback) {
      injected = true
      callback({ effect() {} }) // scope 里没有 connection
    },
  }
  assert.doesNotThrow(() => registerSummaryRoute(ctxMissing, { store: {}, logger }))
  assert.equal(injected, true)
  assert.ok(logger.lines.warn.some((line) => line.includes('connection.fetch 不可用')))

  const directLogger = makeLogger()
  let directRoute
  const ctxDirect = {
    logger: directLogger,
    connection: { fetch: { register: (value) => ((directRoute = value), () => {}) } },
    effect(fn) {
      return fn()
    },
  }
  assert.doesNotThrow(() => registerSummaryRoute(ctxDirect, { store: {}, logger: directLogger }))
  assert.equal(directRoute.path, SUMMARY_ROUTE_PATH)
})

test('createSummaryRoute：route 对象可独立用于单测', async () => {
  const route = createSummaryRoute({ async getSummary() { return { version: 1, hello: 'world' } } })
  assert.equal(route.path, SUMMARY_ROUTE_PATH)
  const response = await route.fetch(new Request('http://x/api/token-stats.summary'))
  assert.deepEqual(await response.json(), { version: 1, hello: 'world' })
})

test('工具定义：普通对象 + output.schema/render，execute 返回 {text}', async () => {
  const captured = {}
  const store = {
    async getSummary(query) {
      captured.query = query
      return sampleBody()
    },
  }
  const definition = createTokenStatsDefinition(store)
  assert.equal(definition.name, 'token_stats')
  assert.equal(typeof definition.description, 'string')
  assert.ok(definition.description.length > 20)
  assert.equal(definition.parameters.type, 'object')
  assert.deepEqual(definition.parameters.required, [])
  assert.equal(definition.parameters.additionalProperties, false)
  assert.equal(typeof definition.parameters.properties.days, 'object')
  assert.equal(definition.output.schema.type, 'object')
  assert.deepEqual(definition.output.schema.required, ['text'])
  assert.deepEqual(definition.output.render({}, { text: 'hi' }), [{ type: 'text', text: 'hi' }])
  assert.deepEqual(definition.output.render({}, {}), [{ type: 'text', text: '' }])

  const value = await definition.execute({ days: 7, limitSessions: 10 })
  assert.equal(typeof value.text, 'string')
  assert.ok(value.text.includes('总计'))
  assert.equal(captured.query.days, 7)
  assert.equal(captured.query.limitSessions, 10)
})

test('工具 execute 出错时返回文本而不是抛错', async () => {
  const definition = createTokenStatsDefinition({
    async getSummary() {
      throw new PersistenceUnavailableError()
    },
  })
  const value = await definition.execute({})
  assert.match(value.text, /token-stats 不可用/u)
})

test('工具注册：ctx.inject(["tools"]) + register 普通对象；注册失败只 warn', () => {
  const logger = makeLogger()
  const registrations = []
  let injected
  const disposers = []
  const ctx = {
    logger,
    inject(deps, callback) {
      injected = deps
      callback({
        tools: { register: (definition) => (registrations.push(definition), () => {}) },
        effect(fn) {
          const disposer = fn()
          if (typeof disposer === 'function') disposers.push(disposer)
        },
      })
    },
  }
  registerTokenStatsTool(ctx, { store: { async getSummary() { return sampleBody() } }, logger })
  assert.deepEqual(injected, ['tools'])
  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].name, 'token_stats')
  while (disposers.length > 0) disposers.pop()()

  const failingLogger = makeLogger()
  assert.doesNotThrow(() =>
    registerTokenStatsTool(
      {
        logger: failingLogger,
        inject(deps, callback) {
          callback({
            tools: {
              register() {
                throw new TypeError('tool "token_stats" must declare output { schema, render }')
              },
            },
            effect(fn) {
              return fn()
            },
          })
        },
      },
      { store: {}, logger: failingLogger },
    ),
  )
  assert.ok(failingLogger.lines.warn.some((line) => line.includes('注册工具 token_stats 失败')))

  const noToolsLogger = makeLogger()
  assert.doesNotThrow(() =>
    registerTokenStatsTool(
      { logger: noToolsLogger, inject: (deps, callback) => callback({ effect() {} }) },
      { store: {}, logger: noToolsLogger },
    ),
  )
  assert.ok(noToolsLogger.lines.warn.some((line) => line.includes('tools 服务不可用')))
})

test('formatSummaryText：包含总量/模型/项目/会话/亮点/索引，且未定价模型有提示', () => {
  const usage = extractSessionUsage(
    { id: 's1', createdAt: NOW - 1000, cwd: 'D:\\proj\\agent_workspace' },
    [
      usageEvent(0, NOW, { inputTokens: 1_234_567, outputTokens: 1000, cacheReadTokens: 5000, totalTokens: 1_240_567 }),
      {
        type: 'assistant/message',
        seq: 1,
        time: NOW,
        data: {
          message: { source: { provider: 'mystery', model: 'unknown-model' } },
          usage: { inputTokens: 10, outputTokens: 1, totalTokens: 11 },
        },
      },
    ],
    { timeZone: TZ, title: '演示会话' },
  )
  const body = aggregateSummary({
    sessions: [usage],
    query: { days: 7 },
    now: NOW,
    timeZone: TZ,
    prices: PRICES,
    currency: 'USD',
    usdToCny: 7.1,
    index: { sessions: 1, events: 2, building: false, stale: false, cacheFile: 'x' },
  })
  const text = formatSummaryText(body)
  assert.ok(text.includes('token-stats 用量汇总'))
  assert.ok(text.includes('总计'))
  assert.ok(text.includes('1,240,567'), '千分位格式化')
  assert.ok(text.includes('模型 Top5'))
  assert.ok(text.includes('项目 Top5'))
  assert.ok(text.includes('会话 Top5'))
  assert.ok(text.includes('亮点'))
  assert.ok(text.includes('未定价模型'))
  assert.ok(text.includes('索引'))
  assert.equal(text.includes('NaN'), false)
  assert.equal(formatSummaryText(undefined), 'token-stats: 暂无用量数据')
})

test('config：默认值、DSH_HOME、访问器 unwrap、非法值回落', () => {
  const env = { DSH_HOME: 'C:\\custom\\dsh-home' }
  const resolved = resolveConfig({}, { env, homedir: 'C:\\Users\\demo' })
  assert.equal(resolved.currency, 'USD')
  assert.equal(resolved.usdToCny, 7.1)
  assert.equal(resolved.readConcurrency, 3)
  assert.equal(resolved.refreshIntervalMs, 15000)
  assert.equal(resolved.refreshOnStart, true)
  assert.equal(resolved.cacheFile, path.join('C:\\custom\\dsh-home', CACHE_RELATIVE_PATH))
  assert.equal(resolveDshHome({}, 'C:\\Users\\demo'), path.join('C:\\Users\\demo', '.dsh'))
  assert.equal(defaultCacheFile({ DSH_HOME: 'D:\\x' }), path.join('D:\\x', CACHE_RELATIVE_PATH))

  const overridden = resolveConfig(
    {
      prices: { 'p/m': { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 } },
      currency: 'cny',
      usdToCny: '7.3',
      readConcurrency: 99,
      refreshIntervalMs: 5,
      refreshOnStart: false,
      cacheFile: 'C:\\tmp\\cache.json',
      timeZone: 'UTC',
    },
    { env, homedir: 'C:\\Users\\demo' },
  )
  assert.equal(overridden.currency, 'CNY')
  assert.equal(overridden.usdToCny, 7.3)
  assert.equal(overridden.readConcurrency, 16, '并发夹到上限 16')
  assert.equal(overridden.refreshIntervalMs, 15000, '非法小间隔退回默认 15000ms')
  assert.equal(overridden.refreshOnStart, false)
  assert.equal(overridden.cacheFile, 'C:\\tmp\\cache.json')
  assert.equal(overridden.timeZone, 'UTC')
  assert.equal(overridden.prices['p/m'].output, 2)

  const accessor = (value) => ({ get: () => value })
  const unwrapped = unwrapConfig({ currency: accessor('USD'), nested: { usdToCny: accessor(7.1) } })
  assert.deepEqual(unwrapped, { currency: 'USD', nested: { usdToCny: 7.1 } })
})

async function tempCache(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'token-stats-plugin-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return path.join(dir, 'usage-index.v2.json')
}

function fakePersistence() {
  const zeroUsageHeader = {
    id: 's-zero',
    version: 4,
    createdAt: NOW - 7200_000,
    cwd: 'D:\\proj\\empty_session',
    parentSession: null,
    delegationDepth: 0,
  }
  const records = new Map([
    [
      's1',
      {
        header: {
          id: 's1',
          version: 4,
          createdAt: NOW - 3600_000,
          cwd: 'D:\\proj\\agent_workspace',
          parentSession: null,
          delegationDepth: 0,
        },
        events: [usageEvent(0, NOW, { inputTokens: 1000, outputTokens: 200, totalTokens: 1200 })],
        sizeBytes: 101,
        eventCount: 1,
        revision: 'rev-1',
      },
    ],
    // 只建了会话但一条 assistant/message 都没有（真实数据里有 5 个）：
    // 计入 index.sessions / totals.sessionsScanned，但不计入 totals.sessions。
    ['s-zero', { header: zeroUsageHeader, events: [], sizeBytes: 88, eventCount: 0, revision: 'rev-0' }],
  ])
  return {
    records,
    async list() {
      return [...records.values()].map((record) => ({
        header: record.header,
        sizeBytes: record.sizeBytes,
        eventCount: record.eventCount,
        revision: record.revision,
      }))
    },
    async open(id) {
      const record = records.get(id)
      if (record === undefined) throw new Error(`session "${id}" not found`)
      return {
        header: record.header,
        async read() {
          return { events: record.events }
        },
        async close() {},
      }
    },
  }
}

function makeFakeCtx(services = {}) {
  const logger = makeLogger()
  const disposers = []
  const listeners = new Map()
  const route = { value: undefined }
  const tool = { value: undefined }
  const connection = services.connection ?? {
    fetch: { register: (value) => (route.value = value, () => {}) },
  }
  const tools = services.tools ?? { register: (definition) => (tool.value = definition, () => {}) }
  const resolvedServices = { ...services, connection, tools }
  const ctx = {
    logger,
    get: (serviceName) => resolvedServices[serviceName],
    on(eventName, listener) {
      const set = listeners.get(eventName) ?? new Set()
      set.add(listener)
      listeners.set(eventName, set)
      return () => set.delete(listener)
    },
    emit(eventName, ...args) {
      for (const listener of listeners.get(eventName) ?? []) listener(...args)
    },
    listenerCount: (eventName) => (listeners.get(eventName) ?? new Set()).size,
    effect(fn, label) {
      const disposer = fn()
      assert.equal(typeof label, 'string')
      if (typeof disposer === 'function') disposers.push(disposer)
      return disposer
    },
    inject(deps, callback) {
      callback({
        connection: resolvedServices.connection,
        tools: resolvedServices.tools,
        get: (serviceName) => resolvedServices[serviceName],
        effect(fn) {
          const disposer = fn()
          if (typeof disposer === 'function') disposers.push(disposer)
        },
      })
    },
    route,
    tool,
    logs: logger.lines,
    dispose() {
      while (disposers.length > 0) {
        try {
          disposers.pop()()
        } catch {
          // 卸载失败不应影响测试
        }
      }
    },
  }
  return ctx
}

async function waitFor(check, timeoutMs = 3000) {
  const started = Date.now()
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() - started > timeoutMs) throw new Error('waitFor timed out')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

async function readJson(response) {
  return JSON.parse(await response.text())
}

test('插件入口：完整服务下注册路由 + 工具，路由返回统计', async (t) => {
  const cacheFile = await tempCache(t)
  const ctx = makeFakeCtx({ sessionPersistence: fakePersistence(), sessions: { get: () => undefined, list: () => [] } })
  applyPlugin(ctx, {
    cacheFile,
    refreshOnStart: false,
    refreshIntervalMs: 600_000,
    timeZone: TZ,
    prices: { 'opencode-go/deepseek-v4.1-flash': { input: 0.15, output: 0.6, cacheRead: 0.015, cacheWrite: 0.15 } },
  })
  assert.equal(PLUGIN_NAME, 'token-stats')
  assert.equal(ctx.route.value.path, SUMMARY_ROUTE_PATH)
  assert.equal(ctx.tool.value.name, 'token_stats')
  assert.ok(ctx.logs.info.some((line) => line.includes('token-stats: 已加载')))

  const response = await ctx.route.value.fetch(new Request('http://x/api/token-stats.summary?days=0'))
  assert.equal(response.status, 200)
  const body = await readJson(response)
  assert.equal(body.index.sessions, 2, '索引到 2 个会话（含零用量）')
  assert.equal(body.totals.sessionsScanned, 2)
  assert.equal(body.totals.sessions, 1, '只有 1 个会话有 usage')
  assert.equal(body.totals.requests, 1)
  assert.equal(body.totals.totalTokens, 1200)
  assert.equal(body.totals.costUsd, Number(((1000 / 1e6) * 0.15 + (200 / 1e6) * 0.6).toFixed(6)))
  assert.deepEqual(body.sessions.map((row) => row.id), ['s1'], '零用量会话不进排行')

  const toolValue = await ctx.tool.value.execute({ days: 0 })
  assert.match(toolValue.text, /token-stats 用量汇总/u)
  assert.ok(toolValue.text.includes('1,200'))

  ctx.dispose()
})

test('插件入口：cordis config 的官方峰谷价生效（峰/闲分桶成本 + timeAware）', async (t) => {
  const cacheFile = await tempCache(t)
  // 两个 session、同一模型：一个峰时（周四 02:00Z）、一个闲时（周四 05:00Z），各 1M input。
  const header = (id) => ({
    id,
    version: 4,
    createdAt: NOW - 1000,
    cwd: 'D:\\proj\\peak-demo',
    parentSession: null,
    delegationDepth: 0,
  })
  const records = new Map([
    [
      'peak',
      {
        header: header('peak'),
        events: [
          {
            type: 'assistant/message',
            seq: 0,
            time: Date.parse('2026-10-29T02:00:00Z'),
            data: {
              message: { source: { provider: 'deepseek-account', model: 'deepseek-flash' } },
              usage: { inputTokens: 1_000_000, totalTokens: 1_000_000 },
            },
          },
        ],
        sizeBytes: 201,
        eventCount: 1,
        revision: 'rev-peak',
      },
    ],
    [
      'off',
      {
        header: header('off'),
        events: [
          {
            type: 'assistant/message',
            seq: 0,
            time: Date.parse('2026-10-29T05:00:00Z'),
            data: {
              message: { source: { provider: 'deepseek-account', model: 'deepseek-flash' } },
              usage: { inputTokens: 1_000_000, totalTokens: 1_000_000 },
            },
          },
        ],
        sizeBytes: 202,
        eventCount: 1,
        revision: 'rev-off',
      },
    ],
  ])
  const persistence = {
    records,
    async list() {
      return [...records.values()].map((record) => ({
        header: record.header,
        sizeBytes: record.sizeBytes,
        eventCount: record.eventCount,
        revision: record.revision,
      }))
    },
    async open(id) {
      const record = records.get(id)
      return {
        header: record.header,
        async read() {
          return { events: record.events }
        },
        async close() {},
      }
    },
  }
  const ctx = makeFakeCtx({ sessionPersistence: persistence, sessions: { get: () => undefined, list: () => [] } })
  applyPlugin(ctx, {
    cacheFile,
    refreshOnStart: false,
    refreshIntervalMs: 600_000,
    timeZone: 'UTC',
    prices: {
      'deepseek-account/deepseek-flash': {
        peak: { input: 0.3, cacheRead: 0.006, output: 1.2, cacheWrite: 0 },
        offPeak: { input: 0.15, cacheRead: 0.003, output: 0.6, cacheWrite: 0 },
      },
    },
  })
  const body = await readJson(await ctx.route.value.fetch(new Request('http://x/api/token-stats.summary?days=0')))
  // 峰 1M * 0.30 + 闲 1M * 0.15 = 0.45（若取平均会是 0.225*2M = 0.45 恰好相同，
  // 所以这里再断言两个会话各自的成本是 0.3 / 0.15，证明分桶而非平均）
  assert.equal(body.totals.costUsd, 0.45)
  const costs = Object.fromEntries(body.sessions.map((row) => [row.id, row.costUsd]))
  assert.deepEqual(costs, { peak: 0.3, off: 0.15 })
  assert.equal(body.byModel[0].priced, true)
  assert.equal(body.byModel[0].costUsd, 0.45)
  assert.equal(body.prices.timeAware, true)
  assert.match(body.prices.peakWindow, /09:00-12:00/u)
  // 工具文本里能看到汇总（成本数字按 6 位小数格式化）
  const toolValue = await ctx.tool.value.execute({ days: 0 })
  assert.ok(toolValue.text.includes('0.45'))
  ctx.dispose()
})

test('插件入口：session/event 监听把活会话增量喂给索引（不重复计数）', async (t) => {
  const cacheFile = await tempCache(t)
  const persistence = fakePersistence()
  const live = {
    id: 's1',
    header: persistence.records.get('s1').header,
  }
  const sessions = { get: (id) => (id === 's1' ? live : undefined), list: () => [live] }
  const ctx = makeFakeCtx({ sessionPersistence: persistence, sessions })
  applyPlugin(ctx, { cacheFile, refreshOnStart: false, refreshIntervalMs: 600_000, timeZone: TZ })
  assert.equal(ctx.listenerCount('session/event'), 1, '注册了 session/event 监听')

  let body = await readJson(await ctx.route.value.fetch(new Request('http://x/api/token-stats.summary?days=0')))
  assert.equal(body.totals.requests, 1)

  const event = usageEvent(1, NOW, { inputTokens: 10, outputTokens: 5, totalTokens: 15 })
  ctx.emit('session/event', live, event)
  ctx.emit('session/event', live, event) // 同一 seq 重复回调只算一次
  body = await readJson(await ctx.route.value.fetch(new Request('http://x/api/token-stats.summary?days=0')))
  assert.equal(body.totals.requests, 2)
  assert.equal(body.totals.totalTokens, 1215)
  assert.equal(body.sessions[0].live, true)

  // 坏事件（null / 非 usage）不能抛回宿主提交路径
  assert.doesNotThrow(() => {
    ctx.emit('session/event', live, null)
    ctx.emit('session/event', { id: 's1' }, { type: 'user/message', seq: 2, data: {} })
  })
  ctx.dispose()
  assert.equal(ctx.listenerCount('session/event'), 0, 'dispose 时取消订阅')
})

test('插件入口：refreshOnStart=true 时后台建索引，不阻塞加载；dispose 干净退出', async (t) => {
  const cacheFile = await tempCache(t)
  const ctx = makeFakeCtx({ sessionPersistence: fakePersistence(), sessions: { get: () => undefined, list: () => [] } })
  applyPlugin(ctx, { cacheFile, refreshOnStart: true, refreshIntervalMs: 600_000, timeZone: TZ })
  // apply 已经同步返回（首屏不阻塞）；后台索引通过路由轮询等到。
  const body = await waitFor(async () => {
    const response = await ctx.route.value.fetch(new Request('http://x/api/token-stats.summary?days=0'))
    const parsed = await readJson(response)
    return parsed.index?.sessions === 2 ? parsed : undefined
  })
  assert.equal(body.totals.requests, 1)
  assert.ok(ctx.logs.info.some((line) => line.includes('sessions')), '启动日志打印索引概况')
  ctx.dispose()
  await new Promise((resolve) => setTimeout(resolve, 20))
})

test('插件入口：没有任何宿主服务也不抛错（降级为空态）', async (t) => {
  const cacheFile = await tempCache(t)
  const ctx = makeFakeCtx({ connection: { fetch: { register: () => () => {} } }, tools: { register: () => () => {} } })
  for (const serviceName of ['sessionPersistence', 'sessions']) delete ctx[serviceName]
  // 让 get() 一律返回 undefined（模拟服务全部缺失）
  ctx.get = () => undefined
  assert.doesNotThrow(() => applyPlugin(ctx, { cacheFile, refreshOnStart: false }))
  ctx.dispose()

  const bareCtx = { logger: makeLogger(), effect: (fn) => fn() }
  assert.doesNotThrow(() => applyPlugin(bareCtx, { cacheFile, refreshOnStart: false }))
})
