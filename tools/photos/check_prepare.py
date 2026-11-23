#!/usr/bin/env python3
"""Self-test of prepare.py on SYNTHETIC test images made here (not photographs, never shipped): proportions kept, no crop,
no upscaling, metadata removed, orientation applied, small originals refused, unapproved photos skipped."""
import os, sys, shutil, subprocess, tempfile, json, re
from PIL import Image, ImageDraw
proj = os.path.abspath(sys.argv[1]); here = os.path.dirname(os.path.abspath(__file__))
t = tempfile.mkdtemp(); p = os.path.join(t, 'p'); os.makedirs(os.path.join(p, 'tools', 'photos')); os.makedirs(os.path.join(p, 'src', 'lib'))
shutil.copy(os.path.join(here, 'prepare.py'), os.path.join(p, 'tools', 'photos'))
src = os.path.join(t, 'originals'); os.makedirs(src)
def make(name, w, h, exif_rot=False):
    im = Image.new('RGB', (w, h), (30, 11, 61)); d = ImageDraw.Draw(im)
    d.rectangle([0, 0, w - 1, h - 1], outline=(255, 120, 0), width=8); d.ellipse([w // 2 - 50, h // 3 - 50, w // 2 + 50, h // 3 + 50], fill=(240, 200, 160))
    ex = Image.Exif(); ex[0x010e] = 'secret description'; ex[0x8825] = {2: (1.0, 17.0, 0.0)}   # description + a GPS block
    if exif_rot: ex[0x0112] = 6   # camera says: rotate 90 degrees
    im.save(os.path.join(src, name), 'JPEG', quality=95, exif=ex)
make('wide.jpg', 3000, 2000); make('tall.jpg', 1500, 2250); make('rot.jpg', 2400, 1600, exif_rot=True); make('small.jpg', 800, 600)
def cfg(items): open(os.path.join(p, 'tools', 'photos', 'photos.yaml'), 'w').write('photos:\n' + ''.join(f'  - {json.dumps(i)}\n' for i in items))
res = []; ok = lambda c, m: res.append((bool(c), m))
cfg([{'id': 'small', 'file': 'small.jpg', 'alt': 'x', 'approved': True}])
r = subprocess.run([sys.executable, '-I', os.path.join(p, 'tools/photos/prepare.py'), src, p], capture_output=True, text=True)
ok(r.returncode == 2 and not os.path.exists(os.path.join(p, 'public', 'photos')), 'an original under 1280 px is refused and nothing is written')
cfg([{'id': 'wide', 'file': 'wide.jpg', 'alt': 'wide test', 'focal': '50% 30%', 'approved': True},
     {'id': 'tall', 'file': 'tall.jpg', 'alt': 'tall test', 'approved': True},
     {'id': 'rot', 'file': 'rot.jpg', 'alt': 'rotated test', 'approved': True},
     {'id': 'unapproved', 'file': 'wide.jpg', 'alt': 'not approved', 'approved': False}])
r = subprocess.run([sys.executable, '-I', os.path.join(p, 'tools/photos/prepare.py'), src, p], capture_output=True, text=True)
ok(r.returncode == 0, 'approved photos are prepared: ' + r.stdout.strip().splitlines()[-1] if r.stdout else r.stderr)
out = os.path.join(p, 'public', 'photos'); files = sorted(os.listdir(out))
ok(not any(f.startswith('unapproved') for f in files), 'a photo not marked approved is skipped')
for name, (w0, h0) in {'wide': (3000, 2000), 'tall': (1500, 2250), 'rot': (1600, 2400)}.items():
    for w in (640, 1280, 1920):
        f = os.path.join(out, f'{name}-{w}.webp')
        if w > w0: ok(not os.path.exists(f), f'{name}: no {w} px copy (would enlarge a {w0} px original)'); continue
        im = Image.open(f); exp_h = round(h0 * w / w0)
        ok(im.size == (w, exp_h), f'{name}-{w}: {im.size[0]}x{im.size[1]}, proportions of the original kept (no crop, no stretch)')
        ok(not im.getexif() and 'exif' not in im.info, f'{name}-{w}: no metadata (no GPS, no description)')
ok(Image.open(os.path.join(out, 'rot-640.webp')).height > Image.open(os.path.join(out, 'rot-640.webp')).width, 'camera orientation applied (rotated photo stands upright)')
gen = open(os.path.join(p, 'src', 'lib', 'photos.generated.ts')).read()
ok('"focal": "50% 30%"' in gen and '"widths": [\n      640,\n      1280\n    ]' in gen, 'photos.generated.ts lists the widths and focal points')
shutil.rmtree(t)
for good, m in res: print(('PASS  ' if good else 'FAIL  ') + m)
print(f'photo preparation: {sum(g for g, _ in res)}/{len(res)} checks passed (synthetic test images)'); sys.exit(0 if all(g for g, _ in res) else 1)
