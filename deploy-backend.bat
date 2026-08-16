@echo off
REM ============================================================================
REM  Phat hanh BACKEND len VM OCI (jarvis-oci-01) - thay cho deploy-all-stations
REM  tu 16/08/2026: backend + database song tron tren VM, cac tram Vercel chi con
REM  la vo proxy (hiem khi phai dong lai - dung deployercel-proxy khi can).
REM
REM  Cach dung: bam dup la phat hanh HEAD. Can xem truoc thi chay tay:
REM     npm run deploy:backend -- --restart   (chi khoi dong lai service)
REM ============================================================================
setlocal
chcp 65001 >nul
cd /d "%~dp0"
call npm run deploy:backend
set "EXITCODE=%ERRORLEVEL%"
echo.
if not "%EXITCODE%"=="0" (
  echo [!!] Phat hanh KHONG xong - doc dong loi o tren.
) else (
  echo [OK] Backend tren VM da mang ban moi.
)
pause
exit /b %EXITCODE%
