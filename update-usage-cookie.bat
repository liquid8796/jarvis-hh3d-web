@echo off
REM ============================================================================
REM  CAP NHAT COOKIE PHIEN VERCEL cua mot tram len secret cua workflow usage.
REM
REM  TEP DUY NHAT TRONG NHOM NAY VAN CHAY O MAY NHA, va co ly do:
REM    - No khong dung toi database, nen khong can len VM.
REM    - No can `gh auth status`, tuc mot luot `gh auth login` qua trinh duyet.
REM      Tren VM khong co trinh duyet de lam viec ay (gh o do chay bang GH_TOKEN,
REM      la duong khac han).
REM    - Tep cookie duoc xuat tu chinh trinh duyet dang dang nhap Vercel o may nay.
REM
REM  VAN CON NGHIA SAU 16/08/2026: cac tram Vercel nay chi la vo proxy, nhung MOI
REM  request cua nguoi dung van di qua chung, nen bang thong Vercel van bi tieu -
REM  do la thu workflow usage dem.
REM
REM  Bam dup tep nay. No hoi hai cau: ma tram, va duong dan tep cookie.
REM  KEO-THA tep cookie vao cua so console la ra duong dan - khong phai go tay.
REM
REM  CAN CHUAN BI TRUOC:
REM    - `gh` (GitHub CLI) da cai va da `gh auth login`. API GitHub doi ma hoa
REM      sealed-box de ghi secret, thu Node khong co san.
REM    - Mot tep cookie JSON xuat tu trinh duyet DANG dang nhap Vercel, dung tai
REM      khoan giu tram ay (co mang `cookies` va cookie ten `authorization`).
REM
REM  Doi so deu chuyen thang cho script:
REM     update-usage-cookie.bat --dry-run    chi in ke hoach, khong ghi secret
REM     update-usage-cookie.bat --list       in bang tram roi thoi
REM
REM  Bang tram doc tu .github/workflows/vercel-usage.yml - workflow la nguon co
REM  tham quyen, khong phai so nao khac. Go sai ma tram thi script in ra bang
REM  that roi dung - chua ghi gi.
REM
REM  HAI LUAT CUA TEP NAY, dung sua pham:
REM    1. Ket dong phai la CRLF.  2. Chi dung ky tu ASCII.
REM ============================================================================
setlocal
chcp 65001 >nul
cd /d "%~dp0"

echo %* | findstr /i /c:"--list" >nul && goto :chi_liet_ke

set "DRYRUN="
echo %* | findstr /i /c:"--dry-run" >nul && set "DRYRUN=1"

REM Da truyen san --site va --cookie thi KHONG hoi gi ca - chay thang, de mot
REM cong cu bam-dup van goi duoc tu mot script khac ma khong ai ngoi go.
set "CO_SITE="
echo %* | findstr /i /c:"--site" >nul && set "CO_SITE=1"
set "CO_COOKIE="
echo %* | findstr /i /c:"--cookie" >nul && set "CO_COOKIE=1"
if defined CO_SITE if defined CO_COOKIE goto :chay_thang

echo.
echo   === Cap nhat cookie cho mot tram ===
echo.
echo   Ma tram la cot dau trong bang cua workflow (vd: auto-hh3d, auto-hh3d-1).
echo   Chua nho thi bo trong roi Enter - script se in ra bang tram that.
echo.

set "SITE="
set /p "SITE=  Ma tram: "
if not defined SITE goto :chi_liet_ke

echo.
echo   Duong dan tep cookie JSON. KEO-THA tep vao day cung duoc.
echo.
set "COOKIE="
set /p "COOKIE=  Tep cookie: "
if not defined COOKIE (
  echo   [!!] Chua go duong dan tep cookie. Dung.
  goto :bye
)

echo.
call npm run usage:cookie -- --site "%SITE%" --cookie "%COOKIE%" %*
set "EXITCODE=%ERRORLEVEL%"
goto :ket_qua

:chay_thang
set "SITE=(theo doi so)"
echo.
call npm run usage:cookie -- %*
set "EXITCODE=%ERRORLEVEL%"

:ket_qua
echo.
if not "%EXITCODE%"=="0" goto :loi
if defined DRYRUN goto :chi_xem
echo   [OK] Xong - secret cua tram "%SITE%" da mang cookie moi.
echo        Nho XOA tep cookie: no la chia mo TOAN TAI KHOAN Vercel.
goto :xong

:chi_xem
echo   [OK] Da doc xong ke hoach - CHUA ghi secret nao. Bo --dry-run de ghi that.
goto :xong

:loi
echo   [!!] Ket thuc voi loi - doc dong bat dau bang dau X o tren.
echo        Chua ghi secret nao: script dung ngay o buoc dau tien that bai.

:xong
echo %* | findstr /i /c:"--no-pause" >nul || pause
exit /b %EXITCODE%

:chi_liet_ke
echo.
call npm run usage:cookie -- --list
set "EXITCODE=%ERRORLEVEL%"
echo.
echo   Chay lai va go MOT trong nhung ma tram o tren.
echo %* | findstr /i /c:"--no-pause" >nul || pause
exit /b %EXITCODE%

:bye
pause
exit /b 1
