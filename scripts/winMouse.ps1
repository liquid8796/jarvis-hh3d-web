param(
    [int]$startX = 0,
    [int]$startY = 0,
    [int]$targetX = 0,
    [int]$targetY = 0,
    [int]$steps = 25,
    [int]$hoverMs = 1200,
    [int]$click = 1
)

Add-Type -MemberDefinition @'
[DllImport("user32.dll")]
public static extern void mouse_event(int flags, int dx, int dy, int buttons, int extra);

[DllImport("user32.dll")]
public static extern bool GetCursorPos(out System.Drawing.Point pt);

[DllImport("user32.dll")]
public static extern bool SetCursorPos(int X, int Y);

[DllImport("user32.dll")]
public static extern bool SetForegroundWindow(IntPtr hWnd);

[DllImport("user32.dll")]
public static extern void SwitchToThisWindow(IntPtr hWnd, bool fAltTab);

[DllImport("user32.dll")]
public static extern int GetSystemMetrics(int nIndex);
'@ -Name 'NativeMethods' -Namespace 'WinMouse' -ReferencedAssemblies System.Drawing

# 1. Kích hoạt cửa sổ Chrome lên hàng đầu mà KHÔNG làm thay đổi kích thước hoặc trạng thái của cửa sổ
try {
    $wshell = New-Object -ComObject WScript.Shell
    $wshell.AppActivate("Chrome") | Out-Null
} catch {}

$chromeProc = Get-Process -Name chrome -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } | Select-Object -First 1
if ($chromeProc) {
    # Giữ nguyên 100% kích thước và trạng thái toàn màn hình (Maximized), không dùng SW_RESTORE (9)
    [void][WinMouse.NativeMethods]::SwitchToThisWindow($chromeProc.MainWindowHandle, $true)
    [void][WinMouse.NativeMethods]::SetForegroundWindow($chromeProc.MainWindowHandle)
    Start-Sleep -Milliseconds 60
}

# 2. Lấy kích thước màn hình vật lý
$screenW = [WinMouse.NativeMethods]::GetSystemMetrics(0) # SM_CXSCREEN
$screenH = [WinMouse.NativeMethods]::GetSystemMetrics(1) # SM_CYSCREEN
if ($screenW -le 0) { $screenW = 1920 }
if ($screenH -le 0) { $screenH = 1080 }

# Hàm chuyển toạ độ pixel sang toạ độ chuẩn hoá 0..65535 và phát sự kiện di chuyển phần cứng MOUSEEVENTF_MOVE
function MoveHardware([int]$x, [int]$y) {
    $clampedX = [Math]::Max(0, [Math]::Min($screenW - 1, $x))
    $clampedY = [Math]::Max(0, [Math]::Min($screenH - 1, $y))
    $normX = [int][Math]::Round(($clampedX * 65535.0) / ($screenW - 1))
    $normY = [int][Math]::Round(($clampedY * 65535.0) / ($screenH - 1))
    # 0x8001 = MOUSEEVENTF_MOVE (0x0001) | MOUSEEVENTF_ABSOLUTE (0x8000)
    # Windows Input Subsystem tạo thông điệp WM_MOUSEMOVE thật sự gửi tới Chrome
    [WinMouse.NativeMethods]::mouse_event(0x8001, $normX, $normY, 0, 0)
    [void][WinMouse.NativeMethods]::SetCursorPos($clampedX, $clampedY)
}

# 3. Lấy toạ độ chuột hiện tại
if ($startX -eq 0 -and $startY -eq 0) {
    [System.Drawing.Point]$startPt = New-Object System.Drawing.Point
    [void][WinMouse.NativeMethods]::GetCursorPos([ref]$startPt)
    $startX = $startPt.X
    $startY = $startPt.Y
}

# 4. Di chuyển mượt mà tới mục tiêu (Cubic Bézier / Smoothstep) kèm phát sự kiện phần cứng
if ($steps -lt 10) { $steps = 10 }
for ($i = 1; $i -le $steps; $i++) {
    $t = [double]$i / [double]$steps
    # Smoothstep: 3t^2 - 2t^3
    $ease = $t * $t * (3.0 - 2.0 * $t)
    $curX = [int]($startX + ($targetX - $startX) * $ease)
    $curY = [int]($startY + ($targetY - $startY) * $ease)
    
    # Rung lắc vi mô (Micro-tremor) +- 1 px
    $jitterX = Get-Random -Minimum -1 -Maximum 2
    $jitterY = Get-Random -Minimum -1 -Maximum 2
    MoveHardware ($curX + $jitterX) ($curY + $jitterY)
    
    $delay = Get-Random -Minimum 8 -Maximum 16
    Start-Sleep -Milliseconds $delay
}

MoveHardware $targetX $targetY

# 5. PHA RÊ CHUỘT LƯỢN TRÊN QUẢNG CÁO (Hover Engagement)
# Kích hoạt liên tục các sự kiện mouseenter, mouseover, pointermove trên quảng cáo
if ($hoverMs -gt 0) {
    $hoverStart = [System.Diagnostics.Stopwatch]::StartNew()
    $angle = 0.0
    while ($hoverStart.ElapsedMilliseconds -lt $hoverMs) {
        $radiusX = Get-Random -Minimum 5 -Maximum 18
        $radiusY = Get-Random -Minimum 4 -Maximum 14
        $angle += [Math]::PI / 4.0
        $wobbleX = [int]($targetX + [Math]::Cos($angle) * $radiusX)
        $wobbleY = [int]($targetY + [Math]::Sin($angle) * $radiusY)
        MoveHardware $wobbleX $wobbleY
        
        $hoverDelay = Get-Random -Minimum 50 -Maximum 110
        Start-Sleep -Milliseconds $hoverDelay
    }
    $hoverStart.Stop()
    MoveHardware $targetX $targetY
}

# 6. PHA NHẤP CHUỘT PHẦN CỨNG (Hardware Click)
if ($click -eq 1) {
    # Dừng nhẹ quan sát (Dwell time trước khi nhấn)
    $dwell = Get-Random -Minimum 250 -Maximum 450
    Start-Sleep -Milliseconds $dwell

    # MOUSEEVENTF_LEFTDOWN = 0x0002
    [WinMouse.NativeMethods]::mouse_event(0x0002, 0, 0, 0, 0)
    
    # Hold time: 80 - 150ms như ngón tay người nhấn giữ chuột
    $hold = Get-Random -Minimum 80 -Maximum 150
    Start-Sleep -Milliseconds $hold
    
    # MOUSEEVENTF_LEFTUP = 0x0004
    [WinMouse.NativeMethods]::mouse_event(0x0004, 0, 0, 0, 0)
    
    # Dư chấn sau khi nhả chuột (Follow-through)
    Start-Sleep -Milliseconds 60
    MoveHardware ($targetX + 1) ($targetY - 1)
}

Write-Output "WIN_MOUSE_DONE_${targetX}_${targetY}"
