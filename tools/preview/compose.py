"""Combine tools/preview/render_passes.py's per-part passes into one customised speeder.

    python tools/preview/compose.py --class "Speeder Bike" --base Boa [--part Front=Taipan ...]
        [--palette Nomad] [--pattern Raider03] [--patina AllSteel] [--out preview.png]

Per pixel, each part's layer is its finish's black render plus the paint colour times (white - black); the colour is
the livery at that pixel: the pattern's SDF sampled at the pixel's livery UV (the mesh's UVMap.002, as the game lays
the patterns out), each channel over the body colour in its mask's colour. The layers are then stacked front
to back by depth. Needs numpy and opencv-python.
"""
import argparse
import json
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
DATAMINE = ROOT.parent / "swgr-datamine"
TEXTURES = Path("E:/SWGR_Export/export")
EXPOSURE, UV_LO, UV_SPAN = 0.25, -0.5, 2.0
CLASS_KEY = {"Speeder Bike": "Bike", "Landspeeder": "Car", "Skim Speeder": "Skimmer"}
# the importer's body finishes (blender_import_vehicle.PATINA_BODY), linear RGB; the metal patinas tint "metal"
PATINA_FINISH = {"LP_AllSteel": ("metal", (0.56, 0.57, 0.58)), "LP_AllRust": ("rust", (0.28, 0.11, 0.05))}


def srgb_to_linear(c):
    c = np.asarray(c, dtype=np.float32)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def hex_linear(h):
    h = h.lstrip("#")
    return srgb_to_linear([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)])


def read(path):
    """a 16-bit pass as float RGB(A) in R, G, B order (OpenCV reads BGR)."""
    im = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
    if im is None:
        raise SystemExit(f"missing pass {path}")
    im = im.astype(np.float32) / 65535
    return im[..., [2, 1, 0, 3]] if im.shape[2] == 4 else im[..., [2, 1, 0]]


def find(table, want, prefix):
    """a liveries.json tag from a short name ("Nomad", "Raider03", "AllRust") or the full tag."""
    if not want:
        return None
    for tag, d in table.items():
        tail = tag.rsplit(".", 1)[-1]
        if want.lower() in (tag.lower(), tail.lower(), (d.get("name") or "").lower(), f"{prefix}.{want}".lower()):
            return tag
    raise SystemExit(f"unknown {prefix} '{want}'")


def contact_shadow(alphas, depths, radius=14, directions=16, strength=0.55, reach=0.06, bias=0.002):
    """Screen-space ambient occlusion between parts: each part is rendered alone, so nothing darkens it where
    another part of the combination crowds it. A pixel is occluded by nearby pixels of a *different* part that are
    nearer the camera (within reach, in the depth map's 0-1 range); its own part's occlusion is already rendered."""
    front = np.where(alphas.max(0) > 0.5, np.argmin(np.where(alphas > 0.5, depths, 2.0), axis=0), -1)
    depth = np.take_along_axis(depths, np.maximum(front, 0)[None], 0)[0]
    occ = np.zeros(depth.shape, np.float32)
    samples = 0
    for k in range(directions):
        ang = 2 * np.pi * k / directions
        for r in (radius * 0.35, radius * 0.7, radius):
            dx, dy = int(round(np.cos(ang) * r)), int(round(np.sin(ang) * r))
            nd = np.roll(depth, (dy, dx), (0, 1))
            nf = np.roll(front, (dy, dx), (0, 1))
            gap = depth - nd
            hit = (nf >= 0) & (nf != front) & (gap > bias) & (gap < reach)
            occ += hit * (1 - gap / reach)
            samples += 1
    return np.where(front >= 0, 1 - strength * np.clip(occ / samples * 2.5, 0, 1), 1).astype(np.float32)


def compose(cls, base, parts, palette, pattern, patina, out, shadows=True):
    passes = ROOT / "assets" / "passes" / cls.replace(" ", "")
    meta = json.loads((passes / "passes.json").read_text(encoding="utf-8"))
    cat = json.loads((DATAMINE / "out" / "liveries" / "liveries.json").read_text(encoding="utf-8"))
    slots = sorted({p["part"] for p in meta["parts"].values() if p["kit"] == base})
    chosen = {s: parts.get(s, base) for s in slots}
    def part_name(slot, kit):
        """a part on a socket that moves with another slot's kit (the bike's rear engine) has one render per position"""
        sk = meta.get("sockets", {}).get(slot)
        at = sk and sk["groups"].get(chosen[sk["parent"]])
        name = f"{kit}_{slot}"
        return f"{name}@{at}" if at and at != sk["groups"].get(kit) and f"{name}@{at}" in meta["parts"] else name
    names = [part_name(slot, kit) for slot, kit in chosen.items()]
    for n in names:
        if n not in meta["parts"]:
            raise SystemExit(f"no passes for {n}: render that kit first")

    # the livery: palette colours, the pattern's SDF and mask colours, the patina's body finish
    pal = [hex_linear(c) for c in cat["palettes"][find(cat["palettes"], palette, "Customisation.Livery")]["colors"]]
    pat = cat["patterns"][CLASS_KEY[cls]].get(find(cat["patterns"][CLASS_KEY[cls]], pattern, "Customisation.Livery")) if pattern else None
    pt = cat["patinas"].get(find(cat["patinas"], patina, "Customisation.Patina")) if patina else {}
    body_finish, body = "paint", pal[0]
    if pt.get("metal_override"):
        body_finish, body = "metal", hex_linear(pt["metal_override"]["color"])
    elif pt.get("asset") in PATINA_FINISH:
        body_finish, body = PATINA_FINISH[pt["asset"]][0], np.array(PATINA_FINISH[pt["asset"]][1], np.float32)
    sdf, mask_cols = None, []
    if pat and not pat.get("empty") and pat.get("sdf"):
        im = cv2.imread(str(TEXTURES / pat["sdf"]), cv2.IMREAD_UNCHANGED)
        sdf = im.astype(np.float32) / (65535 if im.dtype == np.uint16 else 255)
        sdf = sdf[..., [2, 1, 0, 3]] if sdf.shape[2] == 4 else sdf[..., [2, 1, 0]]
        for m in pat["masks"]:
            mask_cols.append(hex_linear(m["color"]) if m["mode"] == "constant" and "color" in m
                             else pal[min(m.get("swatch", 1), len(pal) - 1)])

    layers = []
    for n in names:
        alpha = read(passes / f"{n}_paint_0.png")[..., 3]
        data = read(passes / f"{n}_data.png")
        depth = read(passes / f"{n}_depth.png")[..., 0]
        flag = data[..., 2]
        safe = np.maximum(flag, 1e-6)
        u = data[..., 0] / safe * UV_SPAN + UV_LO   # un-premultiplied: edges are blended with the background
        v = data[..., 1] / safe * UV_SPAN + UV_LO
        colour = np.broadcast_to(body, alpha.shape + (3,)).copy()
        painted = np.zeros(alpha.shape, np.float32)
        if sdf is not None:
            h, w = sdf.shape[:2]
            mapx = np.clip(u, 0, 1) * (w - 1)
            mapy = (1 - np.clip(v, 0, 1)) * (h - 1)  # Blender's image origin is bottom-left
            samp = cv2.remap(sdf, mapx.astype(np.float32), mapy.astype(np.float32), cv2.INTER_LINEAR)
            inside = (u >= 0) & (u <= 1) & (v >= 0) & (v <= 1)
            for ch, col in enumerate(mask_cols):
                if ch >= samp.shape[2]:
                    break
                m = np.clip((samp[..., ch] - 0.49) / 0.02, 0, 1) * inside
                colour = colour * (1 - m[..., None]) + col * m[..., None]
                painted = np.maximum(painted, m)
        if body_finish == "paint":
            painted[:] = 1  # one finish everywhere
        rgb = np.zeros(alpha.shape + (3,), np.float32)
        for finish, wgt in (("paint", painted), (body_finish, 1 - painted)):
            if not wgt.any():
                continue
            blk = read(passes / f"{n}_{finish}_0.png")[..., :3]
            wht = read(passes / f"{n}_{finish}_1.png")[..., :3]
            rgb += wgt[..., None] * (blk + colour * (wht - blk))
        layers.append((rgb / EXPOSURE, alpha, np.where(alpha > 0.002, depth, 2.0)))

    # front to back by depth, "over" with each layer's coverage (the passes are premultiplied)
    order = np.argsort(np.stack([l[2] for l in layers]), axis=0)
    out_rgb = np.zeros(layers[0][0].shape, np.float32)
    out_a = np.zeros(layers[0][1].shape, np.float32)
    stack_rgb = np.stack([l[0] for l in layers])
    stack_a = np.stack([l[1] for l in layers])
    for k in range(len(layers)):
        idx = order[k]
        rgb = np.take_along_axis(stack_rgb, idx[None, ..., None], 0)[0]
        a = np.take_along_axis(stack_a, idx[None], 0)[0]
        out_rgb += (1 - out_a)[..., None] * rgb
        out_a += (1 - out_a) * a
    if shadows:
        out_rgb *= contact_shadow(stack_a, np.stack([l[2] for l in layers]))[..., None]
    straight = out_rgb / np.maximum(out_a, 1e-6)[..., None]
    img = np.dstack([linear_to_srgb(straight), out_a])
    cv2.imwrite(str(out), (np.clip(img, 0, 1)[..., [2, 1, 0, 3]] * 255 + 0.5).astype(np.uint8))
    print("wrote", out)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--class", dest="cls", default="Speeder Bike")
    ap.add_argument("--base", required=True)
    ap.add_argument("--part", action="append", default=[])
    ap.add_argument("--palette", default="Protagonist")
    ap.add_argument("--pattern", default="")
    ap.add_argument("--patina", default="")
    ap.add_argument("--out", default="preview.png")
    ap.add_argument("--no-shadows", action="store_true")
    a = ap.parse_args()
    compose(a.cls, a.base, dict(p.split("=", 1) for p in a.part), a.palette, a.pattern, a.patina,
            ROOT / "assets" / "passes" / a.cls.replace(" ", "") / a.out, shadows=not a.no_shadows)
