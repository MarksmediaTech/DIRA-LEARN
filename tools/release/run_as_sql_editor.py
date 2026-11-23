#!/usr/bin/env python3
"""Runs a .sql file the way the Supabase Dashboard SQL Editor does: the WHOLE text sent as ONE query (libpq PQexec, the
simple-query protocol). PostgreSQL then executes all statements as one implicit transaction: the first error rolls the
whole text back. (psql -f, by contrast, sends statement by statement.) Prints the last result set, or the error.

Usage: python3 -I tools/release/run_as_sql_editor.py <file.sql> [dbname] [--wrap]
  --wrap  additionally wraps the text in BEGIN ... COMMIT, in case an editor adds its own transaction.
Exit code: 0 success, 1 SQL error.
"""
import ctypes, ctypes.util, sys

path = sys.argv[1]; db = next((a for a in sys.argv[2:] if not a.startswith('--')), 'postgres'); wrap = '--wrap' in sys.argv
lib = ctypes.CDLL(ctypes.util.find_library('pq') or 'libpq.so.5')
lib.PQconnectdb.restype = ctypes.c_void_p; lib.PQconnectdb.argtypes = [ctypes.c_char_p]
lib.PQstatus.argtypes = [ctypes.c_void_p]; lib.PQerrorMessage.restype = ctypes.c_char_p; lib.PQerrorMessage.argtypes = [ctypes.c_void_p]
lib.PQexec.restype = ctypes.c_void_p; lib.PQexec.argtypes = [ctypes.c_void_p, ctypes.c_char_p]
lib.PQresultStatus.argtypes = [ctypes.c_void_p]; lib.PQresultErrorMessage.restype = ctypes.c_char_p; lib.PQresultErrorMessage.argtypes = [ctypes.c_void_p]
lib.PQntuples.argtypes = [ctypes.c_void_p]; lib.PQnfields.argtypes = [ctypes.c_void_p]
lib.PQfname.restype = ctypes.c_char_p; lib.PQfname.argtypes = [ctypes.c_void_p, ctypes.c_int]
lib.PQgetvalue.restype = ctypes.c_char_p; lib.PQgetvalue.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int]
lib.PQtransactionStatus.argtypes = [ctypes.c_void_p]
lib.PQclear.argtypes = [ctypes.c_void_p]; lib.PQfinish.argtypes = [ctypes.c_void_p]

import os   # DIRA_SQL_USER: connect as another role, e.g. the non-superuser that emulates the Supabase SQL Editor's role
conn = lib.PQconnectdb(f'host=/tmp port=54322 user={os.environ.get("DIRA_SQL_USER", "postgres")} dbname={db}'.encode())
if lib.PQstatus(conn) != 0: sys.exit('connection failed: ' + lib.PQerrorMessage(conn).decode())
sql = open(path, encoding='utf-8', newline='').read()   # newline='': send line endings exactly as in the file (CRLF stays CRLF)
if wrap: sql = 'begin;\n' + sql + '\n;commit;'
res = lib.PQexec(conn, sql.encode())
st = lib.PQresultStatus(res)            # 1 COMMAND_OK, 2 TUPLES_OK, 7 FATAL_ERROR
if st == 7:
    print('ERROR: ' + lib.PQresultErrorMessage(res).decode().strip())
    code = 1
else:
    n, f = lib.PQntuples(res), lib.PQnfields(res)
    if f:
        cols = [lib.PQfname(res, j).decode() for j in range(f)]
        for i in range(n): print(' | '.join(f'{cols[j]}={(lib.PQgetvalue(res, i, j) or b"").decode()}' for j in range(f)))
    code = 0
# like the dashboard, nothing may be left open: report a transaction still in progress or aborted
ts = lib.PQtransactionStatus(conn)       # 0 idle, 2 in transaction, 3 in failed transaction
if ts in (2, 3): print(f'WARNING: transaction left {"open" if ts == 2 else "aborted"} after the query'); code = code or 1
lib.PQclear(res); lib.PQfinish(conn)
sys.exit(code)
