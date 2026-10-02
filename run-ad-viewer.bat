@echo off
REM ============================================================================
REM  Chay Ad-Viewer tren profile Google Chrome that cua nguoi dung
REM  Tich hop Anti-Detect & Auto-Rotate Proxy moi chu ky xem ads
REM ============================================================================
setlocal EnableDelayedExpansion
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================================================
echo   JARVIS AUTO-HH3D - AD-VIEWER (MY-CHROME RUNNER)
echo   Trinh xem quang cao chong phat hien va tu dong xoay proxy
echo ============================================================================
echo.

REM 1. Che do click
echo [1] Che do click:
echo     1. CDP Input (mac dinh - Playwright/CDP toa do that, muot ma, an toan)
echo     2. Mouse (Chuot that he dieu hanh qua OS Cursor / Playwright Mouse)
set "INPUT_CLICK_MODE="
set /p "INPUT_CLICK_MODE=    Chon [1-2, Enter = 1]: "
set "ARG_CLICK_MODE=--click-mode=cdp"
if "%INPUT_CLICK_MODE%"=="2" (
    set "ARG_CLICK_MODE=--click-mode=mouse"
    echo     -^> Che do: Mouse
) else (
    echo     -^> Che do: CDP
)
echo.

REM 2. Nguon Proxy
echo [2] Cau hinh Proxy (Anti-Detect & Auto-Rotation):
echo     1. Danh sach tu file (Mac dinh: D:\Project\lobby\proxies\list-proxies.txt)
echo     2. Mot Proxy co dinh (ip:port hoac ip:port:user:pass)
echo     3. API URL xoay proxy tu dong
echo     4. Khong dung proxy (Ket noi truc tiep - Direct IP)
set "INPUT_PROXY_SRC="
set /p "INPUT_PROXY_SRC=    Chon nguon proxy [1-4, Enter = 1]: "

set "ARG_PROXY="
if "%INPUT_PROXY_SRC%"=="2" (
    set "CUSTOM_PROXY="
    set /p "CUSTOM_PROXY=    Nhap proxy (vi du: 103.88.234.239:40019): "
    if defined CUSTOM_PROXY (
        set "ARG_PROXY=--proxy=!CUSTOM_PROXY!"
        echo     -^> Proxy co dinh: !CUSTOM_PROXY!
    ) else (
        echo     [!] Khong nhap proxy, chuyen ve mac dinh khong dung proxy.
        set "ARG_PROXY=--no-proxy"
    )
) else if "%INPUT_PROXY_SRC%"=="3" (
    set "CUSTOM_URL="
    set /p "CUSTOM_URL=    Nhap URL API xoay proxy: "
    if defined CUSTOM_URL (
        set "ARG_PROXY=--rotate-url=!CUSTOM_URL!"
        echo     -^> API rotate URL: !CUSTOM_URL!
    ) else (
        echo     [!] Khong nhap URL, chuyen ve mac dinh khong dung proxy.
        set "ARG_PROXY=--no-proxy"
    )
) else if "%INPUT_PROXY_SRC%"=="4" (
    set "ARG_PROXY=--no-proxy"
    echo     -^> Ket noi truc tiep (Direct IP, khong dung proxy)
) else (
    set "DEFAULT_PROXY_FILE=D:\Project\lobby\proxies\list-proxies.txt"
    set "CUSTOM_FILE="
    set /p "CUSTOM_FILE=    Duong dan file proxy [Enter = !DEFAULT_PROXY_FILE!]: "
    if not defined CUSTOM_FILE set "CUSTOM_FILE=!DEFAULT_PROXY_FILE!"
    
    if not exist "!CUSTOM_FILE!" (
        echo     [Canh bao] File "!CUSTOM_FILE!" khong ton tai tren dia.
        echo                He thong se tu dong chay Direct IP neu khong tim thay file.
    )
    
    set "SHUFFLE_CHOICE="
    set /p "SHUFFLE_CHOICE=    Xao tron danh sach proxy moi lan chay? (Y/N) [Enter = Y]: "
    set "ARG_SHUFFLE=--proxy-shuffle"
    if /i "!SHUFFLE_CHOICE!"=="N" (
        set "ARG_SHUFFLE="
        echo     -^> Dung theo thu tu tu tren xuong
    ) else (
        echo     -^> Tu dong xao tron (Shuffle) danh sach
    )
    set "ARG_PROXY=--proxy-file="!CUSTOM_FILE!" !ARG_SHUFFLE!"
    echo     -^> Nguon file: !CUSTOM_FILE!
)
echo.

REM 3. Hien thi cua so Chrome
echo [3] Hien thi cua so Chrome:
echo     1. Co (Hien cua so trinh duyet de quan sat) [mac dinh]
echo     2. Khong (Chay an - Headless)
set "INPUT_HEAD="
set /p "INPUT_HEAD=    Chon [1-2, Enter = 1]: "
set "ARG_HEAD=--head"
if "%INPUT_HEAD%"=="2" (
    set "ARG_HEAD="
    echo     -^> Che do: Chay an (Headless)
) else (
    echo     -^> Che do: Hien cua so Chrome
)
echo.

REM 4. Tien ich CanvasBlocker
echo [4] Tien ich CanvasBlocker (Chong nhan dang dau van tay Canvas):
echo     1. Tat [mac dinh]
echo     2. Bat (Can co thu muc CanvasBlocker hop le)
set "INPUT_CB="
set /p "INPUT_CB=    Chon [1-2, Enter = 1]: "
set "ARG_CB="
if "%INPUT_CB%"=="2" (
    set "ARG_CB=--canvas-blocker"
    echo     -^> CanvasBlocker: BAT
) else (
    echo     -^> CanvasBlocker: TAT
)
echo.

REM 5. Thoi gian chay toi da
echo [5] Thoi gian chay toi da:
set "INPUT_LIFETIME="
set /p "INPUT_LIFETIME=    So phut chay toi da [Enter = 290]: "
if not defined INPUT_LIFETIME set "INPUT_LIFETIME=290"
set "ARG_LIFETIME=--max-lifetime-min=!INPUT_LIFETIME!"
echo     -^> Toi da: !INPUT_LIFETIME! phut
echo.

REM 6. Thoi gian nghi giua cac thao tac click
echo [6] Do tre nghi giua cac luot thao tac (Random delay):
set "INPUT_DMIN="
set /p "INPUT_DMIN=    Thoi gian nghi toi thieu (giay) [Enter = 5]: "
if not defined INPUT_DMIN set "INPUT_DMIN=5"

set "INPUT_DMAX="
set /p "INPUT_DMAX=    Thoi gian nghi toi da (giay) [Enter = 10]: "
if not defined INPUT_DMAX set "INPUT_DMAX=10"

set "ARG_DELAY=--delay-min=!INPUT_DMIN! --delay-max=!INPUT_DMAX!"
echo     -^> Do tre: tu !INPUT_DMIN! den !INPUT_DMAX! giay
echo.

REM 7. So luot click quang cao chuyen tiep toi da
echo [7] So luot click tiep dien tren trang dich quang cao (Recursive clicks):
set "INPUT_RECURSIVE="
set /p "INPUT_RECURSIVE=    So luot click chuyen tiep [0-5, Enter = 2]: "
if not defined INPUT_RECURSIVE set "INPUT_RECURSIVE=2"
set "ARG_RECURSIVE=--max-recursive-clicks=!INPUT_RECURSIVE!"
echo     -^> Toi da !INPUT_RECURSIVE! luot click chuyen tiep
echo.

REM Tong hop lenh thuc thi
set "FINAL_ARGS=--my-chrome !ARG_HEAD! !ARG_CLICK_MODE! !ARG_PROXY! !ARG_CB! !ARG_LIFETIME! !ARG_DELAY! !ARG_RECURSIVE!"

echo ============================================================================
echo   TONG HOP CAU HINH CHAY:
echo   node scripts/adViewer.mjs !FINAL_ARGS!
echo ============================================================================
echo.
echo Nhan Enter de bat dau chay ngay, hoac Ctrl+C de huy bo...
pause >nul

echo.
echo [*] Dang khoi dong Ad-Viewer tren Chrome cua ban...
call node scripts/adViewer.mjs !FINAL_ARGS!
set "EXIT_CODE=%ERRORLEVEL%"

echo.
echo ============================================================================
if "%EXIT_CODE%"=="0" (
    echo   [OK] Ad-Viewer hoan tat chu ky lam viec thanh cong.
) else (
    echo   [!] Ad-Viewer ket thuc voi ma loi: %EXIT_CODE%
)
echo ============================================================================
echo.
pause
exit /b %EXIT_CODE%
