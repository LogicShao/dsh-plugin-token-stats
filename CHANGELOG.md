# Changelog

本插件遵循 [语义化版本](https://semver.org/lang/zh-CN/)；每个发布版本在 git 上打 `vX.Y.Z` tag。

## 0.2.5 — 2026-11-12

### 修复

- **OpenCode Go 的 DeepSeek V4.1 Flash（1017 checkpoint）改为官方峰谷价**：默认价原来是平铺价
  `input 0.15 / output 0.6 / cacheRead 0.015 / cacheWrite 0.15`，其中缓存读与缓存写和 Go 官方价目
  不一致（官方缓存读 $0.003、峰时 $0.006，缓存写官方无此项）。现按
  [Go 价目表](https://opencode.ai/docs/console/go/)（2026-11-11 核对）改为 `peak` / `offPeak` 双价；
  历史 session 会按每条请求的发生时间重新落峰/闲桶计价，不需要等缓存重建。
- 默认价配置增加回归测试：解析 `cordis.patch.yml`，断言该模型保持峰谷价、峰/闲分桶成本正确。

### 说明

- `opencode-go/deepseek-v4-flash`（旧 id，Go 已不再列出）保留旧平铺价，只用于历史 session 的成本估算。
- 成本按官方 token 单价估算；Go 订阅的 dollar allowance（`opencode.allowance`）是另一套口径，
  报表里的 USD 用于横向对比，不代表实际订阅扣费。

## 0.2.4 — 2026-10-29

### 发布准备

- `install.ps1` 支持自动探测 DSH 安装目录：`-DshRoot` 参数 → `DSH_ROOT` 环境变量 → 常见安装路径；不再写死本机路径。
- README 去掉本机绝对路径，补充 `-DshRoot` 用法与手动安装说明。
- `package.json` 描述更新为「单入口：设置 → Token 用量」。
- 新增 `.gitattributes`（统一 LF，`.ps1` 保持 CRLF）与 GitHub Actions 测试工作流（`.github/workflows/test.yml`）。

## 0.2.3 — 2026-10-28

### 变更

- **只保留一个入口**：设置 → 「Token 用量」；移除侧边栏快捷按钮与弹窗（`sidebar.footer.action` / `shell.overlay`）。
- 删除随之失效的死代码：弹窗组件与 fallback Modal、footer 组件、`open`/`openDashboard`/`closeDashboard` 状态、`@deepseek-ai/dsh-client-ui-primitives` 依赖、`ts_modal*` / `ts_footer*` 样式、`close` 文案 key。

## 0.2.2 — 2026-10-28

### 修复

- **横向拖动**：柱状图悬停 tooltip 是绝对定位，靠近图表两端时会撑大滚动宽度，导致弹窗/设置页出现横向滚动。改为两端 10% 的柱子贴边对齐。
- **设置页布局按容器宽度适配**：设置内容区约 600px 而窗口很宽，原来的视口媒体查询不触发，2 列卡片把模型/项目名挤成 `d…`。改用 CSS 容器查询（≤700px 单列卡片、≤640px 收窄进度条与成本列、≤430px 指标卡单列）。
- 新增布局回归测试（固定列、容器查询、tooltip 贴边）。

## 0.2.1 — 2026-10-28

### 修复

- 模型分布 / 项目分布的进度条与金额列对齐：每行 grid 第三列由 `auto` 改为固定 112px，避免按各行文案宽度分列导致错位。

## 0.2.0 — 2026-10-28

### 新增

- **官方 DeepSeek 峰谷价**：`deepseek-flash` / `deepseek-v4-pro` 按官方价目分别计算高峰与闲时成本（不再把 `deepseek-account` 记成 $0）；峰时窗口固定按北京时间周一至周五 09:00–12:00、14:00–18:00（文档同时以 UTC 01:00–04:00、06:00–10:00 表述），周末与节假日为闲时。
- 每个请求按发生时间落峰/闲桶，成本逐请求累加，不取平均价。
- 响应 `prices` 增加 `timeAware` 与 `peakWindow`，仪表盘脚注展示峰谷计价说明。
- 缓存升级到 v2（`usage-index.v2.json`），旧 v1 自动忽略重建。

### 已知偏差

- 无中国法定节假日日历：节假日白天会按高峰价估算（偏保守，成本略高估）。

## 0.1.0 — 2026-10-28

### 首个版本

- 宿主侧只读扫描 `~/.dsh/sessions` 全部 session，提取 usage：请求数、7 个 token 分项、按模型/项目/日期/会话聚合。
- Web GUI 设置页仪表盘：今日/昨日/近 7 天/近 30 天/总计指标卡、每日柱状图、模型与项目分布、会话排行、亮点（连续使用天数、缓存命中率、最忙一天、本月预测）、CSV 导出、深浅色主题、中英文。
- `token_stats` 模型工具：对话里可直接问用量。
- 索引缓存 + 活会话 `session/event` overlay + 增量刷新；`/api/token-stats.summary` 路由。
