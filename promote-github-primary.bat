@echo off
REM Promote a companion GitHub repository to primary from any Windows machine.
REM Portable: this file needs only OpenSSH and the OCI SSH private key.
REM It does not need the Jarvis source tree, Node.js, npm, or database access locally.
REM
REM Examples:
REM   promote-github-primary.bat
REM   promote-github-primary.bat --station owner/current-primary --repo companion --visibility private
REM   promote-github-primary.bat --station owner/current-primary --repo companion --visibility public --yes --no-pause
REM   promote-github-primary.bat --station owner/current-primary --repo companion --dry-run
setlocal DisableDelayedExpansion
chcp 65001 >nul

set "PROMOTE_HOST=ubuntu@158.180.59.36"
set "PROMOTE_SSH_KEY=%USERPROFILE%\.ssh\jarvis_oci_ed25519"
set "PROMOTE_STATION="
set "PROMOTE_REPO="
set "PROMOTE_VISIBILITY=keep"
set "PROMOTE_VISIBILITY_SET="
set "PROMOTE_DRY="
set "PROMOTE_YES="
set "PROMOTE_NO_PAUSE="

:read_args
if "%~1"=="" goto :args_done
if /i "%~1"=="--station" (
  if "%~2"=="" goto :bad_args
  set "PROMOTE_STATION=%~2"
  shift
) else if /i "%~1"=="--repo" (
  if "%~2"=="" goto :bad_args
  set "PROMOTE_REPO=%~2"
  shift
) else if /i "%~1"=="--visibility" (
  if "%~2"=="" goto :bad_args
  set "PROMOTE_VISIBILITY=%~2"
  set "PROMOTE_VISIBILITY_SET=1"
  shift
) else if /i "%~1"=="--ssh-key" (
  if "%~2"=="" goto :bad_args
  set "PROMOTE_SSH_KEY=%~2"
  shift
) else if /i "%~1"=="--host" (
  if "%~2"=="" goto :bad_args
  set "PROMOTE_HOST=%~2"
  shift
) else if /i "%~1"=="--dry-run" (
  set "PROMOTE_DRY=1"
) else if /i "%~1"=="--yes" (
  set "PROMOTE_YES=1"
) else if /i "%~1"=="--no-pause" (
  set "PROMOTE_NO_PAUSE=1"
) else (
  goto :bad_args
)
shift
goto :read_args

:args_done
echo.
echo   === Promote GitHub companion repository ===
echo.
if not defined PROMOTE_STATION set /p "PROMOTE_STATION=  Current station [owner/primary-repo]: "
if not defined PROMOTE_REPO set /p "PROMOTE_REPO=  Companion repository: "
if not defined PROMOTE_VISIBILITY_SET set /p "PROMOTE_VISIBILITY=  Visibility [keep/public/private, default keep]: "
if not defined PROMOTE_VISIBILITY set "PROMOTE_VISIBILITY=keep"
set "PROMOTE_VISIBILITY_SET="

powershell -NoProfile -Command "$s=$env:PROMOTE_STATION; $r=$env:PROMOTE_REPO; $v=$env:PROMOTE_VISIBILITY; $h=$env:PROMOTE_HOST; if($s -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'){exit 11}; if($r -notmatch '^[A-Za-z0-9_.-]{1,100}$' -or $r -in '.', '..'){exit 12}; if($v -notin 'keep','public','private'){exit 13}; if($h -notmatch '^[A-Za-z0-9_.-]+@[A-Za-z0-9.-]+$'){exit 14}"
if errorlevel 1 (
  echo   [!!] Invalid station, repository, visibility, or host.
  goto :fail
)
where ssh >nul 2>nul
if errorlevel 1 (
  echo   [!!] OpenSSH client was not found. Install Windows OpenSSH Client first.
  goto :fail
)
if not exist "%PROMOTE_SSH_KEY%" (
  echo   [!!] SSH key not found: %PROMOTE_SSH_KEY%
  echo        Use --ssh-key "C:\path\to\key" or set the default key in %%USERPROFILE%%\.ssh.
  goto :fail
)

echo.
echo [1/2] Reading the exact promotion plan from OCI. No change is made yet...
set "PROMOTE_REMOTE_DRY=--dry-run"
call :run_remote
if errorlevel 1 goto :fail
if defined PROMOTE_DRY goto :success_preview

echo.
if not defined PROMOTE_YES (
  choice /c YN /n /m "Promote this repository now? [Y/N] "
  if errorlevel 2 goto :cancelled
)
echo.
echo [2/2] Promoting repository and applying visibility...
set "PROMOTE_REMOTE_DRY="
call :run_remote
if errorlevel 1 goto :fail
echo.
echo   [OK] Promotion completed. Source and Git history were preserved.
set "EXITCODE=0"
goto :done

:run_remote
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $remote='cd /opt/jarvis/ops-repo && sudo -u jarvis bash -lc ''git pull --ff-only -q || exit 1; set -a; . /opt/jarvis/shared/.env; set +a; exec npm run github:promote -- --station ' + $env:PROMOTE_STATION + ' --repo ' + $env:PROMOTE_REPO + ' --visibility ' + $env:PROMOTE_VISIBILITY + ' ' + $env:PROMOTE_REMOTE_DRY + ''''; & ssh -i $env:PROMOTE_SSH_KEY -o BatchMode=yes -o ConnectTimeout=25 $env:PROMOTE_HOST $remote; exit $LASTEXITCODE"
exit /b %ERRORLEVEL%

:success_preview
echo.
echo   [OK] Dry-run completed. Nothing was changed.
set "EXITCODE=0"
goto :done

:cancelled
echo.
echo   [--] Cancelled. Nothing was changed.
set "EXITCODE=0"
goto :done

:bad_args
echo.
echo   [!!] Usage: promote-github-primary.bat [--station owner/repo] [--repo companion]
echo        [--visibility keep^|public^|private] [--ssh-key path] [--host user@host]
echo        [--dry-run] [--yes] [--no-pause]
:fail
set "EXITCODE=1"

:done
if not defined PROMOTE_NO_PAUSE pause
exit /b %EXITCODE%
