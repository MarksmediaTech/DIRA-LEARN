#!/usr/bin/env python3
"""Static checks for the Windows launcher .bat files (Windows itself is not available here).
Usage: python3 -I tools/check_bat_files.py <project>"""
import re, sys, os
proj = sys.argv[1]
files = [f for f in os.listdir(proj) if f.lower().endswith('.bat')]
FORBIDDEN = [r'db\s+reset', r'db\s+push', r'functions\s+deploy', r'--linked', r'\bsupabase\s+link\b', r'--no-backup', r'migration\s+repair',
             r'netlify', r'\bdel\b[^\n]*supabase\\migrations', r'\brmdir\b', r'\brd\s', r'docker\s+(rm|volume\s+rm|system\s+prune)', r'\bsupabase\s+stop\s+-', r'--remote\b', r'--project-ref', r'--db-url',
             r'\bsupabase\b[^\n]*\s--yes\b', r'config\s+push', r'secrets\s+(set|unset)',
             r'drop\s+(table|database|schema)', r'truncate\s']
problems, checked = [], 0
for f in sorted(files):
    raw = open(os.path.join(proj, f), 'rb').read()
    text = raw.decode('utf-8')
    lines = text.split('\r\n')
    def P(msg): problems.append(f'{f}: {msg}')
    checked += 1
    if b'\n' in raw.replace(b'\r\n', b''): P('has LF-only line endings (Windows batch files need CRLF)')
    if any(ord(c) > 127 for c in text): P('contains non-ASCII characters (can display wrongly in the Windows console)')
    labels = {m.group(1).lower() for m in re.finditer(r'^:([A-Za-z0-9_]+)\s*$', text, re.M)}
    for m in re.finditer(r'\b(?:goto|call)\s+:([A-Za-z0-9_]+)', text, re.I):
        if m.group(1).lower() not in labels and m.group(1).lower() != 'eof': P(f'jumps to a label that does not exist: :{m.group(1)}')
    depth = 0
    for n, line in enumerate(lines, 1):
        code = line.strip()
        if code.lower().startswith('rem') or code.startswith('::'): continue
        # brackets that count for block structure: outside double quotes, not escaped with ^, not part of an echo text after "echo"
        q = False; i = 0; seg = code
        while i < len(seg):
            c = seg[i]
            if c == '"': q = not q
            elif c == '^': i += 1
            elif not q and c in '()':
                before = seg[:i].lower()
                # text after "echo" inside a block: an unescaped ")" closes the block, "(" does not open one
                in_echo = re.search(r'(^|[&(|]\s*)echo\b[^&|)]*$', before) is not None
                if c == '(' and not in_echo: depth += 1
                elif c == ')':
                    if in_echo and depth == 0: pass          # ")" in an echo outside any block is plain text
                    else: depth -= 1
            i += 1
        if depth < 0: P(f'line {n}: closing bracket without an opening one'); depth = 0
        if re.search(r'\bfor\s+/f\b', code, re.I) and re.search(r"\(\s*'[^']*\([^']*'\s*\)", code): P(f'line {n}: brackets inside a for /f command')
        if re.search(r'%[a-z]\b', code) and re.search(r'\bfor\b', code, re.I) and not re.search(r'%%[a-z]', code): P(f'line {n}: for-loop variable must be written %%x in a .bat file')
        if '!' in code and 'enabledelayedexpansion' not in text.lower() and not code.lower().startswith('echo'): P(f'line {n}: uses ! without delayed expansion')
        if re.search(r'echo[^\n]*%(LOCAL_ANON_KEY|VITE_SUPABASE_ANON_KEY|SERVICE_ROLE|ANON_KEY)%', code, re.I): P(f'line {n}: would print a key')
        if re.search(r'^\s*(npm|npx)\b', code, re.I): P(f'line {n}: npm/npx must be started with "call" in a .bat file, or the script stops after it')
        if re.search(r'\bsupabase\s+stop\b', code, re.I) and not any('choice /c YN' in lines[j] for j in range(max(0, n - 6), n - 1)):
            P(f'line {n}: "supabase stop" must come straight after a yes/no question (choice /c YN)')
        for pat in FORBIDDEN:
            if re.search(pat, code, re.I): P(f'line {n}: forbidden command ({pat}): {code[:80]}')
    if depth != 0: P(f'brackets do not balance (depth {depth} at the end)')
    if 'pause' not in text.lower(): P('never pauses, so the window would close before messages can be read')
print(f'batch-file check: {checked} files, {len(problems)} problems')
for p in problems: print('  PROBLEM ' + p)
sys.exit(1 if problems else 0)
