@echo off
REM ============================================================================
REM  Dung MOT KHOI LOI GITHUB MOI - tu mot PAT toi mot dong trong so kho.
REM
REM  Bam dup tep nay. No hoi dung MOT thu: PAT cua tai khoan GitHub se giu kho.
REM  Moi thu con lai script tu lo: ten kho (ngau nhien), WORKER_ID theo khuon
REM  github-khoiloi-<moc thoi gian>, workflow, secret, va ghi vao so cua tram
REM  DANG HOAT DONG.
REM
REM  PAT CAN QUYEN (thieu la hong o tan buoc cuoi):
REM    - Classic     : scope repo + workflow
REM    - Fine-grained: Contents read/write + Actions read/write
REM
REM  CAN CO TRUOC (script kiem va noi ro neu thieu):
REM    - gh (GitHub CLI): winget install --id GitHub.cli
REM      KHONG can `gh auth login` - PAT di qua bien GH_TOKEN cua rieng luot chay.
REM    - .env co WORKER_TOKEN:
REM      vercel env pull .env --environment=production --yes
REM
REM  HAI LUAT CUA TEP NAY, dung sua pham:
REM    1. Ket dong phai la CRLF. cmd.exe doc theo byte offset nen thieu \r la vo
REM       ngay o khoi `if ( ... )` nhieu dong. .gitattributes dang ep dieu nay.
REM    2. Chi dung ky tu ASCII. Mot dau gach dai hay mot chu co dau la nhieu byte
REM       trong UTF-8; sau `chcp 65001` bo doc cua cmd lech cho va bam nat ca tep.
REM       Chu tieng Viet co dau chi duoc phep nam trong dau ra cua Node.
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

REM GITHUB_PAT dat san tu ngoai thi bo qua buoc hoi - dung cho luot chay lai
REM va cho viec kiem thu.
if defined GITHUB_PAT goto :run

echo   PAT cua tai khoan GitHub se giu kho nay.
echo   (Ky tu se KHONG hien khi go.)
echo.

REM Doc PAT o che do an: Read-Host -AsSecureString roi doi nguoc lai. Lam vay de
REM token khong nam lai trong lich su console cua ai do dung chung may.
for /f "usebackq delims=" %%p in (`powershell -NoProfile -Command "$s = Read-Host -AsSecureString '  PAT'; [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))"`) do set "GITHUB_PAT=%%p"

if not defined GITHUB_PAT (
  echo   [!!] Chua go PAT. Dung.
  goto :bye
)

:run
echo.
call npm run github:new -- %*
set "EXITCODE=%ERRORLEVEL%"

REM Xoa PAT khoi bien moi truong cua cua so nay ngay khi xong.
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
