# dsh-plugin-token-stats — 实现契约（v1，写作时冻结）

> 目标：统计**所有 session** 的 token 用量，并给出每日消耗、成本估算、模型/项目分布、会话排行等。
> 两个半侧：宿主侧（Node，读 session 日志 + 注册 HTTP 路由 + 注册模型工具）与浏览器侧（Web GUI 仪表盘）。
>
> 本文件是并行开发时唯一需要对齐的契约。**不要改本文件里的 wire schema**；需要扩展就加字段，不要改已有字段语义。

---

## 0. 仓库与文件所有权

仓库根：`D:\proj\agent_workspace\dsh-plugin-token-stats`

| 文件/目录 | 归属 | 说明 |
|---|---|---|
| `package.json`, `cordis.patch.yml`, `README.md`, `LICENSE`, `.gitignore` | Lead | 已就位，不要改 |
| `lib/index.js`（宿主入口） | **host-engine** | 已声明为宿主入口 |
| `lib/host/*.js` | **host-engine** | 纯函数 + 引擎 + 路由 + 工具 |
| `test/host*.test.mjs` | **host-engine** | `node --test` |
| `lib/client.js`（浏览器 bundle，单文件） | **client-ui** | 必须是手写的 ModuleLoader factory |
| `test/client*.test.mjs` | **client-ui** | VM 伪宿主测试 |
| `refs/` | Lead | 参考材料，只读 |
| `CONTRACT.md` | Lead | 只读 |

两边并行，**不要跨范围写文件**。共享数据只通过第 3 节的 JSON schema 对齐。

---

## 1. 环境事实（已核实）

- 安装的 DSH：`D:\software\ai\dsh`，运行时版本 `0.2.1-rc.3`，Electron 桌面壳 + Web GUI（`http://127.0.0.1:58223`）。
- 完整解包源码（可直接 grep/read）：`D:\proj\agent_workspace\.tmp\dsh-src\dsh\node_modules\@deepseek-ai\`
- 用户数据：`%USERPROFILE%\.dsh`；会话日志在 `.dsh\sessions\<项目目录>\<会话目录>\session.vN.jsonl.zstd`。
- 现有两个第三方插件（样式参考）：`..\dsh-plugin-context-window`、`..\dsh-plugin-opencode-go`。
- **第三方插件不能静态 import `@deepseek-ai/*` 包**（profile 里没有这些依赖，Node 解析不到）。
  - 宿主侧：只用 Node 内置模块 + `ctx.get()/ctx.inject()` 拿服务；**禁止** `import '@deepseek-ai/...'`。
  - 浏览器侧：只能 `require()` 平台静态模块表里的 id（见第 5 节）。
- 浏览器 bundle 是**构建产物格式**（不是普通 ESM），必须手写 factory 包装（见第 5 节）。

---

## 2. 宿主侧可用的服务（真实 API）

全部通过 `ctx.get('name')` 或 `ctx.inject(['name'], scope => ...)` 获取；服务缺失时插件必须降级而不是抛错。

### 2.1 `sessionPersistence`（读全量历史的主力）

源码：`.tmp/dsh-src/.../dsh-session-persistence/lib/index.js`、`dsh-session-persistence-jsonl/lib/index.js`

```js
const persistence = ctx.get('sessionPersistence')
const snaps = await persistence.list()          // 每个已落盘 session 一条快照
// snap: { header, sizeBytes, eventCount, revision, formatStatus? }
const handle = await persistence.open(id, 'read')
const { events } = await handle.read(0)         // 全量事件；events[i].seq 连续
await handle.close()
```

- `header`：`{ id, version, createdAt, cwd?, parentSession?, isSeeded, origin?, delegationDepth?, agentPreset? }`
- 事件：`{ type, seq, time, data }`
- `list()` 不读事件行，只读 header/stat，适合每轮刷新做「指纹比对」。
- 事件对象可能被 backend 冻结（`shared-frozen`），**只读不改**。
- 若 `persistence` 不存在（非 jsonl 部署），整个插件进入「无数据」空态（路由返回 503 JSON），不要崩溃。

### 2.2 `sessions`（活会话）

```js
const sessions = ctx.get('sessions')
sessions.get(id)          // 活会话或 undefined
sessions.list()           // 全部活会话
await sessions.flush(s)   // 耐久屏障：之后 persistence.open(id,'read') 至少看到已 flush 的前缀
```
活会话的 header 在 `session.header`；id 在 `session.id`。

### 2.3 `session/event` 事件流（活会话增量）

```js
ctx.on('session/event', (session, event) => { ... })
// session: 活会话对象（有 id/header）；event: { type, seq, time, data }
```
实现参考：`.tmp/dsh-src/.../dsh-session-persistence-jsonl/lib/index.js` 里 `ctx.on("session/event", ...)`。
注意：`session/event` 只在**事件提交后**触发，且同一进程内每事件一次；监听器必须自己 try/catch，不能拖垮会话。

### 2.4 `connection`（注册浏览器可访问的 HTTP 路由）

实现参考：`.tmp/dsh-src/.../dsh-session-log-export/lib/index.js`（`connectionOf(ctx).fetch.register`）。
实际写法（照抄其形状）：

```js
ctx.inject(['connection'], (scope) => {
  scope.effect(() => scope.connection.fetch.register({
    path: '/api/token-stats.summary',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request) => new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    }),
  }), 'token-stats: route')
})
```
浏览器侧按 document-relative 形式访问：`api/token-stats.summary`（**去掉开头斜杠**）。

### 2.5 `tools`（注册模型可调用的工具）

用**普通对象**注册，不要 import `defineTool`（会解析失败）。必需字段见
`.tmp/dsh-src/.../dsh-tools/lib/index.js` 的 `register(definition)`：

```js
ctx.inject(['tools'], (scope) => {
  scope.effect(() => scope.tools.register({
    name: 'token_stats',
    description: '...给模型看的中文+英文说明...',
    // parameters 是原始 JSON Schema（object-rooted），不是工具作者的 spec
    parameters: { type: 'object', properties: { ... }, required: [], additionalProperties: false },
    output: {
      schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args) { return { text: '...' } },
  }), 'token-stats: tool')
})
```
注册失败（重名/宿主校验）要 try/catch 并只 log warn，不能影响插件加载。

### 2.6 日志

`ctx.logger?.info/warn/error`。前缀统一 `token-stats: `。启动时打印一行索引概况（N sessions / M events）。

---

## 3. 数据提取与 wire schema（冻结）

### 3.1 单 session 提取（纯函数，可单测）

对每个事件只关心：

- `event.type === 'assistant/message'` 且 `event.data?.usage` 存在：
  ```jsonc
  {
    "turn": 138, "step": 3,
    "message": { "source": { "kind": "model", "provider": "opencode-go", "model": "deepseek-v4.1-flash" } },
    "usage": { "inputTokens": 245, "outputTokens": 3650, "cacheReadTokens": 655616,
               "cacheWriteTokens": 0, "totalTokens": 659511 }
  }
  ```
  字段可能缺：`cacheReadTokens` / `cacheWriteTokens` / `reasoningTokens` / `totalTokens`。
  `totalTokens` 缺失时按 `input+output+cacheRead+cacheWrite+reasoning` 兜底。
  模型：`data.message.source.provider` / `data.message.source.model`；缺失时用 `"unknown"`。
  时间：`event.time`（epoch ms）。按**宿主本地时区**分日桶。
- session 头：`header.createdAt`、`header.cwd`、`header.parentSession`。
- 标题：可选。若 `ctx.get('sessionQuery')?.readTitleSnapshots` 可用就批量取；
  否则 `title = null`，客户端用 `cwd` 的 basename + 创建日期兜底。

提取结果（每个 session 一份，进内存 index 和磁盘缓存）：

```jsonc
{
  "id": "session-2913...",
  "header": { "id": "...", "createdAt": 1791269697776, "cwd": "D:\\proj\\agent_workspace", "parentSession": null, "delegationDepth": 0 },
  "requests": 323,
  "inputTokens": 0, "outputTokens": 0, "cacheReadTokens": 0, "cacheWriteTokens": 0,
  "reasoningTokens": 0, "totalTokens": 0,
  "models": {
    "opencode-go/deepseek-v4.1-flash": { "requests": 320, "inputTokens": 1, "outputTokens": 2, "cacheReadTokens": 3, "cacheWriteTokens": 0, "reasoningTokens": 0, "totalTokens": 6 }
  },
  "daily": {
    "2026-10-26": { "requests": 3, "inputTokens": 0, "outputTokens": 0, "cacheReadTokens": 0, "cacheWriteTokens": 0, "reasoningTokens": 0, "totalTokens": 0 }
  },
  "firstTime": 1791269697776,
  "lastTime": 1791530018777,
  "fingerprint": { "sizeBytes": 123456, "eventCount": 2787, "lastSeq": 2783 },
  "cachedAt": 1791530100000
}
```

### 3.2 聚合响应（`GET /api/token-stats.summary`）

```jsonc
{
  "version": 1,
  "generatedAt": 1791530000000,
  "timeZone": "Asia/Shanghai",
  "index": { "sessions": 82, "events": 40000, "building": false, "stale": false, "cacheFile": "..." },
  "range": { "days": 30, "startDay": "2026-09-27", "endDay": "2026-10-26" },
  "totals": { "requests": 0, "inputTokens": 0, "outputTokens": 0, "cacheReadTokens": 0,
              "cacheWriteTokens": 0, "reasoningTokens": 0, "totalTokens": 0,
              "sessions": 82, "activeDays": 20, "firstDay": "2026-10-01", "lastDay": "2026-10-26",
              "costUsd": 0.0, "costCny": 0.0 },
  "today":     { "day": "2026-10-26", "totals": { }, "costUsd": 0, "costCny": 0 },
  "yesterday": { "day": "2026-10-25", "totals": { }, "costUsd": 0, "costCny": 0 },
  "last7Days": { "totals": { }, "costUsd": 0, "costCny": 0 },
  "last30Days": { "totals": { }, "costUsd": 0, "costCny": 0 },
  "daily": [ { "day": "2026-10-01", "totals": { }, "costUsd": 0, "costCny": 0 } ],   // 升序，range 内补零
  "byModel": [ { "key": "opencode-go/deepseek-v4.1-flash", "provider": "opencode-go",
                 "model": "deepseek-v4.1-flash", "priced": true,
                 "totals": { }, "costUsd": 0, "costCny": 0, "share": 0.42 } ],       // 降序
  "byProject": [ { "cwd": "D:\\proj\\agent_workspace", "name": "agent_workspace",
                   "sessions": 40, "totals": { }, "costUsd": 0, "costCny": 0 } ],    // 降序
  "sessions": [ { "id": "...", "title": null, "cwd": "D:\\...", "project": "agent_workspace",
                  "createdAt": 0, "lastActivity": 0, "totals": { }, "costUsd": 0, "costCny": 0,
                  "primaryModel": "opencode-go/deepseek-v4.1-flash", "live": false,
                  "parentSession": null, "isSubagent": false } ],                     // 降序，limit 默认 100
  "highlights": {
    "streakDays": 3,                       // 截至今天（今天没用则截至昨天）连续有使用的天数
    "busiestDay": { "day": "2026-10-20", "totalTokens": 0, "costUsd": 0 },
    "longestSession": { "id": "...", "title": null, "project": "...", "totalTokens": 0, "costUsd": 0 },
    "avgTokensPerRequest": 1234.5,
    "cacheHitRate": 0.86,                  // cacheRead / (input + cacheRead + cacheWrite)，0 时给 0
    "topModel": { "key": "...", "totalTokens": 0, "share": 0.6 },
    "projectedMonthUsd": 0.0               // 本月已花费 + 按日均外推剩余天数
  },
  "prices": { "currency": "USD", "usdToCny": 7.1, "matchedModels": 3, "unmatchedModels": ["x/y"] }
}
```

约束：
- `daily` 必须**补零**并正好覆盖 `range`（`days=0` 表示「全部历史」，从 `firstDay` 到 `endDay`）。
- 所有 token 字段必须是非负整数；成本保留 6 位小数（NaN/Infinity → 0）。
- `share` 是 0..1 的小数。
- 查询参数：`days`（7/30/90/0，默认 30）、`limitSessions`（默认 100，上限 500）、`refresh`（`1` 强制刷新）。
- HTTP 200 时 content-type `application/json; charset=utf-8`，`cache-control: no-store`。
- 读不到 persistence：503 + JSON `{ "error": "..." }`。

### 3.3 成本

配置来自 `cordis.patch.yml` 的 `config.prices`（每 1M token 的 USD 价）：
```jsonc
{ "provider/model": { "input": 0.15, "output": 0.6, "cacheRead": 0.015, "cacheWrite": 0.15 } }
```
匹配顺序：`provider/model` 精确 → `model` 兜底 → 未命中按 0 计价并记入 `prices.unmatchedModels`。
`costUsd = Σ tokens/1e6 * 单价`；`costCny = costUsd * usdToCny`。

### 3.4 持久化缓存（宿主侧）

- 文件：`path.join(dshHome, 'plugin-data', 'dsh-plugin-token-stats', 'usage-index.v1.json')`
  - `dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')`
- 结构：`{ "version": 1, "savedAt": ms, "sessions": { "<id>": <3.1 的提取结果> } }`
- 写入：临时文件 + `rename` 原子替换；写失败只 warn。加载失败/损坏/版本不符 → 忽略并重建。
- 增量：`persistence.list()` 的 `sizeBytes/eventCount` 没变且缓存里有 → 不读日志。
- 活会话增量：`session/event` 里 `event.seq > 缓存 lastSeq` 的 `assistant/message` 追加到 overlay，
  下次从磁盘重读该 session 时整体替换（避免重复计数）。

---

## 4. 宿主插件入口约定（`lib/index.js`）

```js
export const name = 'token-stats'
export function apply(ctx, config = {}) { ... }
```
- 不要导出 `inject` 硬依赖（服务缺失要能降级）。
- 用 `ctx.effect(() => { ...; return () => cleanup }, 'label')` 管理生命周期。
- 配置字段默认值（见 `cordis.patch.yml`）：prices、currency、usdToCny、readConcurrency、refreshIntervalMs、refreshOnStart。
- 首次加载：`refreshOnStart !== false` 时在后台（`setTimeout(..., 0)` / 微任务）建索引，不阻塞启动。
- 全部逻辑要能在没有任何服务、空数据、损坏缓存下安全运行。

---

## 5. 浏览器侧：bundle 格式与可用依赖（冻结）

### 5.1 文件格式（必须逐字遵守外层包装）

`lib/client.js` 是一个**经典 script**，由宿主以 `/plugins/<包名>/client.js` 提供。格式（参考
`.tmp/dsh-src/.../dsh-session-log-export/lib/client.js` 与 `dsh-client-ui-settings-session-log/lib/client.js`）：

```js
window.__ModuleLoader__.load({
  id: "dsh-plugin-token-stats",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let react = require("react");
    let react_jsx_runtime = require("react/jsx-runtime");
    // ... 你的实现 ...
    exports.apply = apply;
    exports.inject = inject;   // 客户端服务名数组，例如 ["slots", "locale"]
    return module.exports;
  }
});
```

- 只允许 `require()` 平台静态模块表（baseline）里的 id：
  `react`, `react/jsx-runtime`, `react-dom`, `react-dom/client`, `@deepseek-ai/cordis`,
  `zod`, `@tanstack/react-virtual`, `@deepseek-ai/dsh-client-store`,
  `@deepseek-ai/dsh-client-ui-slots`, `@deepseek-ai/dsh-client-ui-primitives`,
  `@deepseek-ai/dsh-client-ui-dockkit`。
  **不需要** `dsh.client.external`（package.json 已配好，别加）。
- 只能用 `react.createElement` / jsx-runtime；不要 import 任何其他包。
- CSS：一次性注入 `<style data-plugin="dsh-plugin-token-stats" data-plugin-css="...">`，类名加前缀
  （如 `ts_`）避免与宿主冲突；颜色用主题变量（见 5.4）。

### 5.2 注册点（已核实的 slot 契约）

```js
// 插件体
const inject = ["slots", "locale"];

function apply(ctx) {
  ctx.effect(() => ctx.locale.register("token-stats", { zh, en }), "token-stats: locale");

  // 设置页：一个独立 settings section（推荐主入口）
  ctx.slots.inject("settings.section", () => ctx.slots.register({
    name: "settings.section",
    id: "token-stats",
    order: 45,
    label: () => ctx.locale.bind("token-stats")("nav"),
    locale: "token-stats",
    inject: () => ({ /* 传给组件的 props，可含 hooks */ }),
  }, TokenStatsSection));

  // 入口约定：只注册 settings.section 一个入口。
  // 不再注册 sidebar.footer.action / shell.overlay（避免两个入口并存）。
}
```

- `settings.section` 组件 props：`inject()` 返回值的展开 + `t`（locale 绑定）。
- locale 契约：`ctx.locale.register(ns, { zh, en })`；组件里 `t("key")`。
- hooks 模式：`inject: () => ({ hooks: { xxx: store }, ...actions })`，组件用
  `props.hooks.xxx(selector)` 订阅（host 侧 `createSnapshotStore`）——见
  `dsh-session-log-export/lib/client.js` 的 `HeaderAction` 与 `UploadRow`。
- **不要**依赖 `ctx.provide` 给别的插件用（本插件自足即可）。

### 5.3 数据获取

```js
const response = await fetch(`api/token-stats.summary?days=${days}`, { headers: { accept: "application/json" } });
```
- 路径必须是 **document-relative**（不带前导 `/`）。
- 每 30s 轮询（页面隐藏时暂停：`document.visibilityState`）；手动刷新按钮。
- 失败显示错误条 + 重试；空数据显示空态；不要抛到 React 外面。
- 导出 CSV：客户端从 `sessions`/`daily` 生成（`Blob` + `URL.createObjectURL` + `<a download>`），免宿主路由。

### 5.4 视觉规范（与 DSH 设置页一致）

- 主题变量（已核实存在）：`--dsw-alias-bg-layer-1/2/3`、`--dsw-alias-bg-base`、
  `--dsw-alias-border-l2/l3`、`--dsw-alias-separator-primary`、
  `--dsw-alias-label-primary/secondary/tertiary/caption`、
  `--dsw-alias-brand-primary`、`--dsw-alias-state-success-primary`、
  `--dsw-alias-state-warn-primary`、`--dsw-alias-interactive-bg-hover`、
  `--dsw-alias-settings-card-fill`、`--dsw-alias-settings-card-stroke`。
- 字号：标题 18–20px，卡片数字 22–26px，正文 13–14px，注释 12px。
- 卡片圆角 10–12px，边界 `1px solid var(--dsw-alias-border-l2)`。
- 图表不引入库：柱状图用 div 高度百分比；模型/项目占比用横向 bar。
- 深浅色都要可用（只用主题变量，不写死背景色）。

### 5.5 仪表盘内容（最低要求）

1. 顶部：标题 + 时间范围切换（7 / 30 / 90 / 全部）+ 刷新按钮 + 最后更新时间。
2. 指标卡：今日 token / 昨日 / 近 7 天 / 总计（含成本 USD，悬停显示 CNY）。
3. 每日消耗柱状图（`daily`，hover 显示当天明细）。
4. 模型分布（`byModel`，横向 bar + 百分比 + 成本）。
5. 项目分布（`byProject`，列表）。
6. 会话排行（`sessions`，标题/项目/token/成本/最后活动，显示前 20）。
7. 亮点行：连续使用天数、缓存命中率、最忙一天、单会话最高、本月预测。
8. 空态/加载态/错误态；CSV 导出按钮。

### 5.6 浏览器侧测试（无 DOM 环境）

`test/client.test.mjs` 用 `node:vm` 造伪宿主：
- stub `globalThis.window.__ModuleLoader__.load = (def) => capture(def)`；
- 用假的 `require` 返回最小 `react`/`react/jsx-runtime`/primitives/store 桩；
- 跑 `factory(require)` 拿 `exports.apply`，用假 `ctx`（slots.register 记录调用、locale.register 记录字典）执行；
- 断言：注册了 `settings.section`，locale 有 zh/en，`TokenStatsSection` 不抛（用桩 react 的 createElement 执行一次渲染）；
- 断言 bundle 只 require 了基线模块（防止手滑引入未声明依赖）。
把可测的纯逻辑（时间范围、格式化、CSV 生成、配色/条形宽度）抽成文件内具名函数并在 `exports.__test` 暴露。

---

## 6. 验收命令

```powershell
# 宿主侧单测（任何目录都可跑，用 DSH 自带 Node 或系统 Node 24）
node --test dsh-plugin-token-stats/test/

# 客户端 bundle 结构自检
node dsh-plugin-token-stats/test/client.test.mjs
```

- 测试不得依赖真实 `~/.dsh` 数据（用临时 fixture 目录）。
- 宿主侧测试至少覆盖：usage 提取（缺字段/未知模型/时区分桶）、定价（精确/兜底/未命中）、
  增量刷新（指纹不变不重读）、损坏缓存、空 persistence、HTTP 响应 schema、工具输出文本。
