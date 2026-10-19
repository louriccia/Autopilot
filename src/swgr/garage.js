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

const DEFAULT_PALETTE = 'dark-enigma', DEFAULT_PATINA = 'all-paint'
const b36 = (n, width) => n.toString(36).padStart(width, '0')
const vehicleOf = (cls, kit) => data.vehicles.find(v => v.class == cls && v.codename == kit)
const classIndex = cls => data.classes.findIndex(c => c.name == cls)

// The colours, a page of the colour menu at a time: its first and last options turn the page
const COLOR_PAGE = 23
const colorPages = () => Math.ceil(data.palettes.length / COLOR_PAGE)
const pageOf = paletteId => Math.floor(data.palettes.findIndex(p => p.id == paletteId) / COLOR_PAGE)

// state <-> code: class, base kit (for Root), each slot's kit, livery (0 = none), colour, patina, colour menu page,
// tab (0 parts, 1 paint), in base 36
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
        s.tab == 'paint' ? '1' : '0',
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
        tab: take(1) == 1 ? 'paint' : 'parts',
    }
}

// A build of one vehicle, in the default livery
function startState(vehicleId) {
    const v = data.vehicle(vehicleId)
    return {
        cls: v.class, base: v.codename,
        parts: Object.fromEntries(preview.slotsOf(v.class).map(sl => [sl.id, v.codename])),
        pattern: null, palette: DEFAULT_PALETTE, patina: DEFAULT_PATINA,
    }
}

const canCustomise = vehicleId => preview.classes().includes(data.vehicle(vehicleId)?.class)

function menu(field, code, placeholder, options) {
    return new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
        .setCustomId(`cust_${field}_${code}`).setPlaceholder(placeholder)
        .addOptions(options.slice(0, 25).map(({ emoji: e, ...o }) => ({ ...o, emoji: emoji.component(e) }))))
}

// The card for a build: its image, then the parts tab or the paint tab
async function card(s) {
    const code = encode(s)
    const slots = preview.slotsOf(s.cls)
    const kits = [...new Set(slots.map(sl => s.parts[sl.id] ?? s.base))]
    const stock = kits.length == 1 && vehicleOf(s.cls, kits[0])
    const image = preview.render(s)
    const palette = data.palette(s.palette), pattern = s.pattern && data.pattern(s.pattern), patina = data.patina(s.patina)

    const container = new ContainerBuilder().setAccentColor(parseInt(palette.colors[0].slice(1), 16))
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
        `-# Garage / ${s.cls}`,
        `# ${stock ? stock.name : `Custom ${s.cls}`}`,
    ].join('\n')))
    container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(item => item.setURL('attachment://speeder.png')))
    // Two tabs, so the card stays under Discord's message size with every option's emoji (all ten menus at once,
    // ~120 emojis, went over): the parts (Model and a menu per slot), and the paint (livery, colour, patina)
    const tab = s.tab ?? 'parts'
    container.addActionRowComponents(new ActionRowBuilder().addComponents([['parts', 'Parts'], ['paint', 'Paint']].map(([id, label]) =>
        new ButtonBuilder().setCustomId(`cust_${id}_${code}`).setLabel(label).setDisabled(id == tab)
            .setStyle(id == tab ? ButtonStyle.Primary : ButtonStyle.Secondary))))
    if (tab == 'parts') container.addActionRowComponents(...partRows(s, code, slots, stock))
    else container.addActionRowComponents(...paintRows(s, code, palette, pattern))
    return {
        components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] },
        files: [new AttachmentBuilder(image, { name: 'speeder.png' })],
    }
}

// The parts tab: the whole model ("Custom" once the parts are mixed), then a menu per slot
function partRows(s, code, slots, stock) {
    const rows = [menu('model', code, 'Model', [
        ...(stock ? [] : [{ label: 'Model: Custom', value: 'custom', description: 'Parts from different models', default: true }]),
        ...slots[0].kits.map(kit => vehicleOf(s.cls, kit)).filter(Boolean).map(v => ({
            label: `Model: ${v.name}`, value: v.codename, description: v.manufacturer ?? undefined,
            emoji: emoji.named(v.emoji) || emoji.vehicle[v.class], default: stock && v.codename == stock.codename,
        })),
    ])]
    rows.push(...slots.map(sl => menu(sl.id, code, sl.label, sl.kits.map(kit => vehicleOf(s.cls, kit)).filter(Boolean).map(v => ({
        label: `${sl.label}: ${v.name}`, value: v.codename, emoji: emoji.named(v.emoji) || emoji.vehicle[v.class],
        default: v.codename == (s.parts[sl.id] ?? s.base),
    })))))
    return rows
}

// The paint tab: livery, colour (paged), patina
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
    else if (field == 'model' && value != 'custom') {
        s.base = value
        for (const sl of preview.slotsOf(s.cls)) s.parts[sl.id] = value
    }
    else if (field == 'patina') s.patina = value
    else if (field == 'parts' || field == 'paint') s.tab = field
    else if (preview.slotsOf(s.cls).some(sl => sl.id == field)) s.parts[field] = value
    return s
}

module.exports = { card, encode, decode, startState, apply, canCustomise }
