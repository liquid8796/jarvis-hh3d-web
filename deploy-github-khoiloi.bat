@echo off
REM ============================================================================
REM  Phat hanh goi khoi loi cho MOI kho GitHub trong so.
REM
REM  CHAY TREN VM. Tu 16/08/2026 backend + database song tren jarvis-oci-01, va
REM  script nay can CA HAI thu chi co o do: so Kho GitHub nam trong Postgres
REM  (chi nghe 127.0.0.1), va mot repo git THAT de dung goi khoi loi tu cay lam
REM  viec. `npm run vm` dua lenh vao /opt/jarvis/ops-repo - ban clone duy nhat
REM  tren VM co .git (release /opt/jarvis/app la git archive, khong co).
REM
REM  Doi so deu chuyen thang cho script:
REM     deploy-github-khoiloi.bat --dry-run          chi in ke hoach, khong day gi
REM     deploy-github-khoiloi.bat --repo <ten kho>   dung mot kho
REM     deploy-github-khoiloi.bat --restart          huy luot mang ma cu, phat luot moi
REM
REM  Con mot mode nua, cho khi kho DA dung ban ma runner van vo dung (vi du bi
REM  Cloudflare chan): --even-if-current cat ca luot dang chay dung ban de lay mot
REM  runner moi. Cua bam dup cua no la force-github-khoiloi.bat; xem section 9 cua
REM  deploy/github-actions.md.
REM ============================================================================
setlocal
chcp 65001 >nul
cd /d "%~dp0"

set "DRYRUN="
echo %* | findstr /i /c:"--dry-run" >nul && set "DRYRUN=1"

call npm run vm -- npm run github:deploy -- %*
set "EXITCODE=%ERRORLEVEL%"

echo.
if not "%EXITCODE%"=="0" goto :loi
if defined DRYRUN goto :chi_xem
echo [OK] Xong - moi kho trong so da mang cung mot goi.
echo      Khong kem --restart thi ban moi co hieu luc o luot Actions ke (toi da ~4 gio).
goto :xong

:chi_xem
echo [OK] Da doc xong ke hoach - CHUA day gi. Bo --dry-run de phat hanh that.
goto :xong

:loi
echo [!!] Ket thuc voi loi. Doc bang TONG KET o tren: kho nao dang LECH MA.
echo      Hay gap nhat la PAT thieu scope `workflow`, hoac PAT da het han.

:xong
echo %* | findstr /i /c:"--no-pause" >nul || pause
exit /b %EXITCODE%
