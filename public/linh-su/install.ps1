# =============================================================================
# Cài KHÔI LỖI TÚC TRỰC — Auto HH3D (Windows)
#
# Chạy bằng lệnh phát ở mục Khôi Lỗi trên dashboard:
#   powershell -NoProfile -ExecutionPolicy Bypass -Command `
#     "$env:LINH_PHU='<linh phù>'; $env:LINH_SU_URL='<web>'; irm <web>/linh-su/install.ps1 | iex"
#
# KHÔNG cần cài sẵn gì cả — không Node.js, không npm, không quyền admin.
# Script tự tải một bản Node "xách tay" vào thư mục cài và chỉ dùng bản đó.
#
# Vì sao Node riêng thay vì dùng Node của máy (hoặc cài qua winget):
#   • Người dùng không phải tự cài gì — đó là toàn bộ mục đích của trang này.
#   • Đường dẫn TUYỆT ĐỐI. Khôi lỗi tự chạy lúc đăng nhập, mà PATH lúc ấy không giống
#     PATH trong cửa sổ PowerShell đang mở — một `node` tìm qua PATH là lỗi "chạy tay
#     thì được, tự khởi động thì không" kinh điển.
#   • Máy có sẵn Node 18, Node hỏng, hay Node do nvm quản lý đều không còn là chuyện
#     của ta. Một bản trong thư mục cài thì hôm nay chạy sao, sang năm chạy vậy.
#
# Chạy lại = cập nhật (gói mới + linh phù mới). Gỡ: uninstall.ps1 trong thư mục cài.
# =============================================================================
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ProgressPreference = "SilentlyContinue"   # thanh tiến trình của IWR làm tải chậm hàng chục lần
# Console mặc định của Windows là codepage 437/1258; không đổi thì mọi dòng tiếng Việt dưới
# đây hiện ra thành ký tự rác. (Nửa còn lại của vấn đề nằm ở phía server: xem headers()
# trong next.config.ts — thiếu charset thì chuỗi đã hỏng từ trước khi tới đây.)
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}

$NODE_VERSION = "v24.18.1"                 # LTS "Krypton"

$token = $env:LINH_PHU
$base = if ($env:LINH_SU_URL) { $env:LINH_SU_URL.TrimEnd("/") } else { "https://auto-hh3d.vercel.app" }

$dir = Join-Path $env:LOCALAPPDATA "AutoHH3D\LinhSu"

# Không có linh phù mà máy ĐÃ cài rồi → đây là lần CẬP NHẬT: tái dùng token trong .env cũ.
# Nhờ vậy nâng cấp chỉ cần chạy lại lệnh cài không kèm gì — linh phù vốn chỉ hiện đúng một
# lần lúc phát, bắt người dùng phát lại token chỉ để cập nhật là bắt họ trả giá vô cớ.
if (-not $token) {
  $oldEnv = Join-Path $dir ".env"
  if (Test-Path $oldEnv) {
    $line = Get-Content $oldEnv | Where-Object { $_ -match "^WORKER_TOKEN=(.+)$" } | Select-Object -First 1
    if ($line -and $line -match "^WORKER_TOKEN=(.+)$") {
      $token = $Matches[1].Trim()
      Write-Host "Dùng lại linh phù của bản cài trước — đây là một lần cập nhật." -ForegroundColor Cyan
    }
  }
}

if (-not $token) {
  Write-Host "Thiếu linh phù. Hãy copy NGUYÊN VẸN lệnh cài từ mục Khôi Lỗi trên dashboard." -ForegroundColor Red
  exit 1
}
$nodeDir = Join-Path $dir "node"
$nodeExe = Join-Path $nodeDir "node.exe"
$runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$runName = "AutoHH3D-LinhSu"

# tar CỦA WINDOWS, gọi bằng đường dẫn tuyệt đối — không phải bất cứ "tar" nào PATH tìm được.
# Máy có Git for Windows (hay MSYS/Cygwin) trong PATH sẽ đưa ta tới GNU tar, thứ đọc
# "C:\Users\..." thành «máy chủ C, thư mục \Users\...» rồi bỏ cuộc. Và nó bỏ cuộc IM LẶNG:
# PowerShell không ném lỗi khi lệnh ngoài trả mã khác 0, nên script đi tiếp và chết ở một
# chỗ chẳng liên quan ("Move-Item: PathNotFound"), giấu mất nguyên nhân thật.
$tar = Join-Path $env:SystemRoot "System32\tar.exe"
if (-not (Test-Path $tar)) {
  Write-Host "Không tìm thấy $tar — Windows 10 phiên bản 1803 trở lên mới có sẵn." -ForegroundColor Red
  Write-Host "Hãy cập nhật Windows rồi chạy lại lệnh cài." -ForegroundColor Red
  exit 1
}

function Invoke-Tar {
  param([string[]]$TarArgs, [string]$What)
  & $tar @TarArgs
  if ($LASTEXITCODE -ne 0) { throw "$What thất bại (tar trả mã $LASTEXITCODE)" }
}

Write-Host ""
Write-Host "== Cài khôi lỗi túc trực vào $dir ==" -ForegroundColor Cyan
Write-Host "   (không cần quyền quản trị, không đụng gì tới phần còn lại của máy)"

# --- 1. Dừng khôi lỗi cũ trước khi ghi đè -------------------------------------
# Phải giết CẢ BA tầng, và VÒNG NUÔI TRƯỚC TIÊN: run.ps1 dựng lại node sau 10 giây, nên
# nếu chỉ giết node thì bản cài này kết thúc với hai vòng nuôi cùng đọc một .env — hai
# khôi lỗi mang CÙNG một WORKER_ID, cùng giành job, cùng mở browser trên một máy.
# (`$PID` loại chính cửa sổ đang chạy script ra, vì command line của nó cũng chứa "LinhSu".)
$stale = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
  $_.ProcessId -ne $PID -and (
    $_.CommandLine -like "*AutoHH3D\LinhSu\run.ps1*" -or
    $_.CommandLine -like "*AutoHH3D\LinhSu\worker.mjs*" -or
    $_.CommandLine -like "*AutoHH3D\LinhSu\launcher.vbs*"
  )
}
foreach ($p in $stale) {
  Write-Host "Dừng khôi lỗi cũ (PID $($p.ProcessId) $($p.Name))..." -ForegroundColor Yellow
  Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
}
if ($stale) { Start-Sleep -Seconds 2 }   # chờ tệp được nhả ra trước khi ghi đè

New-Item -ItemType Directory -Force $dir | Out-Null

# --- 2. Node xách tay --------------------------------------------------------
$arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" }
$nodeName = "node-$NODE_VERSION-win-$arch"

$needNode = $true
if (Test-Path $nodeExe) {
  # Đã có sẵn từ lần cài trước và đúng phiên bản thì khỏi tải lại 37MB.
  $have = (& $nodeExe --version 2>$null)
  if ($have -eq $NODE_VERSION) { $needNode = $false; Write-Host "Node $NODE_VERSION đã có sẵn trong thư mục cài." -ForegroundColor Green }
}

if ($needNode) {
  Write-Host "Tải Node.js $NODE_VERSION ($arch, ~37MB)..."
  $zip = Join-Path $env:TEMP "$nodeName.zip"
  Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/$NODE_VERSION/$nodeName.zip" -OutFile $zip

  # Kiểm tính toàn vẹn: ta sắp chạy thứ này như một runtime, nên không tin suông
  # vào việc "tải xong là đúng". Một bản tải hỏng giữa chừng, hay một cái proxy
  # chen ngang, phải lộ ra ở đây chứ không phải ở một lỗi khó hiểu ba bước sau.
  $sums = (Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt").Content
  $want = ($sums -split "`n" | Where-Object { $_ -match [regex]::Escape("$nodeName.zip") } | Select-Object -First 1).Split(" ")[0]
  $got = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
  if (-not $want -or $got -ne $want.ToLower()) {
    Remove-Item $zip -Force -ErrorAction SilentlyContinue
    Write-Host "Bản Node tải về không khớp mã kiểm tra — dừng lại cho an toàn." -ForegroundColor Red
    Write-Host "  mong đợi: $want" -ForegroundColor DarkGray
    Write-Host "  nhận được: $got" -ForegroundColor DarkGray
    exit 1
  }

  Write-Host "Bung Node..."
  if (Test-Path $nodeDir) { Remove-Item -Recurse -Force $nodeDir }
  # bsdtar giải nén zip nhanh hơn Expand-Archive nhiều.
  Invoke-Tar @("-xf", $zip, "-C", $dir) "Bung Node"
  # Zip của Node bọc ngoài một thư mục tên đầy đủ; ta muốn nó phẳng ở $dir\node.
  Move-Item (Join-Path $dir $nodeName) $nodeDir
  Remove-Item $zip -Force
}

if (-not (Test-Path $nodeExe)) {
  Write-Host "Không dựng được Node trong thư mục cài — dừng." -ForegroundColor Red
  exit 1
}
Write-Host ("Node " + (& $nodeExe --version) + " — sẵn sàng (riêng của khôi lỗi)") -ForegroundColor Green

# --- 3. Gói khôi lỗi ----------------------------------------------------------
Write-Host "Tải gói khôi lỗi..."
$tgz = Join-Path $env:TEMP "goi-linh-su.tgz"
Invoke-WebRequest -UseBasicParsing -Uri "$base/linh-su/goi-linh-su.tgz" -OutFile $tgz
# Xoá bản engine cũ chứ không trộn lên trên: một tệp bị đổi tên ở bản mới mà bản cũ
# còn nằm lại là một quả mìn hẹn giờ.
foreach ($stale in @("quest-engine", "node_modules")) {
  $p = Join-Path $dir $stale
  if (Test-Path $p) { Remove-Item -Recurse -Force $p }
}
Invoke-Tar @("-xzf", $tgz, "-C", $dir) "Bung gói khôi lỗi"
Remove-Item $tgz -Force

# --- 4. Chromium -------------------------------------------------------------
# Dùng CLI của CHÍNH playwright-core đi kèm gói. Không `npx playwright@<bản>` — cách đó
# cần npm, cần ra registry, và mở đường cho CLI lệch phiên bản đặt sẵn một revision
# Chromium khác với revision mà thư viện đi tìm ("Executable doesn't exist"). Ở đây
# người tải browser và người dùng browser là cùng một bản mã, nên không lệch được.
Write-Host "Cài Chromium (~150MB, lần đầu hơi lâu)..."
Push-Location $dir
try {
  & $nodeExe "node_modules\playwright-core\cli.js" install chromium
  if ($LASTEXITCODE -ne 0) { throw "cài Chromium thất bại (mã $LASTEXITCODE)" }
} finally {
  Pop-Location
}

# --- 5. Cấu hình -------------------------------------------------------------
# WORKER_ID mang tên máy để dashboard hiện "khôi lỗi nhà ai" một cách dễ nhận ra, kèm một hậu
# tố để hai máy trùng tên không giẫm lên nhau.
#
# HẬU TỐ ẤY LÀ HÀM CỦA CÁI MÁY, KHÔNG PHẢI SỐ NGẪU NHIÊN. ID là danh tính của khôi lỗi trong
# sổ điểm danh, và sổ ấy không bao giờ tự quên: mỗi ID mới để lại một xác "vắng mặt" nằm đó
# vĩnh viễn, người dùng nhìn vào tưởng mình đang nuôi cả một đàn.
#
# Đọc lại .env cũ (bên dưới) cứu được đường CÀI ĐÈ, nhưng KHÔNG cứu được đường gỡ-rồi-cài-
# lại: uninstall.ps1 xoá cả thư mục nên .env chết theo — mà đó lại đúng là đường ta bảo người
# dùng đi khi cần dọn dẹp. Băm từ MachineGuid + tên tài khoản Windows thì cài lại bao nhiêu
# lần cũng ra cùng một tên. MachineGuid do Windows sinh lúc cài hệ điều hành, không đổi theo
# tên máy hay phần cứng; cộng thêm tên tài khoản vì thư mục cài là %LOCALAPPDATA% của từng
# người, nên hai tài khoản trên cùng một máy là hai khôi lỗi thật, phải mang hai tên khác nhau.
$workerId = $null
$envPath = Join-Path $dir ".env"
if (Test-Path $envPath) {
  $old = (Get-Content $envPath | Where-Object { $_ -match "^WORKER_ID=(.+)$" } | Select-Object -First 1)
  if ($old -and $old -match "^WORKER_ID=(.+)$") { $workerId = $Matches[1].Trim() }
}
if (-not $workerId) {
  $seed = $null
  try {
    $guid = (Get-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Cryptography" -Name MachineGuid -ErrorAction Stop).MachineGuid
    if ($guid) { $seed = "$guid|$env:USERNAME" }
  } catch {
    # Registry không đọc được (chính sách nhóm, bản Windows lạ). Lùi về ngẫu nhiên bên dưới:
    # một cái xác trong sổ vẫn hơn một bản cài không chạy.
  }
  if ($seed) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { $hash = $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($seed)) } finally { $sha.Dispose() }
    $suffix = -join ($hash[0..2] | ForEach-Object { $_.ToString("x2") })
  } else {
    $suffix = -join ((48..57) + (97..122) | Get-Random -Count 6 | ForEach-Object { [char]$_ })
  }
  $workerId = ($env:COMPUTERNAME.ToLower() -replace "[^a-z0-9-]", "-") + "-" + $suffix
}
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
$node = Join-Path $dir "node\node.exe"
$log = Join-Path $dir "linh-su.log"
while ($true) {
  # Cắt nhật ký khi quá 5MB. Khôi lỗi chạy quanh năm, và khi web không với tới được nó
  # ghi một dòng "claim lỗi" mỗi 5 giây — mất mạng một đêm là vài chục nghìn dòng.
  if ((Test-Path $log) -and ((Get-Item $log).Length -gt 5MB)) { Remove-Item $log -Force }
  # Chuyển hướng bằng cmd chứ không bằng `*>>` của PowerShell: toán tử của PS đọc stdout
  # của tiến trình con rồi GHI LẠI bằng encoding của console (UTF-16 cho `>>`), nên nhật ký
  # tiếng Việt do Node in ra bị băm nát, và stderr còn bị bọc thành NativeCommandError kèm
  # cả stack trace PowerShell. cmd thì đổ thẳng byte sang tệp, không dịch, không bọc.
  & cmd /c "`"$node`" `"$dir\worker.mjs`" >> `"$log`" 2>&1"
  Start-Sleep -Seconds 10
}
'@ | Set-Content -Encoding utf8 (Join-Path $dir "run.ps1")

# Nhật ký của bản cài cũ có thể do `*>>` ghi ra dưới dạng UTF-16 — trộn với dòng UTF-8 mới
# thì không đọc được bằng cách nào cả. Bỏ đi; lịch sử lượt chạy vốn nằm trên web.
Remove-Item (Join-Path $dir "linh-su.log") -Force -ErrorAction SilentlyContinue

# --- 7. launcher.vbs — chạy run.ps1 KHÔNG hiện cửa sổ ------------------------
$runPs1 = Join-Path $dir "run.ps1"
@"
CreateObject("WScript.Shell").Run "powershell -NoProfile -ExecutionPolicy Bypass -File ""$runPs1""", 0, False
"@ | Set-Content -Encoding ascii (Join-Path $dir "launcher.vbs")

# --- 8. uninstall.ps1 — đường lui rõ ràng ------------------------------------
@"
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
# Cắt đường tự khởi động TRƯỚC, rồi mới hạ tiến trình — ngược lại thì một lần đăng nhập
# xen vào giữa là khôi lỗi sống dậy sau khi ta tưởng đã tiễn nó đi.
Remove-ItemProperty -Path "$runKey" -Name "$runName" -ErrorAction SilentlyContinue
# Vòng nuôi trước, node sau: giết node trước thì run.ps1 chỉ ngủ 10 giây rồi dựng lại,
# và thư mục vẫn bị khoá nên lệnh xoá bên dưới thất bại một cách khó hiểu.
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
  `$_.ProcessId -ne `$PID -and (
    `$_.CommandLine -like "*AutoHH3D\LinhSu\run.ps1*" -or
    `$_.CommandLine -like "*AutoHH3D\LinhSu\worker.mjs*" -or
    `$_.CommandLine -like "*AutoHH3D\LinhSu\launcher.vbs*"
  )
} | ForEach-Object { Stop-Process -Id `$_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2
Remove-Item -Recurse -Force "$dir" -ErrorAction SilentlyContinue
# Thư mục cha chỉ tồn tại vì khôi lỗi; rỗng rồi thì đừng để lại dấu vết.
`$parent = Split-Path -Parent "$dir"
if ((Test-Path `$parent) -and -not (Get-ChildItem `$parent -Force)) { Remove-Item -Force `$parent }
if (Test-Path "$dir") {
  Write-Host "Còn sót lại `"$dir`" — có tệp đang bị khoá. Đăng xuất rồi xoá tay là xong." -ForegroundColor Yellow
} else {
  Write-Host "Đã gỡ khôi lỗi túc trực — máy trở lại y như trước khi cài." -ForegroundColor Green
}
"@ | Set-Content -Encoding utf8 (Join-Path $dir "uninstall.ps1")

# --- 9. Tự khởi động cùng Windows + chạy ngay --------------------------------
$launcher = Join-Path $dir "launcher.vbs"
Set-ItemProperty -Path $runKey -Name $runName -Value "wscript.exe //B `"$launcher`""
& wscript.exe //B $launcher

Write-Host ""
Write-Host "== Xong! Khôi lỗi「$workerId」đã lên ca và sẽ tự trực mỗi lần mở máy. ==" -ForegroundColor Green
Write-Host "Nhật ký : $dir\linh-su.log"
Write-Host "Gỡ cài  : powershell -ExecutionPolicy Bypass -File `"$dir\uninstall.ps1`""
Write-Host "Kiểm tra: mở mục Khôi Lỗi trên dashboard — sẽ thấy nó điểm danh trong ~10 giây."
