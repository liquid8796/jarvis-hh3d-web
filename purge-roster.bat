@echo off
REM ============================================================================
REM  Don so diem danh - go nhung dong khoi loi tong mon da chet han.
REM
REM  CHAY TREN VM: so diem danh nam trong Postgres cua backend, ma Postgres ay
REM  chi nghe 127.0.0.1 tren jarvis-oci-01. Chay o may nha la doc mot database
REM  Neon cu da dong cung - no van tra ra so lieu, chi la so lieu cua ngay xua.
REM
REM  Doi so deu chuyen thang cho script:
REM     purge-roster.bat --dry-run          chi soi danh sach, khong go gi
REM     purge-roster.bat --older-than 6     doi nguong im lang (gio, mac dinh 24)
REM     purge-roster.bat --force            go ca dong co trong so Kho GitHub
REM ============================================================================
setlocal
chcp 65001 >nul
cd /d "%~dp0"

set "DRYRUN="
echo %* | findstr /i /c:"--dry-run" >nul && set "DRYRUN=1"

call npm run vm -- npm run roster:purge -- %*
set "EXITCODE=%ERRORLEVEL%"

echo.
if not "%EXITCODE%"=="0" goto :loi
if defined DRYRUN goto :chi_xem
echo [OK] Xong - so diem danh da sach.
goto :xong

:chi_xem
echo [OK] Da doc xong danh sach - CHUA go gi. Bo --dry-run de don that.
goto :xong

:loi
echo [!!] Ket thuc voi loi. Doc bang o tren:
echo      - "dong KHONG yen" = co tien trinh con song mang dung id ay, di tat no truoc

:xong
echo %* | findstr /i /c:"--no-pause" >nul || pause
exit /b %EXITCODE%
