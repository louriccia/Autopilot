"""Build Autopilot's reference data and art from the swgr-datamine outputs.

    python tools/import_swgr.py [--datamine ../swgr-datamine] [--textures E:/SWGR_Export/export]

Reads the datamine's catalog CSVs (out/arcade_events.csv, planets.csv, tracks_unique.csv) plus the decoded event and
planet JSON for the fields the CSVs leave out (descriptions, unlock text, which UI textures each one uses), and writes:

    src/data/swgr/{planets,tracks,arcade}.json     what the bot reads at runtime
    assets/{arcade,planets,tracks,icons}/*.webp    resized art, attached to embeds

Re-run it after the datamine is refreshed; the output is deterministic, so the diff shows what changed.
Needs Pillow.
"""
import argparse
import csv
import json
import math
import re
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
DATA_OUT = ROOT / "src" / "data" / "swgr"
ART_OUT = ROOT / "assets"

# Arcade tab names, from EventArcadeTypesText (ArcadeTab_*), and the tab icons in Icons/Arcade. The game's own
# category -> icon lookup is WBP_Arcade_ListEntries.NamesToIcons; it has no Advanced key, which is the Crait /
# Derven Acos tab and takes the remaining Arcade_Planet icon.
CATEGORIES = {
    "FieldTest": ("Test Flight", "T_UI_Arcade_FieldTest_Icn"),
    "Plane": ("Podracing", "T_UI_Arcade_Plane_Icn"),
    "Quick": ("Scramble", "T_UI_Arcade_Quick_Icn"),
    "Precision": ("Precision", "T_UI_Arcade_Needle_Icn"),
    "Acid": ("Acid", "T_UI_Arcade_Acid_Icn"),
    "FireIce": ("Fire & Ice", "T_UI_Arcade_FireIce_Icn"),
    "Advanced": ("Advanced", "T_UI_Arcade_Planet_Icn"),
    "Deluxe": ("Deluxe", "T_UI_Arcade_Deluxe_Icn"),
}
MODES = {"TimeTrial": "Time Trial", "TeamRace": "Race", "Precision": "Precision Driving"}
PLANET_ORDER = ["Jakku", "Lantaana", "Ando Prime", "Sentinel I", "Crait", "Derven Acos", "Tatooine"]


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower().replace("'", "")).strip("-")


def rows(path):
    return list(csv.DictReader(open(path, encoding="utf-8-sig")))


def load_json(path):
    return json.load(open(path, encoding="utf-8")) if path.exists() else []


def rich_text(s, widget=lambda name: "", bold=False):
    """Strip the game's <H1>..</> markup (or, with bold, turn those keyword highlights into **bold**). Inline icons
    (<img id=".."/>, <widget id=".."/>) become widget(name), nothing by default."""
    s = re.sub(r'<(?:img|widget) id="([^"]*)"\s*/>\s*', lambda m: widget(m.group(1)), s or "")
    if bold:
        s = re.sub(r"<H1>(.*?)</>", r"**\1**", s)
    return re.sub(r"</?[A-Za-z0-9]*>", "", s).replace("\r\n", "\n").strip()


def texture(textures, asset_path):
    """/Game/Griffin/UI/....T_X.T_X -> the exported PNG."""
    if not asset_path:
        return None
    rel = asset_path.split("/Game/", 1)[1].rsplit(".", 1)[0]
    p = textures / "Griffin" / "Content" / (rel + ".png")
    return p if p.exists() else None


def save_art(src, dest, *, max_size, crop=None):
    """Resize (and optionally crop to an aspect ratio) into a WebP under assets/. Returns the repo-relative path."""
    if not src:
        return None
    dest = ART_OUT / dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    im = Image.open(src)
    im = im.convert("RGBA" if im.mode in ("RGBA", "LA", "P") else "RGB")
    if crop == "top-square":
        im = im.crop((0, 0, im.width, min(im.width, im.height)))
    elif crop:  # width/height ratio, cut from the vertical middle
        h = min(im.height, round(im.width / crop))
        top = (im.height - h) // 2
        im = im.crop((0, top, im.width, top + h))
    im.thumbnail((max_size, max_size), Image.LANCZOS)
    im.save(dest, "WEBP", quality=82, method=6)
    return dest.relative_to(ROOT).as_posix()


def num(s):
    return int(s) if s not in ("", None) else None


def mode_notes(settings):
    out = []
    s = json.loads(settings) if settings else {}
    if "RollingStartVehicleSpeedLimitMph" in s:
        # The game shows speeds in km/h; the setting is stored in mph.
        out.append(f"Rolling start ({round(s['RollingStartVehicleSpeedLimitMph'] * 1.609344)} km/h)")
    if "TimeReductionForPassedGate" in s:
        out.append(f"-{s['TimeReductionForPassedGate']:g}s per gate")
    return out


def fmt_time(seconds):
    """The game shows times to hundredths."""
    m, s = divmod(round(seconds * 100) / 100, 60)
    return f"{int(m)}:{s:05.2f}" if m else f"{s:.2f}"


# Build stats in the order the game lists them -> (label key in arcade_events.csv, BuildStats icon).
STATS = [("Cornering", "Cornering"), ("Afterburner", "Acceleration"), ("Resilience", "Resilience"),
         ("Ramjet", "Boost"), ("Battery", "Battery"), ("Advanced", "Advanced")]
# The advanced slot's name per class (VehicleText Stat_Advanced_*); the datamine CSV calls the bike's "Advanced".
ADVANCED = {"Landspeeder": "Drift", "Speeder Bike": "Kinetic Burst", "Skim Speeder": "Knife Edge", "Podracer": "Air Brake"}


class Emojis:
    """Collects the icons used inline in text. Each becomes assets/emoji/<name>.png, which
    src/scripts/upload-emojis.js uploads as an application emoji under the same name."""

    def __init__(self):
        self.by_name = {}

    def add(self, name, src):
        if not src:
            return None
        name = re.sub(r"[^A-Za-z0-9_]", "", name)[:32]
        base, n = name, 2
        while name in self.by_name and self.by_name[name] != src:  # same name, different icon
            name = f"{base[:30]}_{n}"
            n += 1
        if name not in self.by_name:
            self.by_name[name] = src
            im = Image.open(src).convert("RGBA")
            im.thumbnail((128, 128), Image.LANCZOS)
            self.save(name, im)
        return name

    def add_image(self, name, im):
        self.by_name[name] = name
        self.save(name, im)
        return name

    def save(self, name, im):
        dest = ART_OUT / "emoji" / f"{name}.png"
        dest.parent.mkdir(parents=True, exist_ok=True)
        im.save(dest, "PNG", optimize=True)


# Pip tint per rarity (linear RGB), from WBP_ItemRarity's UpdateRarityLevel graph: a Select on EGfnRarity feeds the
# pip material's "Colour" parameter (M_UI_MetallicRarityPip multiplies its texture by it). These are constants in the
# widget's bytecode, which the datamine only dumps with SWGR_SCRIPTDATA=1, so they're copied here.
# (EGfnRarity: 0 Common, 1 Low = Rare, 2 High = Epic, 3 Highest = Legendary, 4 Faulty = transparent, 5 Experimental)
PIP_TINTS = {
    "Common": (0.617207, 0.571125, 0.514918),
    "Rare": (0.651042, 0.294649, 0.132242),
    "Epic": (0.685493, 0.831495, 0.940104),
    "Legendary": (1.0, 0.56339, 0.1221),
}


def rarity_pips(emojis, textures):
    """Rarity pips as the item-rarity widget (WBP_ItemRarity) draws them: T_UI_MetallicRarityPip_Icn tinted by the
    rarity's colour (multiplied in linear space, as the material does). Empty slots are a procedural circle with no
    texture, so they're the untinted pip at 25% opacity (as the stat bars' empty segments are). Paired two to an emoji,
    like the stat segments, so neighbouring pips keep their spacing. A rarity of n pips (Common 1 ... Legendary 4)
    is two emojis: pp<R><lit in the first pair> + pp<R><lit in the second> with R = C/R/E/L, and pp0 for an empty pair."""
    src = textures / "Griffin" / "Content" / "Griffin" / "UI" / "Library" / "Textures" / "Icons" / "T_UI_MetallicRarityPip_Icn.png"
    if not src.exists():
        return
    pip = Image.open(src).convert("RGBA")
    dim = Image.merge("RGBA", (*pip.split()[:3], pip.getchannel("A").point(lambda v: v * 0.25)))

    def tinted(rgb):
        to_lin = lambda v: (v / 255) ** 2.2
        bands = [pip.getchannel(c).point(lambda v, t=t: round(min(1.0, to_lin(v) * t) ** (1 / 2.2) * 255))
                 for c, t in zip("RGB", rgb)]
        return Image.merge("RGBA", (*bands, pip.getchannel("A")))

    gap = pip.width // 4
    size = 2 * pip.width + 2 * gap      # one internal gap plus a half gap each side
    top = (size - pip.height) // 2

    def pair(name, first, second):
        canvas = Image.new("RGBA", (size, size))
        for i, img in enumerate((first, second)):
            canvas.alpha_composite(img, (gap // 2 + i * (pip.width + gap), top))
        emojis.add_image(name, canvas)

    pair("pp0", dim, dim)
    for rarity, rgb in PIP_TINTS.items():
        lit = tinted(rgb)
        pair(f"pp{rarity[0]}2", lit, lit)
        pair(f"pp{rarity[0]}1", lit, dim)


def stat_segments(emojis, textures):
    """The build panel's level bar: 10 segments, the first 7 short and the last 3 tall, cut from
    T_UI_StatProgressBar_Presentation_Cmn.

    Discord draws every custom emoji in a square box, so one narrow segment per emoji leaves wide gaps
    between segments and none between rows. Instead each emoji holds a pair of segments: the pair is wider
    than tall, so the spare room goes above and below (row spacing), and the side margins are half the
    in-game gap so neighbouring emojis continue the spacing. A bar is 5 pairs; the pair kinds are ss (short,
    short), st (the 7th and 8th segments) and tt, each with 0-2 filled from the left: ss2, st1, tt0..."""
    src = textures / "Griffin" / "Content" / "Griffin" / "UI" / "Library" / "Textures" / "Common" / "T_UI_StatProgressBar_Presentation_Cmn.png"
    im = Image.open(src).convert("RGBA")
    alpha = im.getchannel("A")
    cols = [x for x in range(im.width) if max(alpha.crop((x, 0, x + 1, im.height)).getdata()) > 20]
    runs, start = [], cols[0]
    for a, b in zip(cols, cols[1:] + [None]):
        if b != a + 1:
            runs.append((start, a + 1))
            start = b
    gap = runs[1][0] - runs[0][1]
    dim = lambda seg: Image.merge("RGBA", (*seg.split()[:3], seg.getchannel("A").point(lambda v: v * 0.25)))
    seg = {}
    for kind, (x0, x1) in (("s", runs[0]), ("t", runs[-1])):
        piece = im.crop((x0, 0, x1, im.height))
        seg[kind] = {1: piece, 0: dim(piece)}
    width = max(p[1].width for p in seg.values())
    size = 2 * width + 2 * gap  # one internal gap plus a half gap on each side
    bottom = (size + im.height) // 2  # segments are bottom-aligned within im.height; centre that band
    for kinds in ("ss", "st", "tt"):
        for filled in (2, 1, 0):
            canvas = Image.new("RGBA", (size, size))
            for i, kind in enumerate(kinds):
                piece = seg[kind][1 if i < filled else 0]
                canvas.alpha_composite(piece, (gap // 2 + i * (width + gap), bottom - piece.height))
            emojis.add_image(f"{kinds}{filled}", canvas)



# Preflight inputs as the HUD shows them: the platform's controller glyphs (T_UI_Cntrl_<XB|PS|PC>_*). The datamine
# names pad buttons by Xbox/PlayStation label ("A/X") and keys by UE key name. Letter keys have no texture of their
# own (the game prints the letter on the blank key), so they're the blank key with the letter cut out.
PAD_GLYPHS = {
    "Up": "Dpad_Top", "Down": "Dpad_Bottom", "Left": "Dpad_Left", "Right": "Dpad_Right",
    "A/X": "FaceButton_Bottom", "B/O": "FaceButton_Right", "X/[]": "FaceButton_Left", "Y/^": "FaceButton_Top",
    "LB/L1": "ShoulderLeft", "RB/R1": "ShoulderRight", "LT/L2": "TriggerLeft", "RT/R2": "TriggerRight",
}
KEY_GLYPHS = {
    "Up": "Arrow_Up", "Down": "Arrow_Down", "Left": "Arrow_Left", "Right": "Arrow_Right",
    "LeftShift": "Key_Shift_Left", "SpaceBar": "Key_Space", "Enter": "Key_Enter", "Tab": "Tab",
}
GLYPH_FONT = Path("C:/Windows/Fonts/bahnschrift.ttf")


def input_glyphs(emojis, textures):
    """Returns glyph(platform, button) -> emoji name, platform being xbox, playstation or keyboard."""
    folder = textures / "Griffin" / "Content" / "Griffin" / "UI" / "Library" / "Textures" / "Platform"
    platforms = {"xbox": ("Xbox", "XB", PAD_GLYPHS), "playstation": ("Playstation", "PS", PAD_GLYPHS),
                 "keyboard": ("PC", "PC", KEY_GLYPHS)}

    def letter_key(letter):
        key = Image.open(folder / "PC" / "T_UI_Cntrl_PC_Key_Blank_Icn.png").convert("RGBA")
        font = ImageFont.truetype(str(GLYPH_FONT), 46)
        font.set_variation_by_name("Bold")
        mask = Image.new("L", key.size, 0)
        ImageDraw.Draw(mask).text((key.width / 2, key.height / 2), letter, font=font, fill=255, anchor="mm")
        key.putalpha(ImageChops.subtract(key.getchannel("A"), mask))
        return key

    def glyph(platform, button):
        if platform == "playstation" and button in ("Up", "Down", "Left", "Right"):
            platform = "xbox"  # both consoles show the squared d-pad (the PS d-pad textures go unused)
        folder_name, prefix, names = platforms[platform]
        name = f"in{prefix}_{re.sub(r'[^A-Za-z0-9]', '', names.get(button, button))}"
        if button in names:
            return emojis.add(name, folder / folder_name / f"T_UI_Cntrl_{prefix}_{names[button]}_Icn.png")
        if platform == "keyboard" and len(button) == 1 and button.isalnum():
            return emojis.add_image(name, letter_key(button.upper()))
        return None
    return glyph


def save_flipbook_gif(datamine, name, dest, *, height):
    """One of the datamine's flipbook animations (tools/make_flipbook_gifs.py), rebuilt smaller.

    Resizing the finished GIF smears its 1-bit edges into stray pixels, so this goes back to the flipbook
    frames (soft alpha), resizes those, and encodes with the datamine's own gif_bytes (one shared palette,
    soft edges blended onto Discord's dark background). Frames are centred on a transparent square because
    Discord crops section thumbnails to a square."""
    import sys
    sys.path.insert(0, str(datamine / "tools"))
    import make_flipbook_gifs as fb
    sheet = next((s for s in fb.SHEETS if s[0] == name), None)
    if not sheet or not Path(sheet[1]).exists():
        return None
    _, path, cols, rows, blank, speed, mode = sheet
    frames = []
    for f in fb.frames_of(path, cols, rows, blank, mode):
        f = f.resize((round(f.width * height / f.height), height), Image.LANCZOS)
        square = Image.new("RGBA", (max(f.size), max(f.size)))
        square.alpha_composite(f, ((square.width - f.width) // 2, (square.height - f.height) // 2))
        frames.append(square)
    dest = ART_OUT / dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(fb.gif_bytes(frames, len(frames) * speed))
    return dest.relative_to(ROOT).as_posix()


def camel(s):
    return "".join(w[:1].upper() + w[1:] for w in re.split(r"[^A-Za-z0-9]+", s) if w)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--datamine", type=Path, default=ROOT.parent / "swgr-datamine")
    ap.add_argument("--textures", type=Path, default=Path("E:/SWGR_Export/export"))
    args = ap.parse_args()
    out = args.datamine / "out"
    game = out / "json" / "Griffin" / "Content" / "Griffin"

    # --- planets ---
    planets = []
    for r in rows(out / "planets.csv"):
        pj = load_json(game / "Gameplay" / "Config" / "Planets" / f"PLA_{r['Codename']}.json")
        props = (pj[0].get("Properties") if pj else None) or {}
        # PlanetTexture (T_UI_Planet_X_Select) is the coloured planet; the HighResolution one is the greyscale "locked" look
        art = (props.get("PlanetTexture") or {}).get("AssetPathName")
        patch = (props.get("PlanetStickerBookTexture") or {}).get("AssetPathName")
        planets.append({
            "id": slug(r["Name"]),
            "name": r["Name"],
            "codename": r["Codename"],
            "tagline": r["Tagline"],
            "conditions": [c.strip() for c in r["Conditions"].split(",") if c.strip()],
            "description": re.sub(r"  +", " ", r["Description"]).strip(),
            "image": save_art(texture(args.textures, art), f"planets/{slug(r['Name'])}.webp", max_size=512),
            "patch": save_art(texture(args.textures, patch), f"planets/{slug(r['Name'])}-patch.webp", max_size=256),
        })
    planets.sort(key=lambda p: PLANET_ORDER.index(p["name"]) if p["name"] in PLANET_ORDER else 99)
    planet_id = {p["name"]: p["id"] for p in planets}

    # --- tracks ---
    maps = {slug(p.stem.split(" - ", 1)[1]): p for p in (out / "track_maps").glob("* - *.png")}
    tracks = []
    for r in rows(out / "tracks_unique.csv"):
        tid = slug(r["TrackName"])
        tracks.append({
            "id": tid,
            "name": r["TrackName"],
            "planet": planet_id[r["Planet"]],
            "vehicles": r["Vehicles"],
            "format": r["Format"],
            "reverseOf": r["ReverseOf"] or None,
            "alsoReversed": r["AlsoRunReversed"] == "yes",
            "defaultLaps": num(r["DefaultLaps"]),
            "eventLaps": [int(x) for x in r["RaceEventLaps"].split()],
            "map": save_art(maps.get(tid), f"tracks/{tid}.webp", max_size=1024),
        })

    # --- arcade ---
    events_dir = game / "Gameplay" / "Arcade" / "Events"
    event_json = {p.stem.lower(): p for p in events_dir.glob("**/EVT_ARC_*.json")}
    track_id = {t["name"]: t["id"] for t in tracks}
    affixes = {a["Asset"]: a for a in rows(out / "affixes.csv")}
    abilities = {a["asset"]: a for a in rows(out / "gameplay" / "abilities.csv")}
    ui_icons = args.textures / "Griffin" / "Content" / "Griffin" / "UI" / "Library" / "Textures" / "Icons"
    emojis = Emojis()
    stat_segments(emojis, args.textures)
    rarity_pips(emojis, args.textures)
    input_glyph = input_glyphs(emojis, args.textures)
    speed_emoji = emojis.add("stat_Speed", ui_icons / "BuildStats" / "T_UI_BuildStats_Speed_Icn.png")
    emojis.add("lock", ui_icons / "T_UI_Lock_Icn.png")
    emojis.add("reverse", ui_icons / "T_UI_Reverse_Icn.png")
    # Inline-icon widget ids that don't match a keyword icon's file name, but have an icon elsewhere in the game
    KEYWORD_ALIASES = {"Surging": "Surge", "Ability": "Abilities", "SysMalfunction": "SystemMalfunction", "Energy": "Battery"}
    STAT_WIDGETS = {"Speed": "Speed", "Cornering": "Cornering"}
    ABILITY_WIDGETS = {"Shield": "Shield", "Vent": "Vent", "FlameVent": "Vent", "SupercooledVent": "Vent", "IonBolt": "IonBolt",
                       "Shockwave": "Shockwave", "VectoredShockwave": "Shockwave", "Autopilot": "Autopilot",
                       "StatusScrubber": "StatusScrubber", "ConcussionMine": "Mines", "OvertakingSurge": "Surge"}

    def keyword_icon(name):
        """A <widget id="Shielded"/> inline icon -> "{emoji:kw_Shielded} " when the game has an icon for it (a keyword,
        a build stat or an ability); nothing otherwise (e.g. the Faulty marker)."""
        if name in STAT_WIDGETS:
            icon = {"Speed": "Speed", "Cornering": "Cornering"}[name]
            emoji_name = emojis.add(f"stat_{name}", ui_icons / "BuildStats" / f"T_UI_BuildStats_{icon}_Icn.png")
        elif name in ABILITY_WIDGETS:
            src = ui_icons / "Abilities" / f"T_UI_Ability_{ABILITY_WIDGETS[name]}_Icn.png"
            emoji_name = emojis.add(f"ab_{ABILITY_WIDGETS[name]}", src) if src.exists() else None
        else:
            key = KEYWORD_ALIASES.get(name, name)
            src = ui_icons / "Keywords" / f"T_UI_Keyword_{key}_Icn.png"
            emoji_name = emojis.add(f"kw_{key}", src) if src.exists() else None
        return "{emoji:" + emoji_name + "} " if emoji_name else ""

    def part_rich(props, values):
        """A part's description as the game shows it: keywords bold with their icon, {perc}-style values filled
        from the catalog's Values column ("perc=50%; int=6")."""
        text = (props.get("PlayerFacingDescription") or props.get("FaultyPlayerFacingDescription") or {}).get("LocalizedString", "")
        for pair in (values or "").split(";"):
            if "=" in pair:
                k, v = pair.split("=", 1)
                text = text.replace("{" + k.strip() + "}", v.strip())
        return rich_text(text, keyword_icon, bold=True) or None

    # Staff times are marked with Fuse Games' logo (tools/art/fuse-logo.jpg, a circle on white): cut the circle out
    logo = ROOT / "tools" / "art" / "fuse-logo.jpg"
    if logo.exists():
        im = Image.open(logo).convert("RGBA")
        scale = 4
        mask = Image.new("L", (im.width * scale, im.height * scale))
        ImageDraw.Draw(mask).ellipse((3 * scale, 3 * scale, (im.width - 3) * scale, (im.height - 3) * scale), fill=255)
        im.putalpha(mask.resize(im.size, Image.LANCZOS))
        im.thumbnail((128, 128), Image.LANCZOS)
        emojis.add_image("staff", im)
    # Planet conditions (Burning, Cooled...) use the status keyword icons
    for p in planets:
        p["conditions"] = [{"name": c, "emoji": emojis.add(f"cond_{c}", ui_icons / "Keywords" / f"T_UI_Keyword_{c}_Icn.png")}
                           for c in p["conditions"]]

    # Speed and Max Energy, as the build panel shows them.
    #   Speed (km/h, rounded up): the thrust config's HighSpeedStep.Y (mph) plus the power-rating tuneset, which
    #   adds its full HighSpeedStep bonus (+150 speeders, +250 podracers) spread over NumberOfSteps (60) — one
    #   step per upgrade level, all slots weighted 1 in DA_VehicleUpgradeConfig. Podracer events flagged
    #   bUseMemoryHud (the legends' Race events) run on the memory-plane config, HC_PM_Thrust.
    #   Checked against all 53 in-game arcade speeds.
    #   Max Energy: AbilityTune.TotalAbilityEnergy (3) plus the Battery upgrade's IntAdd for its level.
    # Direction, as the game labels arcade events. From the route of the event's TrackDef (tracks.csv):
    #   "Alt" long routes, and point-to-point runs on a track that's normally a loop, are Rally;
    #   short routes, and tracks that only have the one special route, have no direction;
    #   otherwise the route's Fwd/Rev.
    route_of = {r["Asset"].lower(): r for r in rows(out / "tracks.csv")}
    track_info = {r["TrackName"]: r for r in rows(out / "tracks_unique.csv")}

    def direction(props, track_name):
        td = ((props.get("TrackDef") or {}).get("ObjectName") or "").split("'")[1:2]
        rt = route_of.get(td[0].lower(), {}) if td else {}
        route, info = rt.get("Route", ""), track_info.get(track_name, {})
        parts = route.split(".")
        if parts[-1] == "Alt" and "Long" in parts:
            return "Rally"
        if rt.get("Format") == "Point-to-point" and info.get("Format") == "Loop":
            return "Rally"
        if "Short" in parts or all(r.startswith("Special") for r in info.get("Routes", "").split()):
            return None
        if parts[-1] in ("Rev", "Reverse"):
            return "Reverse"
        if parts[-1] in ("Fwd", "Forward"):
            return "Forward"
        return None

    MPH_TO_KPH = 1.609344
    vehicles_dir = game / "Vehicles"
    thrust = lambda rel: float(re.search(r'"HighSpeedStep": \{"X": [\d.]+, "Y": ([\d.]+)',
                                         json.dumps(load_json(vehicles_dir / rel))).group(1))
    base_speed = {"Speeder Bike": thrust("Bikes/Configs/HC_B_Thrust.json"),
                  "Landspeeder": thrust("Cars/Configs/HC_C_Thrust.json"),
                  "Skim Speeder": thrust("Skimmers/Configs/HC_S_Thrust.json"),
                  "Podracer": thrust("Planes/Configs/HC_P_Thrust.json")}
    memory_speed = thrust("Planes/Configs/MemoryPlanes/HC_PM_Thrust.json")
    upgrades = game / "Vehicles" / "Common" / "Upgrades"
    power = load_json(upgrades / "StatTuneSets" / "TNS_Upgrade_PowerRating_Max.json")[0]["Properties"]
    step_bonus = lambda ops: next(o["Vector2DParam"]["Y"] for o in ops if o["Property"] == "HighSpeedStep")
    speed_bonus = {c: step_bonus(power["PlaneOperationsAtMax"] if c == "Podracer" else power["CoreVehicleOperationsAtMax"]) for c in ADVANCED}
    steps = power["NumberOfSteps"]
    base_energy = load_json(game / "Gameplay" / "Abilities" / "DA_C_AbilityTuneConfig.json")[0]["Properties"]["Config"]["TotalAbilityEnergy"]
    battery_energy = {0: 0}
    for r in rows(out / "upgrade_tunesets.csv"):
        m = re.fullmatch(r"TNS_Upgrade_Battery_(\d+)", r["TuneSet"])
        if m and r["Stat"] == "AbilityTune.TotalAbilityEnergy":
            battery_energy[int(m.group(1))] = int(r["ValueAtMax"])

    def game_json(object_path):
        """/Game/Griffin/X/Y.Y (or .0) -> the decoded JSON for that package."""
        rel = object_path.split("/Game/Griffin/", 1)[1].rsplit(".", 1)[0]
        return load_json(game / (rel + ".json"))

    def build_def(event_objs):
        cfg = next((o["Properties"] for o in event_objs if o.get("Type", "").endswith("Config") and o.get("Properties")), {})
        ref = ((cfg.get("CustomVehicle") or {}).get("VehicleBuildDef") or {}).get("AssetPathName")
        bd = game_json(ref) if ref else []
        return (bd[0].get("Properties") if bd else None) or {}

    def part(ref):
        asset = ref["ObjectName"].split("'")[1]
        a = affixes.get(asset, {})
        # Refs end in an export index (.0, .1); the object with the icon isn't always the package's first.
        props = next((o["Properties"] for o in game_json(ref["ObjectPath"]) if (o.get("Properties") or {}).get("Icon")), {})
        icon = texture(args.textures, props.get("Icon", {}).get("AssetPathName"))
        name = a.get("Name") or asset
        return {"name": name, "description": a.get("Description", ""), "rich": part_rich(props, a.get("Values")),
                "emoji": emojis.add(camel(name), icon)}

    def ability(ref):
        asset = ref["ObjectName"].split("'")[1].removesuffix("_C")
        aj = json.dumps(game_json(ref["ObjectPath"]))
        icon = next((m for m in re.findall(r"T_UI_Ability_(\w+?)_Icn", aj) if not m.endswith(("_Lg", "_Txt"))), None)
        src = ui_icons / "Abilities" / f"T_UI_Ability_{icon}_Icn.png" if icon else None
        return {"name": (abilities.get(asset) or {}).get("name") or asset.replace("BP_Ability_", ""),
                "emoji": emojis.add(f"ab_{icon}", src if src and src.exists() else None)}

    def build_stats(r, cls_name):
        """A catalog row's upgrade levels (the arcade and scenario CSVs share the "<Stat> lvl" columns)."""
        return [{"stat": ADVANCED.get(cls_name, "Advanced") if key == "Advanced" else key,
                 "level": num(r[f"{key} lvl"]),
                 "emoji": emojis.add(f"stat_{key}", ui_icons / "BuildStats" / f"T_UI_BuildStats_{icn}_Icn.png")}
                for key, icn in STATS if num(r[f"{key} lvl"]) is not None]

    def speed_of(cls_name, build, memory=False):
        total = sum(b["level"] for b in build)
        base = memory_speed if memory else base_speed[cls_name]
        kph = base * MPH_TO_KPH + speed_bonus[cls_name] * min(total, steps) / steps * MPH_TO_KPH
        return {"value": math.ceil(kph - 1e-9), "emoji": speed_emoji}

    def max_energy(r):
        return base_energy + battery_energy[num(r["Battery lvl"]) or 0]

    arcade = []
    for r in rows(out / "arcade_events.csv"):
        ej = load_json(event_json.get(r["Asset"].lower(), Path("-")))
        props = next((o["Properties"] for o in ej if o.get("Type") == "ArcadeEventDef"), {})
        bp = build_def(ej)
        eid = slug(r["Event"])
        tile = texture(args.textures, (props.get("FrontEndTileBackgroundImage") or {}).get("AssetPathName"))
        medals = {m: {"time": fmt_time(float(r[f"{m.title()} (s)"])), "seconds": float(r[f"{m.title()} (s)"]), "rival": r[f"{m.title()} rival"]}
                  for m in ("gold", "silver", "bronze")}
        cls_name = r["Vehicle class"]
        build = build_stats(r, cls_name)
        arcade.append({
            "id": eid,
            "order": int(r["Order"]),
            "name": r["Event"],
            "description": rich_text((props.get("PlayerFacingDescription") or {}).get("LocalizedString")),
            "category": r["Category"],
            "mode": MODES.get(r["Mode"], r["Mode"]),
            "planet": planet_id[r["Planet"]],
            "track": track_id[r["Track"]],
            "laps": num(r["Laps"]),
            "condition": r["Condition"].replace(".", ", ").replace("BlueHour", "Blue Hour"),
            "vehicleClass": r["Vehicle class"],
            "vehicle": r["Vehicle"],
            "medals": medals,
            "speed": speed_of(cls_name, build, memory=props.get("bUseMemoryHud")),
            "direction": direction(props, r["Track"]),
            "trackDef": ((props.get("TrackDef") or {}).get("ObjectName") or "'").split("'")[1],
            "maxEnergy": max_energy(r),
            "build": build,
            "parts": [part(a) for a in bp.get("Affixes", [])],
            "abilities": [ability(a) for a in bp.get("AbilitySlots", [])],
            "notes": mode_notes(r["Mode settings"]),
            "unlock": rich_text((props.get("LockReason") or {}).get("LocalizedString")) or None,
            "tile": save_art(tile, f"arcade/{eid}-tile.webp", max_size=256, crop="top-square"),
        })
    arcade.sort(key=lambda e: e["order"])

    # --- where each track can be raced, and in which variants ---
    # A variant is what a TrackDef changes about the base layout: direction (Fwd/Rev, Alt = Rally), mines, the
    # precision-gate layouts and the podracer versions. Only TrackDefs the game's modes actually reference count;
    # tracks.csv also lists test and cut ones.
    def variant(asset):
        rt = route_of.get(asset.lower())
        if not rt:
            return None
        parts = rt["Route"].split(".")
        d = "Rally" if parts[-1] == "Alt" else "Reverse" if parts[-1] in ("Rev", "Reverse") or rt["Reverse"] == "yes" else "Forward"
        if rt["Family"] == "Podracer":
            return f"Podracer {d}"
        if "Precision" in rt["Folder"]:
            return f"Precision {d}"
        return d + (" with mines" if rt["Mines"] == "yes" else "")

    VARIANT_ORDER = ["Forward", "Reverse", "Rally", "Forward with mines", "Reverse with mines", "Rally with mines",
                     "Precision Forward", "Precision Reverse", "Precision Rally", "Podracer Forward", "Podracer Reverse", "Podracer Rally"]
    vorder = lambda v: VARIANT_ORDER.index(v) if v in VARIANT_ORDER else 99
    cond = lambda c: c.replace("BlueHour", "Blue Hour").replace(".", " ")

    access = {t["name"]: {"variants": set(), "campaign": {}, "scenarios": {}} for t in tracks}
    track_name_by_id = {t["id"]: t["name"] for t in tracks}
    reverse_named = {t["id"] for t in tracks if t["reverseOf"]}
    for e in arcade:
        v = variant(e["trackDef"])
        if v:
            access[track_name_by_id[e["track"]]]["variants"].add(v)
        # Which variant of the track the event runs, as its track page lists them (see the flip below)
        e["variant"] = v.replace("Reverse", "Forward") if v and e["track"] in reverse_named else v

    # The campaign's race kinds under the names the map legend gives them (CampaignText Map_Legend_*), with its icons.
    # Standard/High Risk are the two event slots: they roll GMV_MultiVehicleRace and GMV_Eliminator.
    KIND_NAMES = {"Standard": "Race", "High Risk": "Eliminator", "Shakedown": "Field Test",
                  "Podracer Sprint": "Podracer Test", "Podracer Test": "Podracer Test",
                  "Finale: Champion": "Championship Race", "Finale: Knockout": "Galactic Gauntlet"}
    map_icons = ui_icons / "Map"
    kind_emoji = {k: emojis.add(name, map_icons / f"{icn}.png") for k, name, icn in [
        ("Race", "map_Race", "T_UI_Map_StandardEvent_Icn"), ("Eliminator", "map_Eliminator", "T_UI_Map_HighRisk_Icn"),
        ("Field Test", "map_FieldTest", "T_UI_Map_ShakedownRun_Icn"), ("Championship Race", "map_Championship", "T_UI_Map_ChampionEvent_Icn")]}

    event_rows = {r["Asset"].lower(): r for r in rows(out / "events.csv")}
    # Event modes under their EventArcadeTypesText names
    EVENT_MODES = {"TimeTrialConfig": "Time Trial", "RamjetDistanceConfig": "Ramjet Distance", "TakedownEventConfig": "Takedowns",
                   "PrecisionDrivingConfig": "Precision Driving", "TeamRaceConfig": "Race"}

    # Many TrackDefs that copy a route under another name (_ACT3, _HARD, _MINES...) leave DefaultLaps unset. Inferred
    # fallback: the TrackDef they're BasedOn, else the most common lap count among the same track's TrackDefs on the
    # same route (never another track's: The Qualifier shares Stadium Showdown's route but not its 6 laps).
    laps_by_route = {}
    for r in route_of.values():
        if r["DefaultLaps"]:
            laps_by_route.setdefault((r["TrackName"], r["Route"]), []).append(int(r["DefaultLaps"]))

    def track_laps(asset):
        """A TrackDef's lap count; point-to-point routes run once."""
        rt = route_of.get(asset.lower(), {})
        if rt.get("Format") == "Point-to-point" and not rt.get("DefaultLaps"):
            return 1
        for r in (rt, route_of.get(rt.get("BasedOn", "").lower(), {})):
            if r.get("DefaultLaps"):
                return int(r["DefaultLaps"])
        same = laps_by_route.get((rt.get("TrackName"), rt.get("Route")))
        return max(set(same), key=same.count) if same else None

    # Campaign: each act visits planets in order (a "stop"). On a stop, Standard / High Risk races draw from a
    # track pool that grows over the act: each entry joins once N events are done (UnlockAtEvents, from the stop's
    # EventCompletionUnlocks; "never" = its unlock tag isn't granted). Every stop authors the same 1-10 table.
    # ASSUMPTION (the data doesn't name the counter): N counts events completed since the act started, and every
    # stop is EVENTS_PER_STOP events (the map branches but you must finish 4 to move on). So on stop k you arrive
    # with 4(k-1) done: N at or below that is open on arrival, the next three open after 1-3 events here, and
    # anything later is never reachable on this stop. Podracer Tests aren't counted. Flip stop_unlock if wrong.
    # Shakedown, Podracer Sprint and Podracer Test pools are open for the whole stop; finales are fixed.
    EVENTS_PER_STOP = 4

    def stop_unlock(n, order):
        """Events into this stop before the entry is available (0 = on arrival), or None if never on this stop."""
        arrived_with = EVENTS_PER_STOP * (order - 1)
        here = max(0, n - arrived_with)
        return here if here < EVENTS_PER_STOP else None

    for r in rows(out / "campaign_tracks.csv"):
        a = access.get(r["Track"])
        if not a or r["UnlockAtEvents"] == "never":
            continue
        after = stop_unlock(int(r["UnlockAtEvents"] or 0), int(r["Order"]))
        if after is None:
            continue
        # Derven Acos has no Field Tests in game. Its end-of-act setups still point PreviewEvents at the previous
        # planet's pool (Act 2: Ando Prime's, Act 3: Crait's), which would list those tracks under Derven Acos.
        if r["Kind"] == "Shakedown" and r["Planet"] == "Derven Acos":
            continue
        v = variant(r["TrackAsset"])
        if v:
            a["variants"].add(v)
        stop = a["campaign"].setdefault((r["Act"], int(r["Order"]), planet_id[r["Planet"]]), {})
        kind_name = KIND_NAMES.get(r["Kind"], r["Kind"])
        kind = stop.setdefault(kind_name, {"unlocks": {}, "vehicles": set(), "laps": set(), "events": set()})
        slot = kind["unlocks"].setdefault(after, {"variants": set(), "conditions": set()})
        if v:
            slot["variants"].add(v)
        slot["conditions"].update(cond(c.strip()) for c in r["Conditions"].split(";") if c.strip())
        if r["Vehicle"]:
            kind["vehicles"].add(r["Vehicle"])
        # Laps: pooled races use the variant's own lap count; Eliminators run on a timer (last place out on a cadence
        # until three remain), so laps don't apply; fixed events (Field Tests, Podracer Tests, finales) set their own.
        ev = event_rows.get(r["Event"].lower()) if r["Event"] else None
        if ev:
            kind["events"].add((r["Vehicle"] or "", EVENT_MODES.get(ev["Mode"], ""), ev["Laps"] or ""))
        elif kind_name == "Race":
            kind["laps"].add(track_laps(r["TrackAsset"]))

    # Scenarios: each has its own planet setup(s) (CAM_SCEN_*) whose Standard / High Risk track lists name the exact
    # routes, so variants are known. Days draw from the Race (Standard) pool, the final eliminator from the High Risk
    # pool. A track behind an unlock tag is only in the pool if the scenario force-unlocks that tag.
    scen_dir = game / "Gameplay" / "Scenarios"
    scen_json = {p.stem: p for p in scen_dir.glob("**/*.json")}
    scenario_events = rows(out / "scenario_events.csv")
    for sr in rows(out / "scenarios.csv"):
        sdef = next((o["Properties"] for o in load_json(scen_json.get(sr["Asset"], Path("-"))) if o.get("Type") == "ScenarioDef"), {})
        forced = set(sdef.get("ForcedUnlockedTags", []))
        days = [r for r in scenario_events if r["#"] == sr["#"]]
        for setup_name in [s.strip() for s in sr["Planet setup"].split(",") if s.strip()]:
            ps = next((o["Properties"] for o in load_json(scen_json.get(setup_name, Path("-")))
                       if "StandardEventSetup" in (o.get("Properties") or {})), {})
            for pool_key, final in (("StandardEventSetup", False), ("HighRiskEventSetup", True)):
                for entry in (ps.get(pool_key) or {}).get("Tracks", []):
                    tag = (entry.get("UnlockedBy") or {}).get("TagName", "None")
                    if tag not in ("None", "") and tag not in forced:
                        continue
                    asset = entry["Track"]["AssetPathName" if "AssetPathName" in entry["Track"] else "ObjectPath"].rsplit("/", 1)[-1].split(".")[0]
                    rt = route_of.get(asset.lower())
                    a = access.get(rt["TrackName"]) if rt else None
                    if a is None:
                        continue
                    used = [r for r in days if (r["Event"] == "Final Eliminator") == final]
                    if not used:
                        continue
                    sc = a["scenarios"].setdefault(sr["#"], {"name": sr["Scenario"], "tier": sr["Tier"], "vehicle": sr["Vehicle"],
                                                             "days": set(), "final": False, "pools": {}})
                    if final:
                        sc["final"] = True
                    else:
                        sc["days"].update(int(r["Day"]) for r in used)
                    pool = sc["pools"].setdefault("final" if final else "days", {"variants": set(), "conditions": set()})
                    v = variant(asset)
                    if v:
                        pool["variants"].add(v)
                        a["variants"].add(v)
                    pool["conditions"].update(cond(c.replace("TrackCondition.", "")) for c in entry.get("PermittedTrackConditions", []))

    KIND_ORDER = list(dict.fromkeys(KIND_NAMES.values()))
    for t in tracks:
        a = access[t["name"]]
        t["variants"] = sorted(a["variants"], key=vorder)
        t["campaign"] = [{
            "act": act, "stop": stop, "planet": pid,
            "kinds": [{"kind": k, "emoji": kind_emoji.get(k),
                       "unlocks": [{"after": n, "variants": sorted(u["variants"], key=vorder), "conditions": sorted(u["conditions"])}
                                   for n, u in sorted(v["unlocks"].items())],
                       "vehicles": sorted(v["vehicles"]),
                       "laps": sorted(l for l in v["laps"] if l),
                       "events": [{"vehicle": veh, "mode": mode, "laps": laps} for veh, mode, laps in sorted(v["events"])]}
                      for k, v in sorted(kinds.items(), key=lambda kv: KIND_ORDER.index(kv[0]) if kv[0] in KIND_ORDER else 99)],
        } for (act, stop, pid), kinds in sorted(a["campaign"].items())]
        t["scenarios"] = [{"number": n, "name": sc["name"], "tier": sc["tier"], "vehicle": sc["vehicle"], "days": sorted(sc["days"]),
                           "final": sc["final"],
                           "pools": {k: {"variants": sorted(v["variants"], key=vorder), "conditions": sorted(v["conditions"])}
                                     for k, v in sc["pools"].items()}}
                          for n, sc in sorted(a["scenarios"].items())]

    # Every loop track gets a header lap count; the appearance lists only mention laps where they differ. When the
    # track itself doesn't set one, use the most common count across its races and events. Point-to-point tracks
    # don't talk about laps at all.
    for t in tracks:
        if t["format"] == "Point-to-point":
            t["defaultLaps"] = None
            continue
        if t["defaultLaps"]:
            continue
        counts = [l for c in t["campaign"] for k in c["kinds"] for l in k["laps"]]
        counts += [int(e["laps"]) for c in t["campaign"] for k in c["kinds"] for e in k["events"] if str(e["laps"]).isdigit()]
        counts += [e["laps"] for e in arcade if e["track"] == t["id"] and e["laps"]]
        t["defaultLaps"] = max(set(counts), key=counts.count) if counts else None

    # A track the game names separately for running another backwards (Dai Bendu Ascension = Mountain to Sea in
    # reverse) is driven on reversed routes, but on its own page that's simply its forward direction.
    flip = lambda v: v.replace("Reverse", "Forward")
    for t in tracks:
        if t["reverseOf"]:
            t["variants"] = sorted(dict.fromkeys(map(flip, t["variants"])), key=vorder)
            for stop in t["campaign"]:
                for k in stop["kinds"]:
                    for u in k["unlocks"]:
                        u["variants"] = sorted(dict.fromkeys(map(flip, u["variants"])), key=vorder)
            for sc in t["scenarios"]:
                for pool in sc["pools"].values():
                    pool["variants"] = sorted(dict.fromkeys(map(flip, pool["variants"])), key=vorder)
            # ...and its counterpart's page points back at it
            other = next((o for o in tracks if o["name"] == t["reverseOf"]), None)
            if other:
                other["reversedAs"] = t["name"]

    # --- scenarios ---
    # One card per scenario: its starting build (same treatment as arcade builds), racer style, unlock and rewards,
    # and the day-by-day schedule with each day's track pool (planet setup Standard / High Risk lists, as above).
    track_id_by_name = {t["name"]: t["id"] for t in tracks}
    track_order = [t["id"] for t in tracks]
    CLASS_KEY = {"Landspeeder": "Car", "Speeder Bike": "Bike", "Skim Speeder": "Skimmer", "Podracer": "Plane"}
    scenarios_out = []
    for sr in rows(out / "scenarios.csv"):
        sdef = next((o["Properties"] for o in load_json(scen_json.get(sr["Asset"], Path("-"))) if o.get("Type") == "ScenarioDef"), {})
        forced = set(sdef.get("ForcedUnlockedTags", []))
        cls_name = sr["Vehicle"]
        cls_key = CLASS_KEY[cls_name]
        # starting build: RacerBuildDef -> <Class>Build -> VehicleBuildDef (parts and ability slots)
        rbd = game_json(sdef["PlayerStartingBuildOverride"]["ObjectPath"]) if sdef.get("PlayerStartingBuildOverride") else []
        rbd_props = next((o["Properties"] for o in rbd if (o.get("Properties") or {}).get(f"{cls_key}Build")), {})
        vbd_ref = (rbd_props.get(f"{cls_key}Build") or {}).get("ObjectPath")
        vbd = next((o["Properties"] for o in (game_json(vbd_ref) if vbd_ref else []) if "SlotToUpgradeLevelMap" in (o.get("Properties") or {})), {})
        build = build_stats(sr, cls_name)
        # racer style
        style_ref = (sdef.get("RacerStyleOverride") or {}).get("ObjectPath")
        style = next((o["Properties"] for o in (game_json(style_ref) if style_ref else []) if o.get("Type") == "RacerStyle"), {})
        style_icon = texture(args.textures, (style.get("Icon") or {}).get("AssetPathName"))
        # track pools: False = the Race (Standard) pool for normal days, True = the High Risk pool for the final
        pools = {False: {}, True: {}}
        for setup_name in [s.strip() for s in sr["Planet setup"].split(",") if s.strip()]:
            ps = next((o["Properties"] for o in load_json(scen_json.get(setup_name, Path("-")))
                       if "StandardEventSetup" in (o.get("Properties") or {})), {})
            for key, final in (("StandardEventSetup", False), ("HighRiskEventSetup", True)):
                for entry in (ps.get(key) or {}).get("Tracks", []):
                    tag = (entry.get("UnlockedBy") or {}).get("TagName", "None")
                    if tag not in ("None", "") and tag not in forced:
                        continue
                    ref = entry["Track"]
                    asset = (ref.get("AssetPathName") or ref.get("ObjectPath") or "").rsplit("/", 1)[-1].split(".")[0]
                    rt = route_of.get(asset.lower())
                    if not rt or rt["TrackName"] not in track_id_by_name:
                        continue
                    tid = track_id_by_name[rt["TrackName"]]
                    v = variant(asset)
                    if v and tid in reverse_named:
                        v = v.replace("Reverse", "Forward")
                    t_entry = pools[final].setdefault(tid, {"variants": set(), "conditions": set()})
                    if v:
                        t_entry["variants"].add(v)
                    t_entry["conditions"].update(cond(c.replace("TrackCondition.", "")) for c in entry.get("PermittedTrackConditions", []))
        # schedule: consecutive days with the same event (and must-win rule) share one entry
        schedule = []
        for r in sorted((r for r in scenario_events if r["#"] == sr["#"]), key=lambda r: int(r["Day"])):
            final = r["Event"] == "Final Eliminator"
            kind = "Final Eliminator" if final else KIND_NAMES.get(r["Event"], r["Event"])
            must = bool(r["Must win"])
            prev = schedule[-1] if schedule else None
            if prev and prev["event"] == kind and prev["mustWin"] == must and prev["days"][-1] == int(r["Day"]) - 1:
                prev["days"].append(int(r["Day"]))
                continue
            schedule.append({"days": [int(r["Day"])], "event": kind, "mustWin": must,
                             "emoji": kind_emoji.get("Eliminator" if final else kind),
                             "tracks": [{"track": tid, "variants": sorted(x["variants"], key=vorder), "conditions": sorted(x["conditions"])}
                                        for tid, x in sorted(pools[final].items(), key=lambda kv: track_order.index(kv[0]))]})
        sid = slug(sr["Scenario"])
        style_name = (style.get("PlayerFacingName") or {}).get("LocalizedString") or sr["Racer style"]
        scenarios_out.append({
            "id": sid,
            "number": sr["#"],
            "name": sr["Scenario"],
            "tier": sr["Tier"],
            "tagline": sr["Tagline"],
            "details": re.sub(r"  +", "\n\n", sr["Details"]).strip(),
            "planet": planet_id.get(sr["Planet"]),
            "vehicleClass": cls_name,
            "style": {"name": style_name,
                      "description": (style.get("PlayerFacingDescription") or {}).get("LocalizedString", ""),
                      "emoji": emojis.add("style_" + camel(style_name), style_icon)},
            "difficulty": sr["Difficulty"],
            "leagueTokens": num(sr["League tokens"]),
            "favorSlots": num(sr["Favor slots"]),
            "partSlots": num(sr["Part slots"]),
            "startingPower": num(sr["Starting power"]),
            "speed": speed_of(cls_name, build),
            "maxEnergy": max_energy(sr),
            "build": build,
            "parts": [part(a) for a in vbd.get("Affixes", [])],
            "abilities": [ability(a) for a in vbd.get("AbilitySlots", [])],
            "schedule": schedule,
            "unlock": sr["Unlock requirement"] or None,
            "winMessage": sr["Win message"],
            "repeatRewards": sr["Repeat-win rewards"],
            "tile": save_art(texture(args.textures, (sdef.get("FrontEndTileBackgroundImage") or {}).get("AssetPathName")),
                             f"scenarios/{sid}-tile.webp", max_size=256, crop="top-square"),
        })

    # --- unlock goals: "Spend [Current?]/[Target?]s Shielded." -> "Spend 180s Shielded." ---
    goals = {r["unlock"]: r for r in rows(out / "gameplay" / "unlock_goals.csv")}

    def unlock_text(tag):
        g = goals.get(tag)
        if not g:
            return None
        target = g["target"]
        target = str(int(float(target))) if target and float(target).is_integer() else target
        return re.sub(r"\[Current\?\]/", "", g["description"]).replace("[Target?]", target or "").strip() or None

    def fill_params(text, props):
        """Trait descriptions use {int} / {perc}-style placeholders filled from Description*Parameters."""
        for key, suffix in (("DescriptionIntParameters", ""), ("DescriptionFloatParameters", ""), ("DescriptionPercentParameters", "%")):
            for p in props.get(key, []) or []:
                v = p["Value"]
                text = text.replace("{" + p["Key"] + "}", (f"{v:g}" if isinstance(v, float) else str(v)) + suffix)
        return rich_text(text, keyword_icon, bold=True)

    # --- racer styles ---
    # The 16 campaign styles, each in three ranks (CAM_Style_<X>_Lv1..3). Ranks keep the name, description and
    # starting abilities and add traits; "Dummy" traits only repeat an earlier trait for display, so they're skipped.
    styles_dir = game / "Gameplay" / "Campaign" / "Loadouts" / "RacerStyles"
    style_order = [r["ObjectName"].split("'")[1] for r in load_json(styles_dir / "CAM_LoadoutConfig.json")[0]["Properties"]["RacerStyles"]]

    def trait(ref_path):
        tj = game_json(ref_path)
        props = next((o["Properties"] for o in tj if o.get("Type") == "CharacterTrait"), {})
        name = (props.get("PlayerFacingName") or {}).get("LocalizedString", "")
        icon = texture(args.textures, (props.get("Icon") or {}).get("AssetPathName"))
        return {"name": name, "description": fill_params((props.get("PlayerFacingDescription") or {}).get("LocalizedString", ""), props),
                "emoji": emojis.add("trait_" + camel(re.sub(r"\s+[IVX]+$", "", name)), icon) if name else None}

    styles_out = []
    for lv1 in style_order:
        base = lv1.removesuffix("_Lv1")
        ranks, seen = [], set()
        for rank in (1, 2, 3):
            sj = load_json(styles_dir / f"{base}_Lv{rank}.json")
            props = next((o["Properties"] for o in sj if o.get("Type") == "RacerStyle"), None)
            if not props:
                continue
            traits = []
            for t in props.get("Traits", []):
                path = t["AssetPathName"]
                if path.rsplit(".", 1)[-1].endswith("Dummy"):
                    continue
                tr = trait(path)
                if tr["name"] and tr["name"] not in seen:
                    seen.add(tr["name"])
                    traits.append(tr)
            unlock = (props.get("UnlocksRequired") or [None])[0]
            ranks.append({"rank": rank, "traits": traits, "unlock": unlock_text(unlock)})
            if rank == 1:
                first = props
        name = (first.get("PlayerFacingName") or {}).get("LocalizedString", base)
        abil = [ability({"ObjectName": "x'" + a["AssetPathName"].rsplit(".", 1)[-1] + "'", "ObjectPath": a["AssetPathName"]})
                for a in first.get("StandardAbilities", [])]
        icon = texture(args.textures, (first.get("Icon") or {}).get("AssetPathName"))
        sid = slug(name)
        styles_out.append({
            "id": sid,
            "name": name,
            "description": (first.get("PlayerFacingDescription") or {}).get("LocalizedString", ""),
            "emoji": emojis.add("style_" + camel(name), icon),
            "icon": save_art(icon, f"styles/{sid}.webp", max_size=256),
            "abilities": abil,
            "ranks": ranks,
        })

    # --- parts (affixes) ---
    # Rarity names are CampaignText Rarity_* (Salvaged/Common/Premium/Prototype read Common/Rare/Epic/Legendary);
    # the game draws rarity as 1-4 pips. Families (the I/II/III/IV tiers) come from DA_VehicleUpgradeConfig.
    RARITY = {"": ("Common", 1), "Low": ("Rare", 2), "High": ("Epic", 3), "Highest": ("Legendary", 4),
              "Faulty": ("Faulty", 0), "Experimental": ("Experimental", 0)}
    upgrade_cfg = load_json(game / "Vehicles" / "Common" / "Upgrades" / "DA_VehicleUpgradeConfig.json")[0]["Properties"]
    family_of = {}
    for fam in upgrade_cfg.get("AffixFamilyLists", []):
        members = [a["ObjectName"].split("'")[1] for a in fam.get("AffixList", [])]
        for m in members:
            family_of[m] = members
    used_in = {}
    for e in arcade:
        for p_ in e["parts"]:
            used_in.setdefault(p_["name"], {"events": [], "scenarios": []})["events"].append(e["id"])
    for sc in scenarios_out:
        for p_ in sc["parts"]:
            used_in.setdefault(p_["name"], {"events": [], "scenarios": []})["scenarios"].append(sc["id"])

    parts_out, part_ids = [], {}
    for r in rows(out / "affixes.csv"):
        if not r["Name"]:
            continue
        pid = slug(r["Name"])
        if pid in part_ids.values():  # a few parts exist as two assets; keep the first, but map both to it
            part_ids[r["Asset"]] = pid
            continue
        aj = load_json(game / "Vehicles" / "Common" / "Upgrades" / r["Folder"] / f"{r['Asset']}.json")
        props = next((o["Properties"] for o in aj if (o.get("Properties") or {}).get("Icon")), {})
        icon = texture(args.textures, (props.get("Icon") or {}).get("AssetPathName"))
        large = texture(args.textures, (props.get("LargeIcon") or {}).get("AssetPathName")) or icon
        rarity, pips = RARITY.get(r["Rarity"], (r["Rarity"], 0))
        part_ids[r["Asset"]] = pid
        parts_out.append({
            "id": pid,
            "name": r["Name"],
            "description": r["Description"],
            "rich": part_rich(props, r["Values"]),
            "category": r["Category"],
            "rarity": rarity,
            "pips": pips,
            "credits": num(r["Credits"]),
            "unlock": unlock_text(r["UnlockedBy"]) if r["UnlockedBy"] and r["UnlockedBy"] != "Unlock.Cam.Affixes.Base" else None,
            "special": r["Folder"] != "Affixes",
            "asset": r["Asset"],
            "emoji": emojis.add(camel(r["Name"]), icon),
            "icon": save_art(large, f"parts/{pid}.webp", max_size=256),
            "usedIn": used_in.get(r["Name"], {"events": [], "scenarios": []}),
        })
    # Keywords: the bold game keywords in each part's description (plus Faulty), for the parts finder's keyword
    # filter. Discord menus hold 25 options; there are 24 keywords after merging spelling variants, plus Faulty.
    KEYWORD_SPELLINGS = {"Ability": "Abilities", "Takedowns": "Takedown"}
    keyword_emoji = {}
    for p_ in parts_out:
        found = []
        for m in re.finditer(r"(?:\{emoji:(\w+)\} )?\*\*(.+?)\*\*", p_["rich"] or ""):
            name = KEYWORD_SPELLINGS.get(m.group(2), m.group(2))
            if m.group(1):
                keyword_emoji.setdefault(name, m.group(1))
            if name not in found:
                found.append(name)
        if p_["category"] == "Faulty":
            found.append("Faulty")
        p_["keywords"] = found
        p_["family"] = [part_ids[a] for a in family_of.get(p_["asset"], []) if a in part_ids]
        del p_["asset"]
    counts = {}
    for p_ in parts_out:
        for k in p_["keywords"]:
            counts[k] = counts.get(k, 0) + 1
    # Ids are positions in this list (compact enough for button ids); most-used first
    keywords_out = [{"id": i, "name": k, "emoji": keyword_emoji.get(k), "count": n}
                    for i, (k, n) in enumerate(sorted(counts.items(), key=lambda kv: (-kv[1], kv[0])))]
    if len(keywords_out) > 25:
        print(f"WARNING: {len(keywords_out)} part keywords; the finder's menu shows the first 25")

    # --- abilities ---
    # The 45 player abilities (AI-only versions skipped) in 9 families; tier = price level (1000 / 2000 / 4000
    # credits). Descriptions are the blueprint's text with {placeholders} filled from the ability's config asset.
    # Values a config leaves at the game code's default aren't in any asset: those can be filled by hand in
    # src/data/community/ability-values.json, and anything still missing stays a "{?name}" token the cards show as ?.
    ability_rows = [r for r in rows(out / "gameplay" / "abilities.csv") if r["ai_version"] != "True"]
    preflight = {r["Asset"]: r for r in rows(out / "preflight_checks.csv")}
    prices = {r[1]: int(r[2]) for r in csv.reader(open(out / "economy.csv", encoding="utf-8-sig"))
              if len(r) > 2 and r[0] == "ECO_Campaign" and r[1].startswith("CampaignEconomy.Abilities.Level")}
    hand_values_file = ROOT / "src" / "data" / "community" / "ability-values.json"
    hand_values = json.loads(hand_values_file.read_text(encoding="utf-8")) if hand_values_file.exists() else {}
    abilities_dir = game / "Gameplay" / "Abilities"
    ability_json = {p.stem: p for p in abilities_dir.glob("**/BP_Ability_*.json")}
    FAMILY_MERGE = {"VentV2": "Vent"}

    def number(v):
        return f"{v:g}" if isinstance(v, (int, float)) else str(v)

    abilities_out = []
    for r in ability_rows:
        bp = load_json(ability_json.get(r["asset"], Path("-")))
        props = next((o["Properties"] for o in bp if "Default__" in o.get("Name", "") and (o.get("Properties") or {}).get("Description")), {})
        cfg_ref = (props.get("AbilityConfig") or {}).get("ObjectPath")
        cfg = next((o.get("Properties") or {} for o in (game_json(cfg_ref) if cfg_ref else [])), {}) or {}
        aid = slug(r["name"])
        values = {k.lower(): number(v) for k, v in cfg.items() if isinstance(v, (int, float)) and not isinstance(v, bool)}
        for pair in (r["config"] or "").split(", "):
            if "=" in pair and pair.split("=", 1)[1].replace(".", "", 1).isdigit():
                values.setdefault(pair.split("=", 1)[0].lower(), pair.split("=", 1)[1])
        values.update({k.lower(): number(v) for k, v in hand_values.get(aid, {}).items()})
        text = (props.get("Description") or {}).get("LocalizedString", "")
        text = re.sub(r"\{(\w+)\}", lambda m: values.get(m.group(1).lower(), "{?" + m.group(1) + "}"), text)
        icon_name = next((m for m in re.findall(r"T_UI_Ability_(\w+?)_Icn", json.dumps(bp)) if not m.endswith(("_Lg", "_Txt"))), None)
        icon = ui_icons / "Abilities" / f"T_UI_Ability_{icon_name}_Icn.png" if icon_name else None
        large = ui_icons / "Abilities" / "LargeAbilityIcons" / f"T_UI_Ability_{icon_name}_Lg_Icn.png" if icon_name else None
        pf = preflight.get(r["asset"])
        level = int(r["price_group"][-1]) if r["price_group"][-1:].isdigit() else None
        abilities_out.append({
            "id": aid,
            "name": r["name"],
            "family": FAMILY_MERGE.get(r["family"], r["family"]),
            "tier": level,
            "credits": prices.get(r["price_group"]),
            "description": rich_text(re.sub(r"\{\?(\w+)\}", "?", text)),
            "rich": rich_text(text, keyword_icon, bold=True),
            "cooldown": num(r["cooldown_s"]) if r["cooldown_s"].isdigit() else (float(r["cooldown_s"]) if r["cooldown_s"] else None),
            "energy": num(r["energy_cost"]) if r["energy_cost"].isdigit() else None,
            "upgradesTo": [slug(n.strip()) for n in r["upgrades_to"].split(",") if n.strip()],
            "preflight": {
                "pad": pf["Sequence (pad)"], "keyboard": pf["Sequence (keyboard)"], "reward": pf["Reward"],
                "simpleDrops": pf["Simple mode drops"],
                # an emoji per input, per platform (None where there's no glyph)
                "inputs": {platform: [input_glyph(platform, b) for b in pf[col].split()]
                           for platform, col in (("xbox", "Sequence (pad)"), ("playstation", "Sequence (pad)"),
                                                 ("keyboard", "Sequence (keyboard)"))},
            } if pf else None,
            "unlock": unlock_text(r["unlocked_by"]) if r["unlocked_by"] else None,
            "emoji": emojis.add(f"ab_{icon_name}", icon) if icon and icon.exists() else None,
            "icon": save_art(large if large and large.exists() else icon, f"abilities/{aid}.webp", max_size=256) if icon else None,
            "usedIn": {
                "events": [e["id"] for e in arcade if any(a["name"] == r["name"] for a in e["abilities"])],
                "scenarios": [sc["id"] for sc in scenarios_out if any(a["name"] == r["name"] for a in sc["abilities"])],
                "styles": [st["id"] for st in styles_out if any(a["name"] == r["name"] for a in st["abilities"])],
            },
        })
    ability_ids = {a["id"] for a in abilities_out}
    for a in abilities_out:
        a["upgradesTo"] = [u for u in a["upgradesTo"] if u in ability_ids]
        a["upgradesFrom"] = [b["id"] for b in abilities_out if a["id"] in b["upgradesTo"]]
    # families, named after their first-tier ability, in data order
    ability_families = []
    for a in abilities_out:
        if a["family"] not in [f["id"] for f in ability_families]:
            base = next((b for b in abilities_out if b["family"] == a["family"] and b["tier"] == 1), a)
            ability_families.append({"id": a["family"], "name": base["name"], "emoji": base["emoji"]})
    unresolved = sorted({m for a in abilities_out for m in re.findall(r"\{\?(\w+)\}", a["rich"] or "")})
    if unresolved:
        print(f"{sum(1 for a in abilities_out if '{?' in (a['rich'] or ''))} abilities have values not in the game data "
              f"({', '.join(unresolved)}); fill them in {hand_values_file.relative_to(ROOT).as_posix()}")

    icons_dir = args.textures / "Griffin" / "Content" / "Griffin" / "UI" / "Library" / "Textures" / "Icons" / "Arcade"
    categories = [{"id": k, "name": n,
                   "icon": save_art(icons_dir / f"{icn}.png", f"icons/arcade-{slug(k)}.webp", max_size=128),
                   "emoji": emojis.add(f"cat_{k}", icons_dir / f"{icn}.png")}
                  for k, (n, icn) in CATEGORIES.items()]

    DATA_OUT.mkdir(parents=True, exist_ok=True)
    # The vehicle-select loading animation for each class (tools/make_flipbook_gifs.py in the datamine)
    vehicle_classes = {c: {"gif": save_flipbook_gif(args.datamine, f"vehicle_loading_{slug(c).replace('-', '_')}",
                                                    f"vehicles/{slug(c)}.gif", height=240)}
                       for c in ADVANCED}

    # --- favors ---
    # The 20 campaign favors (Favour_<Key>_1..3), each in three ranks: the description's {int}/{perc} placeholders
    # come from the rank's Description*Parameters, and its unlock text from the datamine's favours.csv. Favor text marks icons
    # twice, <widget id="Part"/><img id="PartMyst"/> (the widget for menus, the img for mystery text), so the img is
    # dropped after a widget; a lone XMyst img is the X icon. Icons with no keyword texture come from FAVOR_ICONS.
    favours_dir = game / "Gameplay" / "Campaign" / "Loadouts" / "Favours"
    icons_root = args.textures / "Griffin" / "Content" / "Griffin" / "UI" / "Library" / "Textures" / "Icons"
    FAVOR_ICONS = {
        "Token": ("LeagueToken", icons_root / "T_UI_Strike_Token_Icn.png"),
        "Part": ("rw_Part", icons_root / "T_UI_Rewards_Affix_Icn.png"),
        "Upgrade": ("rw_Upgrade", icons_root / "T_UI_Rewards_Upgrade_Icn.png"),
        "ScrapDealer": ("map_ScrapDealer", icons_root / "Map" / "T_UI_Map_ExoticVendor_Icn.png"),
    }

    def favor_icon(name):
        name = re.sub(r"Myst$", "", name)
        if name == "Credit":
            return "{emoji:Credits} "  # the server's credits emoji, used everywhere else
        if name in FAVOR_ICONS:
            emoji_name, src = FAVOR_ICONS[name]
            return "{emoji:" + emojis.add(emoji_name, src) + "} " if src.exists() else ""
        return keyword_icon(name)

    def favor_text(text, props):
        values = {p["Key"]: p["Value"] for p in props.get("DescriptionIntParameters", []) or []}
        values.update({p["Key"]: f"{p['Value']:g}%" for p in props.get("DescriptionPercentParameters", []) or []})
        # "{int}|plural(one=Token,other=Tokens)" is just the word, in the form the number needs
        text = re.sub(r"\{(\w+)\}\|plural\(one=([^,]*),other=([^)]*)\)",
                      lambda m: m.group(2) if str(values.get(m.group(1))) == "1" else m.group(3), text)
        text = re.sub(r"\{(\w+)\}", lambda m: str(values.get(m.group(1), m.group(0))), text)
        text = re.sub(r'(<widget id="\w+"\s*/>)\s*<img id="\w+Myst"\s*/>', r"\1", text)
        return text

    favors_out = []
    favor_rows = list(rows(out / "favours.csv"))
    for key in dict.fromkeys(r["Key"] for r in favor_rows):
        ranks, props1 = [], None
        for n in (1, 2, 3):
            fj = load_json(favours_dir / f"Favour_{key}_{n}.json")
            props = next((o.get("Properties") or {} for o in fj if o.get("Type") == "RacerFavour"), None)
            if props is None:
                continue
            props1 = props1 or props
            raw = favor_text((props.get("PlayerFacingDescription") or {}).get("LocalizedString", ""), props)
            ranks.append({
                "rank": n,
                "description": rich_text(raw),
                "rich": rich_text(raw, favor_icon, bold=True),
                # the datamine's HowToUnlock has the goal's number filled in ("Complete {Target} ..." in the asset)
                "unlock": next((r["HowToUnlock"] for r in favor_rows if r["Key"] == key and r["Rank"] == str(n)), None)
                          or rich_text((props.get("UnlockDescription") or {}).get("LocalizedString", "")) or None,
            })
        if not ranks:
            continue
        name = (props1.get("PlayerFacingName") or {}).get("LocalizedString") or next(r["Name"] for r in favor_rows if r["Key"] == key)
        character = next(r["Character"] for r in favor_rows if r["Key"] == key)
        icon = texture(args.textures, (props1.get("Icon") or {}).get("AssetPathName"))
        fid = slug(name)
        favors_out.append({
            "id": fid,
            "name": name,
            "key": key,
            # "Hibi (A)" / "Sebulba (B)": the character offers two favors; "Q-33N (Broker backer)": a backer
            "character": re.sub(r"\s*\((A|B)\)$", "", character),
            "backer": bool(re.search(r"backer\)$", character)),
            "ranks": ranks,
            "emoji": emojis.add(f"fv_{key}", icon) if icon else None,
            "icon": save_art(icon, f"favors/{fid}.webp", max_size=256) if icon else None,
        })
    favors_out.sort(key=lambda f: f["name"].lower())

    # --- vehicles ---
    # The four classes (their garage description, traits and Advanced stat) and every named vehicle in them. A
    # speeder's model is a cosmetic kit (TH_<codename>: its manufacturer's badge, a Kit Points price and the unlock
    # tag buying it sets); stats come from the build, not the model. Podracers are the rivals' named pods, which
    # appear in arcade events but not in the garage. Myth (the player's own podracer) has no name and is left out.
    loc = json.loads((out / "loc_en.json").read_text(encoding="utf-8"))
    vtext = loc.get("VehicleText", {})
    CLASS_KEY = {"Speeder Bike": "Bike", "Landspeeder": "Car", "Skim Speeder": "Skimmer", "Podracer": "Plane"}
    kit_points = emojis.add("KitPoints", ui_icons / "T_UI_KitPoint_Icn.png")
    textures_ui = args.textures / "Griffin" / "Content" / "Griffin" / "UI" / "Library" / "Textures"
    # <action id="ImprovedSteering"/>: that action's button on each platform (IMC_Vehicle_Default / _Keyboard)
    glyphs = " / ".join("{emoji:" + input_glyph(p, b) + "}" for p, b in
                        (("playstation", "X/[]"), ("xbox", "X/[]"), ("keyboard", "SpaceBar")))
    action_text = lambda s: re.sub(r'<action id="ImprovedSteering"\s*/>', glyphs, s or "")

    vehicle_classes_out = []
    for cls_name, key in CLASS_KEY.items():
        traits = []
        for n in (1, 2, 3):
            name = vtext.get(f"Archetype_{key}_Trait0{n}_Name")
            if name:
                traits.append({"name": name, "description": rich_text(action_text(vtext.get(f"Archetype_{key}_Trait0{n}_Desc")))})
        vehicle_classes_out.append({
            "id": slug(cls_name),
            "name": cls_name,
            "description": rich_text(action_text(vtext.get(f"Archetype_{key}_Description"))),
            "traits": traits,
            "advanced": ADVANCED[cls_name],
            "gif": vehicle_classes[cls_name]["gif"],
        })

    kit_json = {p.stem[3:]: p for p in (game / "Vehicles").glob("**/TH_*.json")}
    kit_slots = {}
    for r in rows(out / "vehicle_parts.csv"):
        kit_slots.setdefault(r["kit"], []).append({"slot": r["slot_label"], "cost": num(r["cost"]) if r["cost"] else None})
    racer_rows = list(rows(out / "racer_vehicles.csv"))
    # rivals (not Shade, the player, nor the datamine's boss-race / aged duplicates)
    racer_names = {r["racer"] for r in racer_rows if " " in r["racer"] or r["racer"] in ("Sebulba", "Gasgano", "Autopilot")}
    pilot_art = textures_ui / "Content" / "Characters"

    vehicles_out = []
    for r in rows(out / "vehicles.csv"):
        if not r["Name"]:
            continue
        code = r["Codename"]
        th = next(iter(load_json(kit_json[code])), {}).get("Properties", {}) if code in kit_json else {}
        badge = (th.get("Thumbnail") or {}).get("AssetPathName")
        if r["Class"] == "Podracer":
            # the pilot's portrait (named by persona: Sebulba's pod is the "Nesodon" one)
            image = next((pilot_art / f"T_UI_PlaneChar_{x['persona']}_Thumb.png" for x in racer_rows
                          if code in x["kits"].split("+") and (pilot_art / f"T_UI_PlaneChar_{x['persona']}_Thumb.png").exists()), None)
            desc = re.sub(r"^<B>[^<]*</>\s*", "", vtext.get(f"Archetype_Plane_{code}_Desc", ""))
        else:
            image, desc = texture(args.textures, badge) if badge else None, ""
        if th.get("IsAvailableToPlayerByDefault"):
            unlock = "Owned from the start"
        elif (th.get("UnlockedBy") or {}).get("TagName", "").startswith("GlobalUnlock.Entl"):
            unlock = rich_text((th.get("LockReason") or {}).get("LocalizedString", ""))
        else:
            unlock = None
        aid = slug(r["Name"])
        vehicles_out.append({
            "id": aid,
            "name": r["Name"],
            "codename": code,
            "class": r["Class"],
            "manufacturer": r["Manufacturer"] or None,
            "kitPoints": num(r["Cost"]) if r["Cost"] else None,
            "unlock": unlock,
            "pilot": r["Pilot"] or None,
            "description": rich_text(desc) or None,
            "image": save_art(image, f"vehicles/{aid}.webp", max_size=256) if image and image.exists() else None,
            "parts": kit_slots.get(code, []) if r["Class"] != "Podracer" else [],  # podracers can't be customised
            "racers": sorted({x["racer"] for x in racer_rows if x["racer"] in racer_names and code in x["kits"].split("+")}),
            "events": [e["id"] for e in arcade if e["vehicle"] == r["Name"]],
        })
    vehicle_order = list(CLASS_KEY)
    vehicles_out.sort(key=lambda v: (vehicle_order.index(v["class"]), v["name"].lower()))

    # --- rivals ---
    # The 11 campaign rivals (CAM_Rivalry_<persona>) plus Kestar Bool, the champion. Each has a bio, an animated
    # hologram (the datamine's holo_<who> flipbook), a pool of Head-to-Head races, a favor and a livery palette for
    # beating them, the vehicles they race and the scenario named after them.
    bios = {r["Name"]: r for r in rows(out / "characters.csv")}
    liveries = json.loads((out / "liveries" / "liveries.json").read_text(encoding="utf-8"))
    track_by_name = {t["name"]: t["id"] for t in tracks}

    def palette_emoji(key, colors):
        """A livery palette as three rounded swatches, body colour first, like the garage's colour picker."""
        size, pad = 128, 6
        im = Image.new("RGBA", (size, size))
        draw = ImageDraw.Draw(im)
        w = (size - 2 * pad) // 3
        for i, c in enumerate(colors[:3]):
            draw.rounded_rectangle((pad + i * w + 2, pad + 14, pad + (i + 1) * w - 2, size - pad - 14), radius=10, fill=c)
        return emojis.add_image(f"pal_{key}"[:32], im)

    def head_to_head(spec):
        # "The War Fields (Loop, reverse) Sunset 2 laps x1"
        m = re.match(r"(.+?) \(([^)]*)\) (\S+) (\d+) laps", spec.strip())
        if not m:
            return None
        name, kind, condition, n = m.groups()
        return {"track": track_by_name.get(name), "name": name, "reverse": "reverse" in kind,
                "condition": condition.replace(".", " "), "laps": int(n)}

    rival_rows = list(rows(out / "gameplay" / "rivalries.csv"))
    rival_rows.append({"asset": "CAM_Rivalry_Antagonist", "rival": "Kestar Bool", "unlocked_by": "", "head_to_head_tracks": ""})
    rivals_out = []
    for r in rival_rows:
        name = r["rival"]
        persona = r["asset"].replace("CAM_Rivalry_", "")
        who = "goli" if name.startswith("Goli") else slug(name).replace("-", "_")
        rid = slug(name)
        pal = liveries["palettes"].get(f"Customisation.Livery.{persona}")
        favor = next((f for f in favors_out if f["key"] == persona), None)
        scenario = next((sc for sc in scenarios_out if sc["name"] == name), None)
        rivals_out.append({
            "id": rid,
            "name": name,
            "persona": persona,
            "champion": persona == "Antagonist",
            "bio": re.sub(r"\s+", " ", bios.get(name, {}).get("Bio", "")).strip() or None,
            "holo": save_flipbook_gif(args.datamine, f"holo_{who}", f"rivals/{rid}.gif", height=240),
            "afterTour2": "Unlock.Cam.Tour2Done" in r["unlocked_by"],
            "headToHead": [h for h in map(head_to_head, r["head_to_head_tracks"].split("|")) if h] if r["head_to_head_tracks"] else [],
            "favor": favor["id"] if favor else None,
            "livery": {"name": pal["name"], "colors": pal["colors"], "unlock": pal.get("unlock") or None,
                       "emoji": palette_emoji(persona, pal["colors"])} if pal else None,
            "vehicles": [v["id"] for v in vehicles_out if name in v["racers"]],
            "scenario": scenario["id"] if scenario else None,
        })
    rivals_out.sort(key=lambda x: (x["champion"], x["name"].lower()))

    for name, data in [("planets", planets), ("tracks", tracks),
                       ("arcade", {"categories": categories, "vehicleClasses": vehicle_classes, "events": arcade}),
                       ("scenarios", scenarios_out), ("styles", styles_out), ("parts", {"keywords": keywords_out, "parts": parts_out}),
                       ("abilities", {"families": ability_families, "abilities": abilities_out}),
                       ("vehicles", {"classes": vehicle_classes_out, "vehicles": vehicles_out, "kitPointsEmoji": kit_points}),
                       ("favors", favors_out), ("rivals", rivals_out)]:
        (DATA_OUT / f"{name}.json").write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    missing = [f"{e['name']} ({k})" for e in arcade for k in ("tile",) if not e[k]]
    missing += [f"{e['name']} / {x['name']} (icon)" for e in arcade for x in e["parts"] + e["abilities"] + e["build"] if not x["emoji"]]
    print(f"{len(emojis.by_name)} emoji icons in assets/emoji")
    missing += [f"{t['name']} (map)" for t in tracks if not t["map"]]
    missing += [f"{p['name']} (image)" for p in planets if not p["image"]]
    print(f"{len(planets)} planets, {len(tracks)} tracks, {len(arcade)} arcade events, {len(scenarios_out)} scenarios, {len(styles_out)} racer styles, {len(parts_out)} parts, {len(abilities_out)} abilities, {len(vehicles_out)} vehicles, {len(favors_out)} favors, {len(rivals_out)} rivals")
    if missing:
        print("missing art:", ", ".join(missing))


if __name__ == "__main__":
    main()
