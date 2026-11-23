#!/usr/bin/env python3
"""Every page route in src/App.tsx is either one of the six public pages or sits behind ProtectedRoute with a role list
from src/lib/permissions.ts; every menu entry has a route; unknown addresses show "Page not found"."""
import re, sys, os
proj = sys.argv[1]
app = open(os.path.join(proj, 'src/App.tsx')).read(); perm = open(os.path.join(proj, 'src/lib/permissions.ts')).read()
PUBLIC = {'/login', '/signup', '/set-password', '/forgot-password', '/setup', '/verify'}
nav = set(re.findall(r"path: '([^']+)'", perm.split('NAV_GROUP_OF')[0]))
problems, protected = [], set()
# open to every signed-in, active account (inside the outer ProtectedRoute, no role list on purpose)
ALL_SIGNED_IN = {'/account/password'}
for line in app.splitlines():
    for p in re.findall(r'<Route path="([^"*]+)"', line):
        full = p if p.startswith('/') else '/' + p
        if full in PUBLIC: continue
        guard = re.search(r"rolesFor\('([^']+)'\)", line)
        if guard: base = guard.group(1)
        else: base = None
        protected.add((full, base))
# routes on lines without their own guard sit in a guarded group: find the group's rolesFor just above
lines = app.splitlines()
for i, line in enumerate(lines):
    for p in re.findall(r'<Route path="([^"*]+)"', line):
        full = p if p.startswith('/') else '/' + p
        # old addresses that only forward elsewhere (22 Nov 2026: /connect, /announcements, /notifications) show nothing themselves;
        # they sit inside the signed-in area and the page they lead to has its own guard
        if full in PUBLIC or full in ALL_SIGNED_IN or 'rolesFor' in line or '<Navigate ' in line: continue
        above = next((re.search(r"rolesFor\('([^']+)'\)", lines[j]) for j in range(i - 1, max(i - 4, 0), -1) if 'rolesFor' in lines[j]), None)
        if not above: problems.append(f'{full}: no ProtectedRoute role list')
        elif not (full == above.group(1) or full.startswith(above.group(1) + '/')): problems.append(f'{full}: guarded by {above.group(1)}')
public_found = set(re.findall(r'<Route path="(/[a-z-]+)" element', app)) & PUBLIC
if public_found != PUBLIC: problems.append(f'public pages differ: {sorted(PUBLIC ^ public_found)}')
routes = {f for f, _ in protected} | {'/'}
for n in sorted(nav):
    if n not in routes: problems.append(f'menu entry {n} has no route')
if '<Route path="*"' not in app: problems.append('no catch-all route')
guarded = sum(1 for f, _ in protected)
print(f'routes: {len(PUBLIC)} public pages, {guarded} protected routes, {len(nav)} menu entries; {len(problems)} problems')
for p in problems: print('  PROBLEM ' + p)
sys.exit(1 if problems else 0)
