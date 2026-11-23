#!/usr/bin/env python3
"""Checks the decision logic of the Windows launchers on Linux, by reproducing what each Windows command does with the
exact values the .bat files use. Windows itself is NOT run here. Usage: python3 -I tools/launcher_logic_check.py <project>"""
import re, subprocess, sys, os

proj = sys.argv[1]
start = open(os.path.join(proj, 'START-DIRA-LEARN.bat'), newline='').read()
create = open(os.path.join(proj, 'CREATE-DIRA-TEST-ACCOUNTS.bat'), newline='').read()
results = []
def check(name, ok): results.append((name, bool(ok)))

# --- reproduce: for /f "usebackq tokens=1,* delims==" %%a in (file) do call :read_status "%%a" "%%~b"
def read_status(output):
    api = key = None
    for line in output.splitlines():
        line = line.strip()
        if not line or '=' not in line.lstrip('='): continue
        a, _, b = line.lstrip('=').partition('=')
        b = b[1:-1] if len(b) >= 2 and b[0] == '"' and b[-1] == '"' else b        # %%~b removes surrounding quotes
        if a.lower() == 'api_url': api = b
        if a.lower() == 'anon_key': key = b
        if a.lower() == 'publishable_key' and key is None: key = b
    return api, key
classic = 'API_URL="http://127.0.0.1:54321"\nDB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"\nANON_KEY="eyJhbGciOiJIUzI1NiJ9.e30.abc_DEF-1"\nSERVICE_ROLE_KEY="eyJ.secret.x"\n'
newer = 'API_URL="http://127.0.0.1:54321"\nPUBLISHABLE_KEY="sb_publishable_ABC123"\nSECRET_KEY="sb_secret_XYZ"\n'
check('status output (classic CLI): local address and anon key are read', read_status(classic) == ('http://127.0.0.1:54321', 'eyJhbGciOiJIUzI1NiJ9.e30.abc_DEF-1'))
check('status output (newer CLI): publishable key is used when there is no anon key', read_status(newer) == ('http://127.0.0.1:54321', 'sb_publishable_ABC123'))
check('status output: the service-role / secret key is never picked up', 'secret' not in str(read_status(classic)) + str(read_status(newer)))
check('status output: nothing running -> no address -> launcher stops (err_status)', read_status('') == (None, None) and 'if not defined LOCAL_API_URL goto :err_status' in start)

# --- reproduce: echo %LOCAL_API_URL%| findstr /r /c:"^http://127\.0\.0\.1:" /c:"^http://localhost:"
def is_local(url): return re.search(r'^http://127\.0\.0\.1:', url) is not None or re.search(r'^http://localhost:', url) is not None
for url, want in [('http://127.0.0.1:54321', True), ('http://localhost:54321', True), ('https://abcdefgh.supabase.co', False),
                  ('http://localhost.attacker.example:80', False), ('http://127.0.0.1.example.com:54321', False), ('https://127.0.0.1:54321', False)]:
    check(f'address check: {url} -> {"allowed" if want else "refused"}', is_local(url) == want)
check('launcher refuses a non-local address before starting the website', start.index('goto :err_not_local') < start.index('call npm run dev'))

# --- reproduce: netstat -ano | findstr /r /c:":5173 .*LISTENING"
netstat = ['  TCP    127.0.0.1:5173         0.0.0.0:0              LISTENING       4120',
           '  TCP    [::1]:5173             [::]:0                 LISTENING       4120',
           '  TCP    0.0.0.0:51730          0.0.0.0:0              LISTENING       900',
           '  TCP    127.0.0.1:60123        127.0.0.1:5173         ESTABLISHED     77']
pat = re.compile(r':5173 .*LISTENING')
check('port check: website listening on 127.0.0.1:5173 is detected', pat.search(netstat[0]))
check('port check: website listening on IPv6 [::1]:5173 is detected', pat.search(netstat[1]))
check('port check: a different port (51730) is not mistaken for 5173', not pat.search(netstat[2]))
check('port check: a browser connection to 5173 is not mistaken for a server', not pat.search(netstat[3]))
html = open(os.path.join(proj, 'index.html'), encoding='utf8').read()
check('already-running check: the page title the launcher looks for is in index.html', '<title>DIRA LEARN</title>' in html and 'findstr /c:"<title>DIRA LEARN</title>"' in start)
check('port taken by another program -> clear error, no second server', 'goto :err_port_busy' in start and '--strictPort' in start)

# --- reproduce: for /f "tokens=1 delims=." %%v in ('node -v') ...; set NODE_MAJOR=%NODE_MAJOR:v=%; if %NODE_MAJOR% LSS 18
def node_major(v): return int(v.split('.')[0].replace('v', ''))
for v, ok in [('v16.20.2', False), ('v18.20.4', True), ('v20.18.1', True), ('v22.12.0', True)]:
    check(f'Node.js {v} -> {"accepted" if ok else "asks to upgrade"}', (node_major(v) >= 18) == ok)

# --- order of steps and safety rules in START
order = ['[1/8]', '[2/8]', '[3/8]', '[4/8]', '[5/8]', '[6/8]', '[7/8]', '[8/8]', 'call npm run dev']
check('steps run in the required order: Node, Docker, packages, settings, database, updates, local connection, website', [start.index(x) for x in order] == sorted(start.index(x) for x in order))
check('Docker not running: the launcher opens Docker Desktop and waits up to 4 minutes', 'start "" "%DOCKER_EXE%"' in start and 'if %WAITED% GEQ 240 goto :err_docker_timeout' in start)
check('packages are installed only when missing', 'if not exist "node_modules\\vite\\package.json" goto :install_deps' in start)
check('Supabase already running: it is not started a second time', 'call npx --yes supabase status >nul 2>&1\r\nif not errorlevel 1 goto :supabase_running' in start)
check('database updates are applied only after asking, and never by a reset', 'choice /c YN' in start and 'call npx --yes supabase migration up >' in start and 'db reset' not in start)
check('CLI v3: the deprecated --local flag is no longer used', '--local' not in re.sub(r'(?im)^\s*rem.*$', '', start))
check('CLI v3: an old [inbucket] section is detected with a clear message before Supabase starts', start.index('goto :err_inbucket') < start.index('supabase start') and '[local_smtp]' in start)
check('the Supabase tool must be version 3 (the config uses v3 names)', 'if %CLI_MAJOR% LSS 3 goto :err_cli_old' in start)
check('changed local settings lead to a restart only after asking, and the restart keeps the data (no --no-backup)',
      start.index('choice /c YN /m "      Restart the LOCAL database now"') < start.index('call npx --yes supabase stop') and '--no-backup' not in re.sub(r'(?im)^\s*(rem|echo).*$', '', start))
check('the settings fingerprint is saved after every successful start', start.count('call :config_stamp_save') == 1 and start.index('supabase start') < start.index('call :config_stamp_save'))
check('the test inbox address is read from MAILPIT_URL (CLI v3) or INBUCKET_URL (older)', 'MAILPIT_URL' in start and 'INBUCKET_URL' in start)
# reproduce: for /f "tokens=1,2 delims=." %%a in (version file) ...; CLI_MAJOR=%CLI_MAJOR:v=%; minor defaults to 0
def cli_ok(line):
    parts = [p for p in line.strip().split('.') if p != '']
    major = parts[0].replace('v', '') if parts else ''; minor = parts[1] if len(parts) > 1 else '0'
    if not major.isdigit(): return None
    major, minor = int(major), int(minor) if minor.isdigit() else 0
    return major >= 3
for v, want in [('3.0.1', True), ('3.0.0', True), ('3', True), ('v3.2.0', True), ('4.0.0', True), ('2.122.1', False), ('2.108.0', False), ('1.226.0', False)]:
    check(f'Supabase tool version {v} -> {"accepted" if want else "asks to update"}', cli_ok(v) is want)
# reproduce: certutil -hashfile ... SHA256 | findstr /r /i "^[0-9a-f ][0-9a-f ]*$"  (keeps only the hash line)
certutil = ['SHA256 hash of supabase\\config.toml:', '3a7bd3e2360a3d29eea436fcfb7e44c735d117c42d1c1835420b6b9942dd4f1b',
            'CertUtil: -hashfile command completed successfully.']
old_style = '3a 7b d3 e2 36 0a 3d 29 ee a4 36 fc fb 7e 44 c7 35 d1 17 c4 2d 1c 18 35 42 0b 6b 99 42 dd 4f 1b'
keep = [l for l in certutil + [old_style] if re.fullmatch(r'(?i)[0-9a-f ][0-9a-f ]*', l)]
check('settings fingerprint keeps only the hash lines of certutil (new and old Windows formats)', keep == [certutil[1], old_style])
import json
pkg = json.load(open(os.path.join(proj, 'package.json')))
check('Supabase CLI v3 is pinned in package.json, so every launcher uses the same version', pkg.get('devDependencies', {}).get('supabase', '').startswith('^3'))
check('the launcher installs the packages when the pinned Supabase tool is missing', 'if not exist "node_modules\\supabase\\package.json" goto :install_deps' in start)
for f in ('START-DIRA-LEARN.bat', 'CHECK-DIRA-LEARN.bat', 'CREATE-DIRA-TEST-ACCOUNTS.bat', 'TEST-PASSWORD-RECOVERY.bat'):
    t = open(os.path.join(proj, f), newline='').read()
    check(f'{f}: finds the database container even if v3 names it differently', 'findstr /i /c:"supabase_db" ^| findstr /i /c:"dira-learn"' in t)
# reproduce the fallback: docker ps names -> first exact prefix, else any name containing supabase_db and dira-learn
def find(names):
    exact = [n for n in names if n.startswith('supabase_db_dira-learn')]
    if exact: return exact[-1]
    loose = [n for n in names if 'supabase_db' in n.lower() and 'dira-learn' in n.lower()]
    return loose[-1] if loose else None
check('container lookup: v2-style name', find(['supabase_kong_dira-learn', 'supabase_db_dira-learn']) == 'supabase_db_dira-learn')
check('container lookup: a v3 name with an extra part still matches', find(['supabase_db_dira-learn-development', 'other_db']) == 'supabase_db_dira-learn-development')
check('container lookup: another project\'s database is never picked', find(['supabase_db_otherproject', 'supabase_rest_dira-learn']) is None)
check('after start, the database, sign-in service, Studio and test inbox are each checked; sign-in or database failure stops with a clear message',
      all(x in start for x in ['/auth/v1/health', 'http://127.0.0.1:54323/', '/api/v1/info', 'psql -U postgres -d postgres -tAc "select 1"', 'goto :err_services'])
      and start.index('goto :err_services') < start.index('call npm run dev'))
check('the service check sends the key only to local addresses checked before', start.index('goto :err_not_local') < start.index('call :http_code'))
check('curl prints nothing (status code only, no page or key)', '-s -o nul -w "%%{http_code}"' in start)
check('config.toml: [auth.email] uses the v3 name enabled, not the deprecated enable_signup', re.search(r'(?ms)^\[auth\.email\]\n(?:[^\[]*?)^enabled = true', cfg_text := open(os.path.join(proj, 'supabase', 'config.toml')).read()) is not None
      and not re.search(r'(?ms)^\[auth\.email\][^\[]*^enable_signup', cfg_text))
cfg = open(os.path.join(proj, 'supabase', 'config.toml')).read()
check('config.toml uses [local_smtp], not the removed [inbucket]', '[local_smtp]' in cfg and not re.search(r'(?m)^\[inbucket\]', cfg))
check('the website gets the LOCAL address through this window only (.env.local is never edited)', 'set "VITE_SUPABASE_URL=%LOCAL_API_URL%"' in start and '.env.local' not in re.sub(r'(?im)^\s*(rem|echo).*$', '', start))
check('the key is cleared from the launcher variables once handed over', 'set "LOCAL_ANON_KEY="\r\necho       OK - using the local database' in start)
check('on any problem the window stays open (pause)', start.count('goto :fail') >= 10 and ':fail' in start and 'pause' in start)
check('the Supabase start log (it lists local keys) is deleted after a successful start', 'del "%LOG_DIR%\\launcher-supabase-start.log"' in start)
check('log lines shown on errors hide keys, secrets, tokens and passwords', "notmatch '(?i)key|secret|token|password|jwt'" in start)

# --- CREATE-DIRA-TEST-ACCOUNTS: run its exact SQL against a scratch copy of the local database
def psql(db, sql):
    return subprocess.run(['psql', '-h', '/tmp', '-p', '54322', '-U', 'postgres', '-d', db, '-tAX', '-c', sql], capture_output=True, text=True).stdout.strip()
def sql_from_bat(fragment):
    m = re.search(r'-tAc "(select count\(\*\) from auth\.users where email ' + fragment + r" '%%@dira-test\.local')\"", create)
    return m.group(1).replace('%%', '%')
q_existing, q_others = sql_from_bat('like'), sql_from_bat('not like')
subprocess.run(['psql', '-h', '/tmp', '-p', '54322', '-U', 'postgres', '-d', 'template1', '-qX', '-c', 'drop database if exists launcher_check with (force)', '-c', 'create database launcher_check template postgres'], capture_output=True)
check('test accounts: on a fresh local database none exist and there are no real users', psql('launcher_check', q_existing) == '0' and psql('launcher_check', q_others) == '0')
r = subprocess.run(['psql', '-h', '/tmp', '-p', '54322', '-U', 'postgres', '-d', 'launcher_check', '-qX', '-v', 'ON_ERROR_STOP=1', '-f', os.path.join(proj, 'supabase/local_test_accounts.sql')], capture_output=True, text=True)
check('test accounts: creating them works', r.returncode == 0 and psql('launcher_check', q_existing) == '14')
r2 = subprocess.run(['psql', '-h', '/tmp', '-p', '54322', '-U', 'postgres', '-d', 'launcher_check', '-qX', '-v', 'ON_ERROR_STOP=1', '-f', os.path.join(proj, 'supabase/local_test_accounts.sql')], capture_output=True, text=True)
check('test accounts: a second run is refused and changes nothing', r2.returncode != 0 and 'already exist' in r2.stderr and psql('launcher_check', q_existing) == '14')
psql('launcher_check', "insert into auth.users(id, email) values (gen_random_uuid(), 'real.person@example.org')")
check('test accounts: a database with a real user is detected (the launcher stops)', psql('launcher_check', q_others) == '1' and 'if not "%OTHERS%"=="0" goto :err_real_users' in create)
subprocess.run(['psql', '-h', '/tmp', '-p', '54322', '-U', 'postgres', '-d', 'template1', '-qX', '-c', 'drop database if exists launcher_check with (force)'], capture_output=True)
check('test accounts are never created without asking first', create.index('choice /c YN') < create.index('docker exec -i'))

failed = [n for n, ok in results if not ok]
print(f'launcher logic: {len(results) - len(failed)}/{len(results)} checks passed (Windows itself not run)')
for n in failed: print('  FAILED ' + n)
sys.exit(1 if failed else 0)
