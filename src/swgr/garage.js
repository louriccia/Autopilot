// The garage card: build a speeder from any kit's parts, pick its livery, colour and patina, and see it
// (src/swgr/preview.js composes the image). The whole build rides in the menus' custom ids, so a card needs nothing
// stored and anyone can carry on from it: "cust_<field>_<code>" (interactions/cust.js).
const {
    MessageFlags, AttachmentBuilder, ActionRowBuilder, StringSelectMenuBuilder,
    ContainerBuilder, TextDisplayBuilder, MediaGalleryBuilder,
} = require('discord.js')
const data = require('./data.js')
const preview = require('./preview.js')
const emoji = require('../data/discord/emoji.js')

const DEFAULT_PALETTE = 'dark-enigma', DEFAULT_PATINA = 'all-paint'
const b36 = (n, width) => n.toString(36).padStart(width, '0')
const vehicleOf = (cls, kit) => data.vehicles.find(v => v.class == cls && v.codename == kit)
const classIndex = cls => data.classes.findIndex(c => c.name == cls)

// state <-> code: class, base kit (for Root), each slot's kit, livery (0 = none), colour, patina, in base 36
function encode(s) {
    const slots = preview.slotsOf(s.cls), kits = slots[0].kits
    const patterns = data.patternsFor(s.cls)
    return [
        b36(classIndex(s.cls), 1), b36(kits.indexOf(s.base), 1),
        ...slots.map(sl => b36(sl.kits.indexOf(s.parts[sl.id] ?? s.base), 1)),
        b36(s.pattern ? patterns.findIndex(p => p.id == s.pattern) + 1 : 0, 2),
        b36(data.palettes.findIndex(p => p.id == s.palette), 2),
        b36(data.patinas.findIndex(p => p.id == s.patina), 1),
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

// The card for a build: its image, then a menu per part slot, then livery / colour group / colour / patina
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
        `-# A preview, not the game's renderer: shadows between parts are approximated, and Mix and Rust Steel Mix show as paint.`,
    ].join('\n')))
    container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(item => item.setURL('attachment://speeder.png')))

    const rows = slots.map(sl => menu(sl.id, code, sl.label, sl.kits.map(kit => vehicleOf(s.cls, kit)).filter(Boolean).map(v => ({
        label: `${sl.label}: ${v.name}`, value: v.codename, emoji: emoji.named(v.emoji) || emoji.vehicle[v.class],
        default: v.codename == (s.parts[sl.id] ?? s.base),
    }))))
    rows.push(menu('livery', code, 'Livery', [
        { label: 'Livery: none', value: 'none', default: !pattern },
        ...data.patternsFor(s.cls).map(p => ({ label: `Livery: ${p.name}`, value: p.id, emoji: emoji.named(p.emoji), default: p.id == s.pattern })),
    ]))
    const groups = [...new Set(data.palettes.map(p => p.group))]
    rows.push(menu('group', code, 'Color group', groups.map(g => ({
        label: `Colors: ${g}`, value: g, description: `${data.palettesIn(g).length} colors`, default: g == palette.group,
    }))))
    rows.push(menu('color', code, 'Color', data.palettesIn(palette.group).map(p => ({
        label: `Color: ${p.name}`, value: p.id, emoji: emoji.named(p.emoji), default: p.id == s.palette,
    }))))
    rows.push(menu('patina', code, 'Patina', data.patinas.map(p => ({
        label: `Patina: ${p.name}`, value: p.id, emoji: emoji.named(p.emoji), default: p.id == s.patina,
    }))))
    container.addActionRowComponents(...rows)
    return {
        components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] },
        files: [new AttachmentBuilder(image, { name: 'speeder.png' })],
    }
}

// A menu pick: the build with that field changed
function apply(s, field, value) {
    s = { ...s, parts: { ...s.parts } }
    if (field == 'livery') s.pattern = value == 'none' ? null : value
    else if (field == 'group') s.palette = data.palettesIn(value)[0].id
    else if (field == 'color') s.palette = value
    else if (field == 'patina') s.patina = value
    else if (preview.slotsOf(s.cls).some(sl => sl.id == field)) s.parts[field] = value
    return s
}

module.exports = { card, encode, decode, startState, apply, canCustomise }
