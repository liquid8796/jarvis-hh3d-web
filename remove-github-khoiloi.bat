@echo off
REM ============================================================================
REM  XOA SACH MOT KHO KHOI LOI GITHUB - kho, dong so, va dong diem danh.
REM  Nua doi xung cua new-github-khoiloi.bat.
REM
REM  CHAY TREN VM: so Kho GitHub va bang workers deu nam trong Postgres cua
REM  backend, chi nghe 127.0.0.1 tren jarvis-oci-01.
REM
REM  Script hoi lai TEN KHO truoc khi xoa (khong phai y/n). Cau hoi ay di qua
REM  SSH duoc: npm run vm cap mot TTY khi co nguoi that dang go. Chay trong may
REM  moc thi dung --yes.
REM
REM  PAT CAN QUYEN `delete_repo` (classic) hoac Administration read/write. Day la
REM  scope ma new-github-khoiloi.bat KHONG doi, nen cai PAT da dung kho thuong
REM  KHONG xoa duoc no - phai them quyen truoc.
REM
REM  Doi so deu chuyen thang cho script:
REM     remove-github-khoiloi.bat --dry-run        chi in ke hoach, khong xoa gi
REM     remove-github-khoiloi.bat --repo <ten>     chon khi tai khoan co nhieu kho
REM     remove-github-khoiloi.bat --yes            bo cau xac nhan go tay
REM     remove-github-khoiloi.bat --force          xoa ke ca khi dang giu dan
REM
REM  HAI LUAT CUA TEP NAY, dung sua pham (giong new-github-khoiloi.bat):
REM    1. Ket dong phai la CRLF.  2. Chi dung ky tu ASCII.
REM ============================================================================
setlocal
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo   === Xoa mot kho khoi loi GitHub ===
echo.
echo   Se xoa: kho tren GitHub, dong trong so Kho GitHub, va dong diem danh
echo   trong bang workers. Khong hoan tac duoc.
echo.
echo   Muon xem truoc ma chua xoa gi: chay lai voi --dry-run
echo.
REM GITHUB_PAT dat san tu ngoai thi bo qua buoc hoi - dung cho luot chay lai.
if defined GITHUB_PAT goto :run

echo   PAT cua tai khoan GitHub. (Ky tu se KHONG hien khi go.)
echo.

REM Doc PAT o che do an roi doi nguoc lai, de token khong nam lai trong lich su
REM console. No di sang VM bang co --env cua npm run vm: gia tri duoc gui qua
REM STDIN cua mot luot ssh rieng va ghi vao tep 0600, KHONG bao gio nam tren
REM dong lenh - vi `sudo` ghi tron dong lenh vao /var/log/auth.log.
for /f "usebackq delims=" %%p in (`powershell -NoProfile -Command "$s = Read-Host -AsSecureString '  PAT'; [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))"`) do set "GITHUB_PAT=%%p"

if not defined GITHUB_PAT (
  echo   [!!] Chua go PAT. Dung.
  goto :bye
)

:run
echo.
call npm run vm -- --env GITHUB_PAT -- npm run github:remove -- %*
set "EXITCODE=%ERRORLEVEL%"
set "GITHUB_PAT="

REM Nhanh goto PHANG, khong long if(...)else(...): cmd.exe doc ca khoi ngoac mot
REM lan truoc khi chay, nen mot dau ) lot vao chuoi echo la vo ca khoi.
echo.
if not "%EXITCODE%"=="0" goto :loi
echo   [OK] Xong. Doc dong "Nghiem thu" o tren.
goto :xong

:loi
echo   [!!] Ket thuc voi loi hoac bi huy - doc ky dong bat dau bang dau X o tren.
echo        Script xoa kho TRUOC khi don so, nen khong co canh "da go so ma kho
echo        van chay".

:xong
echo %* | findstr /i /c:"--no-pause" >nul || pause
exit /b %EXITCODE%

:bye
set "GITHUB_PAT="
pause
exit /b 1
