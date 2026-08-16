@echo off
REM ============================================================================
REM  Dung mot TRAM GUONG MOI - tu tai khoan Vercel trang toi tram nam trong so.
REM
REM  Bam dup tep nay. No hoi hai cau roi goi scripts/newMirrorStation.mts.
REM
REM  CAN CHUAN BI TRUOC (script se kiem va noi neu thieu):
REM    - Mot tai khoan Vercel co TEAM, va mot API token cua tai khoan do.
REM    - Team ay da cai san Neon va MongoDB Atlas. Lan dau cai doi chap thuan
REM      dieu khoan - Vercel co y bat buoc co nguoi that, khong script nao vuot.
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
echo   === Dung tram guong moi ===
echo.
echo   Ma tram theo le dat ten: auto-hh3d-^<so tang dan^>
echo   Ma nay dung cho CA BA cho: SITE_ID, ten project Vercel, va dia chi
echo   https://^<ma^>.vercel.app - nen go mot lan, dung mai.
echo.

set "SITE="
set /p "SITE=  Ma tram (vd auto-hh3d-3): "
if not defined SITE (
  echo   [!!] Chua go ma tram. Dung.
  goto :bye
)

REM MIRROR_TOKEN dat san tu ngoai thi bo qua buoc hoi - dung cho luot chay lai
REM va cho viec kiem thu.
if defined MIRROR_TOKEN goto :run

echo.
echo   Token cua tai khoan Vercel giu tram nay.
echo   Go xong se duoc cat vao .env.local - lan sau khong phai go nua.
echo   (Ky tu se KHONG hien khi go.)
echo.

REM Doc token o che do an: Read-Host -AsSecureString roi doi nguoc lai. Lam vay de
REM token khong nam lai trong lich su console cua ai do dung chung may.
for /f "usebackq delims=" %%p in (`powershell -NoProfile -Command "$s = Read-Host -AsSecureString '  Token'; [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))"`) do set "MIRROR_TOKEN=%%p"

if not defined MIRROR_TOKEN (
  echo   [!!] Chua go token. Dung.
  goto :bye
)

:run
echo.
call npm run mirror:new -- --site %SITE% %*
set "EXITCODE=%ERRORLEVEL%"

REM Xoa token khoi bien moi truong cua cua so nay ngay khi xong.
set "MIRROR_TOKEN="

echo.
if "%EXITCODE%"=="0" (
  echo   [OK] Xong. Doc hai viec con lai o tren.
) else (
  echo   [!!] Ket thuc voi loi. Doc ky dong bat dau bang dau X o tren.
)

echo %* | findstr /i /c:"--no-pause" >nul || pause
exit /b %EXITCODE%

:bye
set "MIRROR_TOKEN="
pause
exit /b 1
