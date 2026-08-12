@echo off
REM ============================================================================
REM  PHAT HANH cho DUNG MOT tram - ban moi nhat cua HEAD len tram ban chon.
REM
REM  Bam dup tep nay. No hoi ma tram roi goi deploy:all voi co --site.
REM
REM  Ma tram la `id` trong so guong, KHONG phai ten project Vercel: tram goc mang
REM  ma `main` ma song o project `auto-hh3d`. Go sai thi script in ra danh sach
REM  ma tram co that roi dung, chua phat hanh gi.
REM
REM  Doi so deu chuyen thang cho script:
REM     deploy-one-station.bat --dry-run     chi in ke hoach, khong phat hanh
REM     deploy-one-station.bat --no-pause    khong dung cho o cuoi (dung trong terminal)
REM
REM  Muon phat hanh cho CA DOI thi dung deploy-all-stations.bat. Tep nay co y chi
REM  dung mot tram, va bang tong ket se noi ro nhung tram con lai KHONG duoc dung
REM  toi - chung co the dang mang ma cu.
REM
REM  HAI LUAT CUA TEP NAY, dung sua pham (giong hai tep .bat kia):
REM    1. Ket dong phai la CRLF. cmd.exe doc theo byte offset nen thieu \r la vo
REM       ngay o khoi nhieu dong. .gitattributes dang ep dieu nay.
REM    2. Chi dung ky tu ASCII. Mot chu co dau la nhieu byte trong UTF-8; sau
REM       `chcp 65001` bo doc cua cmd lech cho va bam nat ca tep. Chu tieng Viet
REM       chi duoc phep nam trong dau ra cua Node.
REM ============================================================================
setlocal

chcp 65001 >nul
cd /d "%~dp0"

echo.
echo   === Phat hanh cho mot tram ===
echo.
echo   Ma tram la `id` trong so guong (vd: main, auto-hh3d-1, auto-hh3d-2).
echo   Chua nho thi go bua mot cai - script se in ra danh sach that roi dung.
echo.

set "SITE="
set /p "SITE=  Ma tram: "
if not defined SITE (
  echo   [!!] Chua go ma tram. Dung.
  goto :bye
)

REM Nhan --dry-run TRUOC khi chay, de con noi dung su that o dong cuoi.
set "DRYRUN="
echo %* | findstr /i /c:"--dry-run" >nul && set "DRYRUN=1"

echo.
REM `call` la bat buoc: npm la mot tep .cmd, thieu `call` thi batch nay ket thuc
REM ngay tai day va moi dong ben duoi khong bao gio chay.
call npm run deploy:all -- --site "%SITE%" %*
set "EXITCODE=%ERRORLEVEL%"

REM Nhanh goto PHANG, khong long if(...)else(...): cmd.exe doc ca khoi ngoac mot
REM lan truoc khi chay, nen mot dau ) lot vao chuoi echo la vo ca khoi.
echo.
if not "%EXITCODE%"=="0" goto :loi
if defined DRYRUN goto :chi_xem
echo   [OK] Xong - tram "%SITE%" da mang commit moi nhat.
echo        Cac tram KHAC khong duoc dung toi; xem bang TONG KET o tren.
goto :xong

:chi_xem
echo   [OK] Da doc xong ke hoach - CHUA phat hanh gi. Bo --dry-run de phat hanh that.
goto :xong

:loi
echo   [!!] Ket thuc voi loi. Doc bang TONG KET o tren: ma tram co dung khong,
echo        hay so guong da cu va tram DANG PHUC VU khong nam trong so.

:xong
echo %* | findstr /i /c:"--no-pause" >nul || pause
exit /b %EXITCODE%

:bye
pause
exit /b 1
