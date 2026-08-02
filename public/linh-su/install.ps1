# =============================================================================
# Cài LINH SỨ TÚC TRỰC — Auto HH3D (Windows)
#
# Chạy bằng lệnh phát ở mục Linh Sứ trên dashboard:
#   powershell -NoProfile -ExecutionPolicy Bypass -Command `
#     "$env:LINH_PHU='<linh phù>'; $env:LINH_SU_URL='<web>'; irm <web>/linh-su/install.ps1 | iex"
#
# Script này KHÔNG cần quyền admin: cài vào %LOCALAPPDATA%, tự khởi động qua khoá
# HKCU\...\Run của chính người dùng. Chạy lại = cập nhật (gói mới + linh phù mới).
# Gỡ: chạy uninstall.ps1 trong thư mục cài, hoặc xoá thư mục + khoá Run.
# =============================================================================
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$token = $env:LINH_PHU
$base = if ($env:LINH_SU_URL) { $env:LINH_SU_URL.TrimEnd("/") } else { "https://auto-hh3d.vercel.app" }

if (-not $token) {
  Write-Host "Thiếu linh phù. Hãy copy NGUYÊN VẸN lệnh cài từ mục Linh Sứ trên dashboard." -ForegroundColor Red
  exit 1
}

$dir = Join-Path $env:LOCALAPPDATA "AutoHH3D\LinhSu"
$runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$runName = "AutoHH3D-LinhSu"

Write-Host ""
Write-Host "== Cài linh sứ túc trực vào $dir ==" -ForegroundColor Cyan

# --- 1. Node.js -------------------------------------------------------------
function Get-NodeMajor {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if (-not $cmd) { return 0 }
  $v = (& node --version) -replace "^v", ""
  return [int]($v.Split(".")[0])
}

if ((Get-NodeMajor) -lt 20) {
  Write-Host "Chưa có Node.js (>= 20) — đang cài qua winget..." -ForegroundColor Yellow
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if (-not $winget) {
    Write-Host "Máy không có winget. Hãy cài Node.js LTS từ https://nodejs.org rồi chạy lại lệnh này." -ForegroundColor Red
    exit 1
  }
  & winget install --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
  # winget sửa PATH của registry, nhưng phiên PowerShell này còn PATH cũ — nạp lại.
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
              [Environment]::GetEnvironmentVariable("Path", "User")
  if ((Get-NodeMajor) -lt 20) {
    Write-Host "Cài Node xong nhưng phiên này chưa thấy nó — mở PowerShell MỚI rồi chạy lại lệnh cài." -ForegroundColor Red
    exit 1
  }
}
Write-Host ("Node.js " + (& node --version) + " — được") -ForegroundColor Green

# --- 2. Dừng linh sứ cũ (nếu đang chạy) trước khi ghi đè ---------------------
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like "*AutoHH3D\LinhSu\worker.mjs*" } |
  ForEach-Object {
    Write-Host "Dừng linh sứ cũ (PID $($_.ProcessId))..." -ForegroundColor Yellow
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }

# --- 3. Tải và bung gói ------------------------------------------------------
New-Item -ItemType Directory -Force $dir | Out-Null
$tgz = Join-Path $env:TEMP "goi-linh-su.tgz"
Write-Host "Tải gói linh sứ..."
Invoke-WebRequest -UseBasicParsing -Uri "$base/linh-su/goi-linh-su.tgz" -OutFile $tgz
& tar -xzf $tgz -C $dir
Remove-Item $tgz -Force

# --- 4. Thư viện + Chromium --------------------------------------------------
Push-Location $dir
try {
  Write-Host "Cài thư viện (npm install)..."
  & npm install --omit=dev --no-fund --no-audit --loglevel=error
  if ($LASTEXITCODE -ne 0) { throw "npm install thất bại (mã $LASTEXITCODE)" }

  # Bản Chromium phải khớp CHÍNH XÁC bản playwright-core trong gói — đọc từ gói, không đoán.
  $pw = (& node -p "require('./package.json').dependencies['playwright-core']")
  Write-Host "Cài Chromium cho Playwright $pw (lần đầu hơi lâu, ~150MB)..."
  & npx --yes "playwright@$pw" install chromium
  if ($LASTEXITCODE -ne 0) { throw "cài Chromium thất bại (mã $LASTEXITCODE)" }
} finally {
  Pop-Location
}

# --- 5. Cấu hình -------------------------------------------------------------
# WORKER_ID mang tên máy để dashboard hiện "linh sứ nhà ai" một cách dễ nhận ra.
$suffix = -join ((48..57) + (97..122) | Get-Random -Count 4 | ForEach-Object { [char]$_ })
$workerId = ($env:COMPUTERNAME.ToLower() -replace "[^a-z0-9-]", "-") + "-" + $suffix
@(
  "WEB_URL=$base"
  "WORKER_TOKEN=$token"
  "WORKER_ID=$workerId"
) -join "`r`n" | Set-Content -Encoding ascii (Join-Path $dir ".env")

# --- 6. run.ps1 — vòng nuôi: worker chết là dựng lại sau 10 giây -------------
@'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $dir
foreach ($line in Get-Content (Join-Path $dir ".env")) {
  if ($line -match "^([A-Z_]+)=(.*)$") {
    [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], "Process")
  }
}
while ($true) {
  node worker.mjs *>> (Join-Path $dir "linh-su.log")
  Start-Sleep -Seconds 10
}
'@ | Set-Content -Encoding utf8 (Join-Path $dir "run.ps1")

# --- 7. launcher.vbs — chạy run.ps1 KHÔNG hiện cửa sổ ------------------------
$runPs1 = Join-Path $dir "run.ps1"
@"
CreateObject("WScript.Shell").Run "powershell -NoProfile -ExecutionPolicy Bypass -File ""$runPs1""", 0, False
"@ | Set-Content -Encoding ascii (Join-Path $dir "launcher.vbs")

# --- 8. uninstall.ps1 — đường lui rõ ràng ------------------------------------
@"
Remove-ItemProperty -Path "$runKey" -Name "$runName" -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { `$_.CommandLine -like "*AutoHH3D\LinhSu\worker.mjs*" } |
  ForEach-Object { Stop-Process -Id `$_.ProcessId -Force -ErrorAction SilentlyContinue }
Remove-Item -Recurse -Force "$dir"
Write-Host "Đã gỡ linh sứ túc trực."
"@ | Set-Content -Encoding utf8 (Join-Path $dir "uninstall.ps1")

# --- 9. Tự khởi động cùng Windows + chạy ngay --------------------------------
$launcher = Join-Path $dir "launcher.vbs"
Set-ItemProperty -Path $runKey -Name $runName -Value "wscript.exe //B `"$launcher`""
& wscript.exe //B $launcher

Write-Host ""
Write-Host "== Xong! Linh sứ「$workerId」đã lên ca và sẽ tự trực mỗi lần mở máy. ==" -ForegroundColor Green
Write-Host "Nhật ký : $dir\linh-su.log"
Write-Host "Gỡ cài  : powershell -File `"$dir\uninstall.ps1`""
Write-Host "Kiểm tra: mở mục Linh Sứ trên dashboard — sẽ thấy nó điểm danh trong ~10 giây."
