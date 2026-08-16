@echo off
REM ============================================================================
REM  XOA SACH MOT KHO KHOI LOI GITHUB - kho, dong so, va dong diem danh.
REM  Nua doi xung cua new-github-khoiloi.bat.
REM
REM  Bam dup tep nay. No hoi dung MOT thu: PAT cua tai khoan GitHub giu kho.
REM  Tai khoan duoc suy tu chinh PAT, roi script tu tim kho khoi loi tren do.
REM
REM  PAT CAN QUYEN `delete_repo` (classic) hoac Administration read/write
REM  (fine-grained). Day la scope ma new-github-khoiloi.bat KHONG doi, nen cai
REM  PAT da dung kho thuong KHONG xoa duoc no - phai them quyen truoc.
REM
REM  Doi so deu chuyen thang cho script:
REM     remove-github-khoiloi.bat --dry-run        chi in ke hoach, khong xoa gi
REM     remove-github-khoiloi.bat --repo <ten>     chon khi tai khoan co nhieu kho
REM     remove-github-khoiloi.bat --yes            bo cau xac nhan go tay
REM     remove-github-khoiloi.bat --force          xoa ke ca khi dang giu dan
REM     remove-github-khoiloi.bat --no-pause       khong dung cho o cuoi
REM
REM  Script TU CHOI xoa mot kho khong co bang chung la kho khoi loi, va tu choi
REM  xoa khi khoi loi ay dang giu dan. Truoc khi xoa, no luu dong so ra %TEMP%.
REM
REM  HAI LUAT CUA TEP NAY, dung sua pham (giong new-github-khoiloi.bat):
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
echo   === Xoa mot kho khoi loi GitHub ===
echo.
echo   Se xoa: kho tren GitHub, dong trong so Kho GitHub cua tram dang hoat dong,
echo   va dong diem danh trong bang workers. Khong hoan tac duoc.
echo.
echo   Muon xem truoc ma chua xoa gi: chay lai voi --dry-run
echo.

REM GITHUB_PAT dat san tu ngoai thi bo qua buoc hoi - dung cho luot chay lai
REM va cho viec kiem thu.
if defined GITHUB_PAT goto :run

echo   PAT cua tai khoan GitHub dang giu kho can xoa.
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
call npm run github:remove -- %*
set "EXITCODE=%ERRORLEVEL%"

REM Xoa PAT khoi bien moi truong cua cua so nay ngay khi xong.
set "GITHUB_PAT="

REM Nhanh goto PHANG, khong long if(...)else(...): cmd.exe doc ca khoi ngoac mot
REM lan truoc khi chay, nen mot dau ) lot vao chuoi echo la vo ca khoi.
echo.
if not "%EXITCODE%"=="0" goto :loi
echo   [OK] Xong. Doc dong "Nghiem thu" o tren.
goto :xong

:loi
echo   [!!] Ket thuc voi loi hoac bi huy - doc ky dong bat dau bang dau X o tren.
echo        Script dung o buoc dau tien that bai, va no xoa kho TRUOC khi don so,
echo        nen khong co canh "da go so ma kho van chay".

:xong
echo %* | findstr /i /c:"--no-pause" >nul || pause
exit /b %EXITCODE%

:bye
set "GITHUB_PAT="
pause
exit /b 1
