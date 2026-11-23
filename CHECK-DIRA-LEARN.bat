@echo off
rem ======================================================================
rem  DIRA LEARN - check that everything needed is available (double-click me)
rem  READ-ONLY: it starts nothing, installs nothing and changes nothing.
rem ======================================================================
setlocal EnableExtensions
cd /d "%~dp0"
title DIRA LEARN - check
set "DB_CONTAINER="
set "TMP_FILE=%TEMP%\dira-learn-check.tmp"
set /a PROBLEMS=0

echo.
echo  ==============================================================
echo    DIRA LEARN - system check (nothing is changed)
echo  ==============================================================
echo.

if exist "package.json" (echo  [OK]      Running from the DIRA LEARN folder) else (echo  [MISSING] This file is not inside the DIRA LEARN folder & set /a PROBLEMS+=1)

where node >nul 2>&1 || goto :no_node
for /f "delims=" %%v in ('node -v') do echo  [OK]      Node.js %%v  - version 18 or newer is needed, 20 or 22 LTS recommended
goto :node_done
:no_node
echo  [MISSING] Node.js - install the LTS version from https://nodejs.org
set /a PROBLEMS+=1
:node_done

where npm >nul 2>&1 && (echo  [OK]      npm is available) || (echo  [MISSING] npm - it comes with Node.js & set /a PROBLEMS+=1)
where curl >nul 2>&1 && (echo  [OK]      curl is available) || (echo  [WARNING] curl is missing - the launcher still works but cannot detect an already running website)

where docker >nul 2>&1 || goto :no_docker
docker info >nul 2>&1 && (echo  [OK]      Docker Desktop is running) || (echo  [WARNING] Docker Desktop is installed but not running - START-DIRA-LEARN.bat will try to open it)
goto :docker_done
:no_docker
echo  [MISSING] Docker Desktop - install it from https://www.docker.com/products/docker-desktop
set /a PROBLEMS+=1
:docker_done

if exist "node_modules\supabase\package.json" (echo  [OK]      Supabase tool version 3 is installed in this folder) else (echo  [WARNING] The Supabase tool is not installed in this folder yet - START-DIRA-LEARN.bat installs it with the other packages)
if exist "node_modules\vite\package.json" (echo  [OK]      Website software packages are installed) else (echo  [WARNING] Website software packages are not installed yet - START-DIRA-LEARN.bat installs them the first time)
if exist "supabase\config.toml" (echo  [OK]      Local database settings found) else (echo  [MISSING] supabase\config.toml - use a complete copy of the launcher ZIP & set /a PROBLEMS+=1)
findstr /b /c:"[inbucket]" "supabase\config.toml" >nul 2>&1 && (echo  [MISSING] supabase\config.toml has the old [inbucket] section - Supabase CLI v3 refuses it. Use the config.toml from the latest ZIP & set /a PROBLEMS+=1)
if exist "supabase\templates\recovery.html" (echo  [OK]      Password reset email template found) else (echo  [MISSING] supabase\templates\recovery.html - password reset emails need it & set /a PROBLEMS+=1)
call npx --yes supabase --version > "%TMP_FILE%" 2>nul
set "CLI_VER="
for /f "usebackq delims=" %%v in ("%TMP_FILE%") do if not defined CLI_VER set "CLI_VER=%%v"
if defined CLI_VER (echo  [INFO]    Supabase tool version %CLI_VER% - this folder is set up for version 3) else (echo  [WARNING] Could not run the Supabase tool - it is downloaded by npx the first time, so check the internet connection)
if exist "supabase\local_test_accounts.sql" (echo  [OK]      Test-account script found) else (echo  [WARNING] supabase\local_test_accounts.sql is missing - test accounts cannot be created)

rem ---------- local database ----------
for /f "delims=" %%n in ('docker ps --format "{{.Names}}" 2^>nul ^| findstr /b /c:"supabase_db_dira-learn"') do set "DB_CONTAINER=%%n"
if not defined DB_CONTAINER for /f "delims=" %%n in ('docker ps --format "{{.Names}}" 2^>nul ^| findstr /i /c:"supabase_db" ^| findstr /i /c:"dira-learn"') do set "DB_CONTAINER=%%n"
if not defined DB_CONTAINER goto :db_not_running
echo  [OK]      The local database is running - container %DB_CONTAINER%
for /f %%c in ('dir /b "supabase\migrations\*.sql" 2^>nul ^| find /c /v ""') do set "MIG_FILES=%%c"
set "MIG_APPLIED="
docker exec %DB_CONTAINER% psql -U postgres -d postgres -tAc "select count(*) from supabase_migrations.schema_migrations" > "%TMP_FILE%" 2>nul
for /f "usebackq" %%c in ("%TMP_FILE%") do set "MIG_APPLIED=%%c"
if not defined MIG_APPLIED (echo  [WARNING] Could not count the database updates) else (echo  [INFO]    Database updates: %MIG_APPLIED% applied, %MIG_FILES% in this folder)
set "TEST_ACCOUNTS="
docker exec %DB_CONTAINER% psql -U postgres -d postgres -tAc "select count(*) from auth.users where email like '%%@dira-test.local'" > "%TMP_FILE%" 2>nul
for /f "usebackq" %%c in ("%TMP_FILE%") do set "TEST_ACCOUNTS=%%c"
if defined TEST_ACCOUNTS echo  [INFO]    Local test accounts: %TEST_ACCOUNTS% of 14
del "%TMP_FILE%" >nul 2>&1
goto :db_done
:db_not_running
echo  [INFO]    The local database is not running - START-DIRA-LEARN.bat starts it
goto :services_done
:db_done

rem ---------- local services (only when the database is running; keys are never shown) ----------
where curl >nul 2>&1 || goto :services_done
set "LOCAL_API_URL="
set "LOCAL_ANON_KEY="
set "LOCAL_MAIL_URL="
call npx --yes supabase status -o env > "%TMP_FILE%" 2>nul
for /f "usebackq tokens=1,* delims==" %%a in ("%TMP_FILE%") do call :read_status "%%a" "%%~b"
del "%TMP_FILE%" >nul 2>&1
if not defined LOCAL_API_URL (echo  [WARNING] Could not read the local addresses from Supabase & goto :services_done)
echo %LOCAL_API_URL%| findstr /r /c:"^http://127\.0\.0\.1:" /c:"^http://localhost:" >nul || (echo  [WARNING] Supabase reported an address that is not on this computer - nothing was contacted & goto :services_done)
if not defined LOCAL_MAIL_URL set "LOCAL_MAIL_URL=http://127.0.0.1:54324"
call :http_code "%LOCAL_API_URL%/auth/v1/health" SVC
if "%SVC%"=="200" (echo  [OK]      Sign-in service - Supabase Auth - answers) else (echo  [MISSING] Sign-in service - Supabase Auth - answered %SVC% & set /a PROBLEMS+=1)
call :http_code "http://127.0.0.1:54323/" SVC
if "%SVC%"=="000" (echo  [WARNING] Studio does not answer at http://localhost:54323) else (echo  [OK]      Studio answers at http://localhost:54323)
call :http_code "%LOCAL_MAIL_URL%/api/v1/info" SVC
if "%SVC%"=="200" (echo  [OK]      Test email inbox answers at %LOCAL_MAIL_URL%) else (echo  [MISSING] Test email inbox does not answer at %LOCAL_MAIL_URL% - password reset codes cannot be read & set /a PROBLEMS+=1)
set "LOCAL_ANON_KEY="
:services_done

rem ---------- ports ----------
call :port 5173 "DIRA LEARN website"
call :port 54321 "local database API"
call :port 54322 "local database"
call :port 54323 "local database dashboard (Studio)"
call :port 54324 "local test email inbox"

rem ---------- .env.local (the address itself is not shown) ----------
if not exist ".env.local" goto :env_done
findstr /b /i /c:"SUPABASE_" ".env.local" >nul 2>&1 && echo  [WARNING] .env.local contains SUPABASE_ settings. Supabase CLI v3 reads them and they override config.toml - remove them unless you know you need them.
findstr /b /c:"VITE_SUPABASE_URL=" ".env.local" > "%TMP_FILE%" 2>nul
findstr /i /c:"127.0.0.1" /c:"localhost" "%TMP_FILE%" >nul
if errorlevel 1 (echo  [INFO]    .env.local points to an online address. That is fine: the launcher always uses the LOCAL database instead, for its own window only.) else (echo  [OK]      .env.local points to this computer)
del "%TMP_FILE%" >nul 2>&1
:env_done

echo.
if %PROBLEMS% EQU 0 (echo  Result: nothing is missing. Double-click START-DIRA-LEARN.bat to start.) else (echo  Result: %PROBLEMS% thing^(s^) missing - fix the [MISSING] lines above, then run this check again.)
echo.
pause
endlocal
exit /b

:read_status
if /i "%~1"=="API_URL" set "LOCAL_API_URL=%~2"
if /i "%~1"=="ANON_KEY" set "LOCAL_ANON_KEY=%~2"
if /i "%~1"=="PUBLISHABLE_KEY" if not defined LOCAL_ANON_KEY set "LOCAL_ANON_KEY=%~2"
if /i "%~1"=="MAILPIT_URL" set "LOCAL_MAIL_URL=%~2"
if /i "%~1"=="INBUCKET_URL" if not defined LOCAL_MAIL_URL set "LOCAL_MAIL_URL=%~2"
exit /b 0

:http_code
set "%~2=000"
for /f %%c in ('curl -s -o nul -w "%%{http_code}" --max-time 8 -H "apikey: %LOCAL_ANON_KEY%" "%~1" 2^>nul') do set "%~2=%%c"
exit /b 0

:port
netstat -ano | findstr /r /c:":%~1 .*LISTENING" >nul
if errorlevel 1 (echo  [INFO]    Port %~1 is free - %~2) else (echo  [INFO]    Port %~1 is in use - %~2 is running, or another program uses this port)
exit /b 0
