"""Compare compose.py's output with a reference render (render_passes.py --reference) of the same combination.

    python tools/preview/check.py <composite.png> <reference.png> <sheet.png>

Prints the mean and 95th-percentile difference over the vehicle (0-255) and writes a sheet: reference, composite,
and their difference x3, over a dark background.
"""
import sys

import cv2
import numpy as np


def flat(im, bg=40):
    a = im[..., 3:4].astype(np.float32) / 255
    return im[..., :3].astype(np.float32) * a + bg * (1 - a)


comp, ref, sheet = sys.argv[1:4]
a, b = cv2.imread(comp, cv2.IMREAD_UNCHANGED), cv2.imread(ref, cv2.IMREAD_UNCHANGED)
fa, fb = flat(a), flat(b)
diff = np.abs(fa - fb)
on = (a[..., 3] > 0) | (b[..., 3] > 0)
print(f"mean {diff[on].mean():.1f}  p95 {np.percentile(diff[on].max(axis=1), 95):.1f}  (0-255, over the vehicle)")
cv2.imwrite(sheet, np.hstack([fb, fa, diff * 3]).clip(0, 255).astype(np.uint8))
