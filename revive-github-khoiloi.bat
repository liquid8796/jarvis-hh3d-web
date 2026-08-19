@echo off
REM ============================================================================
REM  HOI SINH KHOI LOI GITHUB DA CHET DUNG - cat luot Actions treo, phat luot moi.
REM
REM  DUNG KHI NAO: tab Khoi Loi hien mot vai khoi loi mau xam kem "vang 1 gio 37
REM  phut" trong khi nhung cai khac van "dang truc". Runner trong luot Actions
REM  cua chung da chet (het RAM, mang dut, GitHub cat ngang) nhung luot chay thi
REM  van con do - ghe ay khong nhan dan nao nua cho toi luot ke, toi da ~4 gio.
REM
REM  KHAC `force-github-khoiloi.bat` o CAU HOI, khong phai o muc do manh tay:
REM    force   hoi "luot nay co mang MA CU khong" - de nang ban, va no CHUA
REM            khoi loi dang giu dan.
REM    revive  hoi "khoi loi nay con SONG khong" - de dung day mot tien trinh
REM            da chet. Ma cu hay moi khong lien quan.
REM
REM  CAI GIA: gan nhu bang khong. Mot khoi loi im lang qua 3 phut da bi
REM  reapStaleJobs tuoc sach dan tu lau, nen toi luc nguong 10 phut cham toi thi
REM  khong con dan nao de cat. Khoi loi DANG TRUC khong bao gio bi dung toi.
REM
REM  CACH DUNG:
REM     revive-github-khoiloi.bat                    moi kho dang bat trong so
REM     revive-github-khoiloi.bat --repo <ten kho>   dung mot kho
REM     revive-github-khoiloi.bat --away 30          doi nguong im lang (phut)
REM     revive-github-khoiloi.bat --yes              khong hoi lai (cho lich chay)
REM     revive-github-khoiloi.bat --no-pause         khong dung o cuoi
REM
REM  CHAY TREN VM (`npm run vm --`) vi so Kho GitHub va so diem danh deu nam
REM  trong Postgres cua VM, thu chi nghe 127.0.0.1 - y het cac .bat con lai.
REM ============================================================================
setlocal
chcp 65001 >nul
cd /d "%~dp0"

echo [1/2] Xem truoc - buoc nay chi DOC, khong cat gi ca...
echo.
call npm run vm -- npm run github:revive -- --dry-run %*
set "EXITCODE=%ERRORLEVEL%"
if not "%EXITCODE%"=="0" goto :loi_xem

echo.
echo ============================================================================
echo  Doc danh sach o tren:
echo    "=" = khoi loi con truc, KHONG bi dung toi
echo    "R" = khoi loi da chet, se bi cat luot treo va phat luot moi
echo ============================================================================
echo.

echo %* | findstr /i /c:"--yes" >nul && goto :lam_that
choice /c YN /n /m "Hoi sinh nhung khoi loi da chet o tren? [Y/N] "
if errorlevel 2 goto :thoi

:lam_that
echo.
echo [2/2] Dang hoi sinh...
echo.
call npm run vm -- npm run github:revive -- %*
set "EXITCODE=%ERRORLEVEL%"
echo.
if not "%EXITCODE%"=="0" goto :loi_lam
echo [OK] Xong - luot Actions moi len ca sau ~30 giay.
echo      Mo tab Khoi Loi o trang Hang Doi de chac chung da "dang truc".
goto :xong

:thoi
set "EXITCODE=0"
echo.
echo [--] Da thoi - CHUA cat gi ca.
goto :xong

:loi_xem
echo.
echo [!!] Buoc xem truoc that bai - KHONG cat gi ca. Doc dong loi o tren.
echo      Hay gap nhat: khong vao duoc VM, hoac PAT cua mot kho da het han.
goto :xong

:loi_lam
echo [!!] Ket thuc voi loi. Doc bang TONG KET: kho nao HONG va vi sao.
echo      Chay lai chinh script nay - kho da hoi sinh xong se hien "con truc".

:xong
echo %* | findstr /i /c:"--no-pause" >nul || pause
exit /b %EXITCODE%
