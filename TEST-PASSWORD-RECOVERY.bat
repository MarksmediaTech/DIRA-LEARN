@echo off
rem ======================================================================
rem  DIRA LEARN - test the password reset (Forgot password) on THIS computer
rem  Uses only the LOCAL Supabase and its test inbox. Never the live system.
rem  It temporarily changes the passwords of local TEST accounts
rem  (@dira-test.local) and puts them back to DiraTest!2026 at the end.
rem ======================================================================
setlocal EnableExtensions
cd /d "%~dp0"
title DIRA LEARN - password reset test
set "LOG_DIR=%~dp0supabase\.temp"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" >nul 2>&1
set "DB_CONTAINER="
set "LOCAL_API_URL="
set "LOCAL_ANON_KEY="
set "LOCAL_MAIL_URL="

echo.
echo  ==============================================================
echo    DIRA LEARN - password reset test (local only)
echo  ==============================================================
echo.
if not exist "package.json" goto :err_folder
where node >nul 2>&1 || goto :err_node
docker info >nul 2>&1 || goto :err_docker

echo [1/4] Checking that the LOCAL database is running...
call npx --yes supabase status >nul 2>&1
if errorlevel 1 goto :err_not_running
for /f "delims=" %%n in ('docker ps --format "{{.Names}}" 2^>nul ^| findstr /b /c:"supabase_db_dira-learn"') do set "DB_CONTAINER=%%n"
if not defined DB_CONTAINER for /f "delims=" %%n in ('docker ps --format "{{.Names}}" 2^>nul ^| findstr /i /c:"supabase_db" ^| findstr /i /c:"dira-learn"') do set "DB_CONTAINER=%%n"
if not defined DB_CONTAINER goto :err_not_running
set "STATUS_FILE=%LOG_DIR%\recovery-status.tmp"
call npx --yes supabase status -o env > "%STATUS_FILE%" 2>nul
for /f "usebackq tokens=1,* delims==" %%a in ("%STATUS_FILE%") do call :read_status "%%a" "%%~b"
del "%STATUS_FILE%" >nul 2>&1
if not defined LOCAL_API_URL goto :err_not_running
if not defined LOCAL_ANON_KEY goto :err_not_running
echo %LOCAL_API_URL%| findstr /r /c:"^http://127\.0\.0\.1:" /c:"^http://localhost:" >nul || goto :err_not_local
if not defined LOCAL_MAIL_URL set "LOCAL_MAIL_URL=http://127.0.0.1:54324"
echo %LOCAL_MAIL_URL%| findstr /r /c:"^http://127\.0\.0\.1:" /c:"^http://localhost:" >nul || goto :err_not_local
echo       OK - local database at %LOCAL_API_URL%, test inbox at %LOCAL_MAIL_URL%

echo [2/4] What this test does
echo       - asks for password reset codes for local TEST accounts and reads them from the local test inbox
echo       - tries wrong, expired and reused codes, the resend cooldown and the guessing limit
echo       - changes the passwords of learner1, learner2, coordinator and director @dira-test.local for a few minutes,
echo         then sets them back to DiraTest!2026
echo       - takes about 5 minutes. Afterwards Supabase refuses code checks from this computer for about 5 minutes
echo         (that is the guessing limit being tested).
echo       Nothing is deleted or reset, and the live system is never used.
choice /c YN /m "      Run the password reset test now"
if errorlevel 2 goto :cancelled

echo [3/4] Testing password reset against the local Supabase (this window shows no codes or passwords)...
set "RESULT_API=failed"
node tools\recovery\recovery_check.mjs
if not errorlevel 1 set "RESULT_API=passed"

echo [4/4] Browser test of the screens (optional)
if not exist "node_modules\@playwright\test\package.json" goto :no_playwright
choice /c YN /m "      Also run the browser test - it needs the Chromium test browser, downloaded once, about 150 MB"
if errorlevel 2 goto :summary
call npx playwright install chromium
if errorlevel 1 goto :err_playwright_install
rem The browser test starts the website itself, connected to the LOCAL database only (these settings apply to this window only).
set "VITE_SUPABASE_URL=%LOCAL_API_URL%"
set "VITE_SUPABASE_ANON_KEY=%LOCAL_ANON_KEY%"
set "RESULT_UI=failed"
call npx playwright test e2e/password-recovery.spec.ts --reporter=list
if not errorlevel 1 set "RESULT_UI=passed"
goto :summary
:no_playwright
echo       Skipped: the website's packages are not installed yet. Run START-DIRA-LEARN.bat once first.

:summary
echo.
echo  ==============================================================
echo    Password reset test: %RESULT_API%
if defined RESULT_UI echo    Browser test of the screens: %RESULT_UI%
echo    Send this window to your developer if anything failed.
echo  ==============================================================
goto :end_pause

:read_status
if /i "%~1"=="API_URL" set "LOCAL_API_URL=%~2"
if /i "%~1"=="ANON_KEY" set "LOCAL_ANON_KEY=%~2"
if /i "%~1"=="PUBLISHABLE_KEY" if not defined LOCAL_ANON_KEY set "LOCAL_ANON_KEY=%~2"
if /i "%~1"=="MAILPIT_URL" set "LOCAL_MAIL_URL=%~2"
if /i "%~1"=="INBUCKET_URL" if not defined LOCAL_MAIL_URL set "LOCAL_MAIL_URL=%~2"
exit /b 0

:cancelled
echo       Cancelled. Nothing was changed.
goto :end_pause
:err_folder
echo [PROBLEM] This file must be inside the DIRA LEARN folder, next to package.json.
goto :end_pause
:err_node
echo [PROBLEM] Node.js is not installed. Install the LTS version from https://nodejs.org and try again.
goto :end_pause
:err_docker
echo [PROBLEM] Docker Desktop is not running. Start DIRA LEARN with START-DIRA-LEARN.bat first.
goto :end_pause
:err_not_running
echo [PROBLEM] The local database is not running. Start it with START-DIRA-LEARN.bat, then run this test again.
goto :end_pause
:err_not_local
echo [STOPPED] The database or inbox address is not on this computer. The test refused to run. Nothing was changed.
goto :end_pause
:err_playwright_install
echo [PROBLEM] The test browser could not be downloaded. Check the internet connection and try again.
goto :summary

:end_pause
echo.
pause
endlocal
exit /b
