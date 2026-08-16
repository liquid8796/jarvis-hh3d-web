@echo off
REM ============================================================================
REM  XOA MOT TRAM GUONG - so, project Vercel, va moi kho cua no.
REM
REM  Bam dup tep nay. No hoi ma tram roi goi scripts/removeMirrorStation.mts.
REM
REM  Doi so deu chuyen thang cho script:
REM     remove-mirror-station.bat --dry-run     chi in ke hoach, khong xoa gi
REM     remove-mirror-station.bat --project auto-hh3d   khi ten project KHAC ma tram
REM     remove-mirror-station.bat --no-pause    khong dung cho o cuoi (dung trong terminal)
REM
REM  Script TU CHOI xoa tram dang phuc vu, va tu choi dung toi kho dang dung chung
REM  voi project khac. Truoc khi go so, no luu dong so ra mot tep trong %TEMP%.
REM
REM  HAI LUAT CUA TEP NAY, dung sua pham (giong new-mirror-station.bat):
REM    1. Ket dong phai la CRLF. cmd.exe doc theo byte offset nen thieu \r la vo
REM       ngay o khoi nhieu dong. .gitattributes dang ep dieu nay.
REM    2. Chi dung ky tu ASCII. Mot chu co dau la nhieu byte trong UTF-8; sau
REM       `chcp 65001` bo doc cua cmd lech cho va bam nat ca tep. Chu tieng Viet
REM       chi duoc phep nam trong dau ra cua Node.
REM ============================================================================
setlocal

chcp 65001 >nul
cd /d "%~dp0"

echo.
echo   === Xoa mot tram guong ===
echo.
echo   Se xoa: dong trong so guong, project Vercel, va moi kho (Neon + Atlas)
echo   chi noi rieng project ay. Khong hoan tac duoc.
echo.

set "SITE="
set /p "SITE=  Ma tram can xoa (vd auto-hh3d-1): "
if not defined SITE (
  echo   [!!] Chua go ma tram. Dung.
  goto :bye
)

echo.
call npm run mirror:remove -- --site "%SITE%" %*
set "EXITCODE=%ERRORLEVEL%"

REM Nhanh goto PHANG, khong long if(...)else(...): cmd.exe doc ca khoi ngoac mot
REM lan truoc khi chay, nen mot dau ) lot vao chuoi echo la vo ca khoi.
echo.
if not "%EXITCODE%"=="0" goto :loi
echo   [OK] Xong. Doc bang o tren de biet kho nao da xoa, kho nao co y giu lai.
goto :xong

:loi
echo   [!!] Ket thuc voi loi hoac bi huy - doc dong bat dau bang dau X o tren.
echo        Khong co gi bi xoa nua a: script dung ngay o buoc dau tien that bai.

:xong
echo %* | findstr /i /c:"--no-pause" >nul || pause
exit /b %EXITCODE%

:bye
pause
exit /b 1
