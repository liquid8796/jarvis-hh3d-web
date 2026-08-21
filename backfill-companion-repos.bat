@echo off
REM ============================================================================
REM  BU KHO PHU CHO KHOI LOI CHUA CO DU HAI - tao phan con thieu, kho da du thi khoi.
REM
REM  DUNG KHI NAO: khoi loi dung TRUOC 19/08/2026 mang "companionRepos: []" - khong
REM  co kho phan mem di kem de vong nuoi day quota vao. Script nay doc so, tim kho
REM  nao thieu, tao dung phan con thieu (0, 1 hay 2 tuy tram) roi ghi lai so.
REM  KHONG dung lai ca bundle ba repo.
REM
REM  KHAC new-github-khoiloi.bat: cai ay dung mot khoi loi HOAN TOAN MOI va hoi mot
REM  PAT moi. Script nay KHONG hoi PAT - no doc PAT DA CO cua tung tram trong so,
REM  giai ma, roi tao kho phu duoi dung tai khoan ay. Kho da du hai thi bo qua.
REM
REM  CACH DUNG:
REM     backfill-companion-repos.bat                    moi kho thieu trong so
REM     backfill-companion-repos.bat --repo <ten kho>   dung mot kho
REM     backfill-companion-repos.bat --yes              khong hoi lai (cho lich chay)
REM     backfill-companion-repos.bat --no-pause         khong dung o cuoi
REM
REM  MOI KHO PHU LA MOT REPO CONG KHAI. Doc deploy/github-actions.md muc "Bundle 3
REM  repo" truoc khi dung lan dau.
REM
REM  CHAY TREN VM (npm run vm --) vi so Kho GitHub nam trong Postgres cua VM va gh
REM  da cai san o do - y het cac .bat con lai. PAT di sang VM trong so da ma hoa;
REM  script giai ma bang ENCRYPTION_KEY o do, khong bao gio in ra.
REM
REM  HAI LUAT CUA TEP NAY, dung sua pham:
REM    1. Ket dong phai la CRLF. cmd.exe doc tep batch theo BYTE OFFSET nen thieu \r
REM       la vo ngay o khoi if ( ... ) nhieu dong. .gitattributes dang ep dieu nay.
REM    2. Chi dung ky tu ASCII. Mot chu co dau la nhieu byte trong UTF-8; sau
REM       chcp 65001 bo doc cua cmd lech cho va bam nat ca tep.
REM ============================================================================
setlocal
chcp 65001 >nul
cd /d "%~dp0"

echo [1/2] Xem truoc - buoc nay chi DOC va dung thu, khong tao repo, khong ghi so...
echo.
call npm run vm -- npm run github:companions:backfill -- --dry-run %*
set "EXITCODE=%ERRORLEVEL%"
if not "%EXITCODE%"=="0" goto :loi_xem

echo.
echo ============================================================================
echo  Doc danh sach o tren:
echo    "R" (dau mui ten) = kho thieu, se duoc TAO them (moi kho phu la repo CONG KHAI)
echo    "=" = kho da du hai, KHONG bi dung toi
echo ============================================================================
echo.

echo %* | findstr /i /c:"--yes" >nul && goto :lam_that
choice /c YN /n /m "Tao kho phu cho nhung kho thieu o tren? [Y/N] "
if errorlevel 2 goto :thoi

:lam_that
echo.
echo [2/2] Dang tao kho phu va ghi so...
echo.
call npm run vm -- npm run github:companions:backfill -- %*
set "EXITCODE=%ERRORLEVEL%"
echo.
if not "%EXITCODE%"=="0" goto :loi_lam
echo [OK] Xong. Mo Tong Mon -^> Kho GitHub, moi dong gio phai hien du hai kho phan mem.
goto :xong

:thoi
set "EXITCODE=0"
echo.
echo [--] Da thoi - CHUA tao gi ca.
goto :xong

:loi_xem
echo.
echo [!!] Buoc xem truoc that bai - KHONG tao gi ca. Doc dong loi o tren.
echo      Hay gap nhat: khong vao duoc VM, hoac dang chay o may nha (phai chay tren VM).
goto :xong

:loi_lam
echo [!!] Ket thuc voi loi. Doc bang TONG KET: kho nao HONG va vi sao.
echo      Kho "PAT thuoc tai khoan khac" hoac "account was suspended" thi bo qua duoc;
echo      chay lai chinh script nay - kho da bu xong se hien "da du hai kho phu".

:xong
echo %* | findstr /i /c:"--no-pause" >nul || pause
exit /b %EXITCODE%
