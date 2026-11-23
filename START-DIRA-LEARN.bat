@echo off
rem ======================================================================
rem  DIRA LEARN - start the complete LOCAL test system (double-click me)
rem  Uses only this computer: local Supabase in Docker + the website.
rem  It never connects to, resets or deploys to the live system.
rem ======================================================================
setlocal EnableExtensions
cd /d "%~dp0"
if /i "%~1"=="--open-browser" goto :open_browser

title DIRA LEARN - starting
set "APP_URL=http://localhost:5173/"
set "APP_PORT=5173"
rem The local database container is found by name (Supabase names it after project_id in supabase\config.toml).
set "DB_CONTAINER="
set "LOG_DIR=%~dp0supabase\.temp"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" >nul 2>&1

echo.
echo  ==============================================================
echo    DIRA LEARN - local test system
echo    Everything runs on THIS computer. The live system is never used.
echo  ==============================================================
echo.

rem ---------- 0. right folder ----------
if not exist "package.json" goto :err_folder
if not exist "supabase\migrations" goto :err_folder

rem ---------- 1. Node.js and npm ----------
echo [1/8] Checking Node.js and npm...
where node >nul 2>&1 || goto :err_node
where npm >nul 2>&1 || goto :err_node
set "NODE_MAJOR="
for /f "tokens=1 delims=." %%v in ('node -v') do set "NODE_MAJOR=%%v"
set "NODE_MAJOR=%NODE_MAJOR:v=%"
if not defined NODE_MAJOR goto :err_node
if %NODE_MAJOR% LSS 18 goto :err_node_old
echo       OK - Node.js version %NODE_MAJOR%

rem ---------- 2. Docker Desktop ----------
echo [2/8] Checking Docker Desktop...
where docker >nul 2>&1 || goto :err_docker_missing
docker info >nul 2>&1 && goto :docker_ok
echo       Docker Desktop is not running. Opening it now...
set "DOCKER_EXE=%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
if not exist "%DOCKER_EXE%" goto :err_docker_start
start "" "%DOCKER_EXE%"
echo       Waiting for Docker Desktop to be ready. This can take one or two minutes...
set /a WAITED=0
:wait_docker
timeout /t 5 /nobreak >nul
docker info >nul 2>&1 && goto :docker_ok
set /a WAITED+=5
if %WAITED% GEQ 240 goto :err_docker_timeout
goto :wait_docker
:docker_ok
echo       OK - Docker Desktop is running

rem ---------- 3. project dependencies ----------
echo [3/8] Checking the website's software packages...
if not exist "node_modules\vite\package.json" goto :install_deps
if not exist "node_modules\@supabase\supabase-js\package.json" goto :install_deps
rem the Supabase tool itself (version 3, pinned in package.json) is installed into the project too
if not exist "node_modules\supabase\package.json" goto :install_deps
echo       OK - already installed
goto :deps_ok
:install_deps
echo       Installing them now. This happens only the first time and can take a few minutes...
rem npm ci installs exactly the versions in package-lock.json (checked for this release); npm install only without a lock file
if exist "package-lock.json" (
  call npm ci
) else (
  call npm install
)
if errorlevel 1 goto :err_npm_install
echo       OK - installed
:deps_ok

rem ---------- 4. local Supabase settings ----------
echo [4/8] Checking the local database settings and the Supabase tool...
if not exist "supabase\config.toml" goto :err_config
findstr /b /c:"[inbucket]" "supabase\config.toml" >nul && goto :err_inbucket
set "CLI_MAJOR="
set "CLI_MINOR="
call npx --yes supabase --version > "%LOG_DIR%\launcher-cli.tmp" 2>nul
for /f "usebackq tokens=1,2 delims=." %%a in ("%LOG_DIR%\launcher-cli.tmp") do if not defined CLI_MAJOR set "CLI_MAJOR=%%a" & set "CLI_MINOR=%%b"
del "%LOG_DIR%\launcher-cli.tmp" >nul 2>&1
if not defined CLI_MAJOR goto :err_cli_missing
set "CLI_MAJOR=%CLI_MAJOR:v=%"
if not defined CLI_MINOR set "CLI_MINOR=0"
if %CLI_MAJOR% LSS 3 goto :err_cli_old
echo       OK - settings found, Supabase tool version %CLI_MAJOR%.%CLI_MINOR%

rem ---------- 5. local Supabase (database, sign-in, storage) ----------
echo [5/8] Checking the local database...
call npx --yes supabase status >nul 2>&1
if not errorlevel 1 goto :supabase_running
:start_supabase
echo       Starting the local database. The first time this downloads about 2 GB and can take 10 minutes or more...
call npx --yes supabase start > "%LOG_DIR%\launcher-supabase-start.log" 2>&1
if errorlevel 1 goto :err_supabase_start
rem the start-up output lists the local keys: do not keep it on disk once start-up worked
del "%LOG_DIR%\launcher-supabase-start.log" >nul 2>&1
call :config_stamp_save
goto :supabase_ok
:supabase_running
rem Supabase reads config.toml and the email templates only when it starts. If they changed since the last start, offer a restart.
call :config_stamp_now
if not exist "%LOG_DIR%\launcher-config-stamp.txt" goto :ask_restart
fc /b "%LOG_DIR%\launcher-config-now.tmp" "%LOG_DIR%\launcher-config-stamp.txt" >nul 2>&1
if errorlevel 1 goto :ask_restart
goto :supabase_ok
:ask_restart
echo       The local settings have changed since the local database was started (for example the password reset email).
echo       A restart is needed to use them. Your local test data is KEPT - nothing is reset or deleted.
choice /c YN /m "      Restart the LOCAL database now"
if errorlevel 2 goto :restart_skipped
call npx --yes supabase stop > "%LOG_DIR%\launcher-supabase-stop.log" 2>&1
if errorlevel 1 goto :err_supabase_stop
del "%LOG_DIR%\launcher-supabase-stop.log" >nul 2>&1
goto :start_supabase
:restart_skipped
echo       Skipped. Password reset emails may use the old settings until the local database restarts.
:supabase_ok
echo       OK - the local database is running

rem ---------- 6. database updates (migrations) ----------
echo [6/8] Checking that the local database is up to date...
set "MIG_FILES=0"
set "MIG_APPLIED="
for /f "delims=" %%n in ('docker ps --format "{{.Names}}" 2^>nul ^| findstr /b /c:"supabase_db_dira-learn"') do set "DB_CONTAINER=%%n"
if not defined DB_CONTAINER for /f "delims=" %%n in ('docker ps --format "{{.Names}}" 2^>nul ^| findstr /i /c:"supabase_db" ^| findstr /i /c:"dira-learn"') do set "DB_CONTAINER=%%n"
if not defined DB_CONTAINER goto :warn_migrations_unknown
for /f %%c in ('dir /b "supabase\migrations\*.sql" 2^>nul ^| find /c /v ""') do set "MIG_FILES=%%c"
rem (written to a file first: brackets inside a "for" command can confuse Windows)
docker exec %DB_CONTAINER% psql -U postgres -d postgres -tAc "select count(*) from supabase_migrations.schema_migrations" > "%LOG_DIR%\launcher-count.tmp" 2>nul
for /f "usebackq" %%c in ("%LOG_DIR%\launcher-count.tmp") do set "MIG_APPLIED=%%c"
del "%LOG_DIR%\launcher-count.tmp" >nul 2>&1
if not defined MIG_APPLIED goto :warn_migrations_unknown
if %MIG_APPLIED% EQU %MIG_FILES% goto :migrations_ok
if %MIG_APPLIED% GTR %MIG_FILES% goto :warn_migrations_newer
echo.
echo       The local database has %MIG_APPLIED% of %MIG_FILES% database updates.
echo       The new updates can be added to your LOCAL test database now. Existing test data is kept.
choice /c YN /m "      Apply the new updates to the LOCAL test database"
if errorlevel 2 goto :migrations_skipped
rem Local is the default target in Supabase CLI v2 and v3 (the old --local flag is deprecated in v3).
call npx --yes supabase migration up > "%LOG_DIR%\launcher-migrations.log" 2>&1
if errorlevel 1 goto :err_migrations
echo       OK - updates applied
goto :migrations_done
:migrations_ok
echo       OK - all %MIG_FILES% database updates are in place
goto :migrations_done
:migrations_skipped
echo       Skipped. Some new screens may not work until the updates are applied.
goto :migrations_done
:warn_migrations_unknown
echo       Note: could not count the database updates. Run CHECK-DIRA-LEARN.bat if something looks wrong.
goto :migrations_done
:warn_migrations_newer
echo       Note: the local database has more updates than this folder (%MIG_APPLIED% versus %MIG_FILES%).
echo       Are you using an older copy of DIRA LEARN? Continuing anyway.
:migrations_done

rem ---------- 7. local address and key for the website ----------
echo [7/8] Connecting the website to the LOCAL database only...
set "LOCAL_API_URL="
set "LOCAL_ANON_KEY="
set "LOCAL_MAIL_URL="
set "STATUS_FILE=%LOG_DIR%\launcher-status.tmp"
call npx --yes supabase status -o env > "%STATUS_FILE%" 2>nul
for /f "usebackq tokens=1,* delims==" %%a in ("%STATUS_FILE%") do call :read_status "%%a" "%%~b"
del "%STATUS_FILE%" >nul 2>&1
if not defined LOCAL_API_URL goto :err_status
if not defined LOCAL_ANON_KEY goto :err_status
echo %LOCAL_API_URL%| findstr /r /c:"^http://127\.0\.0\.1:" /c:"^http://localhost:" >nul || goto :err_not_local
rem ---- every local service must answer: database, sign-in (auth), Studio and the test email inbox ----
if not defined LOCAL_MAIL_URL set "LOCAL_MAIL_URL=http://127.0.0.1:54324"
where curl >nul 2>&1 || goto :services_skipped
set "SVC_PROBLEM="
if not defined DB_CONTAINER goto :svc_db_unknown
docker exec %DB_CONTAINER% psql -U postgres -d postgres -tAc "select 1" >nul 2>&1 && echo       [OK] database && goto :svc_auth
echo       [PROBLEM] database is not answering
set "SVC_PROBLEM=database"
goto :svc_auth
:svc_db_unknown
echo       [WARNING] database container not found by name - skipped this check
:svc_auth
call :http_code "%LOCAL_API_URL%/auth/v1/health" AUTH_CODE
if "%AUTH_CODE%"=="200" (echo       [OK] sign-in service - Supabase Auth) else (echo       [PROBLEM] sign-in service answered %AUTH_CODE% & set "SVC_PROBLEM=sign-in")
call :http_code "http://127.0.0.1:54323/" STUDIO_CODE
if "%STUDIO_CODE%"=="000" (echo       [WARNING] Studio did not answer at http://localhost:54323 - DIRA LEARN still works without it) else (echo       [OK] Studio at http://localhost:54323)
call :http_code "%LOCAL_MAIL_URL%/api/v1/info" MAIL_CODE
if "%MAIL_CODE%"=="200" (echo       [OK] test email inbox at %LOCAL_MAIL_URL%) else (echo       [WARNING] the test email inbox did not answer - password reset codes cannot be read)
if defined SVC_PROBLEM goto :err_services
goto :services_done
:services_skipped
echo       Note: curl is not available, so the services were not checked one by one.
:services_done
rem These settings take priority over .env.local for this window only, so a live address in .env.local is never used here.
set "VITE_SUPABASE_URL=%LOCAL_API_URL%"
set "VITE_SUPABASE_ANON_KEY=%LOCAL_ANON_KEY%"
set "LOCAL_ANON_KEY="
echo       OK - using the local database at %LOCAL_API_URL%
if defined LOCAL_MAIL_URL echo       Test email inbox (password reset codes): %LOCAL_MAIL_URL%

rem ---------- 8. the website ----------
echo [8/8] Starting the DIRA LEARN website...
netstat -ano | findstr /r /c:":%APP_PORT% .*LISTENING" >nul
if errorlevel 1 goto :port_free
where curl >nul 2>&1 || goto :err_port_busy
curl -s --max-time 3 "%APP_URL%" | findstr /c:"<title>DIRA LEARN</title>" >nul
if not errorlevel 1 goto :already_running
goto :err_port_busy
:port_free

start "" /min "%~f0" --open-browser
title DIRA LEARN - website running (close this window to stop it)
echo.
echo  ==============================================================
echo    DIRA LEARN is starting. Your browser will open by itself at
echo    %APP_URL%
echo.
echo    KEEP THIS WINDOW OPEN while you use DIRA LEARN.
echo    To stop the website, close this window.
echo    The local database keeps running in Docker Desktop and keeps
echo    your test data. See README-LOCAL-TESTING.txt for details.
echo  ==============================================================
echo.
call npm run dev -- --host 127.0.0.1 --port %APP_PORT% --strictPort
echo.
echo  The DIRA LEARN website has stopped.
echo  If it stopped by itself with an error, read the messages above.
goto :end_pause

rem ======================================================================
rem  helpers
rem ======================================================================
:read_status
rem Reads one NAME="value" line of `supabase status -o env` without printing anything.
if /i "%~1"=="API_URL" set "LOCAL_API_URL=%~2"
if /i "%~1"=="ANON_KEY" set "LOCAL_ANON_KEY=%~2"
if /i "%~1"=="PUBLISHABLE_KEY" if not defined LOCAL_ANON_KEY set "LOCAL_ANON_KEY=%~2"
if /i "%~1"=="MAILPIT_URL" set "LOCAL_MAIL_URL=%~2"
if /i "%~1"=="INBUCKET_URL" if not defined LOCAL_MAIL_URL set "LOCAL_MAIL_URL=%~2"
exit /b 0

:http_code
rem Prints nothing. Puts the HTTP status of a LOCAL address into the variable named in %2 (000 = no answer).
set "%~2=000"
for /f %%c in ('curl -s -o nul -w "%%{http_code}" --max-time 8 -H "apikey: %LOCAL_ANON_KEY%" "%~1" 2^>nul') do set "%~2=%%c"
exit /b 0

:config_stamp_now
rem A fingerprint of the local settings and the email template (not secret), to notice changes between starts.
certutil -hashfile "supabase\config.toml" SHA256 2>nul | findstr /r /i "^[0-9a-f ][0-9a-f ]*$" > "%LOG_DIR%\launcher-config-now.tmp"
if exist "supabase\templates\recovery.html" certutil -hashfile "supabase\templates\recovery.html" SHA256 2>nul | findstr /r /i "^[0-9a-f ][0-9a-f ]*$" >> "%LOG_DIR%\launcher-config-now.tmp"
exit /b 0

:config_stamp_save
call :config_stamp_now
copy /y "%LOG_DIR%\launcher-config-now.tmp" "%LOG_DIR%\launcher-config-stamp.txt" >nul 2>&1
exit /b 0

:open_browser
rem Runs in a small minimised window: waits until the website answers, opens the browser, then closes itself.
set /a TRIES=0
where curl >nul 2>&1 || goto :ob_no_curl
:ob_loop
curl -s -o nul --max-time 2 "http://localhost:5173/" && goto :ob_open
set /a TRIES+=1
if %TRIES% GEQ 120 exit
timeout /t 1 /nobreak >nul
goto :ob_loop
:ob_no_curl
timeout /t 15 /nobreak >nul
:ob_open
start "" "http://localhost:5173/"
exit

:already_running
echo       DIRA LEARN is already running. Opening it in your browser instead of starting it twice.
start "" "%APP_URL%"
echo.
echo  The website is running in another window titled "DIRA LEARN - website running".
echo  This window can be closed.
goto :end_pause

:show_log
rem Shows the end of a log file, leaving out any line that mentions a key, secret, token or password.
if not exist "%~1" exit /b 0
echo  ---- last messages (keys and passwords are hidden) ----
powershell -NoProfile -Command "Get-Content -Tail 25 -LiteralPath '%~1' | Where-Object { $_ -notmatch '(?i)key|secret|token|password|jwt' }"
echo  ---- full log: %~1 ----
exit /b 0

rem ======================================================================
rem  problems and how to fix them
rem ======================================================================
:err_folder
echo [PROBLEM] This file must be inside the DIRA LEARN folder, next to package.json.
echo           Move START-DIRA-LEARN.bat back into the dira-learn folder and try again.
goto :fail
:err_node
echo [PROBLEM] Node.js is not installed, or Windows cannot find it.
echo           Install the LTS version from https://nodejs.org - accept the default options -
echo           then restart the computer and double-click START-DIRA-LEARN.bat again.
goto :fail
:err_node_old
echo [PROBLEM] Your Node.js is version %NODE_MAJOR%. DIRA LEARN needs version 18 or newer; version 20 or 22 LTS is recommended.
echo           Install the LTS version from https://nodejs.org, restart the computer and try again.
goto :fail
:err_docker_missing
echo [PROBLEM] Docker Desktop is not installed. The local database runs inside Docker Desktop.
echo           Install it from https://www.docker.com/products/docker-desktop - restart if asked - open it once,
echo           accept its terms, then double-click START-DIRA-LEARN.bat again.
goto :fail
:err_docker_start
echo [PROBLEM] Docker Desktop is not running and could not be opened automatically.
echo           Open Docker Desktop from the Start menu, wait until it says it is running, then try again.
goto :fail
:err_docker_timeout
echo [PROBLEM] Docker Desktop did not become ready within 4 minutes.
echo           Look at the Docker Desktop window for messages - it may need an update or a restart of the computer -
echo           then try again.
goto :fail
:err_npm_install
echo [PROBLEM] Installing the website's software packages failed.
echo           Check your internet connection and try again. If it keeps failing, send the messages above to your developer.
goto :fail
:err_config
echo [PROBLEM] The local database settings file supabase\config.toml is missing.
echo           Use a complete copy of the DIRA LEARN folder from the latest ZIP.
goto :fail
:err_inbucket
echo [PROBLEM] supabase\config.toml still has an [inbucket] section. Supabase CLI v3 refuses to start with it.
echo           Use the config.toml from the latest DIRA LEARN ZIP, where it is called [local_smtp].
goto :fail
:err_cli_missing
echo [PROBLEM] The Supabase tool could not be found or downloaded.
echo           Check your internet connection the first time, then try again.
goto :fail
:err_cli_old
echo [PROBLEM] The Supabase tool is version %CLI_MAJOR%.%CLI_MINOR%. This DIRA LEARN folder is set up for version 3.
echo           In this folder run:  npm install   - it installs the right version into the project -
echo           then double-click START-DIRA-LEARN.bat again.
goto :fail
:err_services
echo [PROBLEM] The local database started, but the %SVC_PROBLEM% service is not answering.
echo           Wait one minute and double-click START-DIRA-LEARN.bat again. If it keeps happening,
echo           open Docker Desktop, look for a stopped supabase container, and send CHECK-DIRA-LEARN.bat's result.
goto :fail
:err_supabase_stop
echo [PROBLEM] The local database could not be restarted. Nothing was reset or deleted.
call :show_log "%LOG_DIR%\launcher-supabase-stop.log"
echo           Open Docker Desktop, check that it is running, then try again.
goto :fail
:err_supabase_start
echo [PROBLEM] The local database could not start.
call :show_log "%LOG_DIR%\launcher-supabase-start.log"
echo           Common causes:
echo            - first start without internet: Docker must download the database images once.
echo            - "port is already allocated": another program, or another local Supabase project, uses ports 54321 to 54324.
echo              Close it, or stop the other project in Docker Desktop, then try again.
echo            - Docker Desktop is short of memory: in Docker Desktop settings give it at least 4 GB.
goto :fail
:err_migrations
echo [PROBLEM] Applying the database updates to the LOCAL test database failed. Nothing was reset or deleted.
call :show_log "%LOG_DIR%\launcher-migrations.log"
echo           Send these messages to your developer.
goto :fail
:err_status
echo [PROBLEM] Could not read the local database address from Supabase.
echo           Try again in a minute. If it keeps happening, run CHECK-DIRA-LEARN.bat and send the result to your developer.
goto :fail
:err_not_local
echo [STOPPED] The database address is not on this computer, so the launcher refused to continue.
echo           This protects the live system. Nothing was changed. Run CHECK-DIRA-LEARN.bat and send the result to your developer.
goto :fail
:err_port_busy
echo [PROBLEM] Port %APP_PORT% is already used by another program, so the website cannot start.
echo           Close the other program - for example another development server - or restart the computer, then try again.
echo           To see which program it is, run CHECK-DIRA-LEARN.bat.
goto :fail

:fail
echo.
echo  DIRA LEARN did not start. Nothing was deleted or reset, and the live system was not touched.
:end_pause
echo.
pause
endlocal
exit /b
