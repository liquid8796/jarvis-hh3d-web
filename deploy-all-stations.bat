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

REM `call` la bat buoc: npm la mot tep .cmd, thieu `call` thi batch nay ket thuc
REM ngay tai day va moi dong ben duoi khong bao gio chay.
call npm run deploy:all -- %*
set "EXITCODE=%ERRORLEVEL%"

echo.
if "%EXITCODE%"=="0" (
  echo [OK] Xong - moi tram da mang cung mot commit.
) else (
  echo [!!] Ket thuc voi loi. Doc bang TONG KET o tren: tram nao dang lech ma.
)

REM Bam dup thi cua so tat ngay khi chay xong, khong kip doc gi - nen dung cho.
REM Chay trong terminal thi truyen --no-pause de bo qua doan nay.
echo %* | findstr /i /c:"--no-pause" >nul || pause

exit /b %EXITCODE%
