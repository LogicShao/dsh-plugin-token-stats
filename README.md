# dsh-plugin-token-stats

DeepSeek Harness（DSH）插件：**跨所有 session 的 token 用量统计 + 每日消耗 + 成本估算**。

宿主侧直接读取本地 session 日志（只读、不出本机），在 Web GUI 里提供一个仪表盘入口：
**设置 → Token 用量**；另外注册一个 `token_stats` 工具，随时可以问模型「这个月用了多少 token」。

## 特性

- **全量 session 聚合**：扫描 `~/.dsh/sessions` 下所有历史会话，按模型 / 项目 / 会话 / 天维度汇总。
- **每日消耗**：今日、昨日、近 7 天、近 30 天、近 90 天、全部历史；柱状图随跨度自动切换日 / 周 / 月粒度；连续使用天数。
- **成本估算**：DeepSeek 官方 API 价（**峰时/闲时分别计价**，不取平均）+ 可配置价格表；USD 为主、CNY 折算；**OpenCode Go 的 DeepSeek 模型同样按官方峰谷价**，其他订阅/固定折算通道可用平铺价；未定价模型单独列出。
- **缓存洞察**：cache read / write 占比与缓存命中率 —— 长会话里这项通常占 token 大头。
- **会话排行**：最贵的 session、最忙的一天、平均每请求 token、本月消耗预测。
- **零配置可用，按需覆盖**：默认价格表覆盖 opencode-go / 官方账号的常用模型，可在 profile 里改成自己的价格。
- **增量索引**：只读新增/变更的 session 日志，结果缓存在 `~/.dsh/plugin-data/dsh-plugin-token-stats/`，重启不重扫。
- **模型工具**：`token_stats`（宿主侧注册），支持按天数查询。
- **导出**：仪表盘里一键导出 CSV（每天/每模型/每会话）。

## 界面预览

浅色 / 深色主题（真实组件渲染，数据为示例）：

| 浅色 | 深色 |
|---|---|
| ![浅色仪表盘](docs/screenshot-light.png) | ![深色仪表盘](docs/screenshot-dark.png) |

## 安装

### 一键（推荐）

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
# DSH 装在非默认位置时：
# powershell -ExecutionPolicy Bypass -File .\install.ps1 -DshRoot "D:\software\ai\dsh"
```

脚本会备份 profile 配置、写入 `link:` 依赖与 bundle 条目、用 DSH 自带的 Node + pnpm 安装依赖。
DSH 安装目录按 `-DshRoot` → 环境变量 `DSH_ROOT` → 常见安装路径的顺序自动探测。
然后**完全退出 DSH（托盘也退出）再启动**（bundle 层只在启动时读取，刷新页面不够）。

### 手动

1. 编辑 `%USERPROFILE%\.dsh\profiles\desktop\package.json`：

   ```jsonc
   {
     "dependencies": {
       "dsh-plugin-token-stats": "link:/path/to/dsh-plugin-token-stats"
     },
     "dsh": { "profile": { "bundles": [ /* ... */, "dsh-plugin-token-stats" ] } }
   }
   ```
   `link:` 后面写本仓库在本机的绝对路径（Windows 用正斜杠，例如 `link:D:/code/dsh-plugin-token-stats`）。

2. 在 profile 目录用 DSH 自带 pnpm 安装：

   ```powershell
   cd "$env:USERPROFILE\.dsh\profiles\desktop"
   $dsh = "<DSH 安装目录>"
   & "$dsh\resources\runtime\primary-runtime\dependencies\node\bin\node.exe" `
     "$dsh\resources\runtime\primary-runtime\dependencies\pnpm\bin\pnpm.cjs" install
   ```

3. 重启 DSH。

### 卸载 / 回滚

删掉 profile `package.json` 里的两处条目（dependencies + bundles），再跑一次 `pnpm install`，重启即可。
安装脚本每次都会生成 `package.json.bak-<时间戳>`，直接换回也可以。插件自身不改任何 DSH 配置，
删除插件目录 + `~/.dsh/plugin-data/dsh-plugin-token-stats/` 即为完全清除。

## 使用

- **入口**：设置 → 「Token 用量」（只保留这一个入口，不再有侧边栏按钮）。
- **时间范围**：7 / 30 / 90 天 / 全部，右上角可手动刷新（页面打开时每 30 秒自动刷新，切到后台暂停）。
  图表粒度跟着范围走：≤ 45 天按天，≤ 190 天按自然周（周一起），更久按自然月；柱子数量始终在十几根左右，不会出现横向滚动。
- **问模型**：对话里直接说「用 token_stats 看看这个月用量」，模型会调用工具返回汇总。

## 配置

默认值见 [`cordis.patch.yml`](cordis.patch.yml)（已内置 DeepSeek 官方与 OpenCode Go 的 DeepSeek 峰谷价，来源与核对日期写在文件注释里）。
要覆盖，在 **profile 的** `cordis.patch.yml` 里按 id 覆盖。两种价格形状都支持：

```yaml
- id: token-stats
  name: 'dsh-plugin-token-stats'
  config:
    prices:
      # 形状 A：平铺价（单一价，适合订阅/固定折算通道）
      some-gateway/some-model:
        input: 0.15      # 每 1M token 的美元价
        output: 0.6
        cacheRead: 0.015
        cacheWrite: 0.15
      # 形状 B：峰/闲双价（分时计价）
      deepseek-account/deepseek-flash:      # 官方 DeepSeek API
        peak:    { input: 0.30, cacheRead: 0.006, output: 1.2, cacheWrite: 0 }
        offPeak: { input: 0.15, cacheRead: 0.003, output: 0.6, cacheWrite: 0 }
      opencode-go/deepseek-v4.1-flash:      # OpenCode Go 订阅通道（与官方同价）
        peak:    { input: 0.30, cacheRead: 0.006, output: 1.2, cacheWrite: 0 }
        offPeak: { input: 0.15, cacheRead: 0.003, output: 0.6, cacheWrite: 0 }
      some-model:        # 只写 model 也能命中（跨 provider 兜底）
        input: 1
        output: 2
    currency: USD
    usdToCny: 7.1
    refreshIntervalMs: 15000
```

计费口径：`input` = 缓存未命中的输入 token，`cacheRead` = 缓存命中，`output` = 输出，`cacheWrite` = 缓存写入（DeepSeek 官方无此项，填 0）。
峰时定义：**UTC 周一至周五 01:00–04:00、06:00–10:00**（即北京时间工作日 09:00–12:00、14:00–18:00），其余为闲时。

| 字段 | 默认 | 说明 |
|---|---|---|
| `prices` | 见文件 | 每 1M token 的 USD 单价；键为 `provider/model` 或 `model`；值支持平铺或 `{peak, offPeak}` |
| `currency` | `USD` | 展示币种（内部统一按 USD 计算，再折算） |
| `usdToCny` | `7.1` | CNY 折算汇率 |
| `readConcurrency` | `3` | 建索引时并发读取的 session 数 |
| `refreshIntervalMs` | `15000` | 索引刷新的最小间隔 |
| `refreshOnStart` | `true` | 启动时后台建索引 |

改配置后需要重启 DSH（bundle 层只在启动时读取）。

## 数据来源与隐私

- 只读 `~/.dsh/sessions/**/session*.jsonl(.zstd)`，不写日志、不联网、不读对话正文以外的内容
  （只取 `assistant/message` 事件的 `usage` 与模型标识，以及 session 头部的 cwd/创建时间）。
- 索引缓存在 `~/.dsh/plugin-data/dsh-plugin-token-stats/usage-index.v2.json`，可随时删除（下次会重建）。
- 统计范围是本机全部 session，包括子 agent 会话（在会话排行里标注 `isSubagent`）。

## 已知限制

- `totalTokens` 以日志里 provider 回报的 `usage.totalTokens` 为准；缺失时按各分项相加兜底。
- 成本是**估算**：内置 DeepSeek 官方价与 OpenCode Go 的 DeepSeek 价（2026-11-11 核对），官方调价后需要更新 `prices`。
- **OpenCode Go 的额度（allowance）不等于账单**：Go 订阅按 dollar allowance 折算，API 响应里的 `opencode.allowance` 与官方 token 单价不同口径；本插件按官方 token 单价估算「官方价口径」的用量成本，用于横向对比，不代表实际扣费。
- **峰谷价不含中国法定节假日日历**：官方节假日按闲时计费，本插件把工作日窗口一律按高峰算，节假日白天会略偏高（保守方向）。
- 正在进行的会话在持久化前（turn 结束前）数字会有延迟；插件会在下一次刷新时补上。
- 只统计有 `assistant/message` 且带 usage 的请求；被取消且未上报 usage 的步骤无法计入。

## 开发

```powershell
# 全部单测（88 项；逐文件直跑，避免 test runner 额外 spawn 子进程）
Get-ChildItem .\test -Filter *.mjs | ForEach-Object { node $_.FullName }

# 只跑浏览器 bundle 自检
node .\test\client.test.mjs

# 额外：生成可截图的界面预览页（浅色/深色/英文/空/加载/错误）
node .\test\client.test.mjs --emit-preview .\.tmp\preview
```

结构：

```text
lib/index.js          宿主入口（name/apply）
lib/host/             session 扫描、用量提取、聚合、定价、路由、模型工具
lib/client.js         浏览器 bundle（手写 ModuleLoader factory，无构建步骤）
test/                 node:test 单测（不依赖真实 ~/.dsh）
.github/workflows/    CI（push / PR 时逐文件跑测试）
```

## 验证记录

- **单测**：88 项全绿（宿主 65 + 浏览器 23），测试全部使用临时 fixture，不触碰真实 `~/.dsh`；
  覆盖峰谷边界（UTC 00:59/01:00/03:59/04:00/05:59/06:00/09:59/10:00、周末）、跨桶成本、平铺价回归、默认价配置回归（含 opencode-go 的 DeepSeek 峰谷价）、图表粒度切换（日 / 周 / 月、周一对齐、边缘裁剪、桶内求和守恒）、缓存 v1 忽略 / v2 损坏重建，以及布局回归（行内固定列、容器查询、柱状图 tooltip 两端贴边）。
- **真实数据对账**：用独立脚本直接解 zstd 会话日志算「真值」与插件输出比对——128 个 session 的
  逐会话 totalTokens、7 个分项、4 个模型分桶**逐项相等**；成本也与独立实现的官方峰谷价计算一致
  （`deepseek-account/deepseek-flash` 精确到 $0.0000003）。
- **真实宿主加载**：在隔离 `DSH_HOME` + 隔离 profile 的 DSH 实例里启动，确认
  客户端入口出现在 boot graph 并通过组合校验、`/plugins/dsh-plugin-token-stats/client.js` 返回 200，
  宿主侧 `/api/token-stats.summary` 返回 200 与契约一致的 JSON（含 `prices.timeAware` / `peakWindow`）。

## 版本与发布

- 版本历史见 [CHANGELOG.md](CHANGELOG.md)，每个发布版本在 git 上打 `vX.Y.Z` tag。
- 发布到你自己的 Git 托管（GitHub / Gitee / 自建均可）：

  ```bash
  git remote add origin <你的仓库地址>
  git push -u origin main
  git push --tags          # 推送版本 tag
  ```

- 本仓库已内置 CI（`.github/workflows/test.yml`），push / PR 时自动逐文件跑测试。

## License

MIT


