@echo off
REM Create one public GitHub worker repository through the backend VM.
REM Keep this file ASCII-only and CRLF. Delayed expansion must stay disabled.
setlocal DisableDelayedExpansion
chcp 65001 >nul
cd /d "%~dp0"

set "NO_PAUSE="
set "DRY_RUN_ARG="
:read_args
if "%~1"=="" goto :args_done
if /i "%~1"=="--no-pause" (
  set "NO_PAUSE=1"
) else if /i "%~1"=="--dry-run" (
  set "DRY_RUN_ARG=--dry-run"
) else (
  echo   [!!] Unknown launcher option.
  goto :bye
)
shift
goto :read_args
:args_done

echo.
echo   === Create a new GitHub worker ===
echo.
echo   The repository and its Actions logs will be PUBLIC.
echo   Required classic PAT scopes: repo + workflow + delete_repo.
echo.

REM A pre-set PAT skips only the secret prompt; the non-secret prompts still run.
if defined GITHUB_PAT goto :prompt_values
echo   GitHub PAT. Characters will not be shown.
for /f "usebackq delims=" %%p in (`powershell -NoProfile -Command "$s = Read-Host -AsSecureString '  PAT'; [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))"`) do set "GITHUB_PAT=%%p"
if not defined GITHUB_PAT (
  echo   [!!] No PAT entered. Stopped.
  goto :bye
)

:prompt_values
set "REPO_NAME="
set /p "REPO_NAME=  Repository [random]: "
set "WORKFLOW_FILE=linh-su.yml"
set /p "WORKFLOW_FILE=  Workflow [linh-su.yml]: "
set "DAILY_PUSHES=5"
set /p "DAILY_PUSHES=  Daily pushes [5]: "

REM Validate inherited environment values in PowerShell before cmd interpolates them.
powershell -NoProfile -Command "$r=$env:REPO_NAME; $w=$env:WORKFLOW_FILE; $d=$env:DAILY_PUSHES; if ($r -and ($r.Length -gt 100 -or $r -notmatch '^[A-Za-z0-9._-]+$')) { exit 11 }; if ($w.Length -gt 100 -or $w -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*\.ya?ml$') { exit 12 }; if ($d -notmatch '^(?:[0-9]|1[0-9]|2[0-4])$') { exit 13 }"
if errorlevel 1 (
  echo   [!!] Invalid repository, workflow, or daily limit.
  goto :bye
)

echo.
if defined REPO_NAME goto :run_with_repo
call npm run vm -- --env GITHUB_PAT -- npm run github:new -- --workflow-file "%WORKFLOW_FILE%" --daily-pushes "%DAILY_PUSHES%" %DRY_RUN_ARG%
goto :after_run

:run_with_repo
call npm run vm -- --env GITHUB_PAT -- npm run github:new -- --repo "%REPO_NAME%" --workflow-file "%WORKFLOW_FILE%" --daily-pushes "%DAILY_PUSHES%" %DRY_RUN_ARG%

:after_run
set "EXITCODE=%ERRORLEVEL%"
set "GITHUB_PAT="
echo.
if "%EXITCODE%"=="0" (
  echo   [OK] Complete. Read the result above.
) else (
  echo   [!!] Failed. Read the stage result above.
)
if not defined NO_PAUSE pause
exit /b %EXITCODE%

:bye
set "GITHUB_PAT="
if not defined NO_PAUSE pause
exit /b 1
