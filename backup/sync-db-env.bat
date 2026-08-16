@echo off
REM ============================================================================
REM  Dong bo thong tin database cua TRAM DANG PHUC VU vao .env.local.
REM
REM  Bam dup tep nay la xong. Viec that nam o scripts/syncActiveStationEnv.mts;
REM  tep .bat nay chi lo phan ma cmd.exe can: dung cho, bang ma, va giu cua so
REM  lai de con doc ket qua.
REM
REM  DUNG KHI NAO: sau moi luot chuyen tram, hoac khi mot cong cu bao "so guong
REM  chua co tram nao" / khong noi duoc database. Luc ay .env.local dang tro vao
REM  mot tram DA NGHI - no van noi duoc, van doc ra du lieu that, chi la du lieu
REM  cua mot tram khong ai dung nua.
REM
REM  Doi so deu chuyen thang cho script:
REM     sync-db-env.bat --dry-run     chi in se doi khoa nao, KHONG ghi gi
REM     sync-db-env.bat --no-pause    khong dung cho o cuoi (dung trong terminal)
REM ============================================================================
setlocal

REM Bang ma UTF-8: nhat ky cua script viet bang tieng Viet co dau, con console
REM mac dinh cua Windows la codepage 437/1258 nen se hien ra chu rac.
chcp 65001 >nul

REM Chay tu THU MUC CHUA TEP NAY, khong phai thu muc nguoi dung dang dung.
REM %~dp0 luon ket thuc bang dau \ nen khong them dau \ nua.
cd /d "%~dp0"

REM Nhan --dry-run TRUOC khi chay, de con noi dung su that o dong cuoi. Mot luot
REM --dry-run khong ghi gi ca, ma dong "[OK] da va xong" thi doc nhu da ghi that.
set "DRYRUN="
echo %* | findstr /i /c:"--dry-run" >nul && set "DRYRUN=1"

REM `call` la bat buoc: npm la mot tep .cmd, thieu `call` thi batch nay ket thuc
REM ngay tai day va moi dong ben duoi khong bao gio chay.
call npm run env:sync -- %*
set "EXITCODE=%ERRORLEVEL%"

REM Nhanh goto PHANG, khong long if(...)else(...): cmd.exe doc ca khoi ngoac mot lan
REM truoc khi chay, nen mot dau ) lot vao chuoi echo la vo ca khoi.
echo.
if not "%EXITCODE%"=="0" goto :loi
if defined DRYRUN goto :chi_xem
echo [OK] Xong - .env.local nay tro vao tram dang phuc vu.
echo      Tien trinh nao dang chay (next dev, script dai) phai khoi dong lai moi thay gia tri moi.
goto :xong

:chi_xem
echo [OK] Da doc xong ke hoach - CHUA ghi gi. Bo --dry-run de va that.
goto :xong

:loi
echo [!!] Ket thuc voi loi - doc dong bat dau bang dau X o tren.
echo      Chua ghi gi ca: script dung truoc khi cham vao .env.local.

:xong

REM Bam dup thi cua so tat ngay khi chay xong, khong kip doc gi - nen dung cho.
REM Chay trong terminal thi truyen --no-pause de bo qua doan nay.
echo %* | findstr /i /c:"--no-pause" >nul || pause

exit /b %EXITCODE%
