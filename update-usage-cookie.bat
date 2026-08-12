@echo off
REM ============================================================================
REM  CAP NHAT COOKIE PHIEN VERCEL cua mot tram len secret cua workflow Vercel usage.
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
REM     update-usage-cookie.bat --no-pause   khong dung cho o cuoi
REM
REM  Go sai ma tram thi script in ra BANG TRAM that roi dung - chua ghi gi.
REM
REM  HAI LUAT CUA TEP NAY, dung sua pham (giong ba tep .bat kia):
REM    1. Ket dong phai la CRLF. cmd.exe doc theo byte offset nen thieu \r la vo
REM       ngay o khoi nhieu dong. .gitattributes dang ep dieu nay.
REM    2. Chi dung ky tu ASCII. Mot chu co dau la nhieu byte trong UTF-8; sau
REM       `chcp 65001` bo doc cua cmd lech cho va bam nat ca tep. Chu tieng Viet
REM       chi duoc phep nam trong dau ra cua Node.
REM ============================================================================
setlocal

chcp 65001 >nul
cd /d "%~dp0"

REM --list thi khong hoi gi ca, in bang roi thoi.
echo %* | findstr /i /c:"--list" >nul && goto :chi_liet_ke

REM Nhan --dry-run TRUOC khi chay, de con noi dung su that o dong cuoi.
set "DRYRUN="
echo %* | findstr /i /c:"--dry-run" >nul && set "DRYRUN=1"

REM Da truyen san --site va --cookie thi KHONG hoi gi ca - chay thang. Cung loi
REM `if defined MIRROR_TOKEN goto :run` cua new-mirror-station.bat: mot cong cu
REM bam-dup van phai goi duoc tu mot script khac ma khong ai ngoi go.
set "CO_SITE="
echo %* | findstr /i /c:"--site" >nul && set "CO_SITE=1"
set "CO_COOKIE="
echo %* | findstr /i /c:"--cookie" >nul && set "CO_COOKIE=1"
if defined CO_SITE if defined CO_COOKIE goto :chay_thang

echo.
echo   === Cap nhat cookie cho mot tram ===
echo.
echo   Ma tram la `id` trong so guong (vd: auto-hh3d, auto-hh3d-1).
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
REM `call` la bat buoc: npm la mot tep .cmd, thieu `call` thi batch nay ket thuc
REM ngay tai day va moi dong ben duoi khong bao gio chay.
call npm run usage:cookie -- --site "%SITE%" --cookie "%COOKIE%" %*
set "EXITCODE=%ERRORLEVEL%"
goto :ket_qua

:chay_thang
set "SITE=(theo doi so)"
echo.
call npm run usage:cookie -- %*
set "EXITCODE=%ERRORLEVEL%"

:ket_qua

REM Nhanh goto PHANG, khong long if(...)else(...): cmd.exe doc ca khoi ngoac mot
REM lan truoc khi chay, nen mot dau ) lot vao chuoi echo la vo ca khoi.
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
