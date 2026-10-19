"""Render the per-part passes that tools/preview/compose.py combines into a customised speeder preview.

    blender -b --python tools/preview/render_passes.py -- --class "Speeder Bike" [--kits Boa,Taipan] [--size 512]

Builds each vehicle of the class with the datamine's importer (../swgr-datamine/tools/blender_import_vehicle.py),
then renders every part on its own from one fixed camera per class. Within a class every part sits on the same
socket whatever kit it comes from, so parts rendered alone land where they would on any combination.

The importer's livery shading is linear in the paint colour (wear, grime and edge scuffs are mixes of it), so each
finish is rendered twice, with black and with white paint: any colour is then  black + colour * (white - black).
Finishes (metallic, roughness, as the importer's body_finish / PATINA_BODY): paint (0, 0.35), metal (1, 0.35;
All Steel, All Gold and Deluxe tint it), rust (0.3, 0.8). Every pixel also records, for livery surfaces, its
livery coordinate: the mesh's third UV map (UVMap.002, TEXCOORD_2), which the pattern SDFs are laid out on for
speeders as for podracers (checked against the garage: Ace02's teal band runs along the bike's side panel edge), so
compose.py can lay any pattern over any combination.

Writes assets/passes/<Class>/:
  <kit>_<part>_<finish>_<0|1>.png  16-bit RGBA, linear light x 1/4 (so highlights up to 4.0 fit), alpha = coverage
  <kit>_<part>_data.png            16-bit RGB: R, G = livery UV ((uv + 0.5) / 2), B = 1 on livery surfaces
  <kit>_<part>_depth.png           16-bit grey: camera distance mapped over the class's depth range
  passes.json                      camera, depth range, and each part's top-down bounds
"""
import importlib.util
import json
import math
import os
import sys

import bpy
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATAMINE = os.path.join(os.path.dirname(ROOT), "swgr-datamine")

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
opt = {"class": "Speeder Bike", "kits": "", "size": "512", "samples": "64"}
for i in range(0, len(args) - 1, 2):
    opt[args[i].lstrip("-")] = args[i + 1]
CLASS, SIZE, SAMPLES = opt["class"], int(opt["size"]), int(opt["samples"])
OUT = os.path.join(ROOT, "assets", "passes", CLASS.replace(" ", ""))
os.makedirs(OUT, exist_ok=True)

spec = importlib.util.spec_from_file_location("biv", os.path.join(DATAMINE, "tools", "blender_import_vehicle.py"))
biv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(biv)
biv.LIVERY_PATTERNS = False  # compose.py lays the patterns; the importer only marks which slots are livery

# Vehicle materials (MI_<Kit>Common_*), set from their own parameters. The importer sends them down its path for
# layered world props (they share LayerTintColor / U Tiling), which put the generic rusted-metal texture on as the
# base colour, fully metallic: tan pipes and frames, even on PaintedMetalBlack. The game's parameters say otherwise:
# painted metal, plastic, rubber, leather and fabric carry a real Base Colour, Metallic and Roughness Base. The bare
# metals (Nickel, Brass, Chrome...) leave Base Colour as the placeholder #FF0058 (their colour comes from a parent
# layer the export doesn't include), so they get these: muted, worn-looking metals as the game shows them, mid
# roughness, nudged for Smooth / Rough / Matt / Dirty names. Glass takes its Glass Colour, mostly see-through.
VEHICLE_METALS = [
    ("Brass", (0.34, 0.29, 0.19), 1.0, 0.45), ("Bronze", (0.30, 0.23, 0.16), 1.0, 0.5),
    ("Copper", (0.34, 0.22, 0.17), 1.0, 0.45), ("Nickel", (0.30, 0.30, 0.31), 1.0, 0.45),
    ("Chrome", (0.40, 0.40, 0.41), 1.0, 0.3), ("Aluminum", (0.36, 0.36, 0.37), 1.0, 0.45),
    ("Aluminium", (0.36, 0.36, 0.37), 1.0, 0.45), ("Magnesium", (0.33, 0.33, 0.34), 1.0, 0.5),
    ("Steel", (0.30, 0.30, 0.31), 1.0, 0.5),
]
_setup_material = biv.setup_material


def vehicle_material(mat):
    name = mat.name.split(".")[0]
    low = name.lower()
    src = biv.material_index().get(name)
    if mat.get("swgr_done") or not src or any(k in low for k in ("livery", "heat", "headlight", "emissive", "flipbook")):
        return _setup_material(mat)
    with open(src, encoding="utf-8") as fh:
        data = json.load(fh)
    cols, scal = data.get("Colors") or {}, data.get("Scalars") or {}
    glass = cols.get("Glass Colour")
    base = cols.get("Base Colour")
    if not glass and not (base and "Binder Colour" in cols):
        return _setup_material(mat)  # not a vehicle master material
    mat["swgr_done"] = True
    mat.use_nodes = True
    biv.strip_vertex_colors(mat)
    nt = mat.node_tree
    bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None) or nt.nodes.new("ShaderNodeBsdfPrincipled")
    for sock in ("Base Color", "Metallic", "Roughness"):
        for link in list(bsdf.inputs[sock].links):
            nt.links.remove(link)
    if glass:
        # its colour only as strong as its opacity (Opacity Max 0.4): a light amber, not a solid yellow
        k = float(scal.get("Opacity Max", 0.4))
        rgb, metallic, rough = tuple(1 - (1 - glass[c]) * k for c in "RGB"), 0.0, 0.05
        if "Transmission Weight" in bsdf.inputs:
            bsdf.inputs["Transmission Weight"].default_value = 0.95
    elif base["Hex"].upper() == "FF0058":
        rgb, metallic, rough = next(((c, m, r) for k, c, m, r in VEHICLE_METALS if k.lower() in low), ((0.30, 0.30, 0.31), 1.0, 0.5))
        if "smooth" in low or "polished" in low or "clean" in low:
            rough = max(rough - 0.15, 0.1)
        if "rough" in low or "matt" in low or "dirty" in low or "oxide" in low:
            rough = min(rough + 0.2, 0.9)
    else:
        rgb, metallic, rough = (base["R"], base["G"], base["B"]), float(scal.get("Metallic", 0)), float(scal.get("Roughness Base", 0.6))
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = rough
    mat.diffuse_color = (*rgb, 1.0)


biv.setup_material = vehicle_material  # import_vehicle looks it up in the module, so this takes its place
STUDIO = os.path.join(os.path.dirname(bpy.app.binary_path), f"{bpy.app.version[0]}.{bpy.app.version[1]}",
                      "datafiles", "studiolights", "world", "interior.exr")

FINISHES = {"paint": (0.0, 0.35), "metal": (1.0, 0.35), "rust": (0.3, 0.8)}
EXPOSURE = 0.25   # passes store linear light x EXPOSURE
UV_LO, UV_SPAN = -0.5, 2.0   # livery UV stored as (uv - UV_LO) / UV_SPAN, so a little outside 0-1 still fits


# ---------------------------------------------------------------- scene
def setup_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    for kind in ("OPTIX", "CUDA"):
        try:
            prefs.compute_device_type = kind
            prefs.get_devices()
            for d in prefs.devices:
                d.use = d.type != "CPU"
            sc.cycles.device = "GPU"
            break
        except Exception:
            continue
    sc.cycles.samples = SAMPLES
    sc.cycles.use_denoising = True
    sc.cycles.seed = 1  # the same noise in every render, so black / white differences are clean
    sc.render.resolution_x = sc.render.resolution_y = SIZE
    sc.render.film_transparent = True
    sc.view_settings.view_transform = "Raw"  # linear values straight to the file
    sc.view_settings.exposure = math.log2(EXPOSURE)
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_depth = "16"
    sc.render.image_settings.color_mode = "RGBA"
    # a soft studio: Blender's interior HDRI for light and something for metals to reflect (a flat sky left them
    # looking like glass), a warm key from front-left above, a cool rim from behind
    world = bpy.data.worlds.new("passes")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Strength"].default_value = 0.6
    if os.path.exists(STUDIO):
        env = world.node_tree.nodes.new("ShaderNodeTexEnvironment")
        env.image = bpy.data.images.load(STUDIO, check_existing=True)
        world.node_tree.links.new(env.outputs["Color"], bg.inputs["Color"])
    else:
        bg.inputs["Color"].default_value = (0.35, 0.36, 0.38, 1)
    sc.world = world
    for name, energy, rot, colour in (("key", 4.0, (math.radians(50), 0, math.radians(-40)), (1.0, 0.97, 0.92)),
                                      ("rim", 2.5, (math.radians(60), 0, math.radians(150)), (0.85, 0.9, 1.0))):
        light = bpy.data.lights.new(name, "SUN")
        light.energy, light.color, light.angle = energy, colour, math.radians(8)
        ob = bpy.data.objects.new(name, light)
        ob.rotation_euler = rot
        sc.collection.objects.link(ob)
    vl = sc.view_layers[0]
    vl.use_pass_z = True
    vl.aovs.add().name = "lv"
    return sc


def setup_compositor(sc):
    """data and depth go to their own 16-bit files; the image is the render's own output."""
    sc.use_nodes = True
    nt = sc.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    rl = nt.nodes.new("CompositorNodeRLayers")
    comp = nt.nodes.new("CompositorNodeComposite")
    nt.links.new(rl.outputs["Image"], comp.inputs["Image"])
    out = nt.nodes.new("CompositorNodeOutputFile")
    out.format.file_format, out.format.color_depth, out.format.color_mode = "PNG", "16", "RGB"
    # data, not light: written as is, without the scene's exposure
    out.format.color_management = "OVERRIDE"
    out.format.view_settings.view_transform = "Raw"
    out.format.view_settings.exposure = 0
    out.file_slots.clear()
    out.file_slots.new("data")
    out.file_slots.new("depth")
    nt.links.new(rl.outputs["lv"], out.inputs["data"])
    rng = nt.nodes.new("CompositorNodeMapRange")
    rng.use_clamp = True
    nt.links.new(rl.outputs["Depth"], rng.inputs["Value"])
    nt.links.new(rng.outputs["Value"], out.inputs["depth"])
    return out, rng


# ---------------------------------------------------------------- materials
def pass_material(root):
    """the livery surface for the passes: base colour, metallic and roughness from labelled nodes the render loop
    sets; an AOV with the livery UV (UVMap.002) and 1 for "this is livery"."""
    mat = bpy.data.materials.new("livery_pass")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    for label, kind, sock in (("P_BASE", "ShaderNodeRGB", "Base Color"), ("P_METAL", "ShaderNodeValue", "Metallic"),
                              ("P_ROUGH", "ShaderNodeValue", "Roughness")):
        n = nt.nodes.new(kind)
        n.label = label
        nt.links.new(n.outputs[0], bsdf.inputs[sock])
    uv = nt.nodes.new("ShaderNodeUVMap")
    uv.uv_map = "UVMap.002"
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(uv.outputs["UV"], sep.inputs[0])
    comb = nt.nodes.new("ShaderNodeCombineXYZ")
    for i, axis in enumerate("XY"):
        m = nt.nodes.new("ShaderNodeMath")
        m.operation = "MULTIPLY_ADD"
        m.inputs[1].default_value, m.inputs[2].default_value = 1 / UV_SPAN, -UV_LO / UV_SPAN
        nt.links.new(sep.outputs[axis], m.inputs[0])
        nt.links.new(m.outputs[0], comb.inputs[i])
    comb.inputs[2].default_value = 1.0
    aov = nt.nodes.new("ShaderNodeOutputAOV")
    aov.aov_name = "lv"
    nt.links.new(comb.outputs[0], aov.inputs["Color"])
    return mat


def set_finish(metallic, rough, base):
    for m in bpy.data.materials:
        if "livery_pass" in m.name and m.use_nodes:
            for n in m.node_tree.nodes:
                if n.label == "P_BASE":
                    n.outputs[0].default_value = (base, base, base, 1)
                elif n.label == "P_METAL":
                    n.outputs[0].default_value = metallic
                elif n.label == "P_ROUGH":
                    n.outputs[0].default_value = rough


def build(v):
    """the vehicle with its livery slots on the pass material, then the importer's wear on top."""
    for ob in list(bpy.data.objects):
        if ob.type != "LIGHT" and ob.type != "CAMERA":
            bpy.data.objects.remove(ob, do_unlink=True)
    for c in list(bpy.data.collections):
        bpy.data.collections.remove(c)
    wear, biv.WEAR = biv.WEAR, 0
    root = biv.import_vehicle(v, (0.0, 0.0, 0.0))
    biv.WEAR = wear
    coll = root.users_collection[0]
    mat = pass_material(root)
    for ob in coll.objects:
        if ob.type == "MESH":
            for sl in ob.material_slots:
                if sl.material and "livery" in sl.material.name.lower():
                    sl.material = mat
    biv.apply_wear(coll)  # copies livery_pass per part mask, keeping the labelled nodes
    return root, coll


def part_bounds(objs):
    pts = [ob.matrix_world @ Vector(c) for ob in objs if ob.type == "MESH" for c in ob.bound_box]
    return [min(p.x for p in pts), min(p.y for p in pts), max(p.x for p in pts), max(p.y for p in pts)] if pts else None


def place_camera(sc, meta):
    centre, radius = Vector(meta["camera"]["centre"]), meta["camera"]["radius"]
    cam_data = bpy.data.cameras.new("cam")
    cam_data.lens = 70
    cam = bpy.data.objects.new("cam", cam_data)
    sc.collection.objects.link(cam)
    sc.camera = cam
    direction = Vector((1.0, -1.15, 0.55)).normalized()
    dist = radius * 1.0 / math.tan(cam_data.angle / 2)
    cam.location = centre + direction * dist
    cam.rotation_euler = (centre - cam.location).to_track_quat("-Z", "Y").to_euler()
    return cam, dist, radius


def side_projection(root):
    """experiment: the livery projected from the side (X along the vehicle, Z up) instead of from above"""
    meshes = [o for o in root.users_collection[0].objects if o.type == "MESH"]
    pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
    mnx, mxx = min(p.x for p in pts), max(p.x for p in pts)
    mnz, mxz = min(p.z for p in pts), max(p.z for p in pts)
    for m in bpy.data.materials:
        if not m.use_nodes:
            continue
        nt = m.node_tree
        for mp in [n for n in nt.nodes if n.type == "MAPPING"]:
            src = mp.inputs["Vector"].links[0].from_socket if mp.inputs["Vector"].is_linked else None
            if not src or src.node.type != "TEX_COORD":
                continue
            sep = nt.nodes.new("ShaderNodeSeparateXYZ")
            comb = nt.nodes.new("ShaderNodeCombineXYZ")
            nt.links.new(src, sep.inputs[0])
            nt.links.new(sep.outputs["X"], comb.inputs["X"])
            nt.links.new(sep.outputs["Z"], comb.inputs["Y"])
            nt.links.new(comb.outputs[0], mp.inputs["Vector"])
            sx, sz = max(mxx - mnx, 1e-3), max(mxz - mnz, 1e-3)
            mp.inputs["Scale"].default_value = (1 / sx, 1 / sz, 0)
            mp.inputs["Location"].default_value = (-mnx / sx, -mnz / sz, 0)


def uv_projection(channel):
    """experiment: the livery through a UV map (UVMap.00<channel>) instead of the top-down projection"""
    name = "UVMap" if channel == "0" else f"UVMap.00{channel}"
    for m in bpy.data.materials:
        if not m.use_nodes:
            continue
        nt = m.node_tree
        for tex in [n for n in nt.nodes if n.type == "TEX_IMAGE" and n.image and "_SDF" in n.image.name]:
            uv = nt.nodes.new("ShaderNodeUVMap")
            uv.uv_map = name
            nt.links.new(uv.outputs["UV"], tex.inputs["Vector"])


def reference():
    """one combination the importer's own way (its livery material, patterns and wear), from the passes' camera and
    lights: what compose.py's output is checked against.  --reference Boa --part Front=Taipan --palette Nomad ..."""
    meta = json.load(open(os.path.join(OUT, "passes.json"), encoding="utf-8"))
    with open(biv.LAYOUTS, encoding="utf-8") as fh:
        v = next(x for x in json.load(fh)["vehicles"] if x["codename"].lower() == opt["reference"].lower())
    biv.LIVERY_PATTERNS = True
    biv.PALETTE, biv.PATTERN, biv.PATINA = opt.get("palette", ""), opt.get("pattern", ""), opt.get("patina", "")
    for p in [a for a in opt.get("parts", "").split(",") if a]:
        slot, kit = p.split("=")
        biv.PARTS[slot] = kit
    sc = setup_scene()
    sc.use_nodes = False
    sc.view_settings.view_transform, sc.view_settings.exposure = "Standard", 0
    sc.render.image_settings.color_depth = "8"
    place_camera(sc, meta)
    root = biv.import_vehicle(v, (0.0, 0.0, 0.0))
    if opt.get("projection") == "side":
        side_projection(root)
    elif opt.get("projection", "uv2").startswith("uv"):  # the game lays speeder liveries out on UV2 (the importer projects them top-down)
        uv_projection(opt.get("projection", "uv2")[2:])
    sc.render.filepath = os.path.join(OUT, opt.get("out", "reference.png"))
    bpy.ops.render.render(write_still=True)
    print("wrote", sc.render.filepath)


# ---------------------------------------------------------------- main
def main():
    if opt.get("reference"):
        return reference()
    with open(biv.LAYOUTS, encoding="utf-8") as fh:
        vehicles = [v for v in json.load(fh)["vehicles"] if v["class"] == CLASS]
    if opt["kits"]:
        want = {k.strip().lower() for k in opt["kits"].split(",")}
        vehicles = [v for v in vehicles if v["codename"].lower() in want or v["name"].lower() in want]
    sc = setup_scene()
    out, depth_range = setup_compositor(sc)
    meta_path = os.path.join(OUT, "passes.json")
    meta = json.load(open(meta_path, encoding="utf-8")) if os.path.exists(meta_path) else {"parts": {}}
    cam = None
    for v in vehicles:
        root, coll = build(v)
        meshes = [o for o in coll.objects if o.type == "MESH"]
        if cam is None:
            # one camera for the class, framed on this first vehicle with room to spare; a 3/4 view from front-left
            pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
            lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
            hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
            centre, radius = (lo + hi) / 2, (hi - lo).length / 2
            meta.setdefault("camera", {"centre": list(centre), "radius": radius})
            cam, dist, radius = place_camera(sc, meta)
            near, far = dist - radius * 1.5, dist + radius * 1.5
            meta["depth"] = [near, far]
            depth_range.inputs["From Min"].default_value, depth_range.inputs["From Max"].default_value = near, far
        parts = {}
        for ob in meshes:
            parts.setdefault(ob.get("swgr_part", "?"), []).append(ob)
        for part, objs in parts.items():
            for ob in meshes:
                # each part alone: leaving the rest of its kit in as unseen shadow casters left its shadows behind
                # when those parts were swapped out (a black face on Kingsnake's controls beside another front);
                # compose.py adds contact shadows from the actual combination instead
                ob.hide_render = ob not in objs
            name = f"{v['codename']}_{part}"
            meta["parts"][name] = {"kit": v["codename"], "part": part, "bounds": part_bounds(objs)}
            first = True
            for finish, (metal, rough) in FINISHES.items():
                for base in (0, 1):
                    set_finish(metal, rough, base)
                    out.base_path = os.path.join(OUT, "_tmp")
                    sc.render.filepath = os.path.join(OUT, f"{name}_{finish}_{base}.png")
                    bpy.ops.render.render(write_still=True)
                    tmp = os.path.join(OUT, "_tmp")
                    for slot in ("data", "depth"):
                        src = os.path.join(tmp, f"{slot}{sc.frame_current:04d}.png")
                        if first and os.path.exists(src):
                            os.replace(src, os.path.join(OUT, f"{name}_{slot}.png"))
                    first = False
            print(f"rendered {name}")
        with open(meta_path, "w", encoding="utf-8") as fh:
            json.dump(meta, fh, indent=1)


main()
