@echo off
REM ============================================================================
REM  Dung lai DATABASE cua mot tram - xoa kho cu, dung kho moi.
REM  KHONG dung toi project web: ten mien, env, deployment deu giu nguyen.
REM
REM  Vi sao khong phai mirror:remove roi mirror:new: cap ay xoa luon ca project
REM  web. Khi thu hong chi la DATABASE (schema lech, migration thieu, du lieu
REM  rac) thi pha ca cai nha de thay mot cai be nuoc la dat va rui ro thua.
REM
REM  BA HANG RAO:
REM    1. KHONG BAO GIO dung tram DANG PHUC VU - khong co co nao mo duoc.
REM    2. Kho dung chung voi project khac thi khong xoa.
REM    3. Phai go lai ma tram de xac nhan (--yes de bo qua).
REM
REM  Cach dung - PHAI khai --site:
REM     reset-mirror-db.bat --site auto-hh3d-3 --dry-run    soi ke hoach
REM     reset-mirror-db.bat --site auto-hh3d-3              lam that
REM     reset-mirror-db.bat --site auto-hh3d-3 --store neon chi dung lai Postgres
REM     reset-mirror-db.bat --site auto-hh3d-3 --no-pause   khong dung cho o cuoi
REM ============================================================================
setlocal

REM Bang ma UTF-8: nhat ky cua script viet bang tieng Viet co dau, con console
REM mac dinh cua Windows la codepage 437/1258 nen se hien ra chu rac.
chcp 65001 >nul

REM Chay tu THU MUC CHUA TEP NAY, khong phai thu muc nguoi dung dang dung.
cd /d "%~dp0"

REM Bam dup ma khong co doi so thi script se hoi --site roi thoat - noi truoc
REM cho de doc, vi cua so .bat dong rat nhanh.
echo %* | findstr /i /c:"--site" >nul || goto :thieu_site

set "DRYRUN="
echo %* | findstr /i /c:"--dry-run" >nul && set "DRYRUN=1"

REM `call` la bat buoc: npm la mot tep .cmd, thieu `call` thi batch nay ket thuc
REM ngay tai day va moi dong ben duoi khong bao gio chay.
call npm run mirror:reset-db -- %*
set "EXITCODE=%ERRORLEVEL%"

echo.
if not "%EXITCODE%"=="0" goto :loi
if defined DRYRUN goto :chi_xem
echo [OK] Database moi da dung xong. CON HAI VIEC - doc ky hai dong cuoi o tren:
echo      1. Phat hanh lai (deploy-all-stations.bat) - deployment dang chay van
echo         cam chuoi ket noi CU, thu vua bi xoa.
echo      2. Dong bo du lieu tu tram dang phuc vu, bang tab Guong Tram.
goto :xong

:chi_xem
echo [OK] Da doc xong ke hoach - CHUA xoa gi. Bo --dry-run de lam that.
goto :xong

:thieu_site
echo [!!] Thieu --site. Vi du:
echo        reset-mirror-db.bat --site auto-hh3d-3 --dry-run
echo      Ma tram lay o trang Tong Mon - Guong Tram.
set "EXITCODE=1"
goto :xong

:loi
echo [!!] Ket thuc voi loi. Doc ky dong dau tien co dau ^✗ o tren:
echo      - "DANG PHUC VU" = chuyen tram sang cho khac truoc da
echo      - "khong chia nao nhin thay project" = them VERCEL_TOKEN_<TEN TRAM> vao .env.local

:xong

REM Bam dup thi cua so tat ngay khi chay xong, khong kip doc gi - nen dung cho.
echo %* | findstr /i /c:"--no-pause" >nul || pause

exit /b %EXITCODE%
