// dsh-plugin-token-stats —— 宿主入口（Node 侧）。
//
// 只做三件事：
//   1. 归一化配置、构造索引用 store（所有宿主服务延迟读取，缺失就降级）；
//   2. 用 ctx.effect 管生命周期：首次加载后台建索引 + 周期增量刷新；
//   3. 注册浏览器路由 GET /api/token-stats.summary 与模型工具 token_stats。
//
// 硬约束（契约第 1 节）：不能 import 任何 @deepseek-ai/* 包；只用 node: 内置模块和
// ctx.get()/ctx.inject() 拿服务。任何服务缺失、空数据、坏缓存都必须安全降级。

import { resolveConfig } from './host/config.js'
import { registerSummaryRoute } from './host/routes.js'
import { createStore } from './host/store.js'
import { registerTokenStatsTool } from './host/tool.js'

export const name = 'token-stats'

function safeGet(ctx, serviceName) {
  try {
    return ctx?.get?.(serviceName)
  } catch {
    return undefined
  }
}

function makeLogger(ctx) {
  const log = (level) => {
    const fn = ctx?.logger?.[level]
    if (typeof fn !== 'function') return () => {}
    return (...args) => {
      try {
        fn.call(ctx.logger, ...args)
      } catch {
        // 日志异常绝不影响业务
      }
    }
  }
  return { info: log('info'), warn: log('warn'), error: log('error') }
}

/**
 * 插件入口。
 * @param {object} ctx - Cordis 插件上下文。
 * @param {object} [config] - cordis.patch.yml 的 config（可被 profile 覆盖）。
 */
export function apply(ctx, config = {}) {
  const resolved = resolveConfig(config)
  const logger = makeLogger(ctx)

  const store = createStore({
    getPersistence: () => safeGet(ctx, 'sessionPersistence'),
    getSessions: () => safeGet(ctx, 'sessions'),
    getSessionQuery: () => safeGet(ctx, 'sessionQuery'),
    cacheFile: resolved.cacheFile,
    prices: resolved.prices,
    currency: resolved.currency,
    usdToCny: resolved.usdToCny,
    readConcurrency: resolved.readConcurrency,
    refreshIntervalMs: resolved.refreshIntervalMs,
    timeZone: resolved.timeZone,
    logger,
  })

  logger.info(
    `token-stats: 已加载（缓存 ${resolved.cacheFile}，时区 ${resolved.timeZone ?? 'local'}，` +
      `价格表 ${Object.keys(resolved.prices).length} 条，刷新间隔 ${resolved.refreshIntervalMs}ms）`,
  )

  // 生命周期：定时增量刷新 + 首次后台建索引 + 活会话事件监听。
  // 所有异步失败只 warn，绝不冒泡到宿主。
  ctx.effect(() => {
    let stopped = false
    let kick = null

    // 活会话增量：只喂给 store 的 overlay，不在这里做 I/O；
    // handleSessionEvent 内部自带 try/catch（契约 2.3：监听器不能拖垮会话提交）。
    const off =
      typeof ctx.on === 'function'
        ? ctx.on('session/event', (session, event) => store.handleSessionEvent(session, event))
        : undefined

    const refreshInBackground = (force, label) => {
      if (stopped) return
      Promise.resolve()
        .then(() => store.refresh({ force }))
        .then((info) => {
          if (stopped) return
          if (label === 'initial') {
            logger.info(`token-stats: ${label}索引完成 ${info.sessions} sessions / ${info.events} events`)
          } else if (info.stale === true) {
            logger.warn(`token-stats: ${label}刷新后索引仍不完整（${String(info.lastError ?? '未知原因')}）`)
          }
        })
        .catch((error) => logger.warn(`token-stats: ${label}刷新失败（忽略）：${String(error?.message ?? error)}`))
    }

    const timer = setInterval(() => refreshInBackground(false, '周期'), resolved.refreshIntervalMs)
    if (typeof timer?.unref === 'function') timer.unref()

    if (resolved.refreshOnStart !== false) {
      // setTimeout(0) 而不是直接 await：首屏/启动不被上百万 token 的历史日志阻塞。
      kick = setTimeout(() => refreshInBackground(true, 'initial'), 0)
      if (typeof kick?.unref === 'function') kick.unref()
    }

    return () => {
      stopped = true
      clearInterval(timer)
      if (kick !== null) clearTimeout(kick)
      try {
        if (typeof off === 'function') off()
      } catch {
        // 卸载时取消订阅失败无所谓
      }
      store.dispose()
    }
  }, 'token-stats: refresh loop')

  registerSummaryRoute(ctx, { store, logger })
  registerTokenStatsTool(ctx, { store, logger })
}
