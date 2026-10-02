param(
    [int]$startX = 0,
    [int]$startY = 0,
    [int]$targetX = 0,
    [int]$targetY = 0,
    [int]$steps = 20,
    [int]$click = 1
)

Add-Type -MemberDefinition @'
[DllImport("user32.dll")]
public static extern void mouse_event(int flags, int dx, int dy, int buttons, int extra);

[DllImport("user32.dll")]
public static extern bool SetCursorPos(int X, int Y);

[DllImport("user32.dll")]
public static extern bool GetCursorPos(out System.Drawing.Point pt);
'@ -Name 'NativeMethods' -Namespace 'WinMouse' -ReferencedAssemblies System.Drawing

# Nếu startX/startY không được truyền, lấy toạ độ hiện tại của chuột
if ($startX -eq 0 -and $startY -eq 0) {
    [System.Drawing.Point]$pt = New-Object System.Drawing.Point
    [void][WinMouse.NativeMethods]::GetCursorPos([ref]$pt)
    $startX = $pt.X
    $startY = $pt.Y
}

# Di chuyển mượt mà (Ease-in-out Smoothstep)
if ($steps -lt 5) { $steps = 5 }
for ($i = 1; $i -le $steps; $i++) {
    $t = [double]$i / [double]$steps
    # Smoothstep interpolation
    $ease = $t * $t * (3.0 - 2.0 * $t)
    $curX = [int]($startX + ($targetX - $startX) * $ease)
    $curY = [int]($startY + ($targetY - $startY) * $ease)
    [void][WinMouse.NativeMethods]::SetCursorPos($curX, $curY)
    $delay = Get-Random -Minimum 8 -Maximum 16
    Start-Sleep -Milliseconds $delay
}

[void][WinMouse.NativeMethods]::SetCursorPos($targetX, $targetY)

if ($click) {
    # Dừng nhẹ quan sát (Dwell time)
    $dwell = Get-Random -Minimum 300 -Maximum 600
    Start-Sleep -Milliseconds $dwell

    # MOUSEEVENTF_LEFTDOWN = 0x02, MOUSEEVENTF_LEFTUP = 0x04
    [WinMouse.NativeMethods]::mouse_event(0x02, 0, 0, 0, 0)
    $hold = Get-Random -Minimum 75 -Maximum 140
    Start-Sleep -Milliseconds $hold
    [WinMouse.NativeMethods]::mouse_event(0x04, 0, 0, 0, 0)
}

Write-Output "WIN_MOUSE_DONE_${targetX}_${targetY}"
