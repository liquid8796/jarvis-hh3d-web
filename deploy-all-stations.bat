@echo off
REM ============================================================================
REM  Phat hanh dong bo - moi tram trong so guong nhan cung mot commit.
REM
REM  Bam dup tep nay la xong. Viec that nam o scripts/deployAllStations.mts;
REM  tep .bat nay chi lo phan ma cmd.exe can: dung cho, bang ma, va giu cua so
REM  lai de con doc ket qua.
REM
REM  Doi so deu chuyen thang cho script:
REM     deploy-all-stations.bat --dry-run     chi in ke hoach, khong phat hanh
REM     deploy-all-stations.bat --no-pause    khong dung cho o cuoi (dung trong terminal)
REM ============================================================================
setlocal

REM Bang ma UTF-8: nhat ky cua script viet bang tieng Viet co dau, con console
REM mac dinh cua Windows la codepage 437/1258 nen se hien ra chu rac.
chcp 65001 >nul

REM Chay tu THU MUC CHUA TEP NAY, khong phai thu muc nguoi dung dang dung.
REM %~dp0 luon ket thuc bang dau \ nen khong them dau \ nua.
cd /d "%~dp0"

REM Nhan --dry-run TRUOC khi chay, de con noi dung su that o dong cuoi. Mot luot --dry-run
REM khong phat hanh gi ca, ma dong "[OK] moi tram da mang cung mot commit" thi doc nhu da
REM phat hanh xong - va dong cuoi la thu duy nhat nguoi ta con doc sau bon luot build Vercel.
set "DRYRUN="
echo %* | findstr /i /c:"--dry-run" >nul && set "DRYRUN=1"

REM `call` la bat buoc: npm la mot tep .cmd, thieu `call` thi batch nay ket thuc
REM ngay tai day va moi dong ben duoi khong bao gio chay.
call npm run deploy:all -- %*
set "EXITCODE=%ERRORLEVEL%"

REM Nhanh goto PHANG, khong long if(...)else(...): cmd.exe doc ca khoi ngoac mot lan truoc khi
REM chay, nen mot dau ) lot vao chuoi echo la vo ca khoi. Goto thi khong co cai bay ay.
echo.
if not "%EXITCODE%"=="0" goto :loi
if defined DRYRUN goto :chi_xem
echo [OK] Xong - moi tram TRONG SO da mang cung mot commit.
goto :xong

:chi_xem
echo [OK] Da doc xong ke hoach - CHUA phat hanh gi. Bo --dry-run de phat hanh that.
goto :xong

:loi
echo [!!] Ket thuc voi loi. Doc bang TONG KET o tren: tram nao dang lech ma, hoac
echo      so guong da cu va tram DANG PHUC VU khong nam trong ke hoach.

:xong

REM Bam dup thi cua so tat ngay khi chay xong, khong kip doc gi - nen dung cho.
REM Chay trong terminal thi truyen --no-pause de bo qua doan nay.
echo %* | findstr /i /c:"--no-pause" >nul || pause

exit /b %EXITCODE%
