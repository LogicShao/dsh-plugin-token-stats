#!/usr/bin/env node
/**
 * dsh-plugin-token-stats — browser bundle tests (node:vm fake host).
 *
 * Run the suite:
 *   node dsh-plugin-token-stats/test/client.test.mjs
 *
 * Emit standalone preview pages for visual review (Edge headless screenshots):
 *   node dsh-plugin-token-stats/test/client.test.mjs --emit-preview <dir>
 *
 * The fake host mirrors CONTRACT.md §5.6: capture window.__ModuleLoader__.load,
 * provide stub react / jsx-runtime / client-store / primitives modules, and drive
 * the real bundle with a fake cordis ctx (slots.register records, slots.inject
 * fires immediately, locale.register records dictionaries, effect runs eagerly).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const BUNDLE_PATH = path.join(REPO, "lib", "client.js");
const BUNDLE_SOURCE = fs.readFileSync(BUNDLE_PATH, "utf8");

const BASELINE_MODULES = new Set([
  "react",
  "react/jsx-runtime",
  "react-dom",
  "react-dom/client",
  "@deepseek-ai/cordis",
  "zod",
  "@tanstack/react-virtual",
  "@deepseek-ai/dsh-client-store",
  "@deepseek-ai/dsh-client-ui-slots",
  "@deepseek-ai/dsh-client-ui-primitives",
  "@deepseek-ai/dsh-client-ui-dockkit",
]);

const EXPECTED_MODULES = [
  "@deepseek-ai/dsh-client-store",
  "@deepseek-ai/dsh-client-ui-primitives",
  "react",
  "react/jsx-runtime",
];

// ---------------------------------------------------------------------------
// Fixtures (CONTRACT §3.2 wire schema)
// ---------------------------------------------------------------------------
function totals(overrides = {}) {
  return {
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    ...overrides,
  };
}

function metric(overrides = {}) {
  return {
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    ...overrides,
  };
}

function buildDaily() {
  const days = [];
  for (let index = 0; index < 30; index += 1) {
    const day = new Date(Date.UTC(2026, 8, 27 + index));
    const iso = `${day.getUTCFullYear()}-${String(day.getUTCMonth() + 1).padStart(2, "0")}-${String(day.getUTCDate()).padStart(2, "0")}`;
    const tokens = index === 7 || index === 16 ? 0 : 40000 + index * 3700 + (index % 5) * 9000;
    const costUsd = Math.round((tokens / 1e6) * 3.2 * 1e6) / 1e6;
    days.push({
      day: iso,
      totals: metric({ requests: 4 + (index % 9), inputTokens: 400 + index * 3, outputTokens: 1600 + index * 40, cacheReadTokens: Math.max(0, tokens - 2000), totalTokens: tokens }),
      costUsd,
      costCny: Math.round(costUsd * 7.1 * 1e6) / 1e6,
    });
  }
  return days;
}

function buildSessions() {
  const rows = [
    {
      id: "session-2913a1",
      title: "实现 token-stats 浏览器侧仪表盘",
      cwd: "D:\\proj\\agent_workspace",
      project: "agent_workspace",
      createdAt: Date.UTC(2026, 9, 20, 9, 14, 0),
      lastActivity: Date.UTC(2026, 9, 26, 14, 33, 0),
      totals: metric({ requests: 186, inputTokens: 5200, outputTokens: 64000, cacheReadTokens: 1800000, totalTokens: 1869200 }),
      costUsd: 4.8123,
      costCny: 34.1673,
      primaryModel: "opencode-go/deepseek-v4.1-flash",
      live: true,
      parentSession: null,
      isSubagent: false,
    },
    {
      id: "session-2913a2",
      title: null,
      cwd: "D:\\proj\\agent_workspace",
      project: "agent_workspace",
      createdAt: Date.UTC(2026, 9, 21, 10, 30, 0),
      lastActivity: Date.UTC(2026, 9, 25, 22, 10, 0),
      totals: metric({ requests: 94, inputTokens: 2100, outputTokens: 24000, cacheReadTokens: 720000, totalTokens: 746100 }),
      costUsd: 1.9211,
      costCny: 13.6398,
      primaryModel: "opencode-go/deepseek-v4-flash",
      live: false,
      parentSession: null,
      isSubagent: false,
    },
    {
      id: "session-2913a3",
      title: "Host 路由与索引缓存",
      cwd: "D:\\proj\\dsh",
      project: "dsh",
      createdAt: Date.UTC(2026, 9, 22, 11, 5, 0),
      lastActivity: Date.UTC(2026, 9, 25, 19, 40, 0),
      totals: metric({ requests: 41, inputTokens: 900, outputTokens: 12000, cacheReadTokens: 310000, totalTokens: 322900 }),
      costUsd: 0.8422,
      costCny: 5.9796,
      primaryModel: "opencode-go/deepseek-v4.1-flash",
      live: false,
      parentSession: "session-2913a1",
      isSubagent: true,
    },
    {
      id: "session-2913a4",
      title: "Review pricing table",
      cwd: "D:\\proj\\dsh",
      project: "dsh",
      createdAt: Date.UTC(2026, 9, 23, 8, 20, 0),
      lastActivity: Date.UTC(2026, 9, 24, 18, 15, 0),
      totals: metric({ requests: 22, inputTokens: 400, outputTokens: 6000, cacheReadTokens: 120000, totalTokens: 126400 }),
      costUsd: 0.3129,
      costCny: 2.2216,
      primaryModel: "opencode-go/deepseek-v4-flash",
      live: false,
      parentSession: null,
      isSubagent: false,
    },
    {
      id: "session-2913a5",
      title: "文档与 README 整理",
      cwd: "D:\\proj\\docs",
      project: "docs",
      createdAt: Date.UTC(2026, 9, 24, 7, 45, 0),
      lastActivity: Date.UTC(2026, 9, 24, 12, 30, 0),
      totals: metric({ requests: 12, inputTokens: 220, outputTokens: 2600, cacheReadTokens: 52000, totalTokens: 54820 }),
      costUsd: 0.1211,
      costCny: 0.8598,
      primaryModel: "deepseek-account/deepseek-flash",
      live: false,
      parentSession: null,
      isSubagent: false,
    },
    {
      id: "session-2913a6",
      title: "CSV 导出与空态",
      cwd: "D:\\proj\\docs",
      project: "docs",
      createdAt: Date.UTC(2026, 9, 25, 9, 5, 0),
      lastActivity: Date.UTC(2026, 9, 25, 11, 20, 0),
      totals: metric({ requests: 8, inputTokens: 120, outputTokens: 1500, cacheReadTokens: 21000, totalTokens: 22620 }),
      costUsd: 0.0524,
      costCny: 0.3720,
      primaryModel: "deepseek-account/deepseek-flash",
      live: false,
      parentSession: null,
      isSubagent: false,
    },
    {
      id: "session-2913a7",
      title: "夜间批处理",
      cwd: "D:\\proj\\agent_workspace",
      project: "agent_workspace",
      createdAt: Date.UTC(2026, 9, 25, 20, 0, 0),
      lastActivity: Date.UTC(2026, 9, 25, 21, 10, 0),
      totals: metric({ requests: 5, inputTokens: 60, outputTokens: 800, cacheReadTokens: 9000, totalTokens: 9860 }),
      costUsd: 0.0212,
      costCny: 0.1505,
      primaryModel: "opencode-go/deepseek-v4.1-flash",
      live: false,
      parentSession: null,
      isSubagent: false,
    },
    {
      id: "session-2913a8",
      title: "快速问答",
      cwd: "D:\\proj\\agent_workspace",
      project: "agent_workspace",
      createdAt: Date.UTC(2026, 9, 25, 21, 10, 0),
      lastActivity: Date.UTC(2026, 9, 26, 8, 5, 0),
      totals: metric({ requests: 3, inputTokens: 30, outputTokens: 400, cacheReadTokens: 3000, totalTokens: 3430 }),
      costUsd: 0.0094,
      costCny: 0.0667,
      primaryModel: "opencode-go/deepseek-v4.1-flash",
      live: false,
      parentSession: null,
      isSubagent: false,
    },
  ];
  return rows;
}

function buildMockSummary() {
  return {
    version: 1,
    generatedAt: Date.UTC(2026, 9, 26, 7, 42, 0),
    timeZone: "Asia/Shanghai",
    index: { sessions: 12, events: 4000, building: false, stale: false, cacheFile: "D:\\dsh\\plugin-data\\usage-index.v1.json" },
    range: { days: 30, startDay: "2026-09-27", endDay: "2026-10-26" },
    totals: {
      requests: 323,
      inputTokens: 12000,
      outputTokens: 82000,
      cacheReadTokens: 4100000,
      cacheWriteTokens: 2000,
      reasoningTokens: 0,
      totalTokens: 4200000,
      sessions: 12,
      activeDays: 18,
      firstDay: "2026-09-27",
      lastDay: "2026-10-26",
      costUsd: 8.0923,
      costCny: 57.4553,
    },
    today: {
      day: "2026-10-26",
      totals: metric({ requests: 21, inputTokens: 800, outputTokens: 5200, cacheReadTokens: 240000, totalTokens: 246000 }),
      costUsd: 0.4212,
      costCny: 2.9905,
    },
    yesterday: {
      day: "2026-10-25",
      totals: metric({ requests: 17, inputTokens: 620, outputTokens: 4100, cacheReadTokens: 180000, totalTokens: 184720 }),
      costUsd: 0.3238,
      costCny: 2.2990,
    },
    last7Days: {
      totals: metric({ requests: 118, inputTokens: 4200, outputTokens: 29000, cacheReadTokens: 1420000, totalTokens: 1453200 }),
      costUsd: 2.8121,
      costCny: 19.9659,
    },
    last30Days: {
      totals: metric({ requests: 323, inputTokens: 12000, outputTokens: 82000, cacheReadTokens: 4100000, totalTokens: 4200000 }),
      costUsd: 8.0923,
      costCny: 57.4553,
    },
    daily: buildDaily(),
    byModel: [
      {
        key: "opencode-go/deepseek-v4.1-flash",
        provider: "opencode-go",
        model: "deepseek-v4.1-flash",
        priced: true,
        totals: metric({ requests: 201, inputTokens: 8000, outputTokens: 54000, cacheReadTokens: 2500000, totalTokens: 2562000 }),
        costUsd: 5.0183,
        costCny: 35.6299,
        share: 0.61,
      },
      {
        key: "opencode-go/deepseek-v4-flash",
        provider: "opencode-go",
        model: "deepseek-v4-flash",
        priced: true,
        totals: metric({ requests: 87, inputTokens: 3200, outputTokens: 21000, cacheReadTokens: 1280000, totalTokens: 1304200 }),
        costUsd: 2.4212,
        costCny: 17.1905,
        share: 0.31,
      },
      {
        key: "deepseek-account/deepseek-flash",
        provider: "deepseek-account",
        model: "deepseek-flash",
        priced: false,
        totals: metric({ requests: 35, inputTokens: 800, outputTokens: 7000, cacheReadTokens: 320000, totalTokens: 333800 }),
        costUsd: 0,
        costCny: 0,
        share: 0.08,
      },
    ],
    byProject: [
      {
        cwd: "D:\\proj\\agent_workspace",
        name: "agent_workspace",
        sessions: 7,
        totals: metric({ requests: 188, inputTokens: 7000, outputTokens: 48000, cacheReadTokens: 2500000, totalTokens: 2555000 }),
        costUsd: 5.4221,
        costCny: 38.4970,
      },
      {
        cwd: "D:\\proj\\dsh",
        name: "dsh",
        sessions: 3,
        totals: metric({ requests: 76, inputTokens: 2600, outputTokens: 19000, cacheReadTokens: 940000, totalTokens: 961600 }),
        costUsd: 1.8834,
        costCny: 13.3721,
      },
      {
        cwd: "D:\\proj\\docs",
        name: "docs",
        sessions: 2,
        totals: metric({ requests: 59, inputTokens: 2400, outputTokens: 15000, cacheReadTokens: 660000, totalTokens: 677400 }),
        costUsd: 0.7868,
        costCny: 5.5862,
      },
    ],
    sessions: buildSessions(),
    highlights: {
      streakDays: 6,
      busiestDay: { day: "2026-10-20", totalTokens: 182000, costUsd: 0.5321 },
      longestSession: { id: "session-2913a1", title: "实现 token-stats 浏览器侧仪表盘", project: "agent_workspace", totalTokens: 1869200, costUsd: 4.8123 },
      avgTokensPerRequest: 13003.1,
      cacheHitRate: 0.865,
      topModel: { key: "opencode-go/deepseek-v4.1-flash", totalTokens: 2562000, share: 0.61 },
      projectedMonthUsd: 12.47,
    },
    prices: {
      currency: "USD",
      usdToCny: 7.1,
      matchedModels: 2,
      unmatchedModels: ["deepseek-account/deepseek-flash"],
      timeAware: true,
      peakWindow: "北京时间周一至周五 09:00-12:00、14:00-18:00（UTC 01:00-04:00、06:00-10:00），周末与其余时段为闲时",
    },
  };
}

function buildEmptySummary() {
  const day = "2026-10-26";
  return {
    version: 1,
    generatedAt: Date.UTC(2026, 9, 26, 7, 42, 0),
    timeZone: "Asia/Shanghai",
    index: { sessions: 0, events: 0, building: false, stale: false, cacheFile: null },
    range: { days: 30, startDay: "2026-09-27", endDay: day },
    totals: {
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
      sessions: 0,
      activeDays: 0,
      firstDay: day,
      lastDay: day,
      costUsd: 0,
      costCny: 0,
    },
    today: { day, totals: metric(), costUsd: 0, costCny: 0 },
    yesterday: { day: "2026-10-25", totals: metric(), costUsd: 0, costCny: 0 },
    last7Days: { totals: metric(), costUsd: 0, costCny: 0 },
    last30Days: { totals: metric(), costUsd: 0, costCny: 0 },
    daily: [],
    byModel: [],
    byProject: [],
    sessions: [],
    highlights: {
      streakDays: 0,
      busiestDay: 0,
      longestSession: null,
      avgTokensPerRequest: 0,
      cacheHitRate: 0,
      topModel: null,
      projectedMonthUsd: 0,
    },
    prices: { currency: "USD", usdToCny: 7.1, matchedModels: 0, unmatchedModels: [] },
  };
}

const MOCK_SUMMARY = buildMockSummary();
const EMPTY_SUMMARY = buildEmptySummary();
const clone = (value) => JSON.parse(JSON.stringify(value));

function flush(times = 4) {
  let chain = Promise.resolve();
  for (let index = 0; index < times; index += 1) {
    chain = chain.then(() => new Promise((resolve) => setTimeout(resolve, 0)));
  }
  return chain;
}

// ---------------------------------------------------------------------------
// Fake host
// ---------------------------------------------------------------------------
function createFakeRequire(host) {
  const jsxRuntime = {
    Fragment: Symbol.for("react.fragment"),
    jsx: (type, props, key) => ({ type, props: props === undefined ? {} : props, key }),
    jsxs: (type, props, key) => ({ type, props: props === undefined ? {} : props, key }),
    jsxDEV: (type, props, key) => ({ type, props: props === undefined ? {} : props, key }),
  };
  const reactStub = {
    Fragment: Symbol.for("react.fragment"),
    version: "18.3.1",
    createElement: (type, props, ...children) => ({
      type,
      props: { ...(props || {}), ...(children.length === 0 ? {} : { children: children.length === 1 ? children[0] : children }) },
    }),
    useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}],
    useEffect: () => {},
    useLayoutEffect: () => {},
    useMemo: (factory) => factory(),
    useCallback: (callback) => callback,
    useRef: (initial) => ({ current: initial }),
    useId: () => "test-id",
  };
  const storeStub = {
    createSnapshotStore(initial) {
      let snapshot = initial;
      const listeners = new Set();
      return {
        getSnapshot() {
          return snapshot;
        },
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        update(mutator) {
          const draft = { ...snapshot };
          mutator(draft);
          snapshot = draft;
          for (const listener of [...listeners]) listener();
        },
        set(value) {
          snapshot = value;
          for (const listener of [...listeners]) listener();
        },
      };
    },
  };
  const primitivesStub = host.primitives || {
    Modal(props) {
      if (props.open !== true) return null;
      return {
        type: "div",
        props: {
          className: "test-modal",
          "aria-label": props.title,
          children: props.children,
        },
      };
    },
  };
  return (id) => {
    host.requiredIds.push(id);
    if (id === "react") return reactStub;
    if (id === "react/jsx-runtime") return jsxRuntime;
    if (id === "@deepseek-ai/dsh-client-store") return storeStub;
    if (id === "@deepseek-ai/dsh-client-ui-primitives") return primitivesStub;
    throw new Error(`bundle required a module outside the baseline: ${id}`);
  };
}

function createHost(options = {}) {
  const host = {
    bundleModule: null,
    bundleDefinition: null,
    requiredIds: [],
    fetched: [],
    fetchHandler: options.fetchHandler || (() => Promise.resolve({
      ok: true,
      status: 200,
      json: async () => clone(MOCK_SUMMARY),
      text: async () => "",
    })),
    intervals: [],
    clearedIntervals: [],
    listeners: new Map(),
    styles: [],
    downloads: [],
    revokedUrls: [],
    urlSequence: 0,
    document: null,
    primitives: options.primitives,
  };

  const documentStub = {
    visibilityState: "visible",
    hidden: false,
    head: {
      appendChild(node) {
        host.styles.push(node);
      },
    },
    body: { appendChild() {} },
    createElement(tag) {
      if (tag === "a") {
        return {
          href: "",
          download: "",
          rel: "",
          click() {
            host.downloads.push({ href: this.href, download: this.download });
          },
        };
      }
      const node = { tagName: String(tag).toUpperCase(), dataset: {}, textContent: "" };
      return node;
    },
    querySelector() {
      return null;
    },
    addEventListener(type, listener) {
      host.listeners.set(type, listener);
    },
    removeEventListener(type) {
      host.listeners.delete(type);
    },
  };
  host.document = documentStub;

  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    document: documentStub,
    URL: {
      createObjectURL() {
        host.urlSequence += 1;
        return `blob:preview-${host.urlSequence}`;
      },
      revokeObjectURL(url) {
        host.revokedUrls.push(url);
      },
    },
    Blob: class BlobStub {
      constructor(parts, init) {
        this.parts = parts;
        this.type = init && init.type;
      }
    },
    setInterval(callback, ms) {
      host.intervals.push({ callback, ms });
      return host.intervals.length;
    },
    clearInterval(id) {
      host.clearedIntervals.push(id);
    },
    fetch(url) {
      host.fetched.push(url);
      return host.fetchHandler(url);
    },
    window: {
      __ModuleLoader__: {
        load(definition) {
          host.bundleDefinition = definition;
        },
      },
    },
  };

  const context = vm.createContext(sandbox);
  vm.runInContext(BUNDLE_SOURCE, context, { filename: "dsh-plugin-token-stats/lib/client.js" });

  assert.ok(host.bundleDefinition, "bundle must call window.__ModuleLoader__.load");
  const fakeRequire = createFakeRequire(host);
  host.bundleModule = host.bundleDefinition.factory(fakeRequire);
  host.context = context;
  return host;
}

function createFakeCtx(host) {
  const ctx = {
    registeredSlots: [],
    slotInjections: [],
    locales: {},
    effects: [],
    effect(callback, label) {
      const cleanup = callback();
      host.effects = ctx.effects;
      ctx.effects.push({ label, cleanup });
      return cleanup;
    },
    slots: {
      inject(name, callback) {
        ctx.slotInjections.push(name);
        return callback();
      },
      register(options, component) {
        ctx.registeredSlots.push({ options, component });
        return () => {};
      },
    },
    locale: {
      register(namespace, dictionaries) {
        ctx.locales[namespace] = dictionaries;
        return () => {
          delete ctx.locales[namespace];
        };
      },
      bind(namespace) {
        return (key, params) => {
          const bundle = ctx.locales[namespace] || {};
          const dictionary = bundle.zh || {};
          const template = dictionary[key] === undefined ? key : dictionary[key];
          if (!params) return template;
          return String(template).replace(/\{([A-Za-z0-9_]+)\}/g, (match, name) => (params[name] === undefined ? match : String(params[name])));
        };
      },
    },
  };
  host.ctx = ctx;
  return ctx;
}

async function startHost(options = {}) {
  const host = createHost(options);
  host.exports = host.bundleModule;
  host.ctx = createFakeCtx(host);
  host.exports.apply(host.ctx);
  await flush();
  return host;
}

function findRegistration(host, name) {
  const registration = host.ctx.registeredSlots.find((entry) => entry.options.name === name);
  assert.ok(registration, `expected a ${name} registration`);
  return registration;
}

function hookProps(face) {
  const props = { ...face };
  const hooks = face.hooks || {};
  for (const name of Object.keys(hooks)) {
    const source = hooks[name];
    const hookName = "use" + name.charAt(0).toUpperCase() + name.slice(1);
    props[hookName] = (selector) => selector(source.getSnapshot());
  }
  return props;
}

function tFor(host, locale = "zh") {
  const dictionaries = host.ctx.locales["token-stats"];
  assert.ok(dictionaries, "locale namespace must be registered");
  const dictionary = dictionaries[locale];
  return (key, params) => {
    const template = dictionary[key] === undefined ? key : dictionary[key];
    if (!params) return template;
    return String(template).replace(/\{([A-Za-z0-9_]+)\}/g, (match, name) => (params[name] === undefined ? match : String(params[name])));
  };
}

function setStoreState(host, patch) {
  const registration = findRegistration(host, "settings.section");
  const face = registration.options.inject();
  const store = face.hooks.stats;
  store.update((draft) => Object.assign(draft, patch));
  return store;
}

function renderRegistration(host, name, extraProps = {}, locale = "zh") {
  const registration = findRegistration(host, name);
  const face = registration.options.inject();
  const props = {
    ...hookProps(face),
    t: tFor(host, locale),
    ...extraProps,
  };
  return host.exports.__test.renderElement({ type: registration.component, props });
}

// ---------------------------------------------------------------------------
// Preview pages (visual acceptance)
// ---------------------------------------------------------------------------
const PREVIEW_THEME = {
  light: [
    "--dsw-alias-bg-base:#ffffff",
    "--dsw-alias-bg-layer-1:#ffffff",
    "--dsw-alias-bg-layer-2:#ffffff",
    "--dsw-alias-bg-layer-3:#ffffff",
    "--dsw-alias-border-l2:#0000001a",
    "--dsw-alias-border-l3:#0000001f",
    "--dsw-alias-label-primary:#0f1115",
    "--dsw-alias-label-secondary:#61666b",
    "--dsw-alias-label-tertiary:#81858c",
    "--dsw-alias-label-caption:#adb2b8",
    "--dsw-alias-brand-primary:#0f1115",
    "--dsw-alias-state-success-primary:#22c55e",
    "--dsw-alias-state-warn-primary:#f59e0b",
    "--dsw-alias-interactive-bg-hover:#2631480f",
    "--dsw-alias-settings-card-fill:#ffffff",
    "--dsw-alias-settings-card-stroke:#00000029",
  ],
  dark: [
    "--dsw-alias-bg-base:#151517",
    "--dsw-alias-bg-layer-1:#232324",
    "--dsw-alias-bg-layer-2:#2c2c2e",
    "--dsw-alias-bg-layer-3:#353638",
    "--dsw-alias-border-l2:#ffffff1f",
    "--dsw-alias-border-l3:#ffffff29",
    "--dsw-alias-label-primary:#f9fafb",
    "--dsw-alias-label-secondary:#cfd3d6",
    "--dsw-alias-label-tertiary:#adb2b8",
    "--dsw-alias-label-caption:#81858c",
    "--dsw-alias-brand-primary:#f9fafb",
    "--dsw-alias-state-success-primary:#22c55e",
    "--dsw-alias-state-warn-primary:#f59e0b",
    "--dsw-alias-interactive-bg-hover:#ffffff14",
    "--dsw-alias-settings-card-fill:#2c2c2e",
    "--dsw-alias-settings-card-stroke:#ffffff29",
  ],
};

function wrapPreviewPage(fragment, theme) {
  const variables = (PREVIEW_THEME[theme] || PREVIEW_THEME.light).join(";");
  return [
    "<!doctype html>",
    '<html lang="zh-CN"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<title>dsh-plugin-token-stats preview</title>",
    `<style>:root{${variables}}html,body{margin:0;padding:0;background:var(--dsw-alias-bg-base)}</style>`,
    "</head><body>",
    fragment,
    "</body></html>",
  ].join("\n");
}

const emitIndex = process.argv.indexOf("--emit-preview");
if (emitIndex !== -1) {
  const outDir = path.resolve(process.argv[emitIndex + 1] || path.join(REPO, "tmp-preview"));
  fs.mkdirSync(outDir, { recursive: true });
  const host = createHost();
  const mod = host.bundleModule;
  const screen = (name, summary, options, theme) => {
    const fragment = mod.__test.previewHtml(summary, options);
    const file = path.join(outDir, `preview-${name}-${theme}.html`);
    fs.writeFileSync(file, wrapPreviewPage(fragment, theme), "utf8");
    console.log(`wrote ${file} (${fragment.length} B)`);
  };
  const loadingState = {
    open: false,
    days: 30,
    status: "loading",
    data: null,
    error: null,
    updatedAt: 0,
    lastFetchAt: 0,
    refreshing: false,
  };
  const errorState = {
    open: false,
    days: 30,
    status: "error",
    data: null,
    error: "HTTP 503: session persistence is not available",
    updatedAt: 0,
    lastFetchAt: 0,
    refreshing: false,
  };
  screen("ready-zh", MOCK_SUMMARY, { locale: "zh" }, "light");
  screen("ready-zh", MOCK_SUMMARY, { locale: "zh" }, "dark");
  screen("ready-en", MOCK_SUMMARY, { locale: "en" }, "light");
  screen("empty-zh", EMPTY_SUMMARY, { locale: "zh" }, "light");
  screen("loading-zh", null, { locale: "zh", state: loadingState }, "light");
  screen("error-zh", null, { locale: "zh", state: errorState }, "light");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
test("bundle wraps a classic ModuleLoader factory for dsh-plugin-token-stats", async () => {
  const host = createHost();
  assert.equal(host.bundleDefinition.id, "dsh-plugin-token-stats");
  assert.equal(typeof host.bundleDefinition.factory, "function");
  assert.equal(typeof host.bundleModule.apply, "function");
  assert.equal(typeof host.bundleModule.inject, "object");
  assert.deepEqual([...host.bundleModule.inject].sort(), ["locale", "slots"]);
});

test("only baseline module ids are required", async () => {
  const host = createHost();
  for (const id of host.requiredIds) {
    assert.ok(BASELINE_MODULES.has(id), `required id is not in the platform module table: ${id}`);
  }
  assert.deepEqual([...new Set(host.requiredIds)].sort(), EXPECTED_MODULES);
});

test("styles are injected once with the ts_ prefix and theme variables", async () => {
  const host = startHostSync();
  assert.equal(host.styles.length, 1, "one <style> tag must be injected");
  const tag = host.styles[0];
  assert.equal(tag.dataset.plugin, "dsh-plugin-token-stats");
  assert.equal(tag.dataset.pluginCss, "dsh-plugin-token-stats/dashboard.css");
  assert.match(tag.textContent, /\.ts_/);
  assert.match(tag.textContent, /--dsw-alias-label-primary/);
  assert.doesNotMatch(tag.textContent, /#[0-9a-f]{3,8}\b/i, "no hard-coded hex colors in the stylesheet");
});

test("apply registers settings.section, shell.overlay, and sidebar.footer.action", async () => {
  const host = await startHost();
  const names = host.ctx.registeredSlots.map((entry) => entry.options.name);
  assert.ok(names.includes("settings.section"));
  assert.ok(names.includes("shell.overlay"));
  assert.ok(names.includes("sidebar.footer.action"));
  assert.deepEqual([...new Set(names)].sort(), ["settings.section", "shell.overlay", "sidebar.footer.action"]);

  const section = findRegistration(host, "settings.section");
  assert.equal(section.options.id, "token-stats");
  assert.equal(section.options.order, 45);
  assert.equal(section.options.locale, "token-stats");
  assert.equal(typeof section.options.label, "function");
  assert.equal(section.options.label(), "Token 用量");
  assert.equal(typeof section.options.inject, "function");
  assert.equal(typeof section.component, "function");

  const overlay = findRegistration(host, "shell.overlay");
  assert.equal(overlay.options.id, "token-stats");
  assert.equal(overlay.options.locale, "token-stats");

  const footer = findRegistration(host, "sidebar.footer.action");
  assert.equal(footer.options.id, "token-stats");
  assert.equal(footer.options.label(), "Token 用量");
  assert.deepEqual(host.ctx.slotInjections.sort(), ["settings.section", "shell.overlay", "sidebar.footer.action"]);
  for (const registration of host.ctx.registeredSlots) {
    const face = registration.options.inject();
    assert.equal(typeof face, "object");
  }
});

test("locale dictionaries are symmetric, complete, and cover every literal t() key", async () => {
  const host = await startHost();
  const dictionaries = host.ctx.locales["token-stats"];
  assert.ok(dictionaries);
  const zhKeys = Object.keys(dictionaries.zh).sort();
  const enKeys = Object.keys(dictionaries.en).sort();
  assert.deepEqual(zhKeys, enKeys, "zh and en must expose the same key set");
  assert.ok(zhKeys.length >= 40, `expected a full dictionary, got ${zhKeys.length} keys`);
  for (const key of zhKeys) {
    assert.equal(typeof dictionaries.zh[key], "string", `zh.${key} must be a string`);
    assert.equal(typeof dictionaries.en[key], "string", `en.${key} must be a string`);
    assert.notEqual(dictionaries.zh[key].trim(), "", `zh.${key} must not be empty`);
    assert.notEqual(dictionaries.en[key].trim(), "", `en.${key} must not be empty`);
  }
  const literalKeys = new Set();
  const pattern = /\bt\("([A-Za-z0-9_]+)"/g;
  let match = pattern.exec(BUNDLE_SOURCE);
  while (match !== null) {
    literalKeys.add(match[1]);
    match = pattern.exec(BUNDLE_SOURCE);
  }
  assert.ok(literalKeys.size >= 40, `expected many literal t() keys, got ${literalKeys.size}`);
  for (const key of literalKeys) {
    assert.ok(dictionaries.zh[key] !== undefined, `zh dictionary missing t() key: ${key}`);
    assert.ok(dictionaries.en[key] !== undefined, `en dictionary missing t() key: ${key}`);
  }
});

test("polling uses a document-relative route, 30s cadence, and pauses while hidden", async () => {
  const host = await startHost();
  assert.equal(host.fetched.length, 1, "apply must fetch once immediately");
  assert.equal(host.fetched[0], "api/token-stats.summary?days=30");
  assert.equal(host.intervals.length, 1, "one polling interval must be scheduled");
  assert.equal(host.intervals[0].ms, 30000);
  assert.ok(host.listeners.has("visibilitychange"), "visibilitychange must be observed");

  host.document.visibilityState = "hidden";
  host.document.hidden = true;
  host.intervals[0].callback();
  await flush();
  assert.equal(host.fetched.length, 1, "polling must pause while the document is hidden");

  host.document.visibilityState = "visible";
  host.document.hidden = false;
  host.intervals[0].callback();
  await flush();
  assert.equal(host.fetched.length, 2, "polling must resume when visible");
  assert.equal(host.fetched[1], "api/token-stats.summary?days=30");

  const resume = host.listeners.get("visibilitychange");
  resume();
  await flush();
  assert.equal(host.fetched.length, 3, "visibilitychange must refresh on resume");
});

test("range switch and manual refresh use the expected query parameters", async () => {
  const host = await startHost();
  const section = findRegistration(host, "settings.section");
  const face = section.options.inject();

  face.setDays(7);
  await flush();
  assert.equal(host.fetched[host.fetched.length - 1], "api/token-stats.summary?days=7");
  assert.equal(face.hooks.stats.getSnapshot().days, 7);

  face.refresh();
  await flush();
  assert.equal(host.fetched[host.fetched.length - 1], "api/token-stats.summary?days=7&refresh=1");

  face.setDays(0);
  await flush();
  assert.equal(host.fetched[host.fetched.length - 1], "api/token-stats.summary?days=0");
});

test("successful fetch publishes a ready snapshot with data and timestamp", async () => {
  const host = await startHost();
  const snapshot = findRegistration(host, "settings.section").options.inject().hooks.stats.getSnapshot();
  assert.equal(snapshot.status, "ready");
  assert.equal(snapshot.error, null);
  assert.equal(snapshot.data.version, 1);
  assert.equal(snapshot.data.totals.totalTokens, 4200000);
  assert.ok(snapshot.updatedAt > 0, "updatedAt must be stamped after a fetch");
});

test("transport and HTTP failures publish an error state without throwing", async () => {
  const failing = await startHost({
    fetchHandler: () => Promise.reject(new Error("network down")),
  });
  const failedSnapshot = findRegistration(failing, "settings.section").options.inject().hooks.stats.getSnapshot();
  assert.equal(failedSnapshot.status, "error");
  assert.equal(failedSnapshot.data, null);
  assert.match(failedSnapshot.error, /network down/);

  const http = await startHost({
    fetchHandler: () => Promise.resolve({
      ok: false,
      status: 503,
      json: async () => ({}),
      text: async () => '{"error":"no persistence"}',
    }),
  });
  const httpSnapshot = findRegistration(http, "settings.section").options.inject().hooks.stats.getSnapshot();
  assert.equal(httpSnapshot.status, "error");
  assert.match(httpSnapshot.error, /503/);
  assert.match(httpSnapshot.error, /no persistence/);
});

test("settings section renders the loaded dashboard", async () => {
  const host = await startHost();
  const html = renderRegistration(host, "settings.section");
  assert.match(html, /class="ts_section"/);
  assert.match(html, /class="ts_title"/);
  assert.match(html, /Token 用量统计/);
  assert.match(html, /class="ts_metric"/);
  assert.match(html, /class="ts_bar"/);
  assert.match(html, /class="ts_session"/);
  assert.match(html, /实现 token-stats 浏览器侧仪表盘/);
  assert.match(html, /deepseek-v4\.1-flash/);
  assert.match(html, /agent_workspace/);
  assert.match(html, /连续使用/);
  assert.match(html, /缓存命中率/);
  assert.match(html, /class="ts_footnote"/);
  assert.doesNotMatch(html, /正在加载用量数据/);
  // 30 daily bars for the 30-day fixture.
  assert.equal((html.match(/class="ts_bar"/g) || []).length, 30);
  // Expanded=false caps the session ranking at 20 rows; 8 fixture rows fit.
  assert.equal((html.match(/class="ts_session"/g) || []).length, 8);
  assert.match(html, /class="ts_session ts_sessionHead"/);
});

test("settings section renders loading, empty, and error states", async () => {
  const host = await startHost();

  setStoreState(host, { status: "loading", data: null, error: null, updatedAt: 0 });
  const loading = renderRegistration(host, "settings.section");
  assert.match(loading, /正在加载用量数据/);
  assert.match(loading, /class="ts_spinner"/);

  setStoreState(host, { status: "ready", data: clone(EMPTY_SUMMARY), error: null });
  const empty = renderRegistration(host, "settings.section");
  assert.match(empty, /暂无 token 用量/);
  assert.match(empty, /class="ts_empty"/);
  assert.doesNotMatch(empty, /class="ts_metric"/);

  setStoreState(host, { status: "error", data: null, error: "boom", updatedAt: 0 });
  const error = renderRegistration(host, "settings.section");
  assert.match(error, /加载用量数据失败/);
  assert.match(error, /boom/);
  assert.match(error, /class="ts_error"/);
  assert.match(error, /重试/);
});

test("sidebar footer action renders an icon rail button and a wide button", async () => {
  const host = await startHost();
  const rail = renderRegistration(host, "sidebar.footer.action", { wide: false });
  assert.match(rail, /class="ts_footer"/);
  assert.match(rail, /class="ts_footerBtn"/);
  assert.match(rail, /aria-label="Token 用量"/);
  assert.doesNotMatch(rail, /class="ts_footerLabel"/, "rail mode must not render the label");

  const wide = renderRegistration(host, "sidebar.footer.action", { wide: true });
  assert.match(wide, /class="ts_footerLabel"/);
  assert.match(wide, /Token 用量/);

  const face = findRegistration(host, "sidebar.footer.action").options.inject();
  assert.equal(typeof face.openDashboard, "function");
  face.openDashboard();
  assert.equal(findRegistration(host, "sidebar.footer.action").options.inject().hooks.stats.getSnapshot().open, true);
});

test("shell overlay renders nothing while closed and the shared dashboard while open", async () => {
  const host = await startHost();
  setStoreState(host, { open: false });
  assert.equal(renderRegistration(host, "shell.overlay"), "");

  setStoreState(host, { open: true });
  const html = renderRegistration(host, "shell.overlay");
  assert.match(html, /class="test-modal"/);
  assert.match(html, /class="ts_dash"/);
  assert.match(html, /Token 用量统计/);

  const face = findRegistration(host, "shell.overlay").options.inject();
  assert.equal(typeof face.closeDashboard, "function");
  face.closeDashboard();
  assert.equal(findRegistration(host, "shell.overlay").options.inject().hooks.stats.getSnapshot().open, false);
});

test("overlay degrades to its own modal when primitives.Modal is unavailable", async () => {
  const host = await startHost({ primitives: {} });
  setStoreState(host, { open: true });
  const html = renderRegistration(host, "shell.overlay");
  assert.match(html, /class="ts_modalMask"/);
  assert.match(html, /class="ts_modalCard"/);
  assert.match(html, /class="ts_dash"/);
  assert.match(html, /Token 用量统计/);
  assert.match(html, /关闭/);
});

test("CSV export is quoted, stable, and downloadable from memory", async () => {
  const host = await startHost();
  const mod = host.bundleModule;
  const csv = mod.__test.buildCsv(MOCK_SUMMARY);
  const lines = csv.trimEnd().split("\r\n");
  assert.equal(lines.length, MOCK_SUMMARY.sessions.length + 1);
  assert.equal(
    lines[0],
    "sessionId,title,project,model,createdAt,lastActivity,requests,inputTokens,outputTokens,cacheReadTokens,cacheWriteTokens,totalTokens,costUsd,costCny",
  );
  assert.equal(parseCsvRow(lines[1]).length, 14);
  assert.equal(parseCsvRow(lines[1])[0], "session-2913a1");

  const tricky = clone(MOCK_SUMMARY);
  tricky.sessions = [
    {
      ...tricky.sessions[0],
      id: "id,with,commas",
      title: 'quote " and, comma',
      project: "=cmd()",
    },
  ];
  const trickyCsv = mod.__test.buildCsv(tricky).trimEnd().split("\r\n");
  const cells = parseCsvRow(trickyCsv[1]);
  assert.equal(cells.length, 14);
  assert.equal(cells[0], "id,with,commas");
  assert.equal(cells[1], 'quote " and, comma');
  assert.equal(cells[2], "'=cmd()");

  assert.equal(mod.__test.csvFilename(new Date(2026, 9, 26, 10, 0, 0)), "token-stats-2026-10-26.csv");

  const face = findRegistration(host, "settings.section").options.inject();
  const returned = face.exportCsv();
  assert.equal(returned, mod.__test.buildCsv(MOCK_SUMMARY));
  assert.equal(host.downloads.length, 1);
  assert.match(host.downloads[0].href, /^blob:/);
  assert.match(host.downloads[0].download, /^token-stats-\d{4}-\d{2}-\d{2}\.csv$/);
});

test("pure helpers behave as the dashboard expects", async () => {
  const host = createHost();
  const mod = host.bundleModule;
  const helpers = mod.__test;

  assert.deepEqual([7, 30, 90, 0].map((days) => helpers.normalizeDays(days)), [7, 30, 90, 0]);
  assert.equal(helpers.normalizeDays(12), 30);
  assert.equal(helpers.normalizeDays("90"), 90);
  assert.equal(helpers.normalizeDays(undefined), 30);

  assert.equal(helpers.formatInt(0), "0");
  assert.equal(helpers.formatInt(1234567), "1,234,567");
  assert.equal(helpers.formatInt(-42), "-42");

  assert.equal(helpers.formatCompact(999), "999");
  assert.equal(helpers.formatCompact(1234), "1.2K");
  assert.equal(helpers.formatCompact(12345), "12.3K");
  assert.equal(helpers.formatCompact(123456), "123K");
  assert.equal(helpers.formatCompact(1234567), "1.2M");
  assert.equal(helpers.formatCompact(2500000000), "2.5B");

  assert.equal(helpers.formatUsd(0), "$0.00");
  assert.equal(helpers.formatUsd(0.4212), "$0.421");
  assert.equal(helpers.formatUsd(12.3456), "$12.35");
  assert.equal(helpers.formatCny(57.4553), "¥57.46");

  assert.equal(helpers.formatPercent(0.61), "61%");
  assert.equal(helpers.formatPercent(0.861), "86.1%");
  assert.equal(helpers.formatPercent(0.0005), "<0.1%");
  assert.equal(helpers.formatPercent(1), "100%");
  assert.equal(helpers.formatPercent(0), "0%");

  assert.equal(helpers.barWidth(5, 10), 50);
  assert.equal(helpers.barWidth(10, 10), 100);
  assert.equal(helpers.barWidth(-1, 10), 0);
  assert.equal(helpers.barWidth(1, 0), 0);
  assert.equal(helpers.barWidth(1, 3), 33.3);

  const colors = helpers.COLOR_TOKENS;
  assert.ok(Object.keys(colors).length >= 8);
  for (const name of Object.keys(colors)) {
    assert.match(colors[name], /^var\(--dsw-alias-[a-z0-9-]+\)$/, `color token ${name} must reference a DSH theme variable`);
  }
  assert.equal(helpers.barColor(), "var(--dsw-alias-brand-primary)");
  const halfFill = helpers.trackFillStyle(5, 10);
  assert.equal(halfFill.width, "50%");
  assert.equal(halfFill.background, "var(--dsw-alias-brand-primary)");
  const emptyFill = helpers.trackFillStyle(0, 10);
  assert.equal(emptyFill.width, "0%");
  assert.equal(emptyFill.background, "var(--dsw-alias-brand-primary)");

  assert.equal(helpers.basename("D:\\proj\\agent_workspace"), "agent_workspace");
  assert.equal(helpers.basename("/home/user/proj/"), "proj");
  assert.equal(helpers.basename(""), "");

  assert.equal(helpers.sessionTitle({ title: "  " , project: "proj" }, "untitled"), "proj");
  assert.equal(helpers.sessionTitle({ title: "T" }, "untitled"), "T");
  assert.equal(helpers.sessionTitle({ cwd: "D:\\a\\b" }, "untitled"), "b");
  assert.equal(helpers.sessionTitle({}, "untitled"), "untitled");

  assert.equal(helpers.formatDayShort("2026-10-26"), "10-26");
  assert.equal(helpers.formatDayShort(Date.UTC(2026, 9, 26, 7, 42, 0)), formatDayShortLocal(Date.UTC(2026, 9, 26, 7, 42, 0)));

  assert.equal(helpers.formatText("A {x} B {y}", { x: 1 }), "A 1 B {y}");
  assert.equal(helpers.isSummaryEmpty(null), true);
  assert.equal(helpers.isSummaryEmpty(EMPTY_SUMMARY), true);
  assert.equal(helpers.isSummaryEmpty(MOCK_SUMMARY), false);

  const makeT = (lang) => {
    const dictionary = mod.__test.locales[lang];
    return (key, params) => {
      const template = dictionary[key] === undefined ? key : dictionary[key];
      if (!params) return template;
      return String(template).replace(/\{([A-Za-z0-9_]+)\}/g, (match, name) => (params[name] === undefined ? match : String(params[name])));
    };
  };
  const zhT = makeT("zh");
  const enT = makeT("en");
  assert.equal(helpers.isCjkText("北京时间周一"), true);
  assert.equal(helpers.isCjkText("Beijing time"), false);

  const hostWindow = "北京时间周一至周五 09:00-12:00 为高峰，其余为闲时";
  const zhNote = helpers.pricingWindowNote(zhT, { peakWindow: hostWindow });
  assert.match(zhNote.text, /北京时间周一至周五 09:00-12:00 为高峰/);
  assert.equal(zhNote.title, "");
  const enNote = helpers.pricingWindowNote(enT, { peakWindow: hostWindow });
  assert.equal(enNote.text, mod.__test.locales.en.timeAwareNote);
  assert.equal(enNote.title, hostWindow);
  const latinWindow = helpers.pricingWindowNote(enT, { peakWindow: "weekdays 09:00-12:00, 14:00-18:00" });
  assert.match(latinWindow.text, /weekdays 09:00-12:00/);
  assert.equal(latinWindow.title, "");
  const absentWindow = helpers.pricingWindowNote(zhT, {});
  assert.equal(absentWindow.text, mod.__test.locales.zh.timeAwareNote);
  assert.equal(absentWindow.title, "");
});

test("previewHtml renders the real dashboard synchronously in the ready state", async () => {
  const host = createHost();
  const mod = host.bundleModule;
  const html = mod.__test.previewHtml(MOCK_SUMMARY);
  assert.ok(html.startsWith('<style data-plugin="dsh-plugin-token-stats"'), "preview must inline the real stylesheet");
  assert.match(html, /--dsw-alias-label-primary/);
  const dom = html.slice(html.indexOf("</style>") + "</style>".length);
  assert.match(dom, /class="ts_previewRoot"/);
  assert.match(dom, /class="ts_section"/);
  assert.match(dom, /Token 用量统计/);
  assert.match(dom, /class="ts_metric"/);
  assert.match(dom, /class="ts_metricCny"/);
  assert.match(dom, /≈ ¥/);
  assert.equal((dom.match(/class="ts_bar"/g) || []).length, 30);
  assert.match(dom, /opencode-go/);
  assert.match(dom, /agent_workspace/);
  assert.match(dom, /\$4\.81|1\.9M/);
  assert.match(dom, /class="ts_timeAware"/);
  assert.match(dom, /成本按 DeepSeek 官方峰谷价估算/);
  assert.doesNotMatch(dom, /ts_spinner/);
  assert.doesNotMatch(dom, /正在加载用量数据/);

  const english = mod.__test.previewHtml(MOCK_SUMMARY, { locale: "en" });
  assert.match(english, /Token usage/);
  assert.match(english, /Export CSV/);
  assert.doesNotMatch(english, /1 models/);
  assert.match(english, /1 model lacks a price/);

  const empty = mod.__test.previewHtml(EMPTY_SUMMARY);
  assert.match(empty, /暂无 token 用量/);

  const loading = mod.__test.previewHtml(null, {
    state: { open: false, days: 30, status: "loading", data: null, error: null, updatedAt: 0, lastFetchAt: 0, refreshing: false },
  });
  assert.match(loading, /正在加载用量数据/);

  const error = mod.__test.previewHtml(null, {
    state: { open: false, days: 30, status: "error", data: null, error: "HTTP 503", updatedAt: 0, lastFetchAt: 0, refreshing: false },
  });
  assert.match(error, /加载用量数据失败/);
  assert.match(error, /HTTP 503/);
});

test("peak/off-peak pricing note renders when prices.timeAware is true", async () => {
  const host = await startHost();
  const section = renderRegistration(host, "settings.section");
  assert.match(section, /class="ts_timeAware"/);
  assert.match(section, /成本按 DeepSeek 官方峰谷价估算/);
  // The Host-provided peakWindow is authoritative and rendered verbatim.
  assert.match(section, /北京时间周一至周五 09:00-12:00、14:00-18:00/);
  assert.match(section, /周末与其余时段为闲时/);

  const english = host.bundleModule.__test.previewHtml(MOCK_SUMMARY, { locale: "en" });
  assert.match(english, /peak\/off-peak pricing/);
  // English UI keeps its localized window copy visible; the Chinese Host label rides in the tooltip.
  assert.match(english, /weekdays 09:00–12:00 and 14:00–18:00/);
  assert.match(english, /class="ts_timeAware" title="北京时间周一至周五 09:00-12:00/);
});

test("peak/off-peak pricing note falls back to the built-in window when peakWindow is absent", async () => {
  const host = await startHost();
  const withoutWindow = clone(MOCK_SUMMARY);
  delete withoutWindow.prices.peakWindow;

  const zh = host.bundleModule.__test.previewHtml(withoutWindow);
  assert.match(zh, /class="ts_timeAware"/);
  assert.match(zh, /工作日 09:00–12:00 \/ 14:00–18:00 为高峰价/);
  assert.match(zh, /其余为闲时价/);

  const en = host.bundleModule.__test.previewHtml(withoutWindow, { locale: "en" });
  assert.match(en, /weekdays 09:00–12:00 and 14:00–18:00/);
});

test("legacy summaries without prices.timeAware keep the old footnote, and priced zero-cost models render $0.00", async () => {
  const host = await startHost();

  const legacy = clone(MOCK_SUMMARY);
  delete legacy.prices.timeAware;
  const legacyHtml = host.bundleModule.__test.previewHtml(legacy);
  assert.doesNotMatch(legacyHtml, /class="ts_timeAware"/);
  assert.doesNotMatch(legacyHtml, /峰谷价/);
  assert.match(legacyHtml, /生成于/);
  assert.match(legacyHtml, /时区 Asia\/Shanghai/);
  assert.match(legacyHtml, /1 个模型未配置价格/);

  // A priced model whose cost happens to be zero is displayed as $0.00, no special case.
  const pricedZero = clone(MOCK_SUMMARY);
  pricedZero.byModel[0].priced = true;
  pricedZero.byModel[0].costUsd = 0;
  pricedZero.byModel[0].costCny = 0;
  const pricedZeroHtml = host.bundleModule.__test.previewHtml(pricedZero);
  assert.match(pricedZeroHtml, /61% · \$0\.00/);
});

test("previewHtml escapes untrusted session text", async () => {
  const host = createHost();
  const summary = clone(MOCK_SUMMARY);
  summary.sessions[0].title = '<img src=x onerror="alert(1)">';
  summary.byProject[0].name = "<script>bad</script>";
  const html = host.bundleModule.__test.previewHtml(summary);
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /<script>bad/);
  assert.match(html, /&lt;img src=x/);
  assert.match(html, /&lt;script&gt;bad/);
});

test("dispose clears the polling interval", async () => {
  const host = await startHost();
  const cleanups = host.ctx.effects.filter((entry) => typeof entry.cleanup === "function");
  assert.ok(cleanups.length >= 2, "apply must register polling and locale effects");
  for (const entry of [...cleanups].reverse()) entry.cleanup();
  assert.deepEqual(host.clearedIntervals, [1]);
  const fetchedBefore = host.fetched.length;
  host.intervals[0].callback();
  await flush();
  assert.equal(host.fetched.length, fetchedBefore, "a disposed controller must not fetch");
});

// ---------------------------------------------------------------------------
// Layout invariants (visual regression)
// ---------------------------------------------------------------------------
test("model/project rows keep a fixed value column so bars and costs align", () => {
  const host = startHostSync();
  const css = host.exports.__test.CSS_TEXT;
  // 第三列必须是固定宽度而不是 auto：auto 会让每行按自身文案宽度分列，
  // 导致不同行（如 95.5% · $41.99 与 4.5% · $0.00）的进度条起点和数字错位。
  assert.match(css, /\.ts_row\{[^}]*grid-template-columns:minmax\(0,1fr\) 88px 112px/);
  assert.doesNotMatch(css, /\.ts_row\{[^}]*grid-template-columns:minmax\(0,1fr\) 88px auto/);
  assert.match(css, /\.ts_rowValue\{[^}]*text-align:right/);
});

test("layout adapts to the actual container width (settings pane vs modal)", () => {
  const host = startHostSync();
  const css = host.exports.__test.CSS_TEXT;
  // 设置页内容区只有 ~612px，但视口可能是 1440px：必须用容器查询而不是视口媒体查询，
  // 否则 2 列卡片不堆叠，固定列会把模型/项目名字挤成 "d…"。
  assert.match(css, /\.ts_dash\{[^}]*container-type:inline-size/);
  assert.match(css, /@container tsdash \(max-width: 700px\)\{\.ts_grid2\{grid-template-columns:minmax\(0,1fr\)\}/);
  assert.match(css, /@container tsdash \(max-width: 640px\)\{\.ts_row\{grid-template-columns:minmax\(0,1fr\) 64px 96px/);
  // 柱状图 tooltip 是绝对定位：两端柱子必须贴边对齐，否则会撑大滚动宽度，
  // 让弹窗/设置页出现横向拖动（overflow-x 被计算为 auto）。
  assert.match(css, /\[data-edge=start\] \.ts_barTip\{left:0;transform:none\}/);
  assert.match(css, /\[data-edge=end\] \.ts_barTip\{left:auto;right:0;transform:none\}/);
  const html = host.bundleModule.__test.previewHtml(MOCK_SUMMARY);
  assert.match(html, /data-edge="start"/);
  assert.match(html, /data-edge="end"/);
});

// ---------------------------------------------------------------------------
// Small helpers used by tests
// ---------------------------------------------------------------------------
function startHostSync() {
  const host = createHost();
  host.exports = host.bundleModule;
  host.ctx = createFakeCtx(host);
  host.exports.apply(host.ctx);
  return host;
}

function formatDayShortLocal(value) {
  const date = new Date(value);
  return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseCsvRow(line) {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quoted) {
      if (character === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        current += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      cells.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  cells.push(current);
  return cells;
}

