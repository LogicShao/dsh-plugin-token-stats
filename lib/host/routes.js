// dsh-plugin-token-stats 宿主侧 —— HTTP 路由注册（GET /api/token-stats.summary）。
//
// 注册方式照抄 dsh-session-log-export 的形状：connection.fetch.register({path, methods,
// requestBody, fetch})。connection 可能比本插件晚挂载，所以用 ctx.inject(['connection'])
// 等它就绪；没有该服务时只告警，不影响插件其余能力（工具仍可用）。
//
// 浏览器侧用 document-relative 形式访问：api/token-stats.summary（不要前导斜杠）。

/** 宿主注册用的绝对路径（契约 3.2）。 */
export const SUMMARY_ROUTE_PATH = '/api/token-stats.summary'

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/** 统一的 JSON 响应：200 时和 503 时都带 no-store（统计值随会话变化）。 */
export function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), { status, headers: JSON_HEADERS })
}

/** 解析 query string；坏 URL 退回空对象（由 store 用默认值兜底）。 */
export function parseSummaryQuery(request) {
  try {
    const raw = request?.url
    if (typeof raw !== 'string' || raw.length === 0) return {}
    const url = new URL(raw, 'http://dsh.local')
    return Object.fromEntries(url.searchParams)
  } catch {
    return {}
  }
}

/**
 * 路由处理函数（独立导出便于单测，不必启动 HTTP）。
 * @param {{getSummary: Function}} store
 * @param {Request} request
 */
export async function handleSummaryRequest(store, request) {
  const query = parseSummaryQuery(request)
  try {
    const payload = await store.getSummary(query)
    return jsonResponse(200, payload)
  } catch (error) {
    const status = error?.code === 'persistence-unavailable' ? 503 : 500
    return jsonResponse(status, { error: messageOf(error) })
  }
}

/** 构造 connection.fetch.register 的 route 对象。 */
export function createSummaryRoute(store) {
  return {
    path: SUMMARY_ROUTE_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: (request) => handleSummaryRequest(store, request),
  }
}

function warnWith(logger, message) {
  try {
    logger?.warn?.(message)
  } catch {
    // 日志失败不能影响注册流程
  }
}

function safeService(scope, name) {
  try {
    return scope?.connection ?? scope?.get?.(name)
  } catch {
    return undefined
  }
}

/**
 * 注册汇总路由。
 * @param {object} ctx - 插件上下文。
 * @param {{store: object, logger?: object}} deps
 */
export function registerSummaryRoute(ctx, deps) {
  const route = createSummaryRoute(deps.store)
  const attach = (scope) => {
    try {
      const connection = safeService(scope, 'connection')
      if (connection === undefined || connection === null || typeof connection.fetch?.register !== 'function') {
        warnWith(deps.logger, 'token-stats: connection.fetch 不可用，跳过 API 路由注册（工具仍可用）')
        return
      }
      scope.effect(() => connection.fetch.register(route), 'token-stats: route')
    } catch (error) {
      warnWith(deps.logger, `token-stats: 注册 API 路由失败（不影响其它功能）：${messageOf(error)}`)
    }
  }
  try {
    if (typeof ctx?.inject === 'function') {
      ctx.inject(['connection'], attach)
      return
    }
  } catch (error) {
    warnWith(deps.logger, `token-stats: 等待 connection 服务失败：${messageOf(error)}`)
  }
  attach(ctx)
}
