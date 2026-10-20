// Customised speeder previews, composed from per-part render passes (tools/preview/render_passes.py; the Python
// original of this is tools/preview/compose.py, checked there against full Blender renders).
//
// Every part of a class is rendered alone from one camera (parts sit on the same sockets whatever kit they're from),
// with black and with white paint for each finish (paint, metal, rust): the shading is linear in the paint colour,
// so any colour is  black + colour * (white - black). A data pass gives each livery pixel its livery UV (the mesh's
// third UV map, which the game lays the pattern SDFs out on), where the pattern is sampled. Parts are then stacked front
// to back by depth, with contact shadows between them. Passes are 16-bit PNGs: light x 1/4 (EXPOSURE), alpha = coverage.
const fs = require('fs')
const path = require('path')
const { PNG } = require('pngjs')
const data = require('./data.js')

const ROOT = path.join(__dirname, '../..')
const EXPOSURE = 0.25, UV_LO = -0.5, UV_SPAN = 2
const passDir = cls => path.join(ROOT, 'assets', 'passes', cls.replace(/ /g, ''))
const metaCache = {}
const meta = cls => metaCache[cls] ??= JSON.parse(fs.readFileSync(path.join(passDir(cls), 'passes.json'), 'utf8'))

// Classes with passes rendered (only these can be customised for now)
const classes = () => data.classes.map(c => c.name).filter(n => fs.existsSync(path.join(passDir(n), 'passes.json')))

// Decoded passes, least recently used dropped first, kept under CACHE_BYTES (each is ~4.7 MB at 768 x 768 RGBA 16-bit and
// a preview reads ~40; the Heroku Basic dyno has 512 MB in all)
const cache = new Map()
const CACHE_BYTES = (Number(process.env.PREVIEW_CACHE_MB) || 80) * 1024 * 1024
let cached = 0
function pass(cls, name) {
    const key = `${cls}/${name}`
    let img = cache.get(key)
    if (img) {
        cache.delete(key)
    } else {
        const png = PNG.sync.read(fs.readFileSync(path.join(passDir(cls), `${name}.png`)), { skipRescale: true })
        const channels = png.data.length / (png.width * png.height)
        img = { w: png.width, h: png.height, channels, data: png.data, max: png.depth == 16 ? 65535 : 255 }
        cached += img.data.byteLength
        while (cached > CACHE_BYTES && cache.size) {
            const [oldest, old] = cache.entries().next().value
            cache.delete(oldest)
            cached -= old.data.byteLength
        }
    }
    cache.set(key, img)
    return img
}
const sdfCache = new Map()
function sdf(file) {
    if (!sdfCache.has(file)) {
        const png = PNG.sync.read(fs.readFileSync(path.join(ROOT, file)))
        sdfCache.set(file, { w: png.width, h: png.height, data: png.data })
    }
    return sdfCache.get(file)
}

// the bare finishes' body colours (the datamine importer's PATINA_BODY steel and rust, as sRGB)
const STEEL = '#C5C7C8', RUST = '#905D3F'
const toLinear = c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
const toSrgb = c => c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055
const hexLinear = h => [0, 2, 4].map(i => toLinear(parseInt(h.replace('#', '').slice(i, i + 2), 16) / 255))

// The slots a class's previews offer: every garage slot but Root (one option; any kit's will do)
const slotsOf = cls => (data.classes.find(c => c.name == cls)?.slots ?? []).filter(s => s.id != 'Root' && s.kits.length > 1)

// Contact shadows: a pixel is darkened by nearby pixels of a *different* part nearer the camera (each part's own
// occlusion is already in its render). Screen space, over the stacked depth and which part is in front.
function contactShadow(front, depth, w, h) {
    const out = new Float32Array(w * h).fill(1)
    const offsets = []
    for (let k = 0; k < 16; k++) {
        const a = 2 * Math.PI * k / 16
        for (const r of [5, 10, 14]) offsets.push([Math.round(Math.cos(a) * r), Math.round(Math.sin(a) * r)])
    }
    const reach = 0.06, bias = 0.002
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x, f = front[i]
        if (f < 0) continue
        let occ = 0
        for (const [dx, dy] of offsets) {
            const xx = x - dx, yy = y - dy
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
            const j = yy * w + xx, nf = front[j]
            if (nf < 0 || nf == f) continue
            const gap = depth[i] - depth[j]
            if (gap > bias && gap < reach) occ += 1 - gap / reach
        }
        out[i] = 1 - 0.55 * Math.min(1, occ / offsets.length * 2.5)
    }
    return out
}

// state: { cls, parts: { slot: kit }, palette, pattern, patina } (ids from src/data/swgr/liveries.json; kits are
// codenames). Returns a PNG buffer: the speeder on transparency, cropped to it.
function render(state) {
    const cls = state.cls, m = meta(cls)
    const allSlots = [...new Set(Object.values(m.parts).map(p => p.part))]
    // a part on a socket that moves with another slot's kit (the bike's rear engine, on the front engine) has a
    // render for each position: <kit>_<slot>@<group kit>
    const kitOf = s => state.parts[s] ?? state.base
    const partName = s => {
        const sk = m.sockets?.[s], name = `${kitOf(s)}_${s}`
        if (!sk) return name
        const at = sk.groups[kitOf(sk.parent)]
        return at && at != sk.groups[kitOf(s)] && m.parts[`${name}@${at}`] ? `${name}@${at}` : name
    }
    const names = allSlots.map(partName).filter(n => m.parts[n])
    const palette = data.palette(state.palette).colors.map(hexLinear)
    const pattern = state.pattern && data.pattern(state.pattern)
    // The patina: one body finish, or (Mix 8x8, Rust Steel Mix 16x16) a grid of them, each mesh (a part's base and
    // every panel) taking the texel nearest its PatinaUV (the _patina pass): column round((n - 1) x), row round((n - 1) y)
    // (checked panel by panel against the garage's Napaco D). The livery is painted over it either way.
    const patina = data.patina(state.patina) ?? { finish: 'paint' }
    const bodyFinish = patina.finish ?? 'paint', grid = patina.grid
    const BODY = { paint: palette[0], rust: hexLinear(RUST), metal: hexLinear(STEEL) }
    const body = patina.body ? hexLinear(patina.body) : palette[0]
    const gn = grid ? Math.round(Math.sqrt(grid.length)) : 0
    const at = x => Math.min(gn - 1, Math.max(0, Math.round(x * (gn - 1))))
    const cell = (x, y) => grid[at(y) * gn + at(x)]
    const tex = pattern?.sdf ? sdf(pattern.sdf) : null
    const maskCols = (pattern?.masks ?? []).map(k => k.color ? hexLinear(k.color) : palette[Math.min(k.swatch ?? 1, palette.length - 1)])

    const first = pass(cls, `${names[0]}_paint_0`)
    const w = first.w, h = first.h, n = w * h
    // per layer: premultiplied linear RGB, coverage, depth
    const layers = names.map(name => {
        // each finish's black and white renders, only those this patina can use
        const finishes = {}
        for (const f of new Set(['paint', ...(grid ?? [bodyFinish])])) finishes[f] = [pass(cls, `${name}_${f}_0`), pass(cls, `${name}_${f}_1`)]
        const [p0, p1] = finishes.paint
        const dat = pass(cls, `${name}_data`), dep = pass(cls, `${name}_depth`)
        const pt = grid ? pass(cls, `${name}_patina`) : null, pc = pt?.channels
        const rgb = new Float32Array(n * 3), alpha = new Float32Array(n), depth = new Float32Array(n)
        const dc = dat.channels, zc = dep.channels
        for (let i = 0; i < n; i++) {
            const a = p0.data[i * 4 + 3] / p0.max
            alpha[i] = a
            depth[i] = a > 0.002 ? dep.data[i * zc] / dep.max : 2
            if (a <= 0) continue
            // the livery colour here: the body colour (of this panel's finish), each pattern channel over it in its
            // mask's colour
            const flag = dat.data[i * dc + 2] / dat.max
            const livery = flag > 1e-4
            const u = livery ? dat.data[i * dc] / dat.max / flag * UV_SPAN + UV_LO : 0
            const v = livery ? dat.data[i * dc + 1] / dat.max / flag * UV_SPAN + UV_LO : 0
            const pf = pt ? pt.data[i * pc + 2] / pt.max : 0  // the patina pass's coverage, to un-blend its edges
            const fin = grid && livery && pf > 1e-4 ? cell(pt.data[i * pc] / pt.max / pf, pt.data[i * pc + 1] / pt.max / pf) : grid ? 'paint' : bodyFinish
            let c = grid ? BODY[fin] : body, painted = fin == 'paint' ? 1 : 0
            const [f0, f1] = finishes[fin]
            if (tex && livery) {
                if (u >= 0 && u <= 1 && v >= 0 && v <= 1) {
                    const s = sample(tex, u, 1 - v)  // Blender's image origin is bottom-left
                    c = [...c]
                    maskCols.forEach((col, ch) => {
                        const k = Math.min(1, Math.max(0, (s[ch] - 0.49) / 0.02))
                        if (!k) return
                        for (let q = 0; q < 3; q++) c[q] = c[q] * (1 - k) + col[q] * k
                        painted = Math.max(painted, k)
                    })
                }
            }
            for (let q = 0; q < 3; q++) {
                const pb = p0.data[i * 4 + q] / p0.max, pw = p1.data[i * 4 + q] / p1.max
                const fb = f0.data[i * 4 + q] / f0.max, fw = f1.data[i * 4 + q] / f1.max
                rgb[i * 3 + q] = (painted * (pb + c[q] * (pw - pb)) + (1 - painted) * (fb + c[q] * (fw - fb))) / EXPOSURE
            }
        }
        return { rgb, alpha, depth }
    })

    // front to back by depth, "over" with each layer's coverage
    const out = new Float32Array(n * 3), outA = new Float32Array(n)
    const front = new Int16Array(n).fill(-1), frontDepth = new Float32Array(n).fill(2)
    const order = layers.map((_, k) => k)
    for (let i = 0; i < n; i++) {
        order.sort((a, b2) => layers[a].depth[i] - layers[b2].depth[i])
        let acc = 0
        for (const k of order) {
            const L = layers[k], a = L.alpha[i]
            if (a <= 0) continue
            const t = 1 - acc
            for (let q = 0; q < 3; q++) out[i * 3 + q] += t * L.rgb[i * 3 + q]
            acc += t * a
            if (front[i] < 0 && a > 0.5) { front[i] = k; frontDepth[i] = L.depth[i] }
        }
        outA[i] = acc
    }
    const shade = contactShadow(front, frontDepth, w, h)

    // cropped to the speeder, with a margin
    let x0 = w, y0 = h, x1 = 0, y1 = 0
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (outA[y * w + x] > 0.01) {
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y)
    }
    const pad = 12
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad)
    const png = new PNG({ width: x1 - x0 + 1, height: y1 - y0 + 1 })
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const i = y * w + x, o = ((y - y0) * png.width + (x - x0)) * 4, a = outA[i]
        for (let q = 0; q < 3; q++) png.data[o + q] = Math.round(255 * toSrgb(Math.min(1, Math.max(0, a > 0 ? out[i * 3 + q] * shade[i] / a : 0))))
        png.data[o + 3] = Math.round(255 * Math.min(1, a))
    }
    return PNG.sync.write(png)
}

// Bilinear sample of an 8-bit RGBA image at (u, v) in 0-1 (v down): [r, g, b, a] in 0-1
function sample(t, u, v) {
    const fx = u * (t.w - 1), fy = v * (t.h - 1)
    const x = Math.floor(fx), y = Math.floor(fy), ax = fx - x, ay = fy - y
    const x2 = Math.min(x + 1, t.w - 1), y2 = Math.min(y + 1, t.h - 1)
    const at = (xx, yy, c) => t.data[(yy * t.w + xx) * 4 + c] / 255
    return [0, 1, 2, 3].map(c => (at(x, y, c) * (1 - ax) + at(x2, y, c) * ax) * (1 - ay) + (at(x, y2, c) * (1 - ax) + at(x2, y2, c) * ax) * ay)
}

// render() on a worker thread (preview-worker.js), so composing doesn't hold up the bot: started on first use, renders
// one at a time in order. If the worker dies, the next call starts a new one.
let worker = null, nextId = 0
const pending = new Map()
function renderAsync(state) {
    if (!worker) {
        const { Worker } = require('worker_threads')
        worker = new Worker(path.join(__dirname, 'preview-worker.js'))
        worker.on('message', ({ id, png, error }) => {
            const p = pending.get(id)
            pending.delete(id)
            if (p) error ? p.reject(new Error(error)) : p.resolve(Buffer.from(png))
        })
        const fail = err => {
            for (const p of pending.values()) p.reject(err)
            pending.clear()
            worker = null
        }
        worker.on('error', fail)
        worker.on('exit', code => code && fail(new Error(`preview worker exited with ${code}`)))
        worker.unref()  // don't keep the process alive for it
    }
    const id = nextId++
    return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        worker.postMessage({ id, state })
    })
}

module.exports = { render, renderAsync, classes, slotsOf }
