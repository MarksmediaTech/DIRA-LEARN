#!/usr/bin/env python3
"""Writes FILE_INVENTORY.txt into the production folder and packs it into a ZIP that Windows Explorer extracts reliably:
explicit entries for every folder, MS-DOS attributes (folder 0x10, file 0x20), no Unix permission bits, Deflate, forward
slashes, ASCII names, one top-level folder. Then re-opens the ZIP and verifies every file against the inventory.
Usage: make_zip.py <production folder> <zip file>"""
import hashlib, os, sys, time, zipfile
folder, out = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
top = os.path.basename(folder)
files = sorted(os.path.relpath(os.path.join(d, f), folder).replace(os.sep, '/') for d, _, fs in os.walk(folder) for f in fs if f != 'FILE_INVENTORY.txt')
def sha(p): return hashlib.sha256(open(os.path.join(folder, p), 'rb').read()).hexdigest()
groups = {}
for f in files: groups.setdefault(f.split('/')[0] if '/' in f else '(top level)', []).append(f)
lines = ['DIRA LEARN production source - file inventory', f'Generated {time.strftime("%Y-%m-%d %H:%M")} - {len(files)} files (plus this file)', '',
         'Files per top-level folder:'] + [f'  {k:<16} {len(v):>4}' for k, v in sorted(groups.items())] + ['', 'size_bytes  sha256  path']
lines += [f'{os.path.getsize(os.path.join(folder, f)):>10}  {sha(f)}  {f}' for f in files]
open(os.path.join(folder, 'FILE_INVENTORY.txt'), 'w', newline='\n').write('\n'.join(lines) + '\n')
files = sorted(files + ['FILE_INVENTORY.txt'])
dirs = sorted({'/'.join(f.split('/')[:i]) for f in files for i in range(1, f.count('/') + 1)})
if os.path.exists(out): os.remove(out)
now = time.localtime()[:6]
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    def entry(name, is_dir):
        zi = zipfile.ZipInfo(name, date_time=now); zi.create_system = 0; zi.create_version = 20; zi.extract_version = 20
        zi.external_attr = 0x10 if is_dir else 0x20; zi.compress_type = zipfile.ZIP_STORED if is_dir else zipfile.ZIP_DEFLATED
        return zi
    z.writestr(entry(top + '/', True), b'')
    for d in dirs: z.writestr(entry(f'{top}/{d}/', True), b'')
    for f in files:
        name = f'{top}/{f}'; assert name.isascii() and len(name) < 200, name
        z.writestr(entry(name, False), open(os.path.join(folder, f), 'rb').read())
# verify
z = zipfile.ZipFile(out); bad = z.testzip(); names = set(z.namelist()); problems = []
if bad: problems.append('corrupt entry ' + bad)
for f in files:
    n = f'{top}/{f}'
    if n not in names: problems.append('missing ' + n); continue
    if hashlib.sha256(z.read(n)).hexdigest() != hashlib.sha256(open(os.path.join(folder, f), 'rb').read()).hexdigest(): problems.append('different ' + n)
extra = names - {f'{top}/{f}' for f in files} - {f'{top}/{d}/' for d in dirs} - {top + '/'}
if extra: problems.append('unexpected entries: ' + ', '.join(sorted(extra)))
print(f'{out}: {len(files)} files, {len(dirs) + 1} folders, {os.path.getsize(out)} bytes; verified against the folder: {"OK" if not problems else "PROBLEMS"}')
for p in problems: print('  ' + p)
sys.exit(1 if problems else 0)
