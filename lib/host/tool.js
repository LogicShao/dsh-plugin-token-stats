// dsh-plugin-token-stats 宿主侧 —— 模型工具 token_stats。
//
// 契约 2.5：第三方插件不能 import defineTool（profile 里没有依赖），必须用普通对象注册，
// 且 output 必须同时给 schema 与 render。注册失败（重名 / 宿主 schema 校验）只 warn，
// 不能影响插件加载。工具文本尽量短：给模型看的是结论，不是完整 JSON。

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
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
    if (name === 'tools') return scope?.tools ?? scope?.get?.('tools')
    return scope?.get?.(name)
  } catch {
    return undefined
  }
}

/** 1234567 → "1,234,567"（手动加千分位，不依赖系统区域）。 */
export function formatTokens(value) {
  const number = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : 0
  return String(number).replace(/\B(?=(\d{3})+(?!\d))/gu, ',')
}

/** 成本：最多 6 位小数，去掉多余的 0，前面加 $。 */
export function formatUsd(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '$0'
  const fixed = value.toFixed(6).replace(/0+$/u, '').replace(/\.$/u, '')
  return `$${fixed}`
}

function formatPercent(share) {
  if (typeof share !== 'number' || !Number.isFinite(share)) return '0%'
  return `${(share * 100).toFixed(1)}%`
}

function formatLocalDay(timeMs) {
  if (typeof timeMs !== 'number' || !Number.isFinite(timeMs)) return '未知'
  const date = new Date(timeMs)
  if (!Number.isFinite(date.getTime())) return '未知'
  const pad = (value) => (value < 10 ? `0${String(value)}` : String(value))
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function counterLine(counters, costUsd) {
  const safe = isRecord(counters) ? counters : {}
  return `请求 ${formatTokens(safe.requests)} 次 / tokens ${formatTokens(safe.totalTokens)} / 成本 ${formatUsd(costUsd)}`
}

/**
 * 聚合响应 → 给模型看的短文本（纯函数，便于单测）。
 * @param {object} summary - aggregateSummary() 的返回值。
 */
export function formatSummaryText(summary) {
  if (!isRecord(summary)) return 'token-stats: 暂无用量数据'
  const range = isRecord(summary.range) ? summary.range : {}
  const totals = isRecord(summary.totals) ? summary.totals : {}
  const highlights = isRecord(summary.highlights) ? summary.highlights : {}
  const index = isRecord(summary.index) ? summary.index : {}
  const days = range.days === 0 ? '全部历史' : `最近 ${String(range.days ?? '?')} 天`
  const lines = [
    `token-stats 用量汇总（${days}：${String(range.startDay ?? '?')} ~ ${String(range.endDay ?? '?')}，时区 ${String(summary.timeZone ?? 'local')}）`,
    `总计：${counterLine(totals, totals.costUsd)}（约 ¥${(typeof totals.costCny === 'number' ? totals.costCny : 0).toFixed(2)}）`,
    `今日：${counterLine(summary.today?.totals, summary.today?.costUsd)}`,
    `昨日：${counterLine(summary.yesterday?.totals, summary.yesterday?.costUsd)}`,
    `近 7 天：${counterLine(summary.last7Days?.totals, summary.last7Days?.costUsd)}`,
    `近 30 天：${counterLine(summary.last30Days?.totals, summary.last30Days?.costUsd)}`,
  ]

  const byModel = Array.isArray(summary.byModel) ? summary.byModel.slice(0, 5) : []
  if (byModel.length > 0) {
    lines.push('模型 Top5：')
    for (const row of byModel) {
      if (!isRecord(row)) continue
      const totalsRow = isRecord(row.totals) ? row.totals : {}
      lines.push(
        `  - ${String(row.key)}：tokens ${formatTokens(totalsRow.totalTokens)}（${formatPercent(row.share)}）/ 请求 ${formatTokens(totalsRow.requests)} / ${formatUsd(row.costUsd)}${row.priced === false ? '（未定价）' : ''}`,
      )
    }
  }

  const byProject = Array.isArray(summary.byProject) ? summary.byProject.slice(0, 5) : []
  if (byProject.length > 0) {
    lines.push('项目 Top5：')
    for (const row of byProject) {
      if (!isRecord(row)) continue
      const totalsRow = isRecord(row.totals) ? row.totals : {}
      lines.push(
        `  - ${String(row.name)}：会话 ${formatTokens(row.sessions)} / tokens ${formatTokens(totalsRow.totalTokens)} / ${formatUsd(row.costUsd)}`,
      )
    }
  }

  const sessions = Array.isArray(summary.sessions) ? summary.sessions.slice(0, 5) : []
  if (sessions.length > 0) {
    lines.push('会话 Top5：')
    for (const row of sessions) {
      if (!isRecord(row)) continue
      const totalsRow = isRecord(row.totals) ? row.totals : {}
      const label = typeof row.title === 'string' && row.title.length > 0 ? row.title : String(row.project ?? 'unknown')
      lines.push(
        `  - ${label}（${String(row.live === true ? '进行中' : formatLocalDay(row.lastActivity))}）：tokens ${formatTokens(totalsRow.totalTokens)} / ${formatUsd(row.costUsd)}`,
      )
    }
  }

  const topModel = isRecord(highlights.topModel) ? highlights.topModel : undefined
  const busiestDay = isRecord(highlights.busiestDay) ? highlights.busiestDay : undefined
  const highlightParts = [
    `连续使用 ${formatTokens(highlights.streakDays)} 天`,
    `缓存命中率 ${formatPercent(highlights.cacheHitRate)}`,
    busiestDay === undefined
      ? '最忙一天 无'
      : `最忙一天 ${String(busiestDay.day)}（${formatTokens(busiestDay.totalTokens)} tokens）`,
    topModel === undefined
      ? '主力模型 无'
      : `主力模型 ${String(topModel.key)}（${formatPercent(topModel.share)}）`,
    `本月预测 ${formatUsd(highlights.projectedMonthUsd)}`,
  ]
  lines.push(`亮点：${highlightParts.join('；')}`)

  const prices = isRecord(summary.prices) ? summary.prices : {}
  const unmatched = Array.isArray(prices.unmatchedModels) ? prices.unmatchedModels : []
  if (unmatched.length > 0) lines.push(`未定价模型（成本按 0 计）：${unmatched.slice(0, 8).join(', ')}`)
  lines.push(
    `索引：扫描 ${formatTokens(totals.sessionsScanned)} 个会话（${formatTokens(totals.sessions)} 个范围内有用量）/ ${formatTokens(index.events)} events${index.building === true ? '（后台更新中）' : ''}${index.stale === true ? '（数据可能不完整）' : ''}`,
  )
  return lines.join('\n')
}

/** 工具定义（普通对象；output.render 返回平台认的 [{type:'text', text}]）。 */
export function createTokenStatsDefinition(store) {
  return {
    name: 'token_stats',
    description:
      '查询 DeepSeek Harness 跨会话的 token 用量与成本统计：总计/每日/按模型/按项目/会话排行，含缓存命中率与本月预测。' +
      'Inspect aggregated token usage and estimated cost across all stored sessions (daily, per model, per project).',
    // parameters 是原始 JSON Schema（object-rooted），不是工具作者的 spec。
    parameters: {
      type: 'object',
      properties: {
        days: {
          type: 'integer',
          description: '统计范围天数：7 / 30 / 90；0 表示全部历史。缺省 30。',
        },
        limitSessions: {
          type: 'integer',
          description: '会话排行返回条数，1..500，缺省 100。',
        },
      },
      required: [],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
        additionalProperties: false,
      },
      render: (_args, value) => [
        { type: 'text', text: isRecord(value) && typeof value.text === 'string' ? value.text : '' },
      ],
    },
    async execute(args) {
      try {
        const summary = await store.getSummary({
          days: args?.days,
          limitSessions: args?.limitSessions,
        })
        return { text: formatSummaryText(summary) }
      } catch (error) {
        return { text: `token-stats 不可用：${messageOf(error)}` }
      }
    },
  }
}

/** 注册 token_stats 工具；失败只 warn。 */
export function registerTokenStatsTool(ctx, deps) {
  const attach = (scope) => {
    try {
      const tools = safeService(scope, 'tools')
      if (tools === undefined || tools === null || typeof tools.register !== 'function') {
        warnWith(deps.logger, 'token-stats: tools 服务不可用，跳过 token_stats 工具注册')
        return
      }
      scope.effect(() => {
        try {
          const disposer = tools.register(createTokenStatsDefinition(deps.store))
          return typeof disposer === 'function' ? disposer : undefined
        } catch (error) {
          warnWith(deps.logger, `token-stats: 注册工具 token_stats 失败（忽略，不影响插件加载）：${messageOf(error)}`)
          return undefined
        }
      }, 'token-stats: tool')
    } catch (error) {
      warnWith(deps.logger, `token-stats: 注册工具时出错（忽略）：${messageOf(error)}`)
    }
  }
  try {
    if (typeof ctx?.inject === 'function') {
      ctx.inject(['tools'], attach)
      return
    }
  } catch (error) {
    warnWith(deps.logger, `token-stats: 等待 tools 服务失败：${messageOf(error)}`)
  }
  attach(ctx)
}
