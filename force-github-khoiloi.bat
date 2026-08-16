@echo off
REM ============================================================================
REM  EP KHOI LOI GITHUB DANG CHAY MA CU NHAY SANG BAN MOI - NGAY BAY GIO.
REM
REM  DUNG KHI NAO: sau mot luot `deploy-github-khoiloi.bat --restart`, nhung kho
REM  dang GIU DAN bi CHUA lai co y - huy luot Actions la giet runner tuc khac,
REM  roi reapStaleJobs ket lieu dan ay sau 3 phut. Nhung khoi loi do se con mang
REM  ma cu cho toi luot Actions ke, toi da ~4 gio (lich 0 */4 * * *). Vi du da
REM  gap 16/08/2026: khoiloi-tro-20260813-233056 duoc chua ba luot lien tiep.
REM  Script nay tra dung cai gia ay de co ban moi ngay.
REM
REM  CAI GIA, doc ky: dan dang chay tren nhung khoi loi bi cat SE HONG va phai
REM  khai lai tu dau. Do la dan cua dao huu khac, khong phai cua nguoi go lenh.
REM
REM  KHOI LOI DA CHAY MA MOI THI KHONG BI DUNG TOI. Phep huy chi nham vao luot
REM  Actions mang SHA khac SHA hien tai cua kho (reviewRestart trong
REM  scripts/githubKhoiloi.mts), nen `--force` khong cat nham mot dan nao dang
REM  chay tren dung ban moi.
REM
REM  CACH DUNG:
REM     force-github-khoiloi.bat                    moi kho dang chay ma cu
REM     force-github-khoiloi.bat --repo <ten kho>   dung mot kho
REM     force-github-khoiloi.bat --yes              khong hoi lai (cho lich chay)
REM     force-github-khoiloi.bat --no-pause         khong dung o cuoi
REM
REM  Ten kho lay o bang TONG KET cua deploy-github-khoiloi.bat, vi du
REM  linh-su-20260813-233056-6143 la kho cua khoiloi-tro-20260813-233056.
REM
REM  CHAY TREN VM (`npm run vm --`) vi so Kho GitHub nam trong Postgres cua VM,
REM  thu chi nghe 127.0.0.1 - y het deploy-github-khoiloi.bat.
REM ============================================================================
setlocal
chcp 65001 >nul
cd /d "%~dp0"

echo [1/2] Xem truoc - buoc nay chi DOC, khong huy gi ca...
echo.
call npm run vm -- npm run github:deploy -- --dry-run --restart --force %*
set "EXITCODE=%ERRORLEVEL%"
if not "%EXITCODE%"=="0" goto :loi_xem

echo.
echo ============================================================================
echo  Doc bang TONG KET o tren:
echo    "khoi dong lai (se): huy N luot ma cu"  = kho NAY sap bi cat va phat lai
echo    "khoi dong lai: khong can"              = kho NAY da chay dung ban moi
echo  Dan dang chay tren nhung kho bi cat se hong va phai khai lai.
echo ============================================================================
echo.

echo %* | findstr /i /c:"--yes" >nul && goto :lam_that
choice /c YN /n /m "Ep chung sang ban moi NGAY BAY GIO? [Y/N] "
if errorlevel 2 goto :thoi

:lam_that
echo.
echo [2/2] Dang ep...
echo.
call npm run vm -- npm run github:deploy -- --restart --force %*
set "EXITCODE=%ERRORLEVEL%"
echo.
if not "%EXITCODE%"=="0" goto :loi_ep
echo [OK] Xong - nhung kho o tren da duoc phat lai luot Actions voi ma moi.
echo      Khoi loi len ca sau ~30 giay; xem tab Khoi Loi de doc lai so hieu ban.
goto :xong

:thoi
set "EXITCODE=0"
echo.
echo [--] Da thoi - CHUA ep gi ca. Khong dan nao bi cat.
goto :xong

:loi_xem
echo.
echo [!!] Buoc xem truoc that bai - KHONG ep gi ca. Doc dong loi o tren.
echo      Hay gap nhat: khong vao duoc VM, hoac PAT cua mot kho da het han.
goto :xong

:loi_ep
echo [!!] Luot ep ket thuc voi loi. Doc bang TONG KET: kho nao dang LECH MA.
echo      Chay lai chinh script nay - nhung kho da xong se duoc bo qua.

:xong
echo %* | findstr /i /c:"--no-pause" >nul || pause
exit /b %EXITCODE%
