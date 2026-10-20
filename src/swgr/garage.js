// The garage card: build a speeder from any kit's parts, pick its livery, colour and patina, and see it
// (src/swgr/preview.js composes the image). The whole build rides in the menus' custom ids, so a card needs nothing
// stored and anyone can carry on from it: "cust_<field>_<code>" (interactions/cust.js).
const {
    MessageFlags, AttachmentBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle,
    ContainerBuilder, TextDisplayBuilder, MediaGalleryBuilder,
} = require('discord.js')
const data = require('./data.js')
const preview = require('./preview.js')
const emoji = require('../data/discord/emoji.js')
const viewer = require('../viewer.js')
const { database } = require('../firebase.js')

const DEFAULT_PALETTE = 'dark-enigma', DEFAULT_PATINA = 'all-paint'
const b36 = (n, width) => n.toString(36).padStart(width, '0')
const vehicleOf = (cls, kit) => data.vehicles.find(v => v.class == cls && v.codename == kit)
const classIndex = cls => data.classes.findIndex(c => c.name == cls)

// The colours, a page of the colour menu at a time: its first and last options turn the page
const COLOR_PAGE = 23
const colorPages = () => Math.ceil(data.palettes.length / COLOR_PAGE)
const pageOf = paletteId => Math.floor(data.palettes.findIndex(p => p.id == paletteId) / COLOR_PAGE)

// state <-> code: class, base kit (for Root), each slot's kit, livery (0 = none), colour, patina, colour menu page,
// tab (0 Choose Model, 1 Edit Livery, 2 Edit Vehicle; cards from before had 0 parts / 1 paint), in base 36
function encode(s) {
    const slots = preview.slotsOf(s.cls), kits = slots[0].kits
    const patterns = data.patternsFor(s.cls)
    return [
        b36(classIndex(s.cls), 1), b36(kits.indexOf(s.base), 1),
        ...slots.map(sl => b36(sl.kits.indexOf(s.parts[sl.id] ?? s.base), 1)),
        b36(s.pattern ? patterns.findIndex(p => p.id == s.pattern) + 1 : 0, 2),
        b36(data.palettes.findIndex(p => p.id == s.palette), 2),
        b36(data.patinas.findIndex(p => p.id == s.patina), 1),
        b36(s.page ?? pageOf(s.palette), 1),
        String(TAB_CODES.indexOf(s.tab ?? 'model')),
    ].join('')
}

function decode(code) {
    const cls = data.classes[parseInt(code[0], 36)].name
    const slots = preview.slotsOf(cls)
    let i = 1
    const take = n => parseInt(code.slice(i, i += n), 36)
    const base = slots[0].kits[take(1)]
    const parts = Object.fromEntries(slots.map(sl => [sl.id, sl.kits[take(1)]]))
    const pat = take(2)
    return {
        cls, base, parts,
        pattern: pat ? data.patternsFor(cls)[pat - 1].id : null,
        palette: data.palettes[take(2)].id,
        patina: data.patinas[take(1)].id,
        page: (pg => Number.isNaN(pg) ? undefined : pg)(take(1)),  // cards from before the colour pages have none
        tab: TAB_CODES[take(1)] ?? 'model',
    }
}

// A build of one vehicle, in the default livery or a given one ({ pattern, palette, patina }: a character's speeder,
// an arcade event's)
function startState(vehicleId, livery = {}) {
    const v = data.vehicle(vehicleId)
    return {
        cls: v.class, base: v.codename,
        parts: Object.fromEntries(preview.slotsOf(v.class).map(sl => [sl.id, v.codename])),
        pattern: livery.pattern ?? null, palette: livery.palette ?? DEFAULT_PALETTE, patina: livery.patina ?? DEFAULT_PATINA,
    }
}

// The custom id of a button opening the garage on a dressed speeder ({ vehicle, pattern, palette, patina }, as
// racers.json and arcade.json give them), or null when its class can't be customised
function openId(livery) {
    return livery && canCustomise(livery.vehicle) ? `cust_build_${encode(startState(livery.vehicle, livery))}` : null
}

// The build without its menu page and tab: what the image shows, and what a saved build keeps
const buildKey = s => encode(s).slice(0, -2)

// The known speeders a build is dressed exactly as: characters' (racers.json) and arcade events' (arcade.json), as
// [custom id, label, emoji] buttons to their cards
function knownAs(s) {
    const kits = new Set(preview.slotsOf(s.cls).map(sl => s.parts[sl.id] ?? s.base))
    if (kits.size != 1) return []
    const v = vehicleOf(s.cls, [...kits][0])
    const same = l => !!l && l.vehicle == v?.id && (l.pattern ?? null) == s.pattern && l.palette == s.palette && (l.patina ?? DEFAULT_PATINA) == s.patina
    return [
        ...data.racers.filter(r => r.vehicles.some(same)).map(r => [`character_${r.id}`, r.name, emoji.named(r.emoji)]),
        ...data.events.filter(e => same(e.livery)).map(e => [`arcade_event_${e.id}`, e.name, emoji.vehicle[e.vehicleClass]]),
    ]
}

// Saved builds, per person: garage/<discord id>/<build key> = when it was saved (ms), followed in memory once the bot
// is up (listen(), from bot.js, like records and credits) so cards stay synchronous. At most SAVES each.
const SAVES = 25
let saves = {}
const listen = () => database?.ref('garage').on('value', snap => { saves = snap.val() ?? {} })
const savesOf = id => Object.entries(saves[id] ?? {}).sort((a, b) => b[1] - a[1]).map(([key]) => key)

// Save a build for someone, or unsave it; false when they already have SAVES
async function toggleSave(id, s) {
    const key = buildKey(s), mine = { ...saves[id] }
    if (mine[key]) delete mine[key]
    else if (Object.keys(mine).length >= SAVES) return false
    else mine[key] = Date.now()
    saves = { ...saves, [id]: mine }
    await database?.ref(`garage/${id}/${key}`).set(mine[key] ?? null)
    return true
}

// A build's name and what it's dressed in, for menus
function describe(s) {
    const kits = [...new Set(preview.slotsOf(s.cls).map(sl => s.parts[sl.id] ?? s.base))]
    const stock = kits.length == 1 && vehicleOf(s.cls, kits[0])
    return {
        name: stock ? stock.name : `Custom ${s.cls}`,
        details: [s.pattern ? data.pattern(s.pattern)?.name : 'No livery', data.palette(s.palette)?.name, data.patina(s.patina)?.name].filter(Boolean).join(' / '),
        emoji: (stock && emoji.named(stock.emoji)) || emoji.vehicle[s.cls],
    }
}

// Rendered previews by build key, so a build seen a moment ago (a colour tried and put back) isn't composed again
const IMAGES = 40, images = new Map()
async function imageOf(s) {
    const key = buildKey(s)
    let image = images.get(key)
    if (image) images.delete(key)
    else image = await preview.renderAsync(s)  // on a worker thread, so other clicks are answered meanwhile
    images.set(key, image)
    if (images.size > IMAGES) images.delete(images.keys().next().value)
    return image
}

const canCustomise = vehicleId => preview.classes().includes(data.vehicle(vehicleId)?.class)

function menu(field, code, placeholder, options) {
    return new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
        .setCustomId(`cust_${field}_${code}`).setPlaceholder(placeholder)
        .addOptions(options.slice(0, 25).map(({ emoji: e, ...o }) => ({ ...o, emoji: emoji.component(e) }))))
}

// The garage's tabs, as the game labels them; TAB_CODES is their order in the build code
const TABS = [['model', 'Choose Model'], ['vehicle', 'Edit Vehicle'], ['livery', 'Edit Livery']]
const TAB_CODES = ['model', 'livery', 'vehicle']

// The card for a build: its image, the characters and events dressed the same, then one tab: the model, the parts, or
// the livery. The image is named after the build (speeder-<build key>.png), so when the card being redrawn (message)
// already carries it (only the tab or the colour page changed) it's kept instead of composed and uploaded again.
async function card(s, message = null) {
    const code = encode(s), key = buildKey(s), file = `speeder-${key}.png`
    const slots = preview.slotsOf(s.cls)
    const kits = [...new Set(slots.map(sl => s.parts[sl.id] ?? s.base))]
    const stock = kits.length == 1 && vehicleOf(s.cls, kits[0])
    const kept = message?.attachments?.find(a => a.name == file)
    const image = kept ? null : await imageOf(s)
    const palette = data.palette(s.palette), pattern = s.pattern && data.pattern(s.pattern), patina = data.patina(s.patina)

    const container = new ContainerBuilder().setAccentColor(parseInt(palette.colors[0].slice(1), 16))
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
        `-# Garage / ${s.cls}`,
        `# ${stock ? stock.name : `Custom ${s.cls}`}`,
    ].join('\n')))
    container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(item => item.setURL(`attachment://${file}`)))
    // the characters and arcade events whose speeder this is, each a button to its card
    const known = knownAs(s).slice(0, 5)
    if (known.length) {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent('-# Raced as'))
        container.addActionRowComponents(new ActionRowBuilder().addComponents(known.map(([id, label, e]) =>
            new ButtonBuilder().setCustomId(id).setLabel(label.slice(0, 80)).setEmoji(emoji.component(e)).setStyle(ButtonStyle.Secondary))))
    }
    // Tabs, as in the game's garage; they also keep the card under Discord's message size with every option's emoji
    // (all ten menus at once, ~120 emojis, went over)
    const tab = s.tab ?? 'model'
    // and a star saving the build (or unsaving it) for whoever's looking
    const mine = savesOf(viewer.id()), saved = mine.includes(key)
    container.addActionRowComponents(new ActionRowBuilder().addComponents(...TABS.map(([id, label]) =>
        new ButtonBuilder().setCustomId(`cust_tab${id}_${code}`).setLabel(label).setDisabled(id == tab)
            .setStyle(id == tab ? ButtonStyle.Primary : ButtonStyle.Secondary)),
        new ButtonBuilder().setCustomId(`cust_save_${code}`).setLabel(saved ? 'Saved' : 'Save').setEmoji(saved ? '★' : '☆')
            .setStyle(saved ? ButtonStyle.Success : ButtonStyle.Secondary)))
    if (tab == 'model') {
        container.addActionRowComponents(classRow(s, code), modelRow(s, code, slots, stock))
        if (mine.length) container.addActionRowComponents(savedRow(s, code, mine))
    }
    else if (tab == 'vehicle') container.addActionRowComponents(...partRows(s, code, slots))
    else container.addActionRowComponents(...paintRows(s, code, palette, pattern))
    return {
        components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] },
        ...kept ? { attachments: [kept] } : { files: [new AttachmentBuilder(image, { name: file })], attachments: [] },
    }
}

// Choose Model, for someone with saved builds: one to go back to (value: its build key)
function savedRow(s, code, mine) {
    return menu('saved', code, 'Your saved builds', mine.map(key => {
        const d = describe(decode(`${key}00`))
        return { label: d.name, value: key, description: d.details.slice(0, 100), emoji: d.emoji, default: key == buildKey(s) }
    }))
}

// Choose Model: the vehicle class (those with passes rendered), then the whole model ("Custom" once the parts are mixed)
function classRow(s, code) {
    return menu('class', code, 'Vehicle class', preview.classes().map(c => ({
        label: `Vehicle: ${c}`, value: String(classIndex(c)), emoji: emoji.vehicle[c], default: c == s.cls,
    })))
}

function modelRow(s, code, slots, stock) {
    return menu('model', code, 'Model', [
        ...(stock ? [] : [{ label: 'Model: Custom', value: 'custom', description: 'Parts from different models', default: true }]),
        ...slots[0].kits.map(kit => vehicleOf(s.cls, kit)).filter(Boolean).map(v => ({
            label: `Model: ${v.name}`, value: v.codename, description: v.manufacturer ?? undefined,
            emoji: emoji.named(v.emoji) || emoji.vehicle[v.class], default: stock && v.codename == stock.codename,
        })),
    ])
}

// Edit Vehicle: a menu per part slot
function partRows(s, code, slots) {
    return slots.map(sl => menu(sl.id, code, sl.label, sl.kits.map(kit => vehicleOf(s.cls, kit)).filter(Boolean).map(v => ({
        label: `${sl.label}: ${v.name}`, value: v.codename, emoji: emoji.named(v.emoji) || emoji.vehicle[v.class],
        default: v.codename == (s.parts[sl.id] ?? s.base),
    }))))
}

// Edit Livery: livery, colour (paged), patina
function paintRows(s, code, palette, pattern) {
    const rows = [menu('livery', code, 'Livery', [
        { label: 'Livery: none', value: 'none', default: !pattern },
        ...data.patternsFor(s.cls).map(p => ({ label: `Livery: ${p.name}`, value: p.id, emoji: emoji.named(p.emoji), default: p.id == s.pattern })),
    ])]
    const page = s.page ?? pageOf(s.palette), pages = colorPages()
    const turn = k => (page + k + pages) % pages
    rows.push(menu('color', code, `Color: ${palette.name}`, [
        { label: '◀ Previous colors', value: 'prev', description: `Page ${turn(-1) + 1} of ${pages}` },
        ...data.palettes.slice(page * COLOR_PAGE, (page + 1) * COLOR_PAGE).map(p => ({
            label: `Color: ${p.name}`, value: p.id, description: p.group, emoji: emoji.named(p.emoji), default: p.id == s.palette,
        })),
        { label: 'Next colors ▶', value: 'next', description: `Page ${turn(1) + 1} of ${pages}` },
    ]))
    rows.push(menu('patina', code, 'Patina', data.patinas.map(p => ({
        label: `Patina: ${p.name}`, value: p.id, emoji: emoji.named(p.emoji), default: p.id == s.patina,
    }))))
    return rows
}

// A menu pick: the build with that field changed
function apply(s, field, value) {
    s = { ...s, parts: { ...s.parts } }
    if (field == 'livery') s.pattern = value == 'none' ? null : value
    else if (field == 'color' && (value == 'prev' || value == 'next')) {
        const page = s.page ?? pageOf(s.palette)
        s.page = (page + (value == 'next' ? 1 : -1) + colorPages()) % colorPages()
    } else if (field == 'color') s.palette = value
    else if (field == 'class') {
        // another class: its first model, keeping the colour, patina and tab, and the livery when the class has one by
        // the same name (each class has its own, mostly named alike)
        const cls = data.classes[Number(value)]?.name
        if (!cls || cls == s.cls) return s
        const first = vehicleOf(cls, preview.slotsOf(cls)[0].kits[0])
        const name = s.pattern && data.pattern(s.pattern)?.name
        const pattern = (name && data.patternsFor(cls).find(p => p.name == name)?.id) || null
        return { ...startState(first.id), pattern, palette: s.palette, patina: s.patina, page: s.page, tab: s.tab }
    } else if (field == 'model' && value != 'custom') {
        s.base = value
        for (const sl of preview.slotsOf(s.cls)) s.parts[sl.id] = value
    }
    else if (field == 'patina') s.patina = value
    else if (field == 'saved') return { ...decode(`${value}00`), page: s.page, tab: s.tab }
    else if (field.startsWith('tab')) s.tab = field.slice(3)
    else if (preview.slotsOf(s.cls).some(sl => sl.id == field)) s.parts[field] = value
    return s
}

module.exports = { card, encode, decode, startState, apply, canCustomise, openId, buildKey, savesOf, toggleSave, describe, listen }
