// Page builders for the reference commands, as Components V2 messages. Each returns a full payload
// ({ components, files, flags }) so a slash command can reply with it and a select/button can swap it in place.
const path = require('path')
const {
    MessageFlags, AttachmentBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle,
    ContainerBuilder, TextDisplayBuilder, SectionBuilder, ThumbnailBuilder, MediaGalleryBuilder, SeparatorBuilder,
} = require('discord.js')
const data = require('./data.js')
const emoji = require('../data/discord/emoji.js')

const ROOT = path.join(__dirname, '../..')
const DEFAULT_COLOR = 0x3B88C3
// Discord's cap on the total text in one Components V2 message
const TEXT_LIMIT = 4000

const PLANET_COLORS = {
    'jakku': 0xD9822B,
    'lantaana': 0x3E9E4F,
    'ando-prime': 0x9CC9E6,
    'sentinel-i': 0xB5C93A,
    'crait': 0xC8333A,
    'derven-acos': 0x7B5BC4,
    'tatooine': 0xE3C07A,
}

const categoryEmoji = c => emoji.named(c.emoji)
const MODE_EMOJI = { 'Race': emoji.event.race }

// A track's "Speeders + Podracer" as the class emojis it covers
const SPEEDERS = ['Speeder Bike', 'Landspeeder', 'Skim Speeder']
const vehiclesEmoji = vehicles => [
    ...(vehicles.includes('Speeders') ? SPEEDERS : []),
    ...(vehicles.includes('Podracer') ? ['Podracer'] : []),
].map(c => emoji.vehicle[c]).join('')
const cls = c => emoji.vehicle[c] ?? ''
const crumbs = (...parts) => `-# ${parts.join(' / ')}`
// Base ability energy (3) plus the Battery upgrade's +13 at level 10
const MAX_ENERGY = 16
// Seconds -> the game's time format, to hundredths: 70.41 -> "1:10.41", 56.84 -> "56.84"
const formatTime = s => {
    const cs = Math.round(s * 100), m = Math.floor(cs / 6000), rest = (cs % 6000) / 100
    return m ? `${m}:${rest.toFixed(2).padStart(5, '0')}` : rest.toFixed(2)
}
// A part's description as displayed: bold keywords with their icons (rich), else the plain text. Menus can't
// render either, so they keep using p.description.
const partText = p => (p.rich ?? p.description).replace(/\{emoji:(\w+)\}/g, (_, name) => emoji.named(name))
// How something unlocks, as the last line of a card's header
const unlockLine = text => text ? `-# ${emoji.named('lock')} ${text}` : null
// A build's or style's abilities (by name) as ability records
const abilitiesOf = x => (x.abilities ?? []).map(a => data.abilityByName(a.name)).filter(Boolean)
const laps = n => n ? `${n} lap${n == 1 ? '' : 's'}` : null
// The game's 10-segment level bar (7 short then 3 tall), drawn as 5 emojis of two segments each — ss/st/tt
// for the pair's shapes plus how many of the two are filled. See stat_segments in tools/import_swgr.py.
const segments = level => Array.from({ length: 5 }, (_, p) => {
    const kinds = [2 * p, 2 * p + 1].map(i => i < 7 ? 's' : 't').join('')
    return emoji.named(`${kinds}${Math.max(0, Math.min(2, level - 2 * p))}`)
}).join('')

// Media can only show files uploaded with the message; this keeps the file names unique.
class Files {
    constructor() { this.list = [] }
    add(asset) {
        if (!asset) return null
        const name = asset.replace(/\//g, '-')
        if (!this.list.some(f => f.name == name)) this.list.push(new AttachmentBuilder(path.join(ROOT, asset), { name }))
        return `attachment://${name}`
    }
}

// --- building blocks ---

const text = content => new TextDisplayBuilder().setContent(content)
const separator = () => new SeparatorBuilder()

// A heading block with an image on the right, or plain text when there's no image.
function header(container, lines, image) {
    const content = lines.filter(Boolean).join('\n')
    if (!image) return container.addTextDisplayComponents(text(content))
    return container.addSectionComponents(new SectionBuilder()
        .addTextDisplayComponents(text(content))
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(image)))
}

function gallery(container, image) {
    if (image) container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(item => item.setURL(image)))
    return container
}

function page(container, files, rows) {
    if (rows.length) container.addActionRowComponents(...rows)
    return { components: [container], files: files.list, flags: MessageFlags.IsComponentsV2 }
}

// Menus are stacked like breadcrumbs, broadest at the top: category > event for arcade, planet > track >
// that track's events for the world pages. Cross-link buttons go last.
//
// options: [{ label, value, description?, emoji? }] where emoji is a <:name:id> string
function select(customId, placeholder, options, current) {
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(customId)
            .setPlaceholder(placeholder)
            .addOptions(options.slice(0, 25).map(({ emoji: e, ...o }) => ({ ...o, emoji: emoji.component(e), default: o.value == current })))
    )
}

// specs: [customId, label, emoji?]
function buttons(...specs) {
    return new ActionRowBuilder().addComponents(specs.map(([customId, label, e]) => {
        const button = new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(ButtonStyle.Secondary)
        if (e) button.setEmoji(emoji.component(e))
        return button
    }))
}

function categorySelect(current) {
    return select('arcade_category', 'Browse a category',
        data.categories.map(c => ({ label: c.name, value: c.id, description: `${data.eventsInCategory(c.id).length} events`, emoji: categoryEmoji(c) })), current)
}

function eventSelect(events, current) {
    return select('arcade_event', 'Pick an event',
        events.map(e => ({
            label: e.name,
            value: e.id,
            description: `${data.track(e.track).name} · ${e.vehicle} · Gold ${e.medals.gold.time}`.slice(0, 100),
            emoji: emoji.vehicle[e.vehicleClass],
        })), current)
}

function planetSelect(current) {
    return select('planet', 'Pick a planet',
        data.planets.map(x => ({ label: x.name, value: x.id, description: x.tagline.slice(0, 100), emoji: emoji.planet[x.id] })), current)
}

// A variant as the cards show it: plain Forward is implied (nothing), Reverse is the game's reverse icon, Rally is
// spelled out, and the layout type (Mines / Precision / Podracer) follows unless the context already says it.
//   "Forward" -> ""   "Reverse with mines" -> "[reverse] Mines"   "Precision Forward" -> "Precision"
function variantLabel(v, { type = true } = {}) {
    const dir = v.match(/Forward|Reverse|Rally/)?.[0] ?? 'Forward'
    const kind = v.startsWith('Precision') ? 'Precision' : v.startsWith('Podracer') ? 'Podracer' : v.endsWith(' with mines') ? 'Mines' : ''
    return [dir == 'Reverse' && emoji.named('reverse'), dir == 'Rally' && 'Rally', type && kind].filter(Boolean).join(' ')
}

// The header's variants line: every variant beyond plain Forward — "[reverse] / Rally / Mines / Precision / Podracer"
function variantGroups(variants) {
    const labels = variants.map(v => variantLabel(v)).filter(Boolean)
    return labels.length ? labels.join(' / ') : null
}

const ordinal = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th')
const when = n => n == 0 ? 'from the start' : `after ${n} event${n == 1 ? '' : 's'}`
// An event's lap setting: "2" -> "(2 laps)"; "unlimited" (takedown events run on time) -> nothing
const eventLaps = l => /^\d+$/.test(l) ? `(${laps(+l)})` : ''

// One planet stop in a campaign act, grouped by when things become available, each with the race kinds that open
// up then as indented subtext lines:
//   ### Act 1 ([planet] 3rd stop)
//   From the start
//   -#   [icon] Field Test: [landspeeder] Ramjet Distance (2 laps)
//   After 1 event
//   -#   [icon] Race (2 laps): Reverse (Afternoon Dry)
//   -#   [icon] Eliminator: Reverse (Afternoon Dry)
//   Finale
//   -#   [icon] Championship Race (4 laps): (Night)
// Race / Eliminator pools grow as you complete events on the stop; Field Tests and Podracer Tests are open all
// stop; finales are fixed. Kind names are the campaign map legend's (the data calls Race / Eliminator "Standard" /
// "High Risk"). Discord strips leading spaces, so the indent is em spaces (U+2003), which it keeps.
const INDENT = '\u2003\u2003'
const capitalize = s => s.charAt(0).toUpperCase() + s.slice(1)
const conditionsText = list => list.length ? `(${list.join(', ')})` : ''
const indented = lines => lines.map(l => `-# ${INDENT}${l}`)

// Laps only show where they differ from the track's own count (defaultLaps), which the header already gives.
// Point-to-point tracks (pointToPoint) never mention laps.
function campaignStop({ act, stop, planet, kinds }, showDirections, defaultLaps, pointToPoint) {
    // Each event line: "+ [kind icon] variants / conditions / laps". The map icon stands for the kind; kinds without
    // one (Podracer Test, Galactic Gauntlet) keep their name. Race shows the laps its variants run; Eliminators are
    // timed (last place out on a cadence until three remain); Field Tests carry laps per event.
    const kindLabel = k => emoji.named(k.emoji) || `${k.kind.startsWith('Podracer') ? emoji.vehicle['Podracer'] + ' ' : ''}${k.kind}`
    const lapsOf = k => {
        const counts = k.kind == 'Race' ? k.laps
            : k.kind != 'Field Test' ? [...new Set(k.events.map(ev => ev.laps).filter(l => /^\d+$/.test(l)).map(Number))] : []
        if (pointToPoint || !counts.length || (counts.length == 1 && counts[0] == defaultLaps)) return ''
        return counts.length > 1 ? `${counts.join('–')} laps` : laps(counts[0])
    }
    // One line per variant (plain Forward shows no direction), or a single line when the track has only the one
    const perVariant = variants => showDirections && variants.length ? [...new Set(variants)] : [null]
    // An icon label runs straight into the details; a text label (Podracer Test) is separated like the rest
    const line = (k, parts) => {
        const label = kindLabel(k)
        return `+ ${label}${parts.some(Boolean) ? (label.endsWith('>') ? ' ' : ' / ') : ''}${parts.filter(Boolean).join(' / ')}`
    }

    // Events open from the start sit right under the act; later unlocks and finales get their own label
    const buckets = new Map()  // sort key -> { label, lines }
    const add = (key, label, text) => {
        if (!buckets.has(key)) buckets.set(key, { label, lines: [] })
        buckets.get(key).lines.push(text)
    }
    for (const k of kinds) {
        if (k.kind == 'Race' || k.kind == 'Eliminator') {
            for (const u of k.unlocks) {
                for (const v of perVariant(u.variants)) {
                    add(u.after, u.after ? capitalize(when(u.after)) : null, line(k, [v && variantLabel(v), u.conditions.join(', '), lapsOf(k)]))
                }
            }
        } else if (k.kind == 'Field Test') {
            // All of a stop's Field Tests on one line, each vehicle followed by its events
            const byVehicle = new Map()
            for (const ev of k.events) byVehicle.set(ev.vehicle, [...(byVehicle.get(ev.vehicle) ?? []), [ev.mode, !pointToPoint && ev.laps != String(defaultLaps) && eventLaps(ev.laps)].filter(Boolean).join(' ')])
            add(0, null, line(k, [[...byVehicle].map(([v, evs]) => `${cls(v)} ${evs.join(', ')}`).join(' · ')]))
        } else if (k.kind.startsWith('Podracer')) {
            for (const v of perVariant(k.unlocks.flatMap(u => u.variants))) add(0, null, line(k, [v && variantLabel(v, { type: false }), lapsOf(k)]))
        } else {
            add(Infinity, 'Finale', line(k, [[...new Set(k.unlocks.flatMap(u => u.conditions))].join(', '), lapsOf(k)]))
        }
    }
    return [
        `### ${act} (${emoji.planet[planet]} ${ordinal(stop)} stop)`,
        ...[...buckets.entries()].sort((a, b) => a[0] - b[0]).flatMap(([, b]) => [b.label, ...indented(b.lines)].filter(Boolean)),
    ]
}

// A scenario as a plain line (its vehicle class first), then which days / the final eliminator use the track:
//   [skim] Katja Mox (II: Pilot)
//   -#   Days 1–4: Forward, Reverse (Afternoon Dry, Night Dry)
//   -#   Final eliminator: Reverse with mines (Afternoon Dry)
function scenarioLines(sc, showDirections) {
    const d = sc.days
    const days = d.length > 1 && d[d.length - 1] - d[0] == d.length - 1 ? `Days ${d[0]}–${d[d.length - 1]}` : `Day${d.length > 1 ? 's' : ''} ${d.join(', ')}`
    // One line per variant in the pool, like the campaign: "Days 1–4 / [reverse] / Blue Hour, Sunset"
    const poolLines = (label, p) => (showDirections && p.variants.length ? p.variants : [null])
        .map(v => [label, v && variantLabel(v), p.conditions.join(', ')].filter(Boolean).join(' / '))
    const lines = []
    if (sc.pools.days && d.length) lines.push(...poolLines(days, sc.pools.days))
    if (sc.pools.final) lines.push(...poolLines('Final eliminator', sc.pools.final))
    return [`${cls(sc.vehicle)} **${sc.name}** (${sc.tier})`.trim(), ...indented(lines)]
}

// Arcade events, grouped under the track variant they run when the track has more than one
function arcadeLines(events, showDirections, defaultLaps, pointToPoint) {
    // Laps only where the event differs from the track's count in the header
    const lineOf = e => [`${cls(e.vehicleClass)} **${e.name}**`, e.vehicle, !pointToPoint && e.laps && e.laps != defaultLaps && laps(e.laps),
        `${emoji.medal.gold} ${e.medals.gold.time}`].filter(Boolean).join(' · ')
    if (!showDirections) return events.map(e => `-# ${lineOf(e)}`)
    const groups = new Map()
    for (const e of events) {
        const v = e.variant ?? 'Forward'
        if (!groups.has(v)) groups.set(v, [])
        groups.get(v).push(e)
    }
    // Plain Forward events come first with no label (it's implied); other variants under their label
    const order = v => ['Forward', 'Reverse', 'Rally'].findIndex(d => v.endsWith(d)) + (v.includes(' ') ? 10 * (v.startsWith('Podracer') ? 2 : 1) : 0)
    return [...groups.entries()].sort((a, b) => order(a[0]) - order(b[0]))
        .flatMap(([v, list]) => [variantLabel(v), ...indented(list.map(lineOf))].filter(Boolean))
}

function trackSelect(tracks, current) {
    return select('track', 'Pick a track',
        tracks.map(t => ({ label: t.name, value: t.id, description: `${t.format} · ${t.vehicles}`, emoji: emoji.planet[t.planet] })), current)
}

const eventLine = e => `${cls(e.vehicleClass)} **${e.name}** — ${emoji.planet[e.planet]} ${data.track(e.track).name} · ${e.vehicle} · ${emoji.medal.gold} ${e.medals.gold.time}`

// --- arcade ---

function arcadeOverview() {
    const files = new Files()
    const container = new ContainerBuilder().setAccentColor(DEFAULT_COLOR)
    header(container, ['## Arcade', `${data.events.length} events across ${data.categories.length} categories.`])
    container.addSeparatorComponents(separator())
    container.addTextDisplayComponents(text(data.categories.map(c => {
        const events = data.eventsInCategory(c.id)
        const classes = [...new Set(events.map(e => e.vehicleClass))].map(cls).join('')
        return `${categoryEmoji(c)} **${c.name}** — ${events.length} events ${classes}`
    }).join('\n')))
    return page(container, files, [categorySelect()])
}

function arcadeCategory(categoryId) {
    const category = data.category(categoryId)
    const events = data.eventsInCategory(categoryId)
    const files = new Files()
    const container = new ContainerBuilder().setAccentColor(DEFAULT_COLOR)
    header(container, [crumbs('Arcade'), `## ${category.name}`, `${events.length} events`], files.add(category.icon))
    container.addSeparatorComponents(separator())
    container.addTextDisplayComponents(text(events.map(eventLine).join('\n')))
    return page(container, files, [categorySelect(categoryId), eventSelect(events)])
}

// A build section (arcade events and scenarios): vehicle and speed as a heading, the six upgrade stats as bare bars
// (icon + segments), max energy, abilities, with the class's animation on the right; then the parts.
function addBuild(container, files, b, title) {
    const lines = [
        `## ${cls(b.vehicleClass)} ${title} · ${emoji.named(b.speed.emoji)} ${b.speed.value}`,
        ...b.build.map(s => `${emoji.named(s.emoji)} ${segments(s.level)}`),
        `*Max Energy* ${'●'.repeat(b.maxEnergy)}${'○'.repeat(Math.max(0, MAX_ENERGY - b.maxEnergy))}`,
    ]
    if (b.abilities.length) lines.push(b.abilities.map(a => `${emoji.named(a.emoji)} ${a.name}`).join('   '))
    header(container, lines, files.add(data.vehicleClass(b.vehicleClass)?.gif))
    if (b.parts.length) {
        container.addTextDisplayComponents(text(b.parts.map(p => `${emoji.named(p.emoji)} **${p.name}**: ${partText(p)}`).join('\n')))
    }
}

function arcadeEvent(eventId) {
    const e = data.event(eventId)
    const category = data.category(e.category)
    const track = data.track(e.track)
    const planet = data.planet(e.planet)
    const files = new Files()
    const container = new ContainerBuilder().setAccentColor(PLANET_COLORS[e.planet] ?? DEFAULT_COLOR)

    // Card order: event type and name, where it runs, the vehicle and its build, then the medals to beat.
    header(container, [
        crumbs('Arcade', `${categoryEmoji(category)} ${category.name}`),
        `${MODE_EMOJI[e.mode] ?? ''} **${e.mode}**`.trim(),
        `# ${e.name}`,
        e.description && `*${e.description}*`,
        [`${emoji.planet[planet.id]} **${track.name}**`, e.direction == 'Reverse' ? emoji.named('reverse') : e.direction == 'Forward' ? null : e.direction, track.format != 'Point-to-point' && laps(e.laps), e.condition, ...e.notes].filter(Boolean).join(' / '),
        unlockLine(e.unlock),
    ], files.add(e.tile))

    container.addSeparatorComponents(separator())
    addBuild(container, files, e, e.vehicle)

    // Leaderboard: the medal rivals plus any staff times (Fuse logo), fastest first
    container.addSeparatorComponents(separator())
    const board = [
        ...Object.entries(e.medals).map(([m, x]) => ({ seconds: x.seconds, line: `${emoji.medal[m]} **${x.time}** ${x.rival}` })),
        ...data.staffTimes(e.id).map(s => ({ seconds: s.seconds, line: `${emoji.named('staff')} **${formatTime(s.seconds)}** ${s.name}` })),
    ].sort((a, b) => a.seconds - b.seconds)
    container.addTextDisplayComponents(text(board.map(b => b.line).join('\n')))

    return page(container, files, [
        categorySelect(e.category),
        eventSelect(data.eventsInCategory(e.category), e.id),
        ...(e.parts.length ? [partSelect(e.parts.map(x => data.partByName(x.name)).filter(Boolean))] : []),
        ...(abilitiesOf(e).length ? [abilitySelect(abilitiesOf(e))] : []),
        buttons([`track_${track.id}`, track.name], [`planet_${planet.id}`, planet.name, emoji.planet[planet.id]]),
    ])
}

// --- tracks ---

function trackInfo(trackId) {
    const t = data.track(trackId)
    const planet = data.planet(t.planet)
    const events = data.eventsOnTrack(t.id)
    const files = new Files()
    const container = new ContainerBuilder().setAccentColor(PLANET_COLORS[t.planet] ?? DEFAULT_COLOR)

    // "Loop / [vehicles] Speeders + Podracer / 2 laps", then the variants (per-mode laps are in the list below)
    const variants = variantGroups(t.variants)
    const headerLines = [
        crumbs('Planets', planet.name),
        `# ${t.name}`,
        [t.format, `${vehiclesEmoji(t.vehicles)} ${t.vehicles}`, laps(t.defaultLaps)].filter(Boolean).join(' / '),
        variants,
        // Tracks the game names separately for running another one backwards
        t.reverseOf && `-# ${t.reverseOf} run in reverse`,
        t.reversedAs && `-# Run in reverse as ${t.reversedAs}`,
    ]
    header(container, headerLines, files.add(planet.image))
    gallery(container, files.add(t.map))

    // Every way to race the track. Heading levels: track name #, campaign acts / Scenarios / Arcade ###, race kinds
    // plain text, appearances -# subtext
    const access = []
    if (t.campaign.length) access.push(...t.campaign.flatMap(a => campaignStop(a, !!variants, t.defaultLaps, t.format == 'Point-to-point')))
    if (t.scenarios.length) access.push('### Scenarios', ...t.scenarios.flatMap(sc => scenarioLines(sc, !!variants)))
    if (events.length) access.push('### Arcade', ...arcadeLines(events, !!variants, t.defaultLaps, t.format == 'Point-to-point'))
    if (access.length) {
        // Discord caps a message's text at 4000 characters in total; trim the end of the list rather than fail
        const budget = TEXT_LIMIT - headerLines.filter(Boolean).join('\n').length
        let body = access.join('\n')
        if (body.length > budget) {
            const more = '\n-# …and more'
            body = body.slice(0, budget - more.length).replace(/\n[^\n]*$/, '') + more
        }
        container.addSeparatorComponents(separator())
        container.addTextDisplayComponents(text(body))
    }

    const rows = [planetSelect(t.planet), trackSelect(data.tracksOnPlanet(t.planet), t.id)]
    if (events.length) rows.push(eventSelect(events))
    const scenarios = data.scenariosOnTrack(t.id)
    if (scenarios.length) rows.push(select('scenario', 'Pick a scenario', scenarios.map(sc => ({ label: sc.name, value: sc.id, description: `${sc.tier} · ${sc.style.name}`, emoji: emoji.vehicle[sc.vehicleClass] }))))
    return page(container, files, rows)
}

// --- planets ---

function planetInfo(planetId) {
    const p = data.planet(planetId)
    const tracks = data.tracksOnPlanet(p.id)
    const files = new Files()
    const container = new ContainerBuilder().setAccentColor(PLANET_COLORS[p.id] ?? DEFAULT_COLOR)

    header(container, [crumbs('Planets'), `## ${p.name}`, `**${p.tagline}**`], files.add(p.image))
    container.addTextDisplayComponents(text(p.description))
    container.addTextDisplayComponents(text(`**Conditions:** ${p.conditions.map(c => `${emoji.named(c.emoji)} ${c.name}`).join('   ') || 'None'}`))
    container.addSeparatorComponents(separator())
    // Tracks grouped by the vehicles they support, each group headed by those vehicles' emojis
    const groups = ['Speeders + Podracer', 'Speeders', 'Podracer']
        .map(v => [v, tracks.filter(t => t.vehicles == v)])
        .filter(([, list]) => list.length)
    container.addTextDisplayComponents(text(['**Tracks**', ...groups.map(([v, list]) =>
        [vehiclesEmoji(v), ...list.map(t => `**${t.name}** — ${t.format}`)].join('\n'))].join('\n\n')))

    return page(container, files, [planetSelect(p.id), trackSelect(tracks)])
}

// --- scenarios ---

function scenarioSelect(current) {
    return select('scenario', 'Pick a scenario',
        data.scenarios.map(sc => ({ label: sc.name, value: sc.id, description: `${sc.tier} · ${data.planet(sc.planet).name} · ${sc.style.name}`.slice(0, 100), emoji: emoji.vehicle[sc.vehicleClass] })), current)
}

// "Days 1–4", "Day 5"
const dayLabel = d => d.length > 1 && d[d.length - 1] - d[0] == d.length - 1 ? `Days ${d[0]}–${d[d.length - 1]}` : `Day${d.length > 1 ? 's' : ''} ${d.join(', ')}`

// A pool track: its name, then any variants beyond plain Forward ("+ [reverse]" when Forward is in the pool too)
function poolTrack(t) {
    const others = t.variants.map(v => variantLabel(v)).filter(Boolean)
    const forward = t.variants.length == 0 || t.variants.some(v => !variantLabel(v))
    return `**${data.track(t.track).name}**${others.length ? ` ${forward ? '+ ' : ''}${others.join(', ')}` : ''}`
}

function scenarioInfo(scenarioId) {
    const sc = data.scenario(scenarioId)
    const planet = data.planet(sc.planet)
    const files = new Files()
    const container = new ContainerBuilder().setAccentColor(PLANET_COLORS[sc.planet] ?? DEFAULT_COLOR)

    header(container, [
        crumbs('Scenarios', sc.tier),
        `# ${sc.name}`,
        `*${sc.tagline}*`,
        [`${emoji.planet[planet.id]} ${planet.name}`, `${emoji.named(sc.style.emoji)} ${sc.style.name}`, sc.difficulty].filter(Boolean).join(' / '),
        unlockLine(sc.unlock),
    ], files.add(sc.tile))
    container.addTextDisplayComponents(text(sc.details))

    container.addSeparatorComponents(separator())
    addBuild(container, files, sc, sc.vehicleClass)
    container.addTextDisplayComponents(text(`-# ${[
        sc.startingPower != null && `Starting power ${sc.startingPower}`,
        sc.partSlots != null && `${sc.partSlots} part slots`,
        sc.favorSlots != null && `${sc.favorSlots} favor slots`,
        sc.leagueTokens != null && `${sc.leagueTokens} league token${sc.leagueTokens == 1 ? '' : 's'}`,
    ].filter(Boolean).join(' / ')}`))

    // The schedule: each run of days with its event and the tracks it can draw
    container.addSeparatorComponents(separator())
    container.addTextDisplayComponents(text(sc.schedule.flatMap(d => [
        [`${emoji.named(d.emoji)} **${dayLabel(d.days)}**`, d.event == 'Race' ? null : d.event, d.mustWin && 'must win'].filter(Boolean).join(' / '),
        ...indented(d.tracks.map(t => `+ ${poolTrack(t)}`)),
    ]).join('\n')))

    const footer = [
        sc.winMessage && `Win: ${sc.winMessage}`,
        sc.repeatRewards && `Repeat wins: ${sc.repeatRewards}`,
    ].filter(Boolean)
    if (footer.length) container.addTextDisplayComponents(text(footer.map(l => `-# ${l}`).join('\n')))

    const poolTracks = [...new Set(sc.schedule.flatMap(d => d.tracks.map(t => t.track)))].map(data.track)
    const style = data.styles.find(st => st.name == sc.style.name)
    return page(container, files, [
        scenarioSelect(sc.id),
        trackSelect(poolTracks),
        ...(sc.parts.length ? [partSelect(sc.parts.map(x => data.partByName(x.name)).filter(Boolean))] : []),
        ...(abilitiesOf(sc).length ? [abilitySelect(abilitiesOf(sc))] : []),
        ...(style ? [buttons([`style_${style.id}`, style.name, emoji.named(style.emoji)])] : []),
    ])
}

// --- racer styles ---

// Imported text marks the game's inline keyword icons as {emoji:name}
const emojify = s => (s ?? '').replace(/\{emoji:(\w+)\}/g, (_, name) => emoji.named(name))

function styleSelect(current) {
    return select('style', 'Pick a racer style',
        data.styles.map(s => ({ label: s.name, value: s.id, description: s.description.slice(0, 100), emoji: emoji.named(s.emoji) })), current)
}

function styleInfo(styleId) {
    const st = data.style(styleId)
    const files = new Files()
    const container = new ContainerBuilder().setAccentColor(DEFAULT_COLOR)

    header(container, [
        crumbs('Racer Styles'),
        `# ${st.name}`,
        `*${st.description}*`,
        st.abilities.length && st.abilities.map(a => `${emoji.named(a.emoji)} ${a.name}`).join('   '),
    ].filter(Boolean), files.add(st.icon))

    // Each rank adds traits; its unlock goal last
    container.addSeparatorComponents(separator())
    container.addTextDisplayComponents(text(st.ranks.flatMap(r => [
        `### Level ${r.rank}`,
        ...r.traits.map(t => `-# ${emoji.named(t.emoji)} **${t.name}**: ${emojify(t.description)}`),
        unlockLine(r.unlock),
    ]).filter(Boolean).join('\n')))

    const scenarios = data.scenarios.filter(sc => sc.style.name == st.name)
    if (scenarios.length) {
        container.addTextDisplayComponents(text(['### Scenarios', ...scenarios.map(sc => `-# ${cls(sc.vehicleClass)} **${sc.name}** (${sc.tier})`)].join('\n')))
    }

    const rows = [styleSelect(st.id)]
    if (abilitiesOf(st).length) rows.push(abilitySelect(abilitiesOf(st), 'Starting abilities'))
    if (scenarios.length) rows.push(buttons(...scenarios.slice(0, 5).map(sc => [`scenario_${sc.id}`, sc.name, emoji.vehicle[sc.vehicleClass]])))
    return page(container, files, rows)
}

// --- parts ---

// Rarity as the game's pips, tinted per rarity: 4 slots drawn as two paired-pip emojis, pp<C|R|E|L><lit in the pair>
// or pp0 for an empty pair (see rarity_pips in tools/import_swgr.py)
const rarityPips = p => [Math.min(2, p.pips), Math.max(0, Math.min(2, p.pips - 2))]
    .map(k => emoji.named(k ? `pp${p.rarity[0]}${k}` : 'pp0')).join('')
const rarityText = p => p.pips ? `${rarityPips(p)} ${p.rarity}` : p.rarity

// A menu of parts (a build's, or a family's)
function partSelect(parts, current, placeholder = 'Look up a part') {
    return select('part', placeholder,
        parts.map(p => ({ label: p.name, value: p.id, description: p.description.slice(0, 100), emoji: emoji.named(p.emoji) })), current)
}

// The part card doubles as the parts finder: every card carries a keyword filter (multi-select) and the list of
// parts that mention all chosen keywords (25 to a page). Changing the filter or the page only refreshes those menus
// and leaves the current part on show; picking a part opens its card with the same filter.
//
// The state travels in component ids, so nothing is stored: the keyword selection is a base-36 bitmask of keyword
// ids ("0" = none), and the current part / list page ride along where needed:
//   parts_filter_<partId|->            keyword multi-select (list goes back to page 1)
//   parts_page_<partId|->_<mask>_<n>   list page buttons
//   part_pick_<mask>                   the list (value = part id)
//   part_<partId>_<mask>               tier buttons
const PARTS_PER_PAGE = 25
const keywordMask = ids => ids.reduce((m, id) => m | (1 << id), 0).toString(36)
const parseKeywordMask = code => {
    const m = parseInt(code || '0', 36) || 0
    return data.partKeywords.map(k => k.id).filter(id => m & (1 << id))
}

// The part list's entries: a family's tiers that share the same keywords become one entry ("Ramjet Cooling", or
// "Reconstituted Fuel I–II" when a later tier's keywords differ); the card's tier buttons switch between them.
const tierOf = p => p.name.match(/\s([IVX]+)$/)?.[1]
function partEntries(matches) {
    const entries = new Map()
    for (const p of matches) {
        const key = data.familyOf(p)[0].id + '|' + [...p.keywords].sort().join('+')
        if (!entries.has(key)) entries.set(key, [])
        entries.get(key).push(p)
    }
    return [...entries.values()].map(tiers => {
        const family = data.familyOf(tiers[0])
        const whole = tiers.length == family.length
        const base = tiers[0].name.replace(/\s+[IVX]+$/, '')
        return {
            tiers,
            label: tiers.length == 1 ? tiers[0].name : whole ? base : `${base} ${tierOf(tiers[0])}–${tierOf(tiers[tiers.length - 1])}`,
            description: tiers.length == 1 ? tiers[0].description : `${tiers.length} tiers · ${tiers[0].rarity}–${tiers[tiers.length - 1].rarity}`,
        }
    })
}

function partsMenus(current, keywordIds, pageNumber) {
    const mask = keywordMask(keywordIds)
    const matches = data.partsWithKeywords(keywordIds)
    const entries = partEntries(matches)
    const pages = Math.max(1, Math.ceil(entries.length / PARTS_PER_PAGE))
    // Without an explicit page, show the page holding the current part
    const at = current ? entries.findIndex(e => e.tiers.some(t => t.id == current.id)) : -1
    const pageIndex = Math.min(Math.max(1, pageNumber ?? (at >= 0 ? Math.floor(at / PARTS_PER_PAGE) + 1 : 1)), pages)
    const shown = entries.slice((pageIndex - 1) * PARTS_PER_PAGE, pageIndex * PARTS_PER_PAGE)

    const rows = [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
        .setCustomId(`parts_filter_${current?.id ?? '-'}`)
        .setPlaceholder('Filter parts by keywords')
        .setMinValues(0)
        .setMaxValues(Math.min(25, data.partKeywords.length))
        .addOptions(data.partKeywords.slice(0, 25).map(k => ({
            label: k.name,
            value: String(k.id),
            description: `${k.count} parts`,
            emoji: emoji.component(k.emoji ? emoji.named(k.emoji) : null) ?? (k.name == 'Faulty' ? { name: '⚠️' } : undefined),
            default: keywordIds.includes(k.id),
        }))))]
    const count = `${matches.length} part${matches.length == 1 ? '' : 's'}`
    if (shown.length) {
        rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
            .setCustomId(`part_pick_${mask}`)
            .setPlaceholder(keywordIds.length ? `${count} match` : `Pick a part (${count})`)
            // An entry opens its first tier, or stays on the current part when it's one of the entry's tiers
            .addOptions(shown.map(e => {
                const here = e.tiers.find(t => t.id == current?.id)
                return {
                    label: e.label.slice(0, 100), value: (here ?? e.tiers[0]).id, description: e.description.slice(0, 100),
                    emoji: emoji.component(emoji.named(e.tiers[0].emoji)), default: !!here,
                }
            }))))
    }
    if (pages > 1) {
        const id = current?.id ?? '-'
        rows.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`parts_page_${id}_${mask}_${pageIndex - 1}`).setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(pageIndex == 1),
            new ButtonBuilder().setCustomId('parts_pagenumber').setLabel(`${pageIndex} of ${pages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
            new ButtonBuilder().setCustomId(`parts_page_${id}_${mask}_${pageIndex + 1}`).setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(pageIndex == pages),
        ))
    }
    return { rows, matches }
}

// partId null = the starting card (/part with no name): just the finder
function partInfo(partId, keywordIds = [], pageNumber = null) {
    const p = partId ? data.part(partId) : null
    const files = new Files()
    const container = new ContainerBuilder().setAccentColor(DEFAULT_COLOR)
    const menus = partsMenus(p, keywordIds, pageNumber)

    if (!p) {
        const chosen = keywordIds.map(id => data.partKeywords[id])
        header(container, [
            crumbs('Parts'),
            '## Find a part',
            chosen.length
                ? `${menus.matches.length} part${menus.matches.length == 1 ? '' : 's'} with ${chosen.map(k => `${k.emoji ? emoji.named(k.emoji) + ' ' : ''}**${k.name}**`).join(' + ')}. Pick one below.`
                : `${menus.matches.length} parts. Filter by keywords, then pick one.`,
        ])
        return page(container, files, menus.rows)
    }

    header(container, [
        crumbs('Parts', p.category),
        `# ${p.name}`,
        partText(p),
        [rarityText(p), p.credits && `${emoji.credits} ${p.credits.toLocaleString('en-US')}`].filter(Boolean).join(' / '),
        unlockLine(p.unlock),
    ].filter(Boolean), files.add(p.icon))

    const family = p.family.map(data.part).filter(Boolean)
    const events = p.usedIn.events.map(data.event)
    const scenarios = p.usedIn.scenarios.map(data.scenario)
    const mask = keywordMask(keywordIds)
    // Each section's controls sit right under it: the tier buttons under Family, the Used in menu under the
    // arcade events / scenarios. The finder menus (filter, part list, pages) stay at the bottom.
    if (family.length > 1) {
        container.addSeparatorComponents(separator())
        container.addTextDisplayComponents(text(['### Family', ...family.map(f => `-# ${emoji.named(f.emoji)} ${f.id == p.id ? `**${f.name}**` : f.name}: ${partText(f)}`)].join('\n')))
        // Tiers as buttons (a family has at most 4): the numeral, with the current tier highlighted and disabled
        container.addActionRowComponents(new ActionRowBuilder().addComponents(family.map(f =>
            new ButtonBuilder()
                .setCustomId(`part_${f.id}_${mask}`)
                .setLabel(f.name.match(/[IVX]+$/)?.[0] ?? f.name)
                .setEmoji(emoji.component(emoji.named(f.emoji)))
                .setStyle(f.id == p.id ? ButtonStyle.Primary : ButtonStyle.Secondary)
                .setDisabled(f.id == p.id))))
    }
    if (events.length || scenarios.length) {
        container.addSeparatorComponents(separator())
        container.addTextDisplayComponents(text([
            ...(events.length ? ['### Arcade', ...events.map(e => `-# ${cls(e.vehicleClass)} **${e.name}** · ${e.vehicle}`)] : []),
            ...(scenarios.length ? ['### Scenarios', ...scenarios.map(sc => `-# ${cls(sc.vehicleClass)} **${sc.name}** (${sc.tier})`)] : []),
        ].join('\n')))
        // One menu for both (values are /search ids: "event:x", "scenario:y")
        container.addActionRowComponents(select('goto', 'Used in…', [
            ...events.map(e => ({ label: e.name, value: `event:${e.id}`, description: `Arcade · ${e.vehicle}`, emoji: emoji.vehicle[e.vehicleClass] })),
            ...scenarios.map(sc => ({ label: sc.name, value: `scenario:${sc.id}`, description: `Scenario · ${sc.tier}`, emoji: emoji.vehicle[sc.vehicleClass] })),
        ].slice(0, 25)))
    }

    // A divider keeps the finder (filter, part list, pages) apart from the card's own controls above it
    container.addSeparatorComponents(separator())
    return page(container, files, menus.rows)
}

// --- abilities ---

const ROMAN = ['', 'I', 'II', 'III', 'IV']
// Ability text: bold keywords with icons; values the game data doesn't have ({?duration}) show as ?
const abilityText = a => (a.rich ?? a.description)
    .replace(/\{\?\w+\}/g, '**?**')
    .replace(/\{emoji:(\w+)\}/g, (_, name) => emoji.named(name))

// Preflight inputs as the game's button glyphs (the importer's emoji per input), falling back to the button's name
const inputs = (seq, glyphs = []) => seq.split(' ').map((b, i) => glyphs[i] ? emoji.named(glyphs[i]) : `\`${b}\``).join(' ')
// The preflight reward, keeping only the parts written for people (the rest are raw tuning values)
function preflightReward(reward) {
    return reward.split(';').map(s => s.trim()).map(s =>
        s == 'first cooldown x0.5' ? 'first reload takes half the time'
            : /^(starts ready|first use improved)/.test(s) ? s
            : null).filter(Boolean).join(', ')
}

function abilityFamilySelect(current) {
    return select('ability_family', 'Pick an ability family',
        data.abilityFamilies.map(f => ({
            label: f.name, value: f.id, emoji: emoji.named(f.emoji),
            description: data.abilitiesInFamily(f.id).map(a => a.name).join(', ').slice(0, 100),
        })), current)
}

// A menu of abilities (a build's or a style's); value = ability id
function abilitySelect(list, placeholder = 'Look up an ability') {
    return select('ability', placeholder, list.map(a => ({
        label: a.name, value: a.id, description: a.description.slice(0, 100), emoji: emoji.named(a.emoji),
    })))
}

function abilitiesOverview() {
    const container = new ContainerBuilder().setAccentColor(DEFAULT_COLOR)
    header(container, [crumbs('Abilities'), '## Abilities', `${data.abilities.length} abilities in ${data.abilityFamilies.length} families.`])
    container.addSeparatorComponents(separator())
    container.addTextDisplayComponents(text(data.abilityFamilies.map(f =>
        `${emoji.named(f.emoji)} **${f.name}** · ${data.abilitiesInFamily(f.id).filter(a => a.id != data.abilitiesInFamily(f.id)[0].id).map(a => a.name).join(', ')}`).join('\n')))
    return page(container, new Files(), [abilityFamilySelect()])
}

function abilityInfo(abilityId) {
    const a = data.ability(abilityId)
    const family = data.abilitiesInFamily(a.family)
    const familyName = data.abilityFamilies.find(f => f.id == a.family)?.name ?? a.family
    const files = new Files()
    const container = new ContainerBuilder().setAccentColor(DEFAULT_COLOR)

    header(container, [
        crumbs('Abilities', familyName),
        `# ${a.name}`,
        abilityText(a),
        [a.tier && `Tier ${ROMAN[a.tier]}`, a.cooldown != null && `${a.cooldown}s reload`,
            a.energy != null && `${emoji.named('kw_Battery')} ${a.energy} Energy`,
            a.credits && `${emoji.credits} ${a.credits.toLocaleString('en-US')}`].filter(Boolean).join(' / '),
        unlockLine(a.unlock),
    ], files.add(a.icon))

    // The family by tier, this ability's place in it, and a button for each member
    container.addSeparatorComponents(separator())
    const tiers = [...new Set(family.map(f => f.tier))].sort()
    const names = ids => ids.map(id => `**${data.ability(id).name}**`).join(' or ')
    container.addTextDisplayComponents(text([
        '### Upgrades',
        ...tiers.map(t => `-# Tier ${ROMAN[t]}: ${family.filter(f => f.tier == t).map(f => `${emoji.named(f.emoji)} ${f.id == a.id ? `**${f.name}**` : f.name}`).join(' · ')}`),
        a.upgradesFrom.length && `-# Upgrades from ${names(a.upgradesFrom)}`,
        a.upgradesTo.length && `-# Upgrades into ${names(a.upgradesTo)}`,
    ].filter(Boolean).join('\n')))
    // A button per member while they fit in one row (5), otherwise a menu
    container.addActionRowComponents(family.length > 5
        ? select('ability', 'Pick an ability in this family', family.map(f => ({
            label: f.name, value: f.id, description: `Tier ${ROMAN[f.tier]}`, emoji: emoji.named(f.emoji),
        })), a.id)
        : new ActionRowBuilder().addComponents(family.map(f =>
            new ButtonBuilder()
                .setCustomId(`ability_${f.id}`)
                .setLabel(f.name)
                .setStyle(f.id == a.id ? ButtonStyle.Primary : ButtonStyle.Secondary)
                .setDisabled(f.id == a.id))))

    if (a.preflight) {
        const reward = preflightReward(a.preflight.reward)
        container.addSeparatorComponents(separator())
        container.addTextDisplayComponents(text([
            '### Preflight check',
            inputs(a.preflight.pad, a.preflight.inputs?.playstation),
            inputs(a.preflight.pad, a.preflight.inputs?.xbox),
            inputs(a.preflight.keyboard, a.preflight.inputs?.keyboard),
            reward && `-# Completing it: ${reward}`,
        ].filter(Boolean).join('\n')))
    }

    const used = [
        ...a.usedIn.events.map(data.event).map(e => ({ label: e.name, value: `event:${e.id}`, description: `Arcade · ${e.vehicle}`, emoji: emoji.vehicle[e.vehicleClass] })),
        ...a.usedIn.scenarios.map(data.scenario).map(sc => ({ label: sc.name, value: `scenario:${sc.id}`, description: `Scenario · ${sc.tier}`, emoji: emoji.vehicle[sc.vehicleClass] })),
        ...a.usedIn.styles.map(data.style).map(st => ({ label: st.name, value: `style:${st.id}`, description: 'Racer style (starting ability)', emoji: emoji.named(st.emoji) })),
    ]
    if (used.length) {
        container.addSeparatorComponents(separator())
        container.addTextDisplayComponents(text(['### Used in', ...used.map(u => `-# ${u.emoji ?? ''} **${u.label}** · ${u.description}`)].join('\n')))
        container.addActionRowComponents(select('goto', 'Used in…', used.slice(0, 25)))
    }
    if (/\{\?\w+\}/.test(a.rich ?? '')) container.addTextDisplayComponents(text("-# ? = a value the game files don't include"))

    container.addSeparatorComponents(separator())
    return page(container, files, [abilityFamilySelect(a.family)])
}

// --- vehicles ---

// Class > vehicle menus, broadest first
function vehicleClassSelect(current) {
    return select('vehicle_class', 'Pick a vehicle class', data.classes.map(c => ({
        label: c.name, value: c.id, emoji: emoji.vehicle[c.name],
        description: `${data.vehiclesInClass(c.name).length} vehicles / Advanced: ${c.advanced}`,
    })), current)
}
function vehicleSelect(className, current) {
    return select('vehicle', `Pick a ${className.toLowerCase()}`, data.vehiclesInClass(className).map(v => ({
        label: v.name, value: v.id, emoji: emoji.vehicle[v.class],
        description: (v.manufacturer ?? (v.pilot && `${v.pilot}'s podracer`) ?? v.class).slice(0, 100),
    })), current)
}
const vehicleLine = v => `-# **${v.name}**${v.manufacturer ? ` / ${v.manufacturer}` : v.pilot ? ` / ${v.pilot}` : ''}`

function vehiclesOverview() {
    const container = new ContainerBuilder().setAccentColor(DEFAULT_COLOR)
    header(container, [crumbs('Vehicles'), '# Vehicles', `${data.vehicles.length} vehicles in ${data.classes.length} classes. A speeder's model is cosmetic: its stats come from the build.`])
    container.addSeparatorComponents(separator())
    container.addTextDisplayComponents(text(data.classes.map(c =>
        `${emoji.vehicle[c.name]} **${c.name}** / ${data.vehiclesInClass(c.name).length} vehicles / ${emoji.named('stat_Advanced')} ${c.advanced}`).join('\n')))
    return page(container, new Files(), [vehicleClassSelect()])
}

function vehicleClassInfo(classId) {
    const c = data.vehicleClassById(classId)
    const files = new Files()
    const container = new ContainerBuilder().setAccentColor(DEFAULT_COLOR)
    header(container, [
        crumbs('Vehicles'),
        `# ${emoji.vehicle[c.name]} ${c.name}`,
        `*${emojify(c.description).split('\n\n')[0]}*`,
        `${emoji.named('stat_Advanced')} Advanced stat: **${c.advanced}**`,
    ], files.add(c.gif))

    if (c.traits.length) {
        container.addSeparatorComponents(separator())
        container.addTextDisplayComponents(text(['### Traits', ...c.traits.map(t => `-# **${t.name}**: ${emojify(t.description)}`)].join('\n')))
    }
    container.addSeparatorComponents(separator())
    container.addTextDisplayComponents(text([`### Vehicles`, ...data.vehiclesInClass(c.name).map(vehicleLine)].join('\n')))
    return page(container, files, [vehicleClassSelect(c.id), vehicleSelect(c.name)])
}

function vehicleInfo(vehicleId) {
    const v = data.vehicle(vehicleId)
    const c = data.classes.find(x => x.name == v.class)
    const files = new Files()
    const container = new ContainerBuilder().setAccentColor(DEFAULT_COLOR)
    const kp = n => `${emoji.named('KitPoints')} ${n} Kit Points`

    header(container, [
        crumbs('Vehicles', v.class),
        `# ${v.name}`,
        v.description && `*${v.description}*`,
        [v.manufacturer, v.pilot && `${v.pilot}'s podracer`, v.kitPoints && kp(v.kitPoints)].filter(Boolean).join(' / '),
        unlockLine(v.unlock),
    ], files.add(v.image))

    if (v.parts.length) {
        const costs = [...new Set(v.parts.map(p => p.cost).filter(Boolean))]
        container.addSeparatorComponents(separator())
        container.addTextDisplayComponents(text([
            '### Parts',
            `-# ${v.parts.map(p => p.slot).join(' / ')}`,
            `-# ${costs.length == 1 ? `${kp(costs[0])} each` : 'Included with the vehicle'} / they fit any ${v.class.toLowerCase()}, so models can be mixed`,
        ].join('\n')))
    }

    const events = v.events.map(data.event)
    const racers = v.racers.filter(r => r != v.pilot)
    if (racers.length || events.length) {
        container.addSeparatorComponents(separator())
        container.addTextDisplayComponents(text([
            ...(racers.length ? ['### Raced by', `-# ${racers.join(' / ')}`] : []),
            ...(events.length ? ['### Arcade', ...events.map(e => `-# ${emoji.planet[e.planet]} **${e.name}** / ${data.track(e.track).name}`)] : []),
        ].join('\n')))
    }

    const rows = [vehicleClassSelect(c.id), vehicleSelect(v.class, v.id)]
    const related = [
        ...racers.map(name => data.rivals.find(r => r.name == name)).filter(Boolean).map(r => ({ label: r.name, value: `rival:${r.id}`, description: 'Rival' })),
        ...events.map(e => ({ label: e.name, value: `event:${e.id}`, description: `Arcade / ${data.track(e.track).name}`, emoji: emoji.vehicle[e.vehicleClass] })),
    ]
    if (related.length) rows.push(select('goto', 'Rivals and arcade events with it', related))
    return page(container, files, rows)
}

// --- favors ---

function favorSelect(current) {
    return select('favor', 'Pick a favor', data.favors.map(f => ({
        label: f.name, value: f.id, emoji: emoji.named(f.emoji),
        description: `${f.character} / ${f.ranks[0].description}`.slice(0, 100),
    })), current)
}

function favorsOverview() {
    const container = new ContainerBuilder().setAccentColor(DEFAULT_COLOR)
    header(container, [crumbs('Favors'), '# Favors', `${data.favors.length} favors, each with three ranks. Equip them before a tour; a rank unlocks by completing planets with the one before it equipped.`])
    container.addSeparatorComponents(separator())
    container.addTextDisplayComponents(text(data.favors.map(f => `${emoji.named(f.emoji)} **${f.name}** / ${f.character}`).join('\n')))
    return page(container, new Files(), [favorSelect()])
}

function favorInfo(favorId) {
    const f = data.favor(favorId)
    const files = new Files()
    const container = new ContainerBuilder().setAccentColor(DEFAULT_COLOR)
    header(container, [
        crumbs('Favors', f.character),
        `# ${f.name}`,
        emojify(f.ranks[0].rich),
        unlockLine(f.ranks[0].unlock),
    ], files.add(f.icon))

    // Rank I is the header; later ranks show what they change and how they unlock
    if (f.ranks.length > 1) {
        container.addSeparatorComponents(separator())
        container.addTextDisplayComponents(text(f.ranks.slice(1).flatMap(r => [
            `### Rank ${ROMAN[r.rank]}`,
            emojify(r.rich),
            unlockLine(r.unlock),
        ]).filter(Boolean).join('\n')))
    }
    const rival = data.rivals.find(r => r.favor == f.id)
    return page(container, files, [favorSelect(f.id), ...(rival ? [buttons([`rival_${rival.id}`, `About ${rival.name}`])] : [])])
}

// --- rivals ---

function rivalSelect(current) {
    return select('rival', 'Pick a rival', data.rivals.map(r => ({
        label: r.name, value: r.id, emoji: r.favor ? emoji.named(data.favor(r.favor).emoji) : emoji.named(r.livery?.emoji),
        description: r.champion ? 'Galactic League Champion' : `Favor: ${r.favor ? data.favor(r.favor).name : 'none'}`,
    })), current)
}

function rivalsOverview() {
    const container = new ContainerBuilder().setAccentColor(DEFAULT_COLOR)
    header(container, [crumbs('Rivals'), '# Rivals',
        `${data.rivals.filter(r => !r.champion).length} rivals to challenge to Head-to-Head races over the campaign, and the champion, Kestar Bool.`])
    container.addSeparatorComponents(separator())
    container.addTextDisplayComponents(text(data.rivals.map(r =>
        `${emoji.named(r.livery?.emoji)} **${r.name}** / ${r.vehicles.map(id => data.vehicle(id)).map(v => `${emoji.vehicle[v.class]} ${v.name}`).join(', ')}`).join('\n')))
    return page(container, new Files(), [rivalSelect()])
}

function rivalInfo(rivalId) {
    const r = data.rival(rivalId)
    const files = new Files()
    const container = new ContainerBuilder().setAccentColor(DEFAULT_COLOR)
    const vehicles = r.vehicles.map(data.vehicle)
    header(container, [
        crumbs('Rivals', ...(r.champion ? ['Champion'] : [])),
        `# ${r.name}`,
        r.bio && `*${r.bio}*`,
        vehicles.map(v => `${emoji.vehicle[v.class]} ${v.name}`).join(' / '),
        r.afterTour2 && '-# Only appears once Tour 2 is done',
    ], files.add(r.holo))

    if (r.headToHead.length) {
        container.addSeparatorComponents(separator())
        container.addTextDisplayComponents(text(['### Head-to-Head', '-# Raced on one of these, 2 laps:',
            ...r.headToHead.map(h => {
                const t = h.track && data.track(h.track)
                return `-# ${t ? emoji.planet[t.planet] : ''} **${h.name}**${h.reverse ? ` ${emoji.named('reverse')}` : ''} / ${h.condition}`
            })].join('\n')))
    }

    const favor = r.favor && data.favor(r.favor)
    if (favor || r.livery) {
        container.addSeparatorComponents(separator())
        container.addTextDisplayComponents(text(['### Unlocks',
            ...(favor ? [`${emoji.named(favor.emoji)} **${favor.name}** favor: ${emojify(favor.ranks[0].rich)}`, unlockLine(favor.ranks[0].unlock)] : []),
            ...(r.livery ? [`${emoji.named(r.livery.emoji)} **${r.livery.name}** livery palette`, unlockLine(r.livery.unlock)] : []),
        ].filter(Boolean).join('\n')))
    }

    const related = [
        favor && { label: favor.name, value: `favor:${favor.id}`, description: 'Favor', emoji: emoji.named(favor.emoji) },
        r.scenario && { label: data.scenario(r.scenario).name, value: `scenario:${r.scenario}`, description: `Scenario / ${data.scenario(r.scenario).tier}`, emoji: emoji.vehicle[data.scenario(r.scenario).vehicleClass] },
        ...vehicles.map(v => ({ label: v.name, value: `vehicle:${v.id}`, description: `Vehicle / ${v.class}`, emoji: emoji.vehicle[v.class] })),
        ...[...new Set(r.headToHead.map(h => h.track).filter(Boolean))].map(id => data.track(id)).map(t => ({ label: t.name, value: `track:${t.id}`, description: 'Head-to-Head track', emoji: emoji.planet[t.planet] })),
    ].filter(Boolean)
    return page(container, files, [rivalSelect(r.id), ...(related.length ? [select('goto', 'Their favor, scenario, vehicles and tracks', related)] : [])])
}

module.exports = { rivalInfo, rivalsOverview, favorInfo, favorsOverview, vehicleInfo, vehicleClassInfo, vehiclesOverview, abilityInfo, abilitiesOverview, arcadeOverview, arcadeCategory, arcadeEvent, trackInfo, planetInfo, scenarioInfo, styleInfo, partInfo, parseKeywordMask }
