// Browser check (real Chrome, the project's real CSS and the real CoverHero / LoginPage code) of the 23 Nov 2026 visual changes:
//  1. panels: translucent purple + multicolour glowing ring, readable text (WCAG contrast measured from screenshots), inputs and light surfaces
//  2. welcome panel: ring and glow, photographs still visible (not covered), controls work
//  3. photographs: the welcome panel and sign-in page keep their original compositions and show every photograph whole (four coloured corner markers), no stretch, no zoom, at desktop / tablet / phone
//  4. no horizontal scroll on a phone; reduced motion stops the ring animation; opt-out (dira-plain) and warning banners keep their style
// Usage: node tools/ui-theme/theme_check.mjs <project> [screenshot-dir]. Needs /opt/npm-tools (Playwright, esbuild, Tailwind 4 compiler) and python3 + PIL.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import { execFileSync } from 'node:child_process';
const proj = path.resolve(process.argv[2] ?? '.'); const shots = path.resolve(process.argv[3] ?? path.join(os.tmpdir(), 'ui-theme-shots')); fs.mkdirSync(shots, { recursive: true });
const here = path.dirname(new URL(import.meta.url).pathname); const rec = path.join(proj, 'tools/recovery/browser');
const results = []; const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  – ' + detail : ''}`); };

// synthetic photographs: a coloured marker in each corner, different proportions (a cropped photograph loses a marker)
const synth = fs.mkdtempSync(path.join(os.tmpdir(), 'synth-'));
execFileSync('python3', ['-c', `
from PIL import Image, ImageDraw
for n,(w,h) in {'landscape':(1500,1000),'portrait':(1000,1500),'wide':(1800,900),'square':(1200,1200)}.items():
    im=Image.new('RGB',(w,h),(90,120,150)); d=ImageDraw.Draw(im); m=int(min(w,h)*0.08)
    for x,y,c in [(0,0,(255,0,0)),(w-m,0,(0,255,0)),(0,h-m,(0,0,255)),(w-m,h-m,(255,255,0))]: d.rectangle([x,y,x+m,y+m],fill=c)
    im.save('${synth}/'+n+'.jpg',quality=92)
`]);
const KINDS = ['landscape', 'portrait', 'wide', 'square', 'landscape', 'portrait'];

async function build(entry, out) {
  fs.mkdirSync(out, { recursive: true });
  execFileSync('node', [path.join(rec, 'build.mjs'), proj, out], { stdio: 'inherit', env: { ...process.env, ...(entry ? { HARNESS_ENTRY: entry } : {}) } });
  execFileSync('node', [path.join(rec, 'build-css.mjs'), proj, out], { stdio: 'inherit' });
  fs.writeFileSync(path.join(out, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
}
const themeOut = fs.mkdtempSync(path.join(os.tmpdir(), 'theme-')); const loginOut = fs.mkdtempSync(path.join(os.tmpdir(), 'login-'));
await build('../../ui-theme/harness-theme.tsx', themeOut); await build(null, loginOut);
const serve = (dir) => new Promise((ok) => { const s = http.createServer((q, r) => { const f = q.url.startsWith('/app.js') ? 'app.js' : q.url.startsWith('/app.css') ? 'app.css' : 'index.html';
  r.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' }); r.end(fs.readFileSync(path.join(dir, f))); }); s.listen(0, '127.0.0.1', () => ok({ s, base: `http://127.0.0.1:${s.address().port}` })); });
const t = await serve(themeOut), l = await serve(loginOut);
const exe = fs.existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined;
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });

async function open(base, p, w, h, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: opts.reducedMotion ? 'reduce' : 'no-preference' }); const page = await ctx.newPage();
  let n = 0; const kindOf = new Map();
  await page.route('**/assets/photos/**', (route) => { const u = route.request().url(); if (!kindOf.has(u)) kindOf.set(u, KINDS[n++ % KINDS.length]);
    route.fulfill({ status: 200, contentType: 'image/jpeg', body: fs.readFileSync(path.join(synth, kindOf.get(u) + '.jpg')) }); });
  await page.goto(base + p); await page.waitForLoadState('networkidle'); return { ctx, page };
}
const COUNT = `
import sys,json
from PIL import Image
im=Image.open(sys.argv[1]).convert('RGB'); px=im.load(); cnt={'red':0,'green':0,'blue':0,'yellow':0}
for i in range(im.width):
  for j in range(im.height):
    r,g,b=px[i,j]
    if r>200 and g<60 and b<60: cnt['red']+=1
    elif g>200 and r<60 and b<60: cnt['green']+=1
    elif b>200 and r<60 and g<60: cnt['blue']+=1
    elif r>200 and g>200 and b<60: cnt['yellow']+=1
print(json.dumps(cnt))`;
async function shotMarkers(locator, png) {
  let m; for (let k = 0; k < 6; k++) { await locator.screenshot({ path: png }); m = JSON.parse(execFileSync('python3', ['-c', COUNT, png], { encoding: 'utf8' })); if (Object.values(m).every((c) => c >= 20)) break; await new Promise((r) => setTimeout(r, 300)); }
  return m;
}
const py = (code, args) => execFileSync('python3', ['-c', code, ...args], { encoding: 'utf8' });
const markers = (png, box) => JSON.parse(py(`
import sys,json
from PIL import Image
im=Image.open(sys.argv[1]).convert('RGB'); x,y,w,h=map(int,json.loads(sys.argv[2])); c=im.crop((x,y,x+w,y+h)); px=c.load(); cnt={'red':0,'green':0,'blue':0,'yellow':0}
for i in range(c.width):
  for j in range(c.height):
    r,g,b=px[i,j]
    if r>200 and g<60 and b<60: cnt['red']+=1
    elif g>200 and r<60 and b<60: cnt['green']+=1
    elif b>200 and r<60 and g<60: cnt['blue']+=1
    elif r>200 and g>200 and b<60: cnt['yellow']+=1
print(json.dumps(cnt))`, [png, JSON.stringify([box.x, box.y, box.width, box.height].map(Math.round))]));

// ---------- panels and welcome panel at three sizes ----------
for (const [label, w, h] of [['desktop', 1280, 1000], ['tablet', 820, 1000], ['phone', 390, 844]]) {
  const { ctx, page } = await open(t.base, '/', w, h);
  await page.waitForSelector('[data-testid=session-card]');
  const png = path.join(shots, `panels-${label}.png`); await page.screenshot({ path: png, fullPage: true });
  const info = await page.evaluate(() => {
    const cs = (sel, pseudo) => getComputedStyle(document.querySelector(sel), pseudo ?? null);
    const q = (sel) => document.querySelector(sel);
    const rect = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height }; };
    const panelSel = ['[data-testid=session-card]', '[data-testid=form-panel]', '[data-testid=roster]', '[data-testid=tiles] li a', 'dl > div'];
    const panels = panelSel.map((s) => ({ s, bg: cs(s).backgroundImage.slice(0, 80), ring: cs(s, '::before').content, ringBg: cs(s, '::before').backgroundImage.slice(0, 60), shadow: cs(s).boxShadow !== 'none', radius: cs(s).borderTopLeftRadius }));
    // text probes: [label, selector, background kind]  (panel = sample the panel; self = sample the element's own surface)
    const probes = [['heading on panel', '[data-testid=session-card] h3', 'panel'], ['small caps label', '[data-testid=session-card] p.uppercase', 'panel'], ['muted text (ink/70)', '[data-testid=session-card] p.text-ink\\/70', 'panel'],
      ['error text', '[data-testid=session-card] p[role=alert]', 'panel'], ['approved pill', '[data-testid=session-card] .bg-ok\\/10', 'panel'], ['scheduled pill (light surface)', '[data-testid=session-card] .bg-purple-100', 'self'],
      ['draft pill (light surface)', '[data-testid=session-card] .bg-orange-50', 'self'], ['label', '[data-testid=form-panel] label', 'panel'], ['select (light surface)', '[data-testid=form-panel] select', 'self'],
      ['input (light surface)', '[data-testid=form-panel] input', 'self'], ['primary button', '[data-testid=form-panel] button', 'self'], ['quiet button', '[data-testid=form-panel] button:nth-of-type(2)', 'self'],
      ['staff note (light)', '[data-testid=form-panel] .border-l-4', 'self'], ['roster name', '[data-testid=roster] li span', 'panel'], ['roster muted', '[data-testid=roster] li span.text-ink\\/70', 'panel'], ['tile link text', '[data-testid=tiles] li a', 'self']]
      .map(([name, s, kind]) => { const el = q(s); const r = rect(el); return { name, color: getComputedStyle(el).color, kind, rect: r, panelRect: rect(el.closest('.rounded-card, [data-testid]')) }; });
    const sel = q('[data-testid=form-panel] select'); const opt = getComputedStyle(sel.querySelector('option'));
    return { panels, probes, optionColor: opt.color, optionBg: opt.backgroundColor, scrollW: document.documentElement.scrollWidth, innerW: innerWidth,
      plain: { bg: cs('[data-testid=plain]').backgroundImage, ring: cs('[data-testid=plain]', '::before').content }, banner: { bg: cs('[data-testid=banner]').backgroundColor, ring: cs('[data-testid=banner]', '::before').content },
      welcome: { ring: cs('.dira-welcome', '::before').content, anim: cs('.dira-welcome', '::before').animationName, shadow: cs('.dira-welcome').boxShadow !== 'none', radius: cs('.dira-welcome').borderTopLeftRadius, overflow: cs('.dira-welcome').overflow },
      heading: q('h1')?.textContent, tagline: document.body.textContent.includes('Your direction.') };
  });
  for (const p of info.panels) check(`${label}: panel ${p.s} has the translucent purple background, a gradient ring and a glow`, /gradient/.test(p.bg) && p.ring === '""' && /linear-gradient/.test(p.ringBg) && p.shadow && parseFloat(p.radius) >= 10, `${p.radius}`);
  check(`${label}: opted-out (dira-plain) card is not themed`, !/gradient/.test(info.plain.bg) && info.plain.ring === 'none');
  check(`${label}: warning banner keeps its own colours`, info.banner.bg !== 'rgba(0, 0, 0, 0)' && info.banner.ring === 'none', info.banner.bg);
  check(`${label}: welcome panel has the ring, an outer glow and rounded corners; content kept`, info.welcome.ring === '""' && info.welcome.shadow && parseFloat(info.welcome.radius) >= 20 && info.heading === 'Welcome back, Amina' && info.tagline, `${info.welcome.anim}`);
  check(`${label}: select list options are dark on white`, info.optionColor === 'rgb(33, 23, 58)' && info.optionBg === 'rgb(255, 255, 255)', `${info.optionColor} on ${info.optionBg}`);
  check(`${label}: no horizontal scrolling`, info.scrollW <= info.innerW, `${info.scrollW} <= ${info.innerW}`);
  // contrast from screenshot pixels
  const out = JSON.parse(py(`
import sys,json,re
from PIL import Image
im=Image.open(sys.argv[1]).convert('RGB'); probes=json.loads(sys.argv[2])
def lum(c):
  def f(v):
    v/=255; return v/12.92 if v<=0.03928 else ((v+0.055)/1.055)**2.4
  return 0.2126*f(c[0])+0.7152*f(c[1])+0.0722*f(c[2])
def parse(s):
  m=re.findall(r'[\\d.]+',s); v=[float(x) for x in m]; return v
res=[]
for p in probes:
  r=p['rect']; pr=p['panelRect']
  if p['kind']=='panel': x=int(pr['x']+10); y=int(pr['y']+pr['h']/2)       # panel surface, left padding
  else: x=int(r['x']+r['w']-6); y=int(r['y']+r['h']/2)                            # the element's own surface
  x=min(max(x,0),im.width-1); y=min(max(y,0),im.height-1); bg=im.getpixel((x,y))
  c=parse(p['color']); fg=c[:3]; a=c[3] if len(c)>3 else 1.0
  fg=[fg[i]*a+bg[i]*(1-a) for i in range(3)]
  l1,l2=lum(fg),lum(bg); ratio=(max(l1,l2)+0.05)/(min(l1,l2)+0.05); res.append([p['name'],round(ratio,2),bg])
print(json.dumps(res))`, [png, JSON.stringify(info.probes)]));
  for (const [name, ratio, bg] of out) check(`${label}: contrast ${name}`, ratio >= 4.5, `${ratio}:1 on rgb(${bg.join(',')})`);
  await ctx.close();
}

// ---------- reduced motion ----------
{ const { ctx, page } = await open(t.base, '/', 1280, 900, { reducedMotion: true });
  const anim = await page.evaluate(() => getComputedStyle(document.querySelector('.dira-welcome'), '::before').animationName);
  check('reduced motion: the ring animation is switched off', anim === 'none', anim); await ctx.close(); }

// ---------- photographs: welcome panel (all six photographs, each shape) ----------
// The welcome panel keeps its original composition (photographs behind the greeting, the greeting on the left). Each photograph must be
// shown whole: object-fit contain, no zoom animation, every coloured corner marker visible. For the marker count the purple wash and the
// ring are switched off, because the wash is a deliberate dimming for readable text; the crop test is about the photograph itself.
const HIDE_OVERLAYS = '[class*="-z-10"]{display:none!important} .dira-welcome::before{display:none!important}';
async function showOnly(page, sel, k) {
  await page.waitForFunction(([s, i]) => { const im = document.querySelectorAll(s)[i]; return im && im.complete && im.naturalWidth > 0; }, [sel, k]);
  await page.evaluate(([s, i]) => document.querySelectorAll(s).forEach((im, j) => { im.style.transition = 'none'; im.style.opacity = j === i ? '1' : '0'; }), [sel, k]);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); await page.waitForTimeout(150);
}
for (const [label, w, h] of [['desktop', 1280, 1000], ['tablet', 820, 1000], ['phone', 390, 844]]) {
  const { ctx, page } = await open(t.base, '/', w, h); await page.waitForSelector('.dira-welcome img');
  const heroBox = await page.locator('.dira-welcome').boundingBox();
  const composition = await page.evaluate(() => { const hero = document.querySelector('.dira-welcome'); const imgs = [...hero.querySelectorAll('img')];
    return { frame: !!document.querySelector('[data-photo-frame]'), n: imgs.length, allAbsolute: imgs.every((i) => getComputedStyle(i).position === 'absolute'), fits: imgs.map((i) => getComputedStyle(i).objectFit + '/' + getComputedStyle(i).animationName),
      heading: hero.querySelector('h1')?.textContent, controls: !!hero.querySelector('button[aria-pressed]') }; });
  check(`${label}: welcome panel keeps its original composition (photographs behind the greeting, no separate photo frame, controls kept)`, !composition.frame && composition.n === 6 && composition.allAbsolute && composition.controls && composition.heading === 'Welcome back, Amina', JSON.stringify(composition));
  check(`${label}: welcome photographs use object-fit contain and no zoom animation`, composition.fits.every((f) => f === 'contain/none'), composition.fits.join(','));
  await page.addStyleTag({ content: HIDE_OVERLAYS });
  for (let i = 0; i < composition.n; i++) {
    await showOnly(page, '.dira-welcome img', i);
    const png = path.join(shots, `welcome-photo-${label}-${i}.png`); const m = await shotMarkers(page.locator('.dira-welcome'), png);
    const g = await page.evaluate((k) => { const hero = document.querySelector('.dira-welcome'); const im = hero.querySelectorAll('img')[k]; const cs = getComputedStyle(im);
      const bw = im.clientWidth, bh = im.clientHeight, sc = Math.min(bw / im.naturalWidth, bh / im.naturalHeight); return { w: im.naturalWidth, h: im.naturalHeight, rw: Math.round(im.naturalWidth * sc), rh: Math.round(im.naturalHeight * sc), bw, bh, fit: cs.objectFit, pos: cs.objectPosition, heroW: hero.clientWidth, heroH: hero.clientHeight }; }, i);
    const inside = g.rw <= g.heroW && g.rh <= g.heroH && g.bw === g.heroW && g.bh === g.heroH;
    const all = Object.values(m).every((c) => c >= 20);
    check(`${label}: welcome photo ${i + 1} (${g.w}x${g.h}) is shown whole: all four corner markers visible, drawn ${g.rw}x${g.rh} inside the ${g.heroW}x${g.heroH} panel`, all && inside && g.fit === 'contain', JSON.stringify(m));
  }
  await ctx.close();
}
// the wash is only for text: on a wide screen it fades out before the photograph (right side), so the right-hand photograph is not dimmed
{ const { ctx, page } = await open(t.base, '/', 1280, 1000); await page.waitForSelector('.dira-welcome img');
  const wash = await page.evaluate(() => { const el = document.querySelector('.dira-welcome [class*="-z-10"]'); const cs = getComputedStyle(el); return { bg: cs.backgroundImage, opacity: cs.opacity }; });
  check('desktop: the purple wash behind the greeting is a left-to-right fade that ends transparent (the photograph on the right is not covered)', /linear-gradient/.test(wash.bg) && /rgba\(30, 11, 61, 0\)/.test(wash.bg), wash.bg.slice(0, 120));
  await page.screenshot({ path: path.join(shots, 'welcome-desktop-live.png') }); await ctx.close(); }

// ---------- photographs: sign-in page ----------
for (const [label, w, h] of [['desktop', 1280, 900], ['tablet', 820, 1100], ['phone', 390, 844]]) {
  const { ctx, page } = await open(l.base, '/login', w, h); await page.waitForSelector('img[aria-hidden="true"]');
  const comp = await page.evaluate(() => { const imgs = [...document.querySelectorAll('img[aria-hidden="true"]')]; const content = document.querySelector('section.animate-rise-in');
    return { frame: !!document.querySelector('[data-photo-frame]'), n: imgs.length, inContent: imgs.some((i) => content.contains(i)), fits: imgs.map((i) => getComputedStyle(i).objectFit + '/' + getComputedStyle(i).animationName),
      values: document.querySelectorAll('ul[aria-label="Our values"] li').length, card: !!document.querySelector('form') }; });
  check(`${label}: sign-in page keeps its original composition (photographs only behind the page, values and sign-in card in place, no photo frame)`, !comp.frame && comp.n === 6 && !comp.inContent && comp.values === 4 && comp.card, JSON.stringify(comp));
  check(`${label}: background photographs use object-fit contain and no zoom animation`, comp.fits.every((b) => b === 'contain/none'), comp.fits.join(','));
  await page.addStyleTag({ content: '[class*="-z-10"]{display:none!important}' });
  for (let i = 0; i < comp.n; i++) {
    await showOnly(page, 'img[aria-hidden="true"]', i);
    const png = path.join(shots, `login-photo-${label}-${i}.png`); await page.screenshot({ path: png, fullPage: true });
    const m = JSON.parse(execFileSync('python3', ['-c', COUNT, png], { encoding: 'utf8' }));
    const g = await page.evaluate((k) => { const im = document.querySelectorAll('img[aria-hidden="true"]')[k]; const host = im.parentElement; return { fit: getComputedStyle(im).objectFit, bw: im.clientWidth, hostW: host.clientWidth, bh: im.clientHeight, hostH: host.clientHeight, w: im.naturalWidth, h: im.naturalHeight }; }, i);
    check(`${label}: sign-in photo ${i + 1} (${g.w}x${g.h}) is shown whole: all four corner markers visible, no stretching`, Object.values(m).every((c) => c >= 20) && g.fit === 'contain' && g.bw === g.hostW && g.bh === g.hostH, JSON.stringify(m));
  }
  const over = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  check(`${label}: sign-in page has no horizontal scrolling`, over);
  await page.reload(); await page.waitForLoadState('networkidle'); await page.screenshot({ path: path.join(shots, `login-${label}.png`), fullPage: true }); await ctx.close();
}
await browser.close(); t.s.close(); l.s.close();
const bad = results.filter((r) => !r.ok).length; console.log(`\n${results.length - bad}/${results.length} checks passed`); process.exit(bad ? 1 : 0);
