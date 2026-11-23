// Integration check for supabase/functions/_shared/scanner.ts against a local fake ClamAV REST service.
import http from 'node:http';
import path from 'node:path';
const proj = process.argv[2] ?? '.';
const { scanClamavRest } = await import(path.resolve(proj, 'supabase/functions/_shared/scanner.ts'));
let lastAuth = ''; let lastBody = '';
const server = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; }); req.on('end', () => {
    lastAuth = String(req.headers.authorization ?? ''); lastBody = body;
    if (req.url === '/hang') return;                                   // never answers
    if (body.includes('X5O!P%@AP')) { res.writeHead(406); res.end('{"Status":"FOUND","Description":"Eicar-Test-Signature"}'); return; }
    if (req.url === '/broken') { res.writeHead(500); res.end('clamd not ready'); return; }
    res.writeHead(200); res.end('{"Status":"OK"}');
  });
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const eicar = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
const checks: [string, boolean][] = [];
const clean = await scanClamavRest(new Blob(['hello']), 'a.pdf', `${base}/scan`, 'tok123');
checks.push(['clean file -> clean', clean.result === 'clean'], ['sends the file as multipart field "file"', lastBody.includes('name="file"') && lastBody.includes('filename="a.pdf"')], ['sends the bearer token', lastAuth === 'Bearer tok123']);
const bad = await scanClamavRest(new Blob([eicar]), 'b.pdf', `${base}/scan`, undefined);
checks.push(['EICAR test file -> infected', bad.result === 'infected' && bad.detail.includes('Eicar')], ['no token -> no Authorization header', lastAuth === '']);
const broken = await scanClamavRest(new Blob(['x']), 'c.pdf', `${base}/broken`, undefined);
checks.push(['scanner error -> error (file stays queued)', broken.result === 'error' && broken.detail.includes('500')]);
const hang = await scanClamavRest(new Blob(['x']), 'd.pdf', `${base}/hang`, undefined, 300);
checks.push(['no answer -> error after the timeout', hang.result === 'error']);
const down = await scanClamavRest(new Blob(['x']), 'e.pdf', 'http://127.0.0.1:1/scan', undefined, 2000);
checks.push(['scanner unreachable -> error', down.result === 'error']);
server.closeAllConnections(); server.close();
const failed = checks.filter(([, ok]) => !ok);
console.log(`scanner adapter: ${checks.length - failed.length}/${checks.length} checks passed`);
for (const [name] of failed) console.log('  FAILED ' + name);
process.exit(failed.length ? 1 : 0);
