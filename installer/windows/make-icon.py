"""Creates kuenta.ico from the logo (redrawn from public/img/icon.svg). Requires Pillow.
Usage: python installer/windows/make-icon.py"""
import os
from PIL import Image, ImageDraw

S = 1024  # canvas (scaled down later -> anti-aliasing)
k = S / 64
img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
blue, white = (30, 90, 168, 255), (255, 255, 255, 255)
d.rounded_rectangle([0, 0, S - 1, S - 1], radius=14 * k, fill=blue)
w = 5 * k
# handle of the spanner: from (16,45) to (33,28)
d.line([(16 * k, 45 * k), (33 * k, 28 * k)], fill=white, width=int(w * 2.1))
r = w * 1.05
d.ellipse([16 * k - r, 45 * k - r, 16 * k + r, 45 * k + r], fill=white)
# head: ring around (39,23) with the jaw opening to the top right
cx, cy, R = 39 * k, 23 * k, 10.5 * k
d.ellipse([cx - R, cy - R, cx + R, cy + R], fill=white)
r2 = 5.2 * k
mx, my = cx + 4.5 * k, cy - 4.5 * k
d.polygon([(mx - r2 * 0.75, my - r2 * 0.75), (mx + 14 * k, my - 14 * k + 0.1), (mx + r2 * 0.75 + 14 * k, my + r2 * 0.75 - 14 * k),
           (mx + r2 * 0.75, my + r2 * 0.75)], fill=blue)
d.ellipse([mx - r2, my - r2, mx + r2, my + r2], fill=blue)
# make everything outside the rounded square transparent again
mask = Image.new('L', (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=14 * k, fill=255)
img.putalpha(Image.composite(img.getchannel('A'), mask, mask))
# hole in the handle
r = 1.8 * k; d = ImageDraw.Draw(img); d.ellipse([16 * k - r, 45 * k - r, 16 * k + r, 45 * k + r], fill=blue)
out = os.path.join(os.path.dirname(__file__), 'kuenta.ico')
big = img.resize((256, 256), Image.LANCZOS)
big.save(out, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
if os.environ.get('ICON_PREVIEW_DIR'):
    big.save(os.path.join(os.environ['ICON_PREVIEW_DIR'], 'icon-preview.png'))
print('geschrieben:', out)
