# dsh-plugin-token-stats 安装脚本（Windows PowerShell）
#
# 做三件事（幂等，可重复执行）：
#   1. 备份 profile 的 package.json / pnpm-lock.yaml；
#   2. 把本插件以 link: 依赖 + bundle 条目写进 profile；
#   3. 用 DSH 自带的 Node + pnpm 跑 install，生成 node_modules 链接。
#
# 不会重启 DSH —— 装完手动完全退出 DSH 再启动（bundle 层只在启动时读取）。
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File .\install.ps1
#   powershell -ExecutionPolicy Bypass -File .\install.ps1 -ProfileDir "$env:USERPROFILE\.dsh\profiles\desktop"
param(
  [string]$PluginDir = (Split-Path -Parent $MyInvocation.MyCommand.Path),
  [string]$ProfileDir = (Join-Path $env:USERPROFILE ".dsh\profiles\desktop"),
  [string]$DshRoot = "D:\software\ai\dsh"
)

$ErrorActionPreference = "Stop"
$PluginName = "dsh-plugin-token-stats"

function Fail($message) { Write-Host "✗ $message" -ForegroundColor Red; exit 1 }
function Ok($message) { Write-Host "✓ $message" -ForegroundColor Green }
function Step($message) { Write-Host "→ $message" -ForegroundColor Cyan }

$PluginDir = (Resolve-Path $PluginDir).Path
if (-not (Test-Path (Join-Path $PluginDir "package.json"))) { Fail "插件目录不对：$PluginDir" }
if (-not (Test-Path $ProfileDir)) { Fail "profile 不存在：$ProfileDir（先启动一次 DSH）" }
$profileJson = Join-Path $ProfileDir "package.json"
if (-not (Test-Path $profileJson)) { Fail "找不到 $profileJson" }

$node = Join-Path $DshRoot "resources\runtime\primary-runtime\dependencies\node\bin\node.exe"
$pnpm = Join-Path $DshRoot "resources\runtime\primary-runtime\dependencies\pnpm\bin\pnpm.cjs"
if (-not (Test-Path $node)) { $node = (Get-Command node -ErrorAction SilentlyContinue).Source }
if (-not (Test-Path $pnpm)) { Fail "找不到 DSH 自带 pnpm：$pnpm（可用 -DshRoot 指定安装目录）" }
Ok "Node: $node"
Ok "pnpm: $pnpm"

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
Step "备份 profile 配置"
Copy-Item $profileJson "$profileJson.bak-$stamp"
$lock = Join-Path $ProfileDir "pnpm-lock.yaml"
if (Test-Path $lock) { Copy-Item $lock "$lock.bak-$stamp" }
Ok "已备份 package.json（.bak-$stamp）"

Step "写入 link: 依赖与 bundle 条目"
$linkSpec = "link:" + ($PluginDir -replace '\\', '/')
$env:DSH_TS_PLUGIN_DIR = $PluginDir
$env:DSH_TS_LINK_SPEC = $linkSpec
$env:DSH_TS_PROFILE_JSON = $profileJson
$env:DSH_TS_PLUGIN_NAME = $PluginName
$editor = Join-Path $env:TEMP "dsh-token-stats-wire.mjs"
@'
import fs from "node:fs";
const file = process.env.DSH_TS_PROFILE_JSON;
const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
pkg.dependencies ??= {};
pkg.dependencies[process.env.DSH_TS_PLUGIN_NAME] = process.env.DSH_TS_LINK_SPEC;
pkg.dsh ??= {};
pkg.dsh.profile ??= {};
pkg.dsh.profile.bundles ??= [];
const bundles = pkg.dsh.profile.bundles;
const name = process.env.DSH_TS_PLUGIN_NAME;
if (!bundles.includes(name)) {
  // 插件 bundle 必须在基础 bundle 之后；追加到末尾即可。
  bundles.push(name);
}
fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
console.log("wired", name, "->", pkg.dependencies[name]);
'@ | Set-Content -Encoding utf8 $editor
& $node $editor
if ($LASTEXITCODE -ne 0) { Fail "写入 profile package.json 失败（备份在 $profileJson.bak-$stamp）" }
Ok "profile 已写入 $PluginName"

Step "安装依赖（DSH 自带 pnpm）"
Push-Location $ProfileDir
try {
  & $node $pnpm install --prefer-offline 2>&1 | ForEach-Object { "$_" }
  if ($LASTEXITCODE -ne 0) { Fail "pnpm install 失败；用 *.bak-$stamp 还原 package.json 后重试" }
} finally {
  Pop-Location
}
Ok "依赖安装完成"

$linked = Join-Path $ProfileDir "node_modules\$PluginName"
if (-not (Test-Path $linked)) { Fail "node_modules 里没有 $PluginName，pnpm 没链接成功" }
Ok "node_modules 链接：$linked"

Write-Host ""
Write-Host "安装完成。下一步：" -ForegroundColor Yellow
Write-Host "  1. 完全退出 DSH（托盘也退出），再启动；"
Write-Host "  2. 打开设置 → 插件，确认 $PluginName 已启用；"
Write-Host "  3. 打开设置 → 「Token 用量」查看仪表盘（侧边栏底部也有快捷按钮）。"
Write-Host ""
Write-Host "回滚：把 $profileJson.bak-$stamp 换回 package.json，再跑一次 pnpm install 并重启。" -ForegroundColor DarkGray
