@echo off
REM ============================================================================
REM  Don so diem danh - go nhung dong khoi loi tong mon da chet han.
REM
REM  Vi sao can: so diem danh la so DANG KY, khong phai danh sach tien trinh.
REM  Mot cai ten vao roi o lai vinh vien, va `forgetWorker` chi go duoc khoi loi
REM  RIENG - nen dong cua khoi loi TONG MON da chet thi khong cua nao don.
REM
REM  CHAY DUOC O BAT KY TRAM NAO: script tu hoi bang dieu phoi tren OCI xem tram
REM  nao dang hoat dong, roi tu tra chuoi ket noi cua tram ay - qua so guong, va
REM  neu so duoi may cung chet thi hoi thang Vercel. Khong phu thuoc vao
REM  DATABASE_URL trong .env dang tro vao dau.
REM
REM  Doi so deu chuyen thang cho script:
REM     purge-roster.bat --dry-run          chi soi danh sach, khong go gi
REM     purge-roster.bat --older-than 6     doi nguong im lang (gio, mac dinh 24)
REM     purge-roster.bat --force            go ca dong co trong so Kho GitHub
REM     purge-roster.bat --no-pause         khong dung cho o cuoi
REM ============================================================================
setlocal

REM Bang ma UTF-8: nhat ky cua script viet bang tieng Viet co dau, con console
REM mac dinh cua Windows la codepage 437/1258 nen se hien ra chu rac.
chcp 65001 >nul

REM Chay tu THU MUC CHUA TEP NAY, khong phai thu muc nguoi dung dang dung.
cd /d "%~dp0"

set "DRYRUN="
echo %* | findstr /i /c:"--dry-run" >nul && set "DRYRUN=1"

REM `call` la bat buoc: npm la mot tep .cmd, thieu `call` thi batch nay ket thuc
REM ngay tai day va moi dong ben duoi khong bao gio chay.
call npm run roster:purge -- %*
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
echo      - "khong tra ra chuoi ket noi" = thieu VERCEL_TOKEN_<TEN TRAM> trong .env.local
echo      - "dong KHONG yen" = co tien trinh con song mang dung id ay, di tat no truoc

:xong

REM Bam dup thi cua so tat ngay khi chay xong, khong kip doc gi - nen dung cho.
echo %* | findstr /i /c:"--no-pause" >nul || pause

exit /b %EXITCODE%
