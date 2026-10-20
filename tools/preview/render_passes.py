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
  <kit>_<part>_patina.png          16-bit RGB: R, G = each mesh's PatinaUV (where it reads the patina grid), B = 1 on
                                   livery surfaces (--patina-only renders just these, for passes made before them)
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
# layer the export doesn't include), so they get these, matched by eye to the garage (golden brass pipes and bright
# steel cages on the ARZ 41, champagne nickel pipes on the Napaco D), mid roughness, nudged for Smooth / Rough / Matt / Dirty names. Glass takes its Glass Colour, mostly see-through.
VEHICLE_METALS = [
    ("Brass", (0.55, 0.43, 0.20), 1.0, 0.4), ("Bronze", (0.45, 0.31, 0.18), 1.0, 0.45),
    ("Copper", (0.52, 0.33, 0.24), 1.0, 0.4), ("Nickel", (0.50, 0.44, 0.36), 1.0, 0.4),
    ("Chrome", (0.56, 0.56, 0.57), 1.0, 0.25), ("Aluminum", (0.50, 0.50, 0.51), 1.0, 0.4),
    ("Aluminium", (0.50, 0.50, 0.51), 1.0, 0.4), ("Magnesium", (0.42, 0.42, 0.43), 1.0, 0.45),
    ("Steel", (0.40, 0.40, 0.41), 1.0, 0.45),
    # the engines' heat-tinted metal (MI_*Common_Heat*): the importer's preset was a purple that read as magenta
    ("Heat", (0.36, 0.35, 0.37), 1.0, 0.4),
]
_setup_material = biv.setup_material


def vehicle_material(mat):
    name = mat.name.split(".")[0]
    low = name.lower()
    src = biv.material_index().get(name)
    if mat.get("swgr_done") or not src or any(k in low for k in ("livery", "headlight", "emissive", "flipbook")):
        return _setup_material(mat)
    with open(src, encoding="utf-8") as fh:
        data = json.load(fh)
    cols, scal = data.get("Colors") or {}, data.get("Scalars") or {}
    glass = cols.get("Glass Colour")
    base = cols.get("Base Colour")
    metal = next(((c, m, r) for k, c, m, r in VEHICLE_METALS if k.lower() in low), None)
    vehicle = "/Vehicles/" in src.replace("\\", "/")
    if not vehicle or not (glass or base or metal):
        return _setup_material(mat)  # not a vehicle material, or nothing to go on
    mat["swgr_done"] = True
    mat.use_nodes = True
    biv.strip_vertex_colors(mat)
    nt = mat.node_tree
    bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None) or nt.nodes.new("ShaderNodeBsdfPrincipled")
    for sock in ("Base Color", "Metallic", "Roughness"):
        for link in list(bsdf.inputs[sock].links):
            nt.links.remove(link)
    if glass:
        # its colour at half its opacity (Opacity Max 0.4): the garage's windscreens are nearly clear, tinted at the edge
        k = float(scal.get("Opacity Max", 0.4)) / 2
        rgb, metallic, rough = tuple(1 - (1 - glass[c]) * k for c in "RGB"), 0.0, 0.05
        if "Transmission Weight" in bsdf.inputs:
            bsdf.inputs["Transmission Weight"].default_value = 0.95
    elif not base or base["Hex"].upper() == "FF0058":
        rgb, metallic, rough = metal or ((0.30, 0.30, 0.31), 1.0, 0.5)
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
    vl.aovs.add().name = "pt"
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
    out.file_slots.new("patina")
    nt.links.new(rl.outputs["lv"], out.inputs["data"])
    nt.links.new(rl.outputs["pt"], out.inputs["patina"])
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
    # the mesh's PatinaUV (set on each object by build()): where it reads the patina grid
    pt = nt.nodes.new("ShaderNodeAttribute")
    pt.attribute_type, pt.attribute_name = "OBJECT", "swgr_patina_uv"
    pt_aov = nt.nodes.new("ShaderNodeOutputAOV")
    pt_aov.aov_name = "pt"
    nt.links.new(pt.outputs["Color"], pt_aov.inputs["Color"])
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


_patina_uv = {}


def patina_uv(mesh_path):
    """A mesh's PatinaUV (its StaticMesh's PatinaUserData; SwgrDump dump .../Customisation --match "^SM_"): where it
    samples the patina grid, one finish for the whole mesh (a part's base mesh and each panel apart). (0, 0) when
    it has none."""
    if mesh_path not in _patina_uv:
        rel = os.path.relpath(os.path.splitext(mesh_path)[0], biv.EXPORT_ROOT)
        js = os.path.join(DATAMINE, "out", "json", rel + ".json")
        uv = (0.0, 0.0)
        if os.path.exists(js):
            for o in json.load(open(js, encoding="utf-8")):
                if o.get("Type") == "PatinaUserData":  # no properties: left at its default, (0, 0)
                    p = (o.get("Properties") or {}).get("PatinaUV") or {}
                    uv = (p.get("X", 0.0), p.get("Y", 0.0))
        _patina_uv[mesh_path] = uv
    return _patina_uv[mesh_path]


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
            ob["swgr_patina_uv"] = (*patina_uv(ob.get("swgr_mesh_path", "")), 1.0)
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


def frame_class(sc, vehicles, margin=0.03):
    """the class's camera framed on every kit at once: place_camera's direction, its centre and distance fitted (a few
    rounds of projecting every vertex) so the whole of each vehicle lands inside the frame with a margin on the
    tightest side. Framing on one vehicle left bigger kits cut off at the edge (the Napaco D's nose)."""
    import numpy as np
    pts = []
    for v in vehicles:
        root, coll = build(v)
        dg = bpy.context.evaluated_depsgraph_get()
        for ob in coll.objects:
            if ob.type != "MESH":
                continue
            me = ob.evaluated_get(dg).data
            co = np.empty(len(me.vertices) * 3, dtype=np.float64)
            me.vertices.foreach_get("co", co)
            co = co.reshape(-1, 3)
            mw = np.array(ob.matrix_world)
            w = co @ mw[:3, :3].T + mw[:3, 3]
            pts.append(w)
    pts = np.concatenate(pts)
    print("frame points", len(pts), "non-finite", int((~np.isfinite(pts).all(1)).sum()), flush=True)
    pts = pts[np.isfinite(pts).all(1)]
    lo, hi = pts.min(0), pts.max(0)
    meta = {"camera": {"centre": list((lo + hi) / 2), "radius": float(np.linalg.norm(hi - lo) / 2)}}
    cam, dist, _ = place_camera(sc, meta)
    t = math.tan(cam.data.angle / 2)
    for _ in range(8):
        bpy.context.view_layer.update()  # a new camera's matrix_world is identity until then
        inv = np.array(cam.matrix_world.inverted())
        c = pts @ inv[:3, :3].T + inv[:3, 3]
        x, y = c[:, 0] / (-c[:, 2] * 2 * t), c[:, 1] / (-c[:, 2] * 2 * t)  # -0.5..0.5 across the frame
        print("frame round", round(dist, 3), float(x.min()), float(x.max()), float(y.min()), float(y.max()),
              float(c[:, 2].max()), flush=True)
        xmid, ymid = (x.min() + x.max()) / 2, (y.min() + y.max()) / 2
        extent = max(x.max() - x.min(), y.max() - y.min())
        right, up = cam.matrix_world.to_3x3() @ Vector((1, 0, 0)), cam.matrix_world.to_3x3() @ Vector((0, 1, 0))
        centre = Vector(meta["camera"]["centre"]) + (right * xmid + up * ymid) * 2 * dist * t
        dist *= extent / (1 - 2 * margin)
        meta["camera"] = {"centre": list(centre), "radius": dist * t}  # place_camera's dist = radius / tan(angle / 2)
        bpy.data.objects.remove(cam, do_unlink=True)
        cam, dist, _ = place_camera(sc, meta)
    print("framed", len(vehicles), "kits:", meta["camera"])
    return meta["camera"]


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


def debug_patina(root, patina):
    """experiment: each mesh's livery surfaces flat in the finish its PatinaUV picks from a patina (an id in
    src/data/swgr/liveries.json: column floor(n x), row floor(n y), as preview.js does). Paint dark grey, rust orange,
    steel light."""
    p = next(p for p in json.load(open(os.path.join(ROOT, "src", "data", "swgr", "liveries.json"), encoding="utf-8"))["patinas"]
             if p["id"] == patina)
    grid = p.get("grid") or [p.get("finish") or "paint"]
    n = round(len(grid) ** 0.5)
    colours = {"paint": (0.06, 0.06, 0.07), "rust": (0.5, 0.16, 0.03), "metal": (0.8, 0.8, 0.82)}
    mats = {}
    for f, rgb in colours.items():
        m = bpy.data.materials.new(f"finish_{f}")
        m.use_nodes = True
        b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        b.inputs["Base Color"].default_value = (*rgb, 1)
        b.inputs["Roughness"].default_value = 0.6
        mats[f] = m
    at = lambda x: min(n - 1, max(0, round(x * (n - 1))))
    for ob in root.users_collection[0].objects:
        if ob.type != "MESH":
            continue
        x, y = patina_uv(ob.get("swgr_mesh_path", ""))
        livery = [sl for sl in ob.material_slots if sl.material and "livery" in sl.material.name.lower()]
        for sl in livery:
            sl.material = mats[grid[at(y) * n + at(x)]]
        if livery:
            _labels.append((ob, "%s %.3f %.3f %d,%d %s" % (os.path.basename(ob.get("swgr_mesh_path", "?")), x, y, at(x), at(y),
                                                        grid[at(y) * n + at(x)])))


_labels = []


def print_labels(sc):
    """after the camera is set: each labelled mesh's centre in the image (0-1, y down) and its label"""
    from bpy_extras.object_utils import world_to_camera_view
    dg = bpy.context.evaluated_depsgraph_get()
    for ob, text in _labels:
        e = ob.evaluated_get(dg)
        vs = [e.matrix_world @ v.co for v in e.data.vertices]
        c = sum(vs, Vector()) / max(1, len(vs))
        p = world_to_camera_view(sc, sc.camera, c)
        print("LBL %.4f %.4f %s" % (p.x, 1 - p.y, text))


def top_camera(sc, meta):
    """experiment: a camera high above the vehicle, nose to the right and tilted a little, like the garage's patina shots"""
    centre, radius = Vector(meta["camera"]["centre"]), meta["camera"]["radius"]
    cam = sc.camera
    d = [float(v) for v in opt.get("cam", "0.45,-0.9,0.95,1.25").split(",")]
    direction = Vector(d[:3]).normalized()
    cam.location = centre + direction * radius * d[3] / math.tan(cam.data.angle / 2)
    cam.rotation_euler = (centre - cam.location).to_track_quat("-Z", "Y").to_euler()


def debug_ids(root, sc):
    """experiment: every livery mesh flat (emission, Standard view) in a colour coding its index: R = 8 * (index + 1);
    prints "ID index mesh u v"; everything else black"""
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    sc.view_settings.exposure, sc.view_settings.gamma = 0, 1
    sc.cycles.use_denoising = False
    sc.world.use_nodes = False
    sc.world.color = (0, 0, 0)
    black = bpy.data.materials.new("id_black")
    k = 0
    for ob in root.users_collection[0].objects:
        if ob.type != "MESH":
            continue
        livery = any(sl.material and "livery" in sl.material.name.lower() for sl in ob.material_slots)
        mat = black
        if livery:
            mat = bpy.data.materials.new(f"id_{k}")
            mat.use_nodes = True
            nt = mat.node_tree
            nt.nodes.clear()
            em = nt.nodes.new("ShaderNodeEmission")
            c = (k + 1) * 8 / 255
            em.inputs["Color"].default_value = (c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4, 0, 0, 1)
            o = nt.nodes.new("ShaderNodeOutputMaterial")
            nt.links.new(em.outputs[0], o.inputs[0])
            print("ID", k, os.path.basename(ob.get("swgr_mesh_path", "?")), "%.4f %.4f" % patina_uv(ob.get("swgr_mesh_path", "")))
            k += 1
        for sl in ob.material_slots:
            sl.material = mat


def debug_materials(spec):
    """experiment: flat colours for the materials whose names contain each key: spec "Nickel:00ff00,Brass:ffff00" """
    for item in spec.split(","):
        key, hexc = item.split(":")
        rgb = tuple(int(hexc[i:i + 2], 16) / 255 for i in (0, 2, 4))
        for m in bpy.data.materials:
            if key.lower() in m.name.lower() and m.use_nodes:
                b = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
                if b:
                    for sock in ("Base Color", "Metallic"):
                        for l in list(b.inputs[sock].links):
                            m.node_tree.links.remove(l)
                    b.inputs["Base Color"].default_value = (*rgb, 1)
                    b.inputs["Metallic"].default_value = 0


def debug_meshes(root):
    """experiment: every mesh's livery surfaces in its own colour; prints mesh, colour and PatinaUV"""
    import colorsys
    obs = [o for o in root.users_collection[0].objects if o.type == "MESH" and any(
        sl.material and "livery" in sl.material.name.lower() for sl in o.material_slots)]
    for k, ob in enumerate(obs):
        rgb = colorsys.hsv_to_rgb((k * 0.618) % 1, 0.85, 0.95)
        mat = bpy.data.materials.new(f"mesh_{k}")
        mat.use_nodes = True
        b = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        b.inputs["Base Color"].default_value = (*rgb, 1)
        for sl in ob.material_slots:
            if sl.material and "livery" in sl.material.name.lower():
                sl.material = mat
        print("MESH", k, os.path.basename(ob.get("swgr_mesh_path", "?")), "#%02X%02X%02X" % tuple(round(c * 255) for c in rgb),
              "uv %.3f %.3f" % patina_uv(ob.get("swgr_mesh_path", "")))


def debug_parts(root):
    """experiment: every part in its own flat colour, its name printed with the colour"""
    import colorsys
    obs = [o for o in root.users_collection[0].objects if o.type == "MESH"]
    parts = sorted({o.get("swgr_part", "?") for o in obs})
    for k, part in enumerate(parts):
        rgb = colorsys.hsv_to_rgb(k / len(parts), 0.8, 0.9)
        print("PART", part, "#%02X%02X%02X" % tuple(round(c * 255) for c in rgb))
        mat = bpy.data.materials.new(f"part_{part}")
        mat.use_nodes = True
        b = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        b.inputs["Base Color"].default_value = (*rgb, 1)
        for o in obs:
            if o.get("swgr_part") == part:
                for sl in o.material_slots:
                    if sl.material and "livery" in sl.material.name.lower():
                        sl.material = mat


def debug_region():
    """experiment: livery surfaces coloured by their vertex colour's red channel (the patina region?): blue below
    0.25, orange from there to 0.75, white above"""
    for m in bpy.data.materials:
        if not m.use_nodes or "livery" not in m.name.lower():
            continue
        nt = m.node_tree
        bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if not bsdf:
            continue
        mode = opt["debug-region"]
        sep = nt.nodes.new("ShaderNodeSeparateColor")
        if mode.startswith("uv"):
            # the 4x4 cell of UVMap.00<n> each surface sits in, as a checker: red = (floor(4u) + floor(4v)) mod 2
            uv = nt.nodes.new("ShaderNodeUVMap")
            uv.uv_map = f"UVMap.00{mode[2:]}"
            xyz = nt.nodes.new("ShaderNodeSeparateXYZ")
            nt.links.new(uv.outputs["UV"], xyz.inputs[0])
            fl = []
            for axis in "XY":
                mul = nt.nodes.new("ShaderNodeMath"); mul.operation = "MULTIPLY"; mul.inputs[1].default_value = 4
                nt.links.new(xyz.outputs[axis], mul.inputs[0])
                f = nt.nodes.new("ShaderNodeMath"); f.operation = "FLOOR"
                nt.links.new(mul.outputs[0], f.inputs[0])
                fl.append(f)
            add = nt.nodes.new("ShaderNodeMath"); add.operation = "ADD"
            nt.links.new(fl[0].outputs[0], add.inputs[0]); nt.links.new(fl[1].outputs[0], add.inputs[1])
            mod = nt.nodes.new("ShaderNodeMath"); mod.operation = "FLOORED_MODULO"; mod.inputs[1].default_value = 2
            nt.links.new(add.outputs[0], mod.inputs[0])
            half = nt.nodes.new("ShaderNodeMath"); half.operation = "MULTIPLY"; half.inputs[1].default_value = 0.5
            nt.links.new(mod.outputs[0], half.inputs[0])
            comb = nt.nodes.new("ShaderNodeCombineColor")
            nt.links.new(half.outputs[0], comb.inputs["Red"])
            nt.links.new(comb.outputs[0], sep.inputs["Color"])
        elif mode.startswith("grid"):
            # the Mix patina's 4x4 table (T_PatinaMix: 0 paint, 105 rust, 255 steel), sampled nearest through
            # UVMap(.00<n>): paint dark grey, rust orange, steel light
            n, which = mode[4], mode[5:] or "mix"
            uv = nt.nodes.new("ShaderNodeUVMap")
            uv.uv_map = "UVMap" if n == "0" else f"UVMap.00{n}"
            img = bpy.data.images.get(f"patina_{which}_debug")
            if img is None:
                grid = ([[105, 255, 105, 255]] * 4 if which.startswith("checker") else
                        [[255, 105, 0, 255], [105, 0, 255, 105], [0, 0, 255, 105], [0, 255, 105, 0]])
                colour = {0: (0.08, 0.08, 0.09), 105: (0.45, 0.15, 0.04), 255: (0.75, 0.75, 0.76)}
                img = bpy.data.images.new(f"patina_{which}_debug", 4, 4)
                px = []
                flip = which.endswith("flip")
                for y in range(4):  # Blender rows run bottom-up; the texture's first row is its top
                    for x in range(4):
                        px += [*colour[grid[y if flip else 3 - y][x]], 1.0]
                img.pixels = px
            tex = nt.nodes.new("ShaderNodeTexImage")
            tex.image, tex.interpolation, tex.extension = img, "Closest", "REPEAT"
            nt.links.new(uv.outputs["UV"], tex.inputs["Vector"])
            for link in list(bsdf.inputs["Base Color"].links):
                nt.links.remove(link)
            nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
            bsdf.inputs["Metallic"].default_value = 0
            continue
        elif mode == "mask":
            # the part's baked mask (wear_material's T_<Part>_U on UV0): blue and green as they are, red = 0
            tex = next((n for n in nt.nodes if n.type == "TEX_IMAGE" and n.image and n.image.name.endswith("_U.png")), None)
            if not tex:
                continue
            msep = nt.nodes.new("ShaderNodeSeparateColor")
            nt.links.new(tex.outputs["Color"], msep.inputs["Color"])
            comb = nt.nodes.new("ShaderNodeCombineColor")
            nt.links.new(msep.outputs["Green"], comb.inputs["Green"])
            nt.links.new(msep.outputs["Blue"], comb.inputs["Blue"])
            for link in list(bsdf.inputs["Base Color"].links):
                nt.links.remove(link)
            nt.links.new(comb.outputs[0], bsdf.inputs["Base Color"])
            bsdf.inputs["Metallic"].default_value = 0
            if "Emission Color" in bsdf.inputs:
                nt.links.new(comb.outputs[0], bsdf.inputs["Emission Color"])
                bsdf.inputs["Emission Strength"].default_value = 0.6
            continue
        else:
            attr = nt.nodes.new("ShaderNodeVertexColor")
            nt.links.new(attr.outputs["Color"], sep.inputs["Color"])
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.interpolation = "CONSTANT"
        els = ramp.color_ramp.elements
        els[0].position, els[0].color = 0.0, (0.05, 0.2, 0.9, 1)
        els[1].position, els[1].color = 0.25, (0.9, 0.35, 0.05, 1)
        e = els.new(0.75)
        e.color = (1, 1, 1, 1)
        nt.links.new(sep.outputs["Red"], ramp.inputs["Fac"])
        for link in list(bsdf.inputs["Base Color"].links):
            nt.links.remove(link)
        nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
        bsdf.inputs["Metallic"].default_value = 0


def patina_cell(patina, uv):
    """the finish ("paint" / "rust" / "metal") a mesh at PatinaUV uv takes under a patina id (src/data/swgr/liveries.json):
    the grid's nearest texel, round(u (n - 1)), as preview.js does"""
    p = next(p for p in json.load(open(os.path.join(ROOT, "src", "data", "swgr", "liveries.json"), encoding="utf-8"))["patinas"]
             if p["id"] == patina)
    grid = p.get("grid") or [p.get("finish") or "paint"]
    n = round(len(grid) ** 0.5)
    at = lambda x: min(n - 1, max(0, round(x * (n - 1))))
    return grid[at(uv[1]) * n + at(uv[0])]


def patina_reference(v, patina):
    """the importer's own look under a mixed patina: the vehicle imported once per finish (All Paint / Rust / Steel),
    each livery mesh kept from the import of the finish its cell picks, everything else from the paint one"""
    roots = []
    for f, tag in (("paint", "AllPaint"), ("rust", "AllRust"), ("metal", "AllSteel")):
        biv.PATINA = tag
        root = biv.import_vehicle(v, (0.0, 0.0, 0.0))
        roots.append(root)
        for ob in list(root.users_collection[0].objects):
            if ob.type != "MESH":
                continue
            livery = any(sl.material and "livery" in sl.material.name.lower() for sl in ob.material_slots)
            keep = patina_cell(patina, patina_uv(ob.get("swgr_mesh_path", ""))) == f if livery else f == "paint"
            if not keep:
                bpy.data.objects.remove(ob, do_unlink=True)
    return roots[0]


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
    if opt.get("patina-grid"):
        root = patina_reference(v, opt["patina-grid"])
    else:
        root = biv.import_vehicle(v, (0.0, 0.0, 0.0))
    if opt.get("view") == "top":
        top_camera(sc, meta)
    if opt.get("debug-patina"):
        debug_patina(root, opt["debug-patina"])
        print_labels(sc)
    elif opt.get("debug-parts"):
        debug_parts(root)
    elif opt.get("debug-materials"):
        debug_materials(opt["debug-materials"])
    elif opt.get("debug-ids"):
        debug_ids(root, sc)
    elif opt.get("debug-meshes"):
        debug_meshes(root)
    elif opt.get("debug-region"):
        debug_region()
    elif opt.get("projection") == "side":
        side_projection(root)
    elif opt.get("projection", "uv2").startswith("uv"):  # the game lays speeder liveries out on UV2 (the importer projects them top-down)
        uv_projection(opt.get("projection", "uv2")[2:])
    sc.render.filepath = os.path.join(OUT, opt.get("out", "reference.png"))
    bpy.ops.render.render(write_still=True)
    print("wrote", sc.render.filepath)


def socket_groups():
    """Parts whose socket depends on another slot's kit: the bike's rear engine (EngineB) hangs off the front engine
    (EngineC), at one of four heights. -> {child slot: {"parent": slot, "groups": {parent kit: group's first kit}}}"""
    lib = biv.parts_library().get(biv.CLASS_KEY.get(CLASS, CLASS), {})
    out = {}
    for parent, opts in lib.get("slots", {}).items():
        for child in {k for o in opts for k in (o.get("attach") or {})}:
            groups = {}
            for o in opts:
                m = (o.get("attach") or {}).get(child)
                if m:
                    groups.setdefault(tuple(round(m[i]) for i in (3, 7, 11)), []).append(o["kit"])
            if len(groups) > 1:
                out[child] = {"parent": parent, "groups": {k: kits[0] for kits in groups.values() for k in kits}}
    return out


def render_part(sc, out, meshes, objs, name):
    """one part alone, every finish with black and white paint, plus its data and depth"""
    for ob in meshes:
        # each part alone: leaving the rest of its kit in as unseen shadow casters left its shadows behind
        # when those parts were swapped out (a black face on Kingsnake's controls beside another front);
        # compose.py adds contact shadows from the actual combination instead
        ob.hide_render = ob not in objs
    if opt.get("patina-only"):
        # just the patina pass (each mesh's PatinaUV), added after the rest were rendered: one quick render
        sc.cycles.samples = 16
        out.base_path = os.path.join(OUT, "_tmp")
        sc.render.filepath = os.path.join(OUT, "_tmp", "image.png")
        bpy.ops.render.render(write_still=True)
        src = os.path.join(OUT, "_tmp", f"patina{sc.frame_current:04d}.png")
        if os.path.exists(src):
            os.replace(src, os.path.join(OUT, f"{name}_patina.png"))
        print(f"rendered {name} patina")
        return
    first = True
    for finish, (metal, rough) in FINISHES.items():
        for base in (0, 1):
            set_finish(metal, rough, base)
            out.base_path = os.path.join(OUT, "_tmp")
            sc.render.filepath = os.path.join(OUT, f"{name}_{finish}_{base}.png")
            bpy.ops.render.render(write_still=True)
            tmp = os.path.join(OUT, "_tmp")
            for slot in ("data", "depth", "patina"):
                src = os.path.join(tmp, f"{slot}{sc.frame_current:04d}.png")
                if first and os.path.exists(src):
                    os.replace(src, os.path.join(OUT, f"{name}_{slot}.png"))
            first = False
    print(f"rendered {name}")


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
    if not opt["kits"]:
        meta["camera"] = frame_class(sc, vehicles)
        if opt.get("frame-only"):
            return  # a --kits run keeps the class's camera, so its parts still fit
    cam = None
    for v in vehicles:
        root, coll = build(v)
        meshes = [o for o in coll.objects if o.type == "MESH"]
        if cam is None:
            # one camera for the class (frame_class's, else framed on this first vehicle); a 3/4 view from front-left
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
            name = f"{v['codename']}_{part}"
            meta["parts"][name] = {"kit": v["codename"], "part": part, "bounds": part_bounds(objs)}
            render_part(sc, out, meshes, objs, name)
        with open(meta_path, "w", encoding="utf-8") as fh:
            json.dump(meta, fh, indent=1)

    # Parts on a socket that moves with another slot's kit, rendered once more for each other position:
    # <kit>_<part>@<group kit>, the group kit being the first parent kit with that socket (compose picks by meta["sockets"])
    sockets = socket_groups()
    meta["sockets"] = sockets
    for v in vehicles:
        for child, sk in sockets.items():
            own = sk["groups"].get(v["codename"])
            for group in sorted(set(sk["groups"].values()) - {own}):
                biv.PARTS.clear()
                biv.PARTS[sk["parent"]] = group
                root, coll = build(v)
                meshes = [o for o in coll.objects if o.type == "MESH"]
                objs = [o for o in meshes if o.get("swgr_part") == child]
                name = f"{v['codename']}_{child}@{group}"
                meta["parts"][name] = {"kit": v["codename"], "part": child, "socket": group, "bounds": part_bounds(objs)}
                render_part(sc, out, meshes, objs, name)
        biv.PARTS.clear()
        with open(meta_path, "w", encoding="utf-8") as fh:
            json.dump(meta, fh, indent=1)
    with open(meta_path, "w", encoding="utf-8") as fh:
        json.dump(meta, fh, indent=1)


main()
