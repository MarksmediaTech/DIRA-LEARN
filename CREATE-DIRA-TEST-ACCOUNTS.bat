@echo off
rem ======================================================================
rem  DIRA LEARN - OPTIONAL: create test accounts in the LOCAL database only
rem  It talks directly to the local database container on this computer
rem  (supabase_db_dira-learn...), so it cannot reach the live system.
rem  It is never run automatically.
rem ======================================================================
setlocal EnableExtensions
cd /d "%~dp0"
title DIRA LEARN - create local test accounts
set "DB_CONTAINER="
set "SQL_FILE=supabase\local_test_accounts.sql"
set "TMP_FILE=%TEMP%\dira-learn-accounts.tmp"

echo.
echo  ==============================================================
echo    DIRA LEARN - create LOCAL test accounts
echo  ==============================================================
echo.
if not exist "%SQL_FILE%" goto :err_file
where docker >nul 2>&1 || goto :err_docker
docker info >nul 2>&1 || goto :err_docker
for /f "delims=" %%n in ('docker ps --format "{{.Names}}" 2^>nul ^| findstr /b /c:"supabase_db_dira-learn"') do set "DB_CONTAINER=%%n"
if not defined DB_CONTAINER for /f "delims=" %%n in ('docker ps --format "{{.Names}}" 2^>nul ^| findstr /i /c:"supabase_db" ^| findstr /i /c:"dira-learn"') do set "DB_CONTAINER=%%n"
if not defined DB_CONTAINER goto :err_db

rem ---------- already there? ----------
set "EXISTING="
docker exec %DB_CONTAINER% psql -U postgres -d postgres -tAc "select count(*) from auth.users where email like '%%@dira-test.local'" > "%TMP_FILE%" 2>nul
for /f "usebackq" %%c in ("%TMP_FILE%") do set "EXISTING=%%c"
if not defined EXISTING goto :err_db
if not "%EXISTING%"=="0" goto :already

rem ---------- safety: only on a database with no real users ----------
set "OTHERS="
docker exec %DB_CONTAINER% psql -U postgres -d postgres -tAc "select count(*) from auth.users where email not like '%%@dira-test.local'" > "%TMP_FILE%" 2>nul
for /f "usebackq" %%c in ("%TMP_FILE%") do set "OTHERS=%%c"
del "%TMP_FILE%" >nul 2>&1
if not "%OTHERS%"=="0" goto :err_real_users

echo  This adds 14 test accounts, 2 test cohorts and a test application to your LOCAL test database.
echo  Nothing is deleted. The live system is not touched.
echo.
choice /c YN /m " Create the test accounts now"
if errorlevel 2 goto :cancelled
docker exec -i %DB_CONTAINER% psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 < "%SQL_FILE%"
if errorlevel 1 goto :err_failed
echo.
echo  Done.
goto :list

:already
echo  The test accounts already exist (%EXISTING% found). Nothing was changed.
goto :list

:list
echo.
echo  Sign in at http://localhost:5173 with any of these. Password for all of them: DiraTest!2026
echo  (a test password for this computer only; never use it on the live system)
echo.
echo    founder@dira-test.local        Founder
echo    cofounder@dira-test.local      Co-Founder
echo    admin@dira-test.local          Super Administrator
echo    director@dira-test.local       Programme Director - test Safeguarding Lead
echo    coordinator@dira-test.local    Programme Coordinator - test Safeguarding Deputy
echo    trainer.a@dira-test.local      Facilitator, Test cohort A
echo    trainer.b@dira-test.local      Facilitator, Test cohort B
echo    mentor@dira-test.local         Mentor of learner2
echo    me@dira-test.local             M^&E officer
echo    learner1@dira-test.local       Learner, cohort A
echo    learner2@dira-test.local       Learner, cohort A
echo    learner3@dira-test.local       Learner, cohort A - learning access not open yet
echo    learner4@dira-test.local       Learner, cohort B
echo    applicant@dira-test.local      Applicant
echo.
echo  To start again with a clean test database, ask your developer: it needs a database reset,
echo  which this launcher never does by itself.
goto :end

:cancelled
echo  Cancelled. Nothing was changed.
goto :end
:err_file
echo [PROBLEM] %SQL_FILE% is missing. Use a complete copy of the DIRA LEARN folder.
goto :end
:err_docker
echo [PROBLEM] Docker Desktop is not running. Run START-DIRA-LEARN.bat first, then this file.
goto :end
:err_db
echo [PROBLEM] The local DIRA LEARN database is not running. Run START-DIRA-LEARN.bat first, then this file.
goto :end
:err_real_users
echo [STOPPED] The local database already has %OTHERS% account^(s^) that are not test accounts.
echo           To be safe, test accounts are only added to a database without real users. Nothing was changed.
goto :end
:err_failed
echo [PROBLEM] Creating the test accounts failed. Nothing was saved: it is all or nothing.
echo           Send the messages above to your developer.
goto :end

:end
del "%TMP_FILE%" >nul 2>&1
echo.
pause
endlocal
exit /b
