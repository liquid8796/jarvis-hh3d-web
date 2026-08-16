@echo off
REM ============================================================================
REM  Dung MOT KHOI LOI GITHUB MOI - tu mot PAT toi mot dong trong so kho.
REM
REM  CHAY TREN VM: so Kho GitHub nam trong Postgres cua backend (chi nghe
REM  127.0.0.1 tren jarvis-oci-01), va `gh` - thu dat secret WORKER_TOKEN cho
REM  kho moi - da duoc cai san o do. `gh` doc PAT qua bien GH_TOKEN nen khong
REM  can `gh auth login`; may nha khong con phai cai gi ca.
REM
REM  Bam dup tep nay. No hoi dung MOT thu: PAT cua tai khoan GitHub se giu kho.
REM
REM  PAT CAN QUYEN (thieu la hong o tan buoc cuoi):
REM    - Classic     : scope repo + workflow
REM    - Fine-grained: Contents read/write + Actions read/write
REM
REM  HAI LUAT CUA TEP NAY, dung sua pham:
REM    1. Ket dong phai la CRLF. cmd.exe doc theo byte offset nen thieu  la vo
REM       ngay o khoi `if ( ... )` nhieu dong. .gitattributes dang ep dieu nay.
REM    2. Chi dung ky tu ASCII. Mot chu co dau la nhieu byte trong UTF-8; sau
REM       `chcp 65001` bo doc cua cmd lech cho va bam nat ca tep.
REM ============================================================================
setlocal
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo   === Dung khoi loi GitHub moi ===
echo.
echo   Kho tao ra la CONG KHAI, va nhat ky Actions cua no ai cung doc duoc.
echo   Doc deploy/github-actions.md muc 6 truoc khi dung lan dau.
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
call npm run vm -- --env GITHUB_PAT -- npm run github:new -- %*
set "EXITCODE=%ERRORLEVEL%"
set "GITHUB_PAT="

echo.
if "%EXITCODE%"=="0" (
  echo   [OK] Xong. Doc dong "Nghiem thu" o tren.
) else (
  echo   [!!] Ket thuc voi loi. Doc ky dong bat dau bang dau X o tren.
)

echo %* | findstr /i /c:"--no-pause" >nul || pause
exit /b %EXITCODE%

:bye
set "GITHUB_PAT="
pause
exit /b 1
