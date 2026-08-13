@echo off
REM ============================================================================
REM  Phat hanh goi khoi loi cho MOI kho GitHub trong so.
REM
REM  Vi sao can: kho khoi loi GitHub la mot ban DONG LANH cua goi khoi loi -
REM  workflow checkout chinh kho ay roi chay scripts/worker.mjs tu do. Nen ma
REM  trong kho la ma se chay, mai mai, cho toi khi co nguoi day ban moi len.
REM  Truoc 14/08/2026 chi co github:new (dung) va github:remove (xoa).
REM
REM  Bam dup tep nay la xong. Viec that nam o scripts/deployGithubKhoiloi.mts.
REM
REM  Doi so deu chuyen thang cho script:
REM     deploy-github-khoiloi.bat --dry-run          chi in ke hoach, khong day gi
REM     deploy-github-khoiloi.bat --repo <ten kho>   dung mot kho
REM     deploy-github-khoiloi.bat --no-pause         khong dung cho o cuoi
REM ============================================================================
setlocal

REM Bang ma UTF-8: nhat ky cua script viet bang tieng Viet co dau, con console
REM mac dinh cua Windows la codepage 437/1258 nen se hien ra chu rac.
chcp 65001 >nul

REM Chay tu THU MUC CHUA TEP NAY, khong phai thu muc nguoi dung dang dung.
cd /d "%~dp0"

REM Nhan --dry-run TRUOC khi chay, de con noi dung su that o dong cuoi: mot luot
REM --dry-run khong day gi ca, ma dong "[OK] da nhan goi moi" thi doc nhu da xong.
set "DRYRUN="
echo %* | findstr /i /c:"--dry-run" >nul && set "DRYRUN=1"

REM `call` la bat buoc: npm la mot tep .cmd, thieu `call` thi batch nay ket thuc
REM ngay tai day va moi dong ben duoi khong bao gio chay.
call npm run github:deploy -- %*
set "EXITCODE=%ERRORLEVEL%"

echo.
if not "%EXITCODE%"=="0" goto :loi
if defined DRYRUN goto :chi_xem
echo [OK] Xong - moi kho trong so da mang cung mot goi.
echo      Luot chay Actions DANG chay van dung ma cu cua no; ban moi co hieu luc
echo      o luot ke, toi da ~4 gio (lich 0 */4 * * *).
goto :xong

:chi_xem
echo [OK] Da doc xong ke hoach - CHUA day gi. Bo --dry-run de phat hanh that.
goto :xong

:loi
echo [!!] Ket thuc voi loi. Doc bang TONG KET o tren: kho nao dang LECH MA.
echo      Hay gap nhat la PAT thieu scope `workflow` (GitHub tra 422 khi dung
echo      toi .github/workflows/) hoac PAT da het han - dan lai o tab Kho GitHub.

:xong

REM Bam dup thi cua so tat ngay khi chay xong, khong kip doc gi - nen dung cho.
echo %* | findstr /i /c:"--no-pause" >nul || pause

exit /b %EXITCODE%
