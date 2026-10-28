// dsh-plugin-token-stats 宿主侧 —— config 归一化（纯函数 + 环境探测）。
//
// cordis.patch.yml 里给的默认值在这里兜底：插件可能被别处的 profile 覆盖、也可能
// 拿到 schemastery 的访问器对象（带 get()），所以先 unwrap 再做类型归一。
// 任何非法值都退回默认值，绝不因为配置写错让插件加载失败。

import os from 'node:os'
import path from 'node:path'
import { normalizePrices } from './prices.js'

/** 缓存文件相对 dshHome 的位置（契约 3.4）。 */
export const CACHE_RELATIVE_PATH = path.join('plugin-data', 'dsh-plugin-token-stats', 'usage-index.v1.json')

export const DEFAULT_CONFIG = {
  currency: 'USD',
  usdToCny: 7.1,
  readConcurrency: 3,
  refreshIntervalMs: 15000,
  refreshOnStart: true,
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 把 schemastery volatile 访问器（带 get()）还原成普通值。 */
export function unwrapConfig(value, depth = 0) {
  if (depth > 8 || value === null || typeof value !== 'object' || Array.isArray(value)) return value
  if (typeof value.get === 'function') {
    try {
      return unwrapConfig(value.get(), depth + 1)
    } catch {
      return value
    }
  }
  const result = {}
  for (const [key, child] of Object.entries(value)) result[key] = unwrapConfig(child, depth + 1)
  return result
}

function positiveInt(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  const integer = Math.trunc(parsed)
  if (integer < min) return fallback
  return Math.min(integer, max)
}

/** dshHome：优先 DSH_HOME，其次 ~/.dsh（契约 3.4）。 */
export function resolveDshHome(env = process.env, homedir = os.homedir()) {
  const fromEnv = typeof env?.DSH_HOME === 'string' ? env.DSH_HOME.trim() : ''
  if (fromEnv.length > 0) return fromEnv
  try {
    const profile = typeof homedir === 'string' && homedir.length > 0 ? homedir : os.homedir()
    return path.join(profile, '.dsh')
  } catch {
    return path.join('.', '.dsh')
  }
}

/** 默认缓存路径。 */
export function defaultCacheFile(env = process.env, homedir = os.homedir()) {
  return path.join(resolveDshHome(env, homedir), CACHE_RELATIVE_PATH)
}

function localTimeZone() {
  try {
    const name = Intl.DateTimeFormat().resolvedOptions().timeZone
    return typeof name === 'string' && name.length > 0 ? name : undefined
  } catch {
    return undefined
  }
}

/**
 * 归一化插件配置。
 * @param {object} raw - cordis 传入的 config（可能是普通对象或访问器）。
 * @param {{env?: object, homedir?: string}} [options] - 测试注入用。
 * @returns {object} 完整配置（含 cacheFile / timeZone）。
 */
export function resolveConfig(raw, options = {}) {
  const input = isRecord(raw) ? unwrapConfig(raw) : {}
  const env = options.env ?? process.env
  const homedir = options.homedir ?? os.homedir()
  const usdToCnyInput = typeof input.usdToCny === 'number' ? input.usdToCny : Number(input.usdToCny)
  return {
    prices: normalizePrices(input.prices),
    currency:
      typeof input.currency === 'string' && input.currency.trim().length > 0
        ? input.currency.trim().toUpperCase()
        : DEFAULT_CONFIG.currency,
    usdToCny:
      Number.isFinite(usdToCnyInput) && usdToCnyInput >= 0 ? usdToCnyInput : DEFAULT_CONFIG.usdToCny,
    readConcurrency: positiveInt(input.readConcurrency, DEFAULT_CONFIG.readConcurrency, { min: 1, max: 16 }),
    refreshIntervalMs: positiveInt(input.refreshIntervalMs, DEFAULT_CONFIG.refreshIntervalMs, {
      min: 50,
      max: 24 * 60 * 60 * 1000,
    }),
    refreshOnStart: input.refreshOnStart !== false,
    cacheFile:
      typeof input.cacheFile === 'string' && input.cacheFile.trim().length > 0
        ? input.cacheFile.trim()
        : defaultCacheFile(env, homedir),
    timeZone:
      typeof input.timeZone === 'string' && input.timeZone.trim().length > 0
        ? input.timeZone.trim()
        : localTimeZone(),
  }
}
