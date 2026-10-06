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
    set "INPUT_PROXY_SRC=4"
) else (
    set "ARG_PROXY=--proxy=%CUSTOM_PROXY%"
    echo     -^> Proxy co dinh: %CUSTOM_PROXY% [Bao ve co dinh, khong tu dong chuyen ve Direct IP]
)
goto :after_proxy

:proxy_rotate
set "CUSTOM_URL="
set /p "CUSTOM_URL=    Nhap URL API xoay proxy: "
if not defined CUSTOM_URL (
    echo     [!] Khong nhap URL, chuyen ve ket noi truc tiep.
    set "ARG_PROXY=--no-proxy"
    set "INPUT_PROXY_SRC=4"
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
set "ARG_ANTI_DETECT_PROXY="
if "%INPUT_PROXY_SRC%"=="4" goto :skip_anti_detect_proxy
echo.
echo     --- Tuy chon Anti-Detect Proxy ---
echo     1. Bat Anti-Detect Proxy [Mac dinh - Dong bo Timezone, Geolocation, Locale theo IP proxy va chong ro ri WebRTC]
echo     2. Tat Anti-Detect Proxy [Chi dung proxy lam tunnel mang thuan tuy, khong can thiep Geo/Timezone]
set "INPUT_ANTI_DETECT_PROXY="
set /p "INPUT_ANTI_DETECT_PROXY=    Chon [1-2, Enter = 1]: "
set "ARG_ANTI_DETECT_PROXY=--anti-detect-proxy"
if "%INPUT_ANTI_DETECT_PROXY%"=="2" (
    set "ARG_ANTI_DETECT_PROXY=--no-anti-detect-proxy"
    echo     -^> Anti-Detect Proxy: TAT [Khong can thiep Timezone / Geo / Locale]
) else (
    set "ARG_ANTI_DETECT_PROXY=--anti-detect-proxy"
    echo     -^> Anti-Detect Proxy: BAT [Zero-Mismatch Triad]
)
:skip_anti_detect_proxy
echo.

REM 3. Hien thi cua so Chrome
echo [3] Hien thi cua so Chrome:
echo     1. Co [Hien cua so trinh duyet de quan sat - mac dinh]
echo     2. Khong [Chay an - Headless]
set "INPUT_HEAD="
set /p "INPUT_HEAD=    Chon [1-2, Enter = 1]: "
set "ARG_HEAD=--head"
if "%INPUT_HEAD%"=="2" (
    set "ARG_HEAD=--headless"
    echo     -^> Che do: Chay an [Headless]
    if not "%ARG_CLICK_MODE%"=="--click-mode=cdp" if not "%ARG_CLICK_MODE%"=="--click-mode=mouse" (
        set "ARG_CLICK_MODE=--click-mode=cdp"
        echo     [*] Che do chay an [Headless]: Tu dong chuyen sang CDP Input Dispatch [Bezier curve] vi chuot phan cung khong ap dung cho trinh duyet chay an.
    )
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

REM 9. Thiet bi gia lap
echo [9] Thiet bi gia lap [doi moi sau moi lan xoa cache]:
echo     1. Ngau nhien Desktop + Mobile [mac dinh, 50/50]
echo     2. Chi Desktop [Windows / macOS / Linux]
echo     3. Chi Mobile [Android / iPhone - chu ky mobile tu dung click cam ung CDP]
echo     4. Tu nhap thiet bi cu the [vi du: iPhone 15, Pixel 8, Galaxy S24, Windows, macOS...]
set "INPUT_DEVICE="
set /p "INPUT_DEVICE=    Chon [1-4, Enter = 1]: "
set "ARG_DEVICE=--device=random"
if "%INPUT_DEVICE%"=="2" (
    set "ARG_DEVICE=--device=desktop"
    echo     -^> Thiet bi: Chi Desktop
) else if "%INPUT_DEVICE%"=="3" (
    set "ARG_DEVICE=--device=mobile"
    echo     -^> Thiet bi: Chi Mobile
) else if "%INPUT_DEVICE%"=="4" (
    set "CUSTOM_DEVICE="
    set /p "CUSTOM_DEVICE=    Nhap ten thiet bi hoac he dieu hanh mong muon: "
    goto :custom_device
) else if not "%INPUT_DEVICE%"=="1" if not "%INPUT_DEVICE%"=="" (
    set "CUSTOM_DEVICE=%INPUT_DEVICE%"
    goto :custom_device
) else (
    echo     -^> Thiet bi: Ngau nhien Desktop + Mobile
)
goto :after_device

:custom_device
if not defined CUSTOM_DEVICE set "CUSTOM_DEVICE=random"
set "ARG_DEVICE=--device="%CUSTOM_DEVICE%""
echo     -^> Thiet bi: %CUSTOM_DEVICE%

:after_device
echo.

REM 10. Trinh duyet gia lap
echo [10] Trinh duyet gia lap:
echo     1. Ngau nhien tat ca [Chrome, Edge, Opera, Brave, Coc Coc, Samsung, Firefox, Safari - mac dinh]
echo     2. Chi ho Chromium [Chrome, Edge, Opera, Brave, Coc Coc, Samsung - van tay nhat quan nhat]
echo     3. Tu nhap danh sach [vi du: chrome,edge,firefox]
set "INPUT_BROWSER="
set /p "INPUT_BROWSER=    Chon [1-3, Enter = 1]: "
set "ARG_BROWSERS=--browsers=random"
if "%INPUT_BROWSER%"=="2" (
    set "ARG_BROWSERS=--browsers=chromium"
    echo     -^> Trinh duyet: Chi ho Chromium
) else if "%INPUT_BROWSER%"=="3" (
    set "CUSTOM_BROWSERS="
    set /p "CUSTOM_BROWSERS=    Nhap danh sach, cach nhau dau phay: "
    goto :custom_browsers
) else (
    echo     -^> Trinh duyet: Ngau nhien tat ca
)
goto :after_browsers

:custom_browsers
if not defined CUSTOM_BROWSERS set "CUSTOM_BROWSERS=random"
set "ARG_BROWSERS=--browsers=%CUSTOM_BROWSERS%"
echo     -^> Trinh duyet: %CUSTOM_BROWSERS%

:after_browsers
echo.

REM 11. So luong instance chay dong thoi
echo [11] So luong instance chay dong thoi [Multi-Instance]:
echo      Nhap so luong instance muon chay dong thoi (1-10, Enter = 1).
echo      Moi instance co lap hoan toan profile, proxy va fingerprint, tu dong dieu phoi mutex chuot.
set "INPUT_INSTANCES="
set /p "INPUT_INSTANCES=    So luong instance [1-10, Enter = 1]: "
if not defined INPUT_INSTANCES set "INPUT_INSTANCES=1"
set "ARG_INSTANCES=--instances=%INPUT_INSTANCES%"
echo     -^> So luong instance: %INPUT_INSTANCES%
echo.

set "ARG_MY_CHROME=--my-chrome"
if not "%INPUT_INSTANCES%"=="1" (
    set "ARG_MY_CHROME="
    echo     [*] Che do da instance: Tu dong su dung profile doc lap cho tung instance thay vi --my-chrome.
    echo.
) else if defined ARG_CB (
    set "ARG_MY_CHROME="
    echo     [*] Tien ich CanvasBlocker: Tu dong su dung profile doc lap de nap day du tien ich va bat Developer Mode.
    echo.
) else if "%INPUT_HEAD%"=="2" (
    set "ARG_MY_CHROME="
    echo     [*] Che do chay an [Headless]: Tu dong su dung profile doc lap thay vi --my-chrome de Chromium chay ngam.
    echo.
)

REM 12. Thoi gian hover re chuot tren quang cao truoc khi click
echo [12] Thoi gian re chuot tren quang cao truoc khi click [Hover Engagement]:
echo      Nhap so giay (vi du: 3 hoac 4), khoang thoi gian (vi du: 2-5), hoac ms (vi du: 3000).
echo      De trong de su dung mac dinh (tu 1.2 den 2.5 giay).
set "INPUT_HOVER="
set /p "INPUT_HOVER=    Thoi gian hover tren quang cao [Enter = mac dinh 1.2-2.5s]: "
set "ARG_HOVER="
if defined INPUT_HOVER (
    set "ARG_HOVER=--hover=%INPUT_HOVER%"
    echo     -^> Thoi gian hover: %INPUT_HOVER%
) else (
    echo     -^> Thoi gian hover: Mac dinh [1.2 - 2.5 giay]
)
echo.

REM 13. Thoi gian toi da cho render Adsterra
echo [13] Thoi gian toi da cho render quang cao Adsterra [Render Timeout]:
echo      Nhap so giay (vi du: 5, 8, 10), hoac ms (vi du: 6000, 8000).
echo      Neu qua thoi gian nay ma quang cao chua tai xong thi auto se cuong che click 1 quang cao bat ky.
echo      De trong de su dung mac dinh (10 giay).
set "INPUT_RENDER_TIMEOUT="
set /p "INPUT_RENDER_TIMEOUT=    Thoi gian cho render toi da [Enter = mac dinh 10s]: "
set "ARG_RENDER_TIMEOUT="
if defined INPUT_RENDER_TIMEOUT (
    set "ARG_RENDER_TIMEOUT=--render-timeout=%INPUT_RENDER_TIMEOUT%"
    echo     -^> Thoi gian cho render toi da: %INPUT_RENDER_TIMEOUT%
) else (
    echo     -^> Thoi gian cho render toi da: Mac dinh [10 giay]
)
echo.

REM 14. Nha mang quang cao muc tieu (Ad Network)
echo [14] Nha mang quang cao muc tieu [Ad Network]:
echo      1. Adcash [Mac dinh - chay AutoTag tu dong]
echo      2. Clickadu [Mang quang cao Clickadu]
echo      3. Adsterra [Mang quang cao Adsterra]
echo      4. Tat ca nha mang [All networks - Adcash + Clickadu + Adsterra]
set "INPUT_AD_NETWORK="
set /p "INPUT_AD_NETWORK=    Chon [1-4, Enter = 1]: "
set "ARG_AD_NETWORK=--ad-network=adcash"
if "%INPUT_AD_NETWORK%"=="2" (
    set "ARG_AD_NETWORK=--ad-network=clickadu"
    echo     -^> Nha mang: Clickadu
) else if "%INPUT_AD_NETWORK%"=="3" (
    set "ARG_AD_NETWORK=--ad-network=adsterra"
    echo     -^> Nha mang: Adsterra
) else if "%INPUT_AD_NETWORK%"=="4" (
    set "ARG_AD_NETWORK=--ad-network=all"
    echo     -^> Nha mang: Tat ca [Adcash + Clickadu + Adsterra]
) else (
    echo     -^> Nha mang: Adcash [Mac dinh]
)
echo.

REM 15. Tap trung click vao Popunder (Popunder Focus)
echo [15] Tap trung click vao Popunder [Popunder Focus]:
echo      1. Co [Uu tien click tu nhien de kich hoat Popunder - KHUYEN NGHI]
echo      2. Khong [Can bang tat ca cac dinh dang, khong uu tien Popunder]
set "INPUT_FOCUS_POPUNDER="
set /p "INPUT_FOCUS_POPUNDER=    Chon [1-2, Enter = 1]: "
if "%INPUT_FOCUS_POPUNDER%"=="2" goto :popunder_skip

:popunder_focus
set "ARG_AD_FOCUS=--focus-popunder-social"
echo     -^> Tap trung Popunder: CO [Uu tien Popunder]
echo.
echo [16] Xac suat click quang cao Popunder [Popunder Ratio]:
echo      Nhap ti le phan tram (vi du: 70, 80, 90, 100), hoac thap phan (0.8).
echo      Auto se tu dong uu tien click tu nhien de kich hoat Popunder theo ti le nay.
echo      De trong de su dung mac dinh (80%%).
set "INPUT_POPUNDER="
set /p "INPUT_POPUNDER=    Xac suat Popunder (%%) [Enter = mac dinh 80%%]: "
if defined INPUT_POPUNDER (
    set "ARG_POPUNDER=--popunder-ratio=%INPUT_POPUNDER%"
    echo     -^> Xac suat Popunder: %INPUT_POPUNDER%%%
) else (
    set "ARG_POPUNDER=--popunder-ratio=80"
    echo     -^> Xac suat Popunder: Mac dinh [80%%]
)
goto :after_popunder

:popunder_skip
set "ARG_AD_FOCUS=--with-native"
set "ARG_POPUNDER=--popunder-ratio=0"
echo     -^> Tap trung Popunder: KHONG [Can bang cac dinh dang, khong uu tien Popunder]

:after_popunder
echo.


REM 17. Nguon truy cap website (Traffic Source / Referrer)
echo [17] Nguon truy cap website [Traffic Source / Referrer]:
echo      1. Khong dung [Truy cap truc tiep - Direct Traffic - mac dinh]
echo      2. Ngau nhien tat ca nguon [Google, Facebook, Instagram, TikTok, X, ChatGPT, Claude, Grok, Gemini - KHUYEN NGHI]
echo      3. Google Search [Tim kiem tu nhien - Google Organic Search]
echo      4. Facebook [Mang xa hoi Facebook]
echo      5. Instagram [Mang xa hoi Instagram]
echo      6. TikTok [Mang xa hoi TikTok]
echo      7. X / Twitter [Mang xa hoi X]
echo      8. ChatGPT [AI Referral]
echo      9. Claude [Anthropic AI Referral]
echo      10. Grok [xAI Referral]
echo      11. Google Gemini [AI Referral]
set "INPUT_TRAFFIC_SOURCE="
set /p "INPUT_TRAFFIC_SOURCE=    Chon [1-11, Enter = 1]: "
set "ARG_TRAFFIC_SOURCE="
set "ARG_TRAFFIC_RATIO="

if "%INPUT_TRAFFIC_SOURCE%"=="2" (
    set "ARG_TRAFFIC_SOURCE=--traffic-source=all"
    echo     -^> Nguon truy cap: Ngau nhien tat ca [Google, Facebook, Instagram, TikTok, X, ChatGPT, Claude, Grok, Gemini]
    goto PROMPT_TRAFFIC_RATIO
)
if "%INPUT_TRAFFIC_SOURCE%"=="3" (
    set "ARG_TRAFFIC_SOURCE=--traffic-source=google"
    echo     -^> Nguon truy cap: Google Search [Organic Search]
    goto PROMPT_TRAFFIC_RATIO
)
if "%INPUT_TRAFFIC_SOURCE%"=="4" (
    set "ARG_TRAFFIC_SOURCE=--traffic-source=facebook"
    echo     -^> Nguon truy cap: Facebook [Social]
    goto PROMPT_TRAFFIC_RATIO
)
if "%INPUT_TRAFFIC_SOURCE%"=="5" (
    set "ARG_TRAFFIC_SOURCE=--traffic-source=instagram"
    echo     -^> Nguon truy cap: Instagram [Social]
    goto PROMPT_TRAFFIC_RATIO
)
if "%INPUT_TRAFFIC_SOURCE%"=="6" (
    set "ARG_TRAFFIC_SOURCE=--traffic-source=tiktok"
    echo     -^> Nguon truy cap: TikTok [Social]
    goto PROMPT_TRAFFIC_RATIO
)
if "%INPUT_TRAFFIC_SOURCE%"=="7" (
    set "ARG_TRAFFIC_SOURCE=--traffic-source=x"
    echo     -^> Nguon truy cap: X / Twitter [Social]
    goto PROMPT_TRAFFIC_RATIO
)
if "%INPUT_TRAFFIC_SOURCE%"=="8" (
    set "ARG_TRAFFIC_SOURCE=--traffic-source=chatgpt"
    echo     -^> Nguon truy cap: ChatGPT [AI Referral]
    goto PROMPT_TRAFFIC_RATIO
)
if "%INPUT_TRAFFIC_SOURCE%"=="9" (
    set "ARG_TRAFFIC_SOURCE=--traffic-source=claude"
    echo     -^> Nguon truy cap: Claude [Anthropic AI Referral]
    goto PROMPT_TRAFFIC_RATIO
)
if "%INPUT_TRAFFIC_SOURCE%"=="10" (
    set "ARG_TRAFFIC_SOURCE=--traffic-source=grok"
    echo     -^> Nguon truy cap: Grok [xAI Referral]
    goto PROMPT_TRAFFIC_RATIO
)
if "%INPUT_TRAFFIC_SOURCE%"=="11" (
    set "ARG_TRAFFIC_SOURCE=--traffic-source=gemini"
    echo     -^> Nguon truy cap: Google Gemini [AI Referral]
    goto PROMPT_TRAFFIC_RATIO
)

set "ARG_TRAFFIC_SOURCE=--traffic-source=none"
echo     -^> Nguon truy cap: Khong dung [Truy cap truc tiep - Direct Traffic]
goto SKIP_TRAFFIC_RATIO

:PROMPT_TRAFFIC_RATIO
echo.
REM 18. Xac suat truy cap tu nguon duoc chon [Traffic Source Ratio]
echo [18] Xac suat truy cap tu nguon duoc chon [Traffic Source Ratio]:
echo      Nhap ti le phan tram (vi du: 70, 80, 100), hoac thap phan (0.8).
echo      Vi du: 80%% = 80%% luot truy cap mang referrer cua nguon, 20%% con lai la truc tiep (Direct).
echo      De trong de su dung mac dinh (80%%).
set "INPUT_TRAFFIC_RATIO="
set /p "INPUT_TRAFFIC_RATIO=    Xac suat co referrer [Enter = mac dinh 80%%]: "
if defined INPUT_TRAFFIC_RATIO (
    set "ARG_TRAFFIC_RATIO=--traffic-ratio=%INPUT_TRAFFIC_RATIO%"
    echo     -^> Xac suat: %INPUT_TRAFFIC_RATIO%%%
) else (
    set "ARG_TRAFFIC_RATIO=--traffic-ratio=80"
    echo     -^> Xac suat: Mac dinh [80%%]
)

:SKIP_TRAFFIC_RATIO
echo.

REM 19. Tuong tac lau voi website (Deep / Extended Interaction)
echo [19] Tuong tac lau voi website [Deep Engagement]:
echo      1. Duyet tat ca cac tab [Click vao tat ca cac tab ma page co, moi page/tab se scroll toi cuoi page - KHUYEN NGHI]
echo      2. Chi scroll trang hien tai [Khong click vao tab khac ma scroll toi cuoi trang tai page dau tien luon]
echo      3. Khong dung [Mac dinh - Tuong tac nhanh theo khu vuc quang cao]
set "INPUT_DEEP_ENGAGE="
set /p "INPUT_DEEP_ENGAGE=    Chon [1-3, Enter = 1]: "
if "%INPUT_DEEP_ENGAGE%"=="2" goto DEEP_ENGAGE_SINGLE
if "%INPUT_DEEP_ENGAGE%"=="3" goto DEEP_ENGAGE_SKIP

:DEEP_ENGAGE_ALL
set "ARG_DEEP_ENGAGE=--deep-engagement=all-tabs"
echo     -^> Tuong tac lau: DUYET TAT CA TAB [Click qua tung tab va scroll toi cuoi moi page/tab]
goto PROMPT_DEEP_RATIO

:DEEP_ENGAGE_SINGLE
set "ARG_DEEP_ENGAGE=--deep-engagement=single-page"
echo     -^> Tuong tac lau: CHI TRANG HIEN TAI [Khong click tab khac, chi scroll het trang dau tien]
goto PROMPT_DEEP_RATIO

:PROMPT_DEEP_RATIO
echo.
echo [20] Xac suat tuong tac lau [Deep Engagement Ratio]:
echo      Nhap ti le phan tram (vi du: 70, 80, 90, 100), hoac thap phan (0.7).
echo      Auto se tu dong thuc hien cuon trang / duyet tab theo ti le nay.
echo      De trong de su dung mac dinh (70%%).
set "INPUT_DEEP_RATIO="
set /p "INPUT_DEEP_RATIO=    Xac suat tuong tac lau (%%) [Enter = mac dinh 70%%]: "
if defined INPUT_DEEP_RATIO (
    set "ARG_DEEP_RATIO=--deep-engagement-ratio=%INPUT_DEEP_RATIO%"
    echo     -^> Xac suat: %INPUT_DEEP_RATIO%%%
) else (
    set "ARG_DEEP_RATIO=--deep-engagement-ratio=70"
    echo     -^> Xac suat: Mac dinh [70%%]
)
goto AFTER_DEEP_ENGAGE

:DEEP_ENGAGE_SKIP
set "ARG_DEEP_ENGAGE=--deep-engagement=none"
set "ARG_DEEP_RATIO=--deep-engagement-ratio=0"
echo     -^> Tuong tac lau: KHONG [Tuong tac nhanh theo khu vuc quang cao]

:AFTER_DEEP_ENGAGE
echo.

REM 21. Cuon trang truoc khi click quang cao (Scroll before ad click)
echo [21] Cuon trang truoc khi click quang cao [Scroll before ad click]:
echo      1. Co [Cuon luot trang truoc de kich hoat lazy-load va tang do tu nhien roi moi click ads - KHUYEN NGHI]
echo      2. Khong [Click ads ngay sau khi tai trang, khong cuon truoc]
set "INPUT_SCROLL_BEFORE="
set /p "INPUT_SCROLL_BEFORE=    Chon [1-2, Enter = 1]: "
if "%INPUT_SCROLL_BEFORE%"=="2" (
    set "ARG_SCROLL_BEFORE=--no-scroll-before-click"
    echo     -^> Cuon truoc khi click ads: KHONG [Click ads ngay]
) else (
    set "ARG_SCROLL_BEFORE=--scroll-before-click"
    echo     -^> Cuon truoc khi click ads: CO [Cuon truoc roi moi click ads]
)
echo.

REM Tong hop lenh thuc thi
set FINAL_ARGS=%ARG_MY_CHROME% %ARG_HEAD% %ARG_CLICK_MODE% %ARG_PROXY% %ARG_ANTI_DETECT_PROXY% %ARG_CB% %ARG_LIFETIME% %ARG_DELAY% %ARG_RECURSIVE% %ARG_CLEAN_CYCLES% %ARG_DEVICE% %ARG_BROWSERS% %ARG_INSTANCES% %ARG_HOVER% %ARG_RENDER_TIMEOUT% %ARG_POPUNDER% %ARG_AD_FOCUS% %ARG_AD_NETWORK% %ARG_TRAFFIC_SOURCE% %ARG_TRAFFIC_RATIO% %ARG_DEEP_ENGAGE% %ARG_DEEP_RATIO% %ARG_SCROLL_BEFORE%

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
