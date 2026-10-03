@echo off
REM ============================================================================
REM  Chay Ad-Viewer tren profile Google Chrome that cua nguoi dung
REM  Tich hop Anti-Detect va Tu dong xoay proxy moi chu ky xem ads
REM ============================================================================
setlocal DisableDelayedExpansion
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================================================
echo   JARVIS AUTO-HH3D - AD-VIEWER [MY-CHROME RUNNER]
echo   Trinh xem quang cao chong phat hien va tu dong xoay proxy
echo ============================================================================
echo.

REM 1. Che do click
echo [1] Che do tuong tac / click quang cao:
echo     1. OS Hardware Mouse [Tu dong re chuot phan cung Windows qua MOUSEEVENTF_MOVE + Hover - KHUYEN NGHI]
echo     2. Logitech G-HUB Assist [Auto re chuot vao quang cao + Bam nut G4/G5 tren chuot G304]
echo     3. Thu cong / Ban tu dong [Auto chuan bi moi thu, dung cho ban click tay roi tu chay tiep]
echo     4. CDP Input Dispatch [Playwright CDP Bezier curve, isTrusted: true]
echo     5. Playwright Mouse API
set "INPUT_CLICK_MODE="
set /p "INPUT_CLICK_MODE=    Chon [1-5, Enter = 1]: "
set "ARG_CLICK_MODE=--click-mode=os-mouse"
if "%INPUT_CLICK_MODE%"=="2" (
    set "ARG_CLICK_MODE=--click-mode=ghub"
    echo     -^> Che do: Logitech G-HUB Assist [Chuot G304]
) else if "%INPUT_CLICK_MODE%"=="3" (
    set "ARG_CLICK_MODE=--click-mode=manual"
    echo     -^> Che do: Thu cong / Ban tu dong [Manual Assist]
) else if "%INPUT_CLICK_MODE%"=="4" (
    set "ARG_CLICK_MODE=--click-mode=cdp"
    echo     -^> Che do: CDP Input Dispatch
) else if "%INPUT_CLICK_MODE%"=="5" (
    set "ARG_CLICK_MODE=--click-mode=mouse"
    echo     -^> Che do: Playwright Mouse API
) else (
    echo     -^> Che do: OS Hardware Mouse [Chuot phan cung Windows + Re chuot Hover]
)
echo.

REM 2. Nguon Proxy
echo [2] Cau hinh Proxy [Anti-Detect va Tu dong xoay proxy]:
echo     1. Danh sach tu file [Mac dinh: D:\Project\lobby\proxies\list-proxies.txt]
echo     2. Mot Proxy co dinh [ip:port hoac ip:port:user:pass]
echo     3. API URL xoay proxy tu dong
echo     4. Khong dung proxy [Ket noi truc tiep - Direct IP]
set "INPUT_PROXY_SRC="
set /p "INPUT_PROXY_SRC=    Chon nguon proxy [1-4, Enter = 1]: "

if "%INPUT_PROXY_SRC%"=="2" goto :proxy_fixed
if "%INPUT_PROXY_SRC%"=="3" goto :proxy_rotate
if "%INPUT_PROXY_SRC%"=="4" goto :proxy_none
goto :proxy_file

:proxy_fixed
set "CUSTOM_PROXY="
set /p "CUSTOM_PROXY=    Nhap proxy (vi du: 103.88.234.239:40019): "
if not defined CUSTOM_PROXY (
    echo     [!] Khong nhap proxy, chuyen ve ket noi truc tiep.
    set "ARG_PROXY=--no-proxy"
) else (
    set "ARG_PROXY=--proxy=%CUSTOM_PROXY%"
    echo     -^> Proxy co dinh: %CUSTOM_PROXY%
)
goto :after_proxy

:proxy_rotate
set "CUSTOM_URL="
set /p "CUSTOM_URL=    Nhap URL API xoay proxy: "
if not defined CUSTOM_URL (
    echo     [!] Khong nhap URL, chuyen ve ket noi truc tiep.
    set "ARG_PROXY=--no-proxy"
) else (
    set "ARG_PROXY=--rotate-url=%CUSTOM_URL%"
    echo     -^> API rotate URL: %CUSTOM_URL%
)
goto :after_proxy

:proxy_none
set "ARG_PROXY=--no-proxy"
echo     -^> Ket noi truc tiep [Direct IP, khong dung proxy]
goto :after_proxy

:proxy_file
set "DEFAULT_PROXY_FILE=D:\Project\lobby\proxies\list-proxies.txt"
set "CUSTOM_FILE="
set /p "CUSTOM_FILE=    Duong dan file proxy [Enter = %DEFAULT_PROXY_FILE%]: "
if not defined CUSTOM_FILE set "CUSTOM_FILE=%DEFAULT_PROXY_FILE%"

if not exist "%CUSTOM_FILE%" (
    echo     [Canh bao] File "%CUSTOM_FILE%" khong ton tai tren dia.
)

set "SHUFFLE_CHOICE="
set /p "SHUFFLE_CHOICE=    Xao tron danh sach proxy moi lan chay? (Y/N) [Enter = Y]: "
set "ARG_SHUFFLE=--proxy-shuffle"
if /i "%SHUFFLE_CHOICE%"=="N" (
    set "ARG_SHUFFLE="
    echo     -^> Thu tu: Tu tren xuong duoi
) else (
    echo     -^> Thu tu: Xao tron ngau nhien moi chu ky
)
set ARG_PROXY=--proxy-file="%CUSTOM_FILE%" %ARG_SHUFFLE%
echo     -^> Nguon file: %CUSTOM_FILE%
echo     -^> Tu dong loai bo proxy chet khoi file: BAT [Tu dong lam sach danh sach]
goto :after_proxy

:after_proxy
echo.

REM 3. Hien thi cua so Chrome
echo [3] Hien thi cua so Chrome:
echo     1. Co [Hien cua so trinh duyet de quan sat - mac dinh]
echo     2. Khong [Chay an - Headless]
set "INPUT_HEAD="
set /p "INPUT_HEAD=    Chon [1-2, Enter = 1]: "
set "ARG_HEAD=--head"
if "%INPUT_HEAD%"=="2" (
    set "ARG_HEAD="
    echo     -^> Che do: Chay an [Headless]
) else (
    echo     -^> Che do: Hien cua so Chrome
)
echo.

REM 4. Tien ich CanvasBlocker
echo [4] Tien ich CanvasBlocker [Chong nhan dang dau van tay Canvas]:
echo     1. Tat [mac dinh]
echo     2. Bat [Can co thu muc CanvasBlocker hop le]
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
set "ARG_LIFETIME=--max-lifetime-min=%INPUT_LIFETIME%"
echo     -^> Toi da: %INPUT_LIFETIME% phut
echo.

REM 6. Thoi gian nghi giua cac thao tac click
echo [6] Do tre nghi giua cac luot thao tac [Random delay]:
set "INPUT_DMIN="
set /p "INPUT_DMIN=    Thoi gian nghi toi thieu (giay) [Enter = 5]: "
if not defined INPUT_DMIN set "INPUT_DMIN=5"

set "INPUT_DMAX="
set /p "INPUT_DMAX=    Thoi gian nghi toi da (giay) [Enter = 10]: "
if not defined INPUT_DMAX set "INPUT_DMAX=10"

set "ARG_DELAY=--delay-min=%INPUT_DMIN% --delay-max=%INPUT_DMAX%"
echo     -^> Do tre: tu %INPUT_DMIN% den %INPUT_DMAX% giay
echo.

REM 7. So luot click quang cao chuyen tiep toi da
echo [7] So luot click tiep dien tren trang dich quang cao [Recursive clicks]:
set "INPUT_RECURSIVE="
set /p "INPUT_RECURSIVE=    So luot click chuyen tiep [0-5, Enter = 2]: "
if not defined INPUT_RECURSIVE set "INPUT_RECURSIVE=2"
set "ARG_RECURSIVE=--max-recursive-clicks=%INPUT_RECURSIVE%"
echo     -^> Toi da %INPUT_RECURSIVE% luot click chuyen tiep
echo.

REM 8. Chu ky xoa cache va cookies trinh duyet
echo [8] Chu ky xoa sach cache va cookies trinh duyet:
echo     Nhap so chu ky chay truoc khi xoa sach toan bo cache va cookies.
echo     (Vi du: 1 = xoa sau moi chu ky; 5 = chay 5 chu ky moi xoa mot lan)
set "INPUT_CLEAN_CYCLES="
set /p "INPUT_CLEAN_CYCLES=    Xoa sach cache + cookies sau bao nhieu chu ky [Nhap so n, Enter = 1]: "
if not defined INPUT_CLEAN_CYCLES set "INPUT_CLEAN_CYCLES=1"
set "ARG_CLEAN_CYCLES=--clear-cache-cycles=%INPUT_CLEAN_CYCLES%"
echo     -^> Xoa cache + cookies: Sau moi %INPUT_CLEAN_CYCLES% chu ky
echo.

REM Tong hop lenh thuc thi
set FINAL_ARGS=--my-chrome %ARG_HEAD% %ARG_CLICK_MODE% %ARG_PROXY% %ARG_CB% %ARG_LIFETIME% %ARG_DELAY% %ARG_RECURSIVE% %ARG_CLEAN_CYCLES%

echo ============================================================================
echo   TONG HOP CAU HINH CHAY:
echo   node scripts/adViewer.mjs %FINAL_ARGS%
echo ============================================================================
echo.
echo Nhan phim bat ky de bat dau chay ngay, hoac dong cua so de huy bo...
pause >nul

echo.
echo [*] Dang khoi dong Ad-Viewer tren Chrome cua ban...
call node scripts/adViewer.mjs %FINAL_ARGS%
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
