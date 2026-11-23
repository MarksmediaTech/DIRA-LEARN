DIRA LEARN - TESTING ON YOUR OWN WINDOWS COMPUTER
=================================================

Everything in this folder runs ONLY on your own computer. Nothing here
connects to the live DIRA LEARN website or the live database, and nothing
here publishes anything to the internet.

IMPORTANT: these launcher files were written and checked on Linux. They have
NOT yet been run on a real Windows computer. If anything goes wrong, the
window stays open and shows a message - please send that message.


1. WHAT YOU NEED (one time)
---------------------------
  - Node.js 20 or 22 "LTS" from https://nodejs.org (version 18 is the
    minimum; older versions are refused with a clear message).
  - Docker Desktop from https://www.docker.com/products/docker-desktop
    (installed in the normal place; you do not have to start it yourself).
  - An internet connection the FIRST time. The first start downloads the
    website's packages and the local database (about 2 GB). This can take
    10 to 30 minutes. Later starts take about 1 minute.


2. THE FILES
------------
  START-DIRA-LEARN.bat
      Double-click this to use DIRA LEARN. It:
        1. checks Node.js and npm
        2. checks Docker Desktop, opens it if it is closed and waits for it
           (up to 4 minutes)
        3. installs the website's packages, only if they are missing
        4. checks the local database settings (supabase\config.toml)
        5. starts the local database, only if it is not already running
        6. checks for database updates; if there are any, it ASKS you
           before applying them (it never wipes the database)
        7. connects the website to the LOCAL database only - if the address
           is not on your own computer it stops
        8. starts the website and opens http://localhost:5173 in your browser
      If the website is already running, it just opens the browser.

  CHECK-DIRA-LEARN.bat
      Changes nothing. Shows a list of [OK], [MISSING] and [WARNING] lines:
      Node.js, Docker, packages, database, updates, ports and settings.
      Use it when something does not work, and send the result.

  TEST-PASSWORD-RECOVERY.bat  (optional)
      Tests "Forgot password?" against the LOCAL database and its test
      inbox: codes, wrong/expired/reused codes, the one-minute resend
      limit, the guessing limit, password rules, sign-in with the new
      password, and that nobody's role changes. It changes some TEST
      account passwords for a few minutes and sets them back to
      DiraTest!2026. Takes about 5 minutes. It asks before starting,
      and can also run the browser test (downloads a test browser once).

  CREATE-DIRA-TEST-ACCOUNTS.bat  (optional, run it once)
      Creates 14 test accounts in the LOCAL database. Run it after
      START-DIRA-LEARN.bat has started everything. It asks before doing
      anything, refuses if the test accounts already exist, and refuses if
      the database contains any real (non-test) account. It is never run
      automatically.


3. USING IT
-----------
  1. Double-click START-DIRA-LEARN.bat.
  2. Wait. Messages [1/8] to [8/8] appear. Your browser opens by itself.
  3. The first time only: double-click CREATE-DIRA-TEST-ACCOUNTS.bat and
     press Y. Then sign in with one of the test accounts below.

  Test accounts (local only, password for all:  DiraTest!2026 )
     founder@dira-test.local        Founder
     cofounder@dira-test.local      Co-Founder
     admin@dira-test.local          Super Administrator
     director@dira-test.local       Programme Director (test Safeguarding Lead)
     coordinator@dira-test.local    Programme Coordinator (test Safeguarding Deputy)
     trainer.a@dira-test.local      Facilitator, Test cohort A
     trainer.b@dira-test.local      Facilitator, Test cohort B
     mentor@dira-test.local         Mentor of learner2
     me@dira-test.local             M&E officer
     learner1@dira-test.local       Learner, cohort A (access open)
     learner2@dira-test.local       Learner, cohort A (access open)
     learner3@dira-test.local       Learner, cohort A (access opens in 10 days)
     learner4@dira-test.local       Learner, cohort B (access open)
     applicant@dira-test.local      Applicant
  These are made-up accounts for testing. They exist only on your computer.


4. HOW TO STOP
--------------
  - To stop the WEBSITE: close the window titled
        "DIRA LEARN - website running (close this window to stop it)"
    (or click in it and press Ctrl+C, then Y).
    A second small window opens the browser; it closes by itself.

  - The local DATABASE keeps running inside Docker Desktop after you close
    the website. That is normal and keeps your test data. Next time,
    START-DIRA-LEARN.bat simply reuses it.

  - To stop the database too: quit Docker Desktop (right-click the whale
    icon near the clock > Quit Docker Desktop). Your test data is kept and
    is there again the next time you start.

  - Do NOT use "supabase stop --no-backup" or "supabase db reset": they
    delete the local test data. The launcher never uses them.


5. USEFUL LOCAL ADDRESSES (only work while the system is running)
-----------------------------------------------------------------
  http://localhost:5173    DIRA LEARN
  http://localhost:54323   Local database viewer (Supabase Studio)
  http://localhost:54324   Local test mailbox (Mailpit) - emails "sent" by
                           the local system (sign-up confirmations, password
                           reset CODES) arrive here, never in a real inbox.

  FORGOT PASSWORD (works for every account, learners and staff alike):
     On the sign-in page click "Forgot password?", type the email, then
     open http://localhost:54324 to read the 6-digit code. The code works
     for 15 minutes and only once. A new code can be requested once a
     minute.


6. SAFETY - WHAT THE LAUNCHER NEVER DOES
----------------------------------------
  - never connects to or changes the live database
  - never publishes or deploys anything (no Netlify, no Supabase push)
  - never wipes or resets the database and never deletes data or files
  - never changes your .env.local file (the local connection is given to
    the website only inside the launcher window)
  - never shows keys or passwords on screen (error logs are filtered, and
    the temporary start log is deleted after a successful start)
  - never changes database security rules (RLS)


7. IF SOMETHING GOES WRONG
--------------------------
  The window stays open and says what to do. Common cases:

  "Node.js was not found" / "too old"
      Install Node.js 20 or 22 LTS, then restart the computer.

  "Docker Desktop was not found" / "did not start in time"
      Install or open Docker Desktop yourself, wait until it says
      "Engine running", then double-click START-DIRA-LEARN.bat again.
      On some computers Docker asks to enable WSL 2 or virtualisation the
      first time - follow its instructions.

  "port 5173 is in use by another program"
      Something else uses that port. Close it (or restart the computer)
      and try again.

  "port is already allocated" while starting the database
      Another program, or another local Supabase project, uses ports
      54321 to 54324. Stop it in Docker Desktop and try again.

  "The database address is not on this computer"
      The launcher stopped on purpose to protect the live system.
      Run CHECK-DIRA-LEARN.bat and send the result.

  Anything else: run CHECK-DIRA-LEARN.bat and send the whole window
  (a screenshot is fine). It does not show keys or passwords.


8. KNOWN LIMITS OF LOCAL TESTING (not yet verified on Windows)
--------------------------------------------------------------
  - Server functions (Edge Functions) such as e-mails, the attachment
    virus scanner, importing learners and the /setup "first administrator"
    page are not started by the launcher, so those features may show an
    error locally. Use the test accounts instead of /setup.
  - Attachments stay "waiting for scan" locally, because no virus scanner
    runs on your computer. This is the intended safe behaviour.
  - Real e-mails are never sent; look in http://localhost:54324.

9. SUPABASE TOOL VERSION 3 (November 2026)
------------------------------------------
  This folder is set up for Supabase CLI version 3, which is pinned in
  package.json: the first start installs it INTO this folder, so the
  launcher always uses the same version. The old [inbucket] setting is
  now called [local_smtp]. If the launcher says the settings changed,
  answer Y to restart the local database - your test data is kept.

10. TESTING THIS PACKAGE ON WINDOWS - STEP BY STEP
-------------------------------------------------
  These steps have NOT been run on Windows by the developer. Please do
  them once and send the results (screenshots of the windows are fine).

  A. Prepare
     1. Make sure Docker Desktop is installed and shows "Engine running".
     2. Unzip the new ZIP into a NEW, empty folder, for example
        C:\DIRA\v13.2-test  (do not unzip over the old folder).
     3. Open the dira-learn folder inside it.

  B. Start (expected: 8 steps, then the browser opens)
     4. Double-click START-DIRA-LEARN.bat.
     5. Step [3/8] installs the packages the first time (several
        minutes; it also installs the Supabase tool version 3).
     6. Step [4/8] must say:
           OK - settings found, Supabase tool version 3.x
        If it says the tool is too old, run "npm install" in the folder
        (type cmd in the folder's address bar) and start again.
     7. Step [5/8] starts the local database (first time about 2 GB,
        10 minutes or more). If it asks to restart because settings
        changed, press Y - test data is kept.
     8. Step [6/8] may ask to apply database updates: press Y.
     9. Step [7/8] must show:
           [OK] database
           [OK] sign-in service - Supabase Auth
           [OK] Studio at http://localhost:54323
           [OK] test email inbox at http://127.0.0.1:54324
     10. The browser opens DIRA LEARN at http://localhost:5173.

  C. Check each service yourself
     11. Studio:      open http://localhost:54323 - the Supabase Studio
                      dashboard appears; Table Editor lists the tables.
     12. Test inbox:  open http://localhost:54324 - the Mailpit inbox.
     13. Database:    double-click CHECK-DIRA-LEARN.bat - it must show
                      "Database updates: 35 applied, 35 in this folder"
                      and [OK] for the sign-in service and test inbox.

  D. Sign in and reset a password
     14. Double-click CREATE-DIRA-TEST-ACCOUNTS.bat once and press Y.
     15. Sign in as learner1@dira-test.local / DiraTest!2026.
     16. Sign out, click "Forgot password?", enter learner1@dira-test.local,
         read the code at http://localhost:54324, enter it, and choose a
         new password. Sign in with it.
     17. Optional: double-click TEST-PASSWORD-RECOVERY.bat (about 5 min).

  E. What to send back
     - A screenshot of the START window after step [7/8] (no keys or
       passwords are shown there).
     - The CHECK-DIRA-LEARN.bat window.
     - If anything failed: the whole window with the [PROBLEM] lines.
     - The Supabase tool version shown in step [4/8].

  Nothing in these steps deletes data, resets the database, deploys,
  or contacts the live DIRA LEARN system.
