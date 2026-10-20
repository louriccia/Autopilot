// Page builders for the reference commands, as Components V2 messages. Each returns a full payload
// ({ components, files, flags }) so a slash command can reply with it and a select/button can swap it in place.
const path = require('path')
const {
    MessageFlags, AttachmentBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle,
    ContainerBuilder, TextDisplayBuilder, SectionBuilder, ThumbnailBuilder, MediaGalleryBuilder, SeparatorBuilder,
} = require('discord.js')
const data = require('./data.js')
const records = require('../records.js')
const viewer = require('../viewer.js')
const credits = require('../credits.js')
const emoji = require('../data/discord/emoji.js')
const garage = require('./garage.js')

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

// Text already on a card (Discord counts every text display toward its 4000 characters)
const textLength = container => {
    let n = 0
    const walk = c => { if (c.type == 10) n += c.content.length; (c.components ?? []).forEach(walk); if (c.accessory) walk(c.accessory) }
    walk(container.toJSON())
    return n
}
// Community times (src/records.js): one line per person's best, the time linked to its proof when there is one
const boardTime = s => `**\`${formatTime(s)}\`**`
const place = rank => rank <= 10 ? emoji.named(`place_${rank}`) : `**#${rank}**`
// A time's platform as the game's logo (platform_PC / _PS5 / _Xbox); anything else in words
const platformMark = p => !p ? '' : records.PLATFORMS.includes(p) ? ` ${emoji.named(`platform_${p}`)}` : ` / ${p}`
// The viewer's declared rival (/times rival) gets the rival marker
const timeLine = (t, rank) => `${place(rank)} ${t.proof ? `[${boardTime(t.time)}](<${t.proof}>)` : boardTime(t.time)} <@${t.user}>${platformMark(t.platform)}${t.user == records.rivalOf(viewer.id()) ? ` ${emoji.named('rival')}` : ''}`
// A board's open bounties (/bounty): the pot, the time to beat and when it ends
// (at the top of its leaderboard): "[bounty] 54.00 [credits] 100 (expires in 14 days)"
const bountyLines = (kind, target) => credits.openBounties(kind, target).map(b =>
    `${emoji.named('bounty')} ${boardTime(b.under)} ${emoji.named('credits')} **${b.pot.toLocaleString('en-US')}** (expires <t:${Math.floor(b.expires / 1000)}:R>)`)

// The public message for a newly posted bounty (the card's "Set a bounty" and /bounty post)
function bountyPosted(b) {
    // An event or scenario, with its planet; or a cumulative board (all 50, or a category), won by a racer's total
    const what = b.kind == 'aggregate'
        ? `the first total under ${boardTime(b.under)} across **${b.target == 'main' ? `${emoji.named('stopwatch')} all ${MAIN_EVENTS().length} events` : `${categoryEmoji(data.category(b.target))} all of ${data.category(b.target).name}`}**`
        : (item => `the first run under ${boardTime(b.under)} on **${[emoji.planet[item.planet], item.name].filter(Boolean).join(' ')}**`)(b.kind == 'arcade' ? data.event(b.target) : data.scenario(b.target))
    return {
        content: [`**${emoji.named('bounty')} Bounty posted**`,
            `**${emoji.named('credits')} ${b.pot.toLocaleString('en-US')}** for ${what} with a screenshot or video`,
            `-# expires <t:${Math.floor(b.expires / 1000)}:R>`].join('\n'),
        allowedMentions: { parse: [] },
    }
}
// A board's community times as shown: the top 5, plus whoever is looking (src/viewer.js) with the places either side
// of theirs, and their rival if they're further down
const shownTimes = (kind, target) => {
    const board = records.leaderboard(kind, target).map((t, i) => ({ ...t, rank: i + 1 }))
    const me = viewer.id(), rival = records.rivalOf(me)
    const mine = board.find(t => t.user == me)?.rank
    return board.filter(t => t.rank <= 5 || (mine && Math.abs(t.rank - mine) <= 1) || (rival && t.user == rival))
}
// Submit a time, then rate the event / scenario with the three thumbs (counts on the buttons)
function recordButtons(kind, target) {
    const counts = records.feedbackCounts(kind, target)
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`time_open_${kind}_${target}`).setLabel('Submit').setEmoji(emoji.named('stopwatch')).setStyle(ButtonStyle.Primary),
        ...[['up', emoji.thumbsUp], ['neutral', emoji.thumbsNeutral], ['down', emoji.thumbsDown]].map(([r, e]) =>
            new ButtonBuilder().setCustomId(`rate_${kind}_${target}_${r}`).setLabel(String(counts[r])).setEmoji(emoji.component(e)).setStyle(ButtonStyle.Secondary)))
}
// A board's leaderboard text with "Set a bounty" beside it (like the track button beside an event's details), which
// posts a bounty on the board from your credits (interactions/bounty.js)
function addLeaderboard(container, kind, target, content) {
    container.addSectionComponents(new SectionBuilder()
        .addTextDisplayComponents(text(content))
        .setButtonAccessory(new ButtonBuilder().setCustomId(`bounty_open_${kind}_${target}`).setEmoji(emoji.component(emoji.named('bounty'))).setStyle(ButtonStyle.Secondary)))
}

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
    return { components: [container], files: files.list, flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } }
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

// The categories, after an Overview option back to the arcade's front page (value 'overview'); each says how many of
// its events the viewer has a time on ("3/6 events")
function categorySelect(current = 'overview') {
    const me = viewer.id()
    const mine = new Set(me ? records.allTimes().filter(t => t.user == me && t.kind == 'arcade').map(t => t.target) : [])
    const count = events => me ? `${events.filter(e => mine.has(e.id)).length}/${events.length} events` : `${events.length} events`
    return select('arcade_category', 'Browse a category', [
        { label: 'Overview', value: 'overview', description: `${count(MAIN_EVENTS())}: the cumulative leaderboard`, emoji: setEmoji(MAIN_EVENTS(), me) ?? emoji.named('stopwatch') },
        ...data.categories.map(c => ({ label: c.name, value: c.id, description: count(data.eventsInCategory(c.id)), emoji: setEmoji(data.eventsInCategory(c.id), me) ?? categoryEmoji(c) })),
    ], current)
}

// How the viewer stands on a whole set of events once they have a time on every one, like standingEmoji for one event:
// their worst medal across the set (the tick if any is below bronze), upgraded to their place on the set's cumulative
// leaderboard when that's gold and in the top 10. null until the set is complete.
function setEmoji(events, me) {
    if (!me) return null
    const bests = events.map(e => records.leaderboard('arcade', e.id).find(t => t.user == me))
    if (bests.some(t => !t)) return null
    const medals = ['gold', 'silver', 'bronze']
    const worst = Math.max(...events.map((e, i) => { const m = medals.findIndex(m => bests[i].time <= e.medals[m].seconds); return m < 0 ? 3 : m }))
    if (worst == 3) return emoji.named('tick')
    const rank = records.cumulative('arcade', events.map(e => e.id)).ranked.find(t => t.user == me)?.rank
    return worst == 0 && rank <= 10 ? emoji.named(`place_${rank}`) : emoji.medal[medals[worst]]
}

// Each event's emoji is how the viewer stands on it: the best medal their time beats, upgraded to their place
// (place_1 to place_10) once it's gold and in the top 10 (a "1st" on a thin board with a silver time would oversell
// it); the game's tick for a time below bronze; with no time, its vehicle class
const standingEmoji = (e, time, rank) => {
    const medal = ['gold', 'silver', 'bronze'].find(m => time <= e.medals[m].seconds)
    return medal == 'gold' && rank <= 10 ? emoji.named(`place_${rank}`) : medal ? emoji.medal[medal] : emoji.named('tick')
}
function eventSelect(events, current) {
    const me = viewer.id()
    return select('arcade_event', 'Pick an event',
        events.map(e => {
            const board = me ? records.leaderboard('arcade', e.id) : []
            const rank = board.findIndex(t => t.user == me) + 1
            return {
                label: e.name,
                value: e.id,
                description: `${data.track(e.track).name} · ${e.vehicle} · Gold ${e.medals.gold.time}`.slice(0, 100),
                emoji: rank ? standingEmoji(e, board[rank - 1].time, rank) : emoji.vehicle[e.vehicleClass],
            }
        }), current)
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

// Discord strips leading spaces, so spacing uses em spaces (U+2003), which it keeps
const INDENT = '\u2003\u2003'

function trackSelect(tracks, current) {
    return select('track', 'Pick a track',
        tracks.map(t => ({ label: t.name, value: t.id, description: `${t.format} · ${t.vehicles}`, emoji: emoji.planet[t.planet] })), current)
}


// --- arcade ---

// The main arcade set: every event but the Deluxe pack's (paid extras not everyone has)
const MAIN_EVENTS = () => data.events.filter(e => e.category != 'Deluxe')

// A cumulative leaderboard over some events: the summed medal times, then everyone with a time on all of them by their
// summed bests (top 5, the viewer and their rival), fastest first; plus how many have them all, and the viewer's count
// target: the bounty board it is ('main' or a category id), whose open bounties lead it
function cumulativeBoard(events, target) {
    const { ranked } = records.cumulative('arcade', events.map(e => e.id))
    const me = viewer.id(), rival = records.rivalOf(me)
    const board = [
        ...['gold', 'silver', 'bronze'].map(m => {
            const seconds = events.reduce((n, e) => n + e.medals[m].seconds, 0)
            return { seconds, line: `${emoji.medal[m]} ${boardTime(seconds)} ${m[0].toUpperCase() + m.slice(1)} medals` }
        }),
        ...ranked.filter(t => t.rank <= 5 || t.user == me || t.user == rival).map(t => ({ seconds: t.time, line: timeLine(t, t.rank) })),
    ].sort((a, b) => a.seconds - b.seconds)
    return [...bountyLines('aggregate', target), ...board.map(b => b.line), `-# Total time across all ${events.length} events`].join('\n')
}

// The arcade's front page and a racer's timesheet in one card (/arcade, the category menu's Overview, /timesheet):
// their profile (credits and backer; events with a time over the main set as a stat bar; medals and podium places;
// their rival and the head to head), then the all-events leaderboard, with the categories in the menu.
// racer: { id, name, avatar } (the viewer, or /timesheet's racer); without one, just the leaderboard.
function arcadeOverview(racer) {
    const files = new Files()
    const container = new ContainerBuilder().setAccentColor(DEFAULT_COLOR)
    const events = MAIN_EVENTS()
    const gap = '​'  // a blank line (empty lines are dropped)
    if (racer) {
        const results = arcadeResults(racer.id)
        const mine = events.map(e => results[e.id]).filter(Boolean)
        const count = (key, value) => mine.filter(r => r[key] == value).length
        const rival = records.rivalOf(racer.id)
        header(container, [
            `# ${racer.name}`,
            creditsLine(racer.id),
            gap,
            `${mine.length}/${events.length} events ${segments(Math.round(mine.length / events.length * 10))}`,
            mine.length && `${emoji.named('stopwatch')} ${boardTime(mine.reduce((n, r) => n + r.time, 0))}`,  // their bests summed
            ['gold', 'silver', 'bronze'].map(m => `${emoji.medal[m]} ${count('medal', m)}`).join(' / '),
            [1, 2, 3].map(n => `${place(n)} ${count('rank', n)}`).join(' / '),
            ...(rival ? [gap, `${emoji.named('rival')} <@${rival}>`, rivalSummary(headToHead(events, results, arcadeResults(rival)), racer.id == viewer.id())] : []),
        ], racer.avatar)
    } else {
        header(container, ['## Arcade'])
    }
    container.addSeparatorComponents(separator())
    addLeaderboard(container, 'aggregate', 'main', cumulativeBoard(events, 'main'))
    const recent = racer && recentSelect(racer.id)
    return page(container, files, [categorySelect(), recent].filter(Boolean))
}

// "3 hours ago" (menus can't show Discord's live timestamps, so this is as of the card's drawing)
const ago = ms => {
    const units = [['year', 365 * 864e5], ['month', 30 * 864e5], ['day', 864e5], ['hour', 36e5], ['minute', 6e4]]
    const [unit, size] = units.find(([, size]) => Date.now() - ms >= size) ?? []
    if (!unit) return 'just now'
    const n = Math.floor((Date.now() - ms) / size)
    return `${n} ${unit}${n == 1 ? '' : 's'} ago`
}

// A racer's latest arcade runs (up to 25, newest first) as a menu that opens each one's board: the event and time, then
// where it places on the board now, what it took off their previous best there (or that it was their first), and when
// it happened. Values carry the run's position (<event>:<n>), since one event can appear more than once; arcade.js
// drops it.
function recentSelect(userId) {
    const mine = records.allTimes().filter(t => t.kind == 'arcade' && t.user == userId && data.event(t.target))
    if (!mine.length) return null
    return select('arcade_event_recent', 'See recent runs', mine.slice(0, 25).map((t, i) => {
        const e = data.event(t.target)
        const before = Math.min(...mine.filter(o => o.target == t.target && o.date < t.date).map(o => o.time))
        const gain = before == Infinity ? 'first time' : t.time < before ? `−${formatTime(before - t.time)}` : null
        const rank = records.leaderboard('arcade', t.target).filter(o => o.user != userId && o.time < t.time).length + 1
        return {
            label: `${e.name} ${formatTime(t.time)}`,
            value: `${e.id}:${i}`,
            description: [ordinal(rank), gain, ago(t.date)].filter(Boolean).join(' · '),
            emoji: standingEmoji(e, t.time, rank),  // as in the event menus, for this run's time and place
        }
    }))
}

function arcadeCategory(categoryId) {
    const category = data.category(categoryId)
    const events = data.eventsInCategory(categoryId)
    const files = new Files()
    const container = new ContainerBuilder().setAccentColor(DEFAULT_COLOR)
    header(container, [crumbs('Arcade'), `## ${categoryEmoji(category)} ${category.name}`], files.add(category.icon))

    // The cumulative leaderboard (cumulativeBoard): summed medal times and each racer's summed bests, with the bounty
    // button beside it
    container.addSeparatorComponents(separator())
    addLeaderboard(container, 'aggregate', categoryId, cumulativeBoard(events, categoryId))
    return page(container, files, [categorySelect(categoryId), eventSelect(events)])
}

// A build section (arcade events and scenarios): vehicle and speed as a heading, the six upgrade stats as bare bars
// (icon + segments), max energy, abilities, with the class's animation on the right; then the parts.
// Whether a card message currently shows its build's details (its button offers to hide them), so a redraw of the
// same card (a rating, a submission, a bounty) keeps them as they were
const buildExpanded = message => /"details_[^"]*_hide"/.test(JSON.stringify(message?.components?.map(c => c.toJSON?.() ?? c) ?? []))

// The build starts condensed: one line (vehicle, speed, how many parts and abilities) with "Show details" beside it,
// like the track line; shown (expanded), the line gets "Hide details" and the full build follows. The state lives in
// the button (details_<kind>_<target>_<show|hide>) and survives redraws of the same card (buildExpanded).
// A build's stats in two columns, in the game's order down each: Cornering / Afterburner / Resilience, then Ramjet /
// Battery / Advanced. As small text (-#), which shrinks the emojis, so both columns fit beside the thumbnail on
// a phone; one en space between them. Max Energy last.
function statLines(build, maxEnergy) {
    const stat = s => `${emoji.named(s.emoji)}${segments(s.level)}`
    const half = Math.ceil(build.length / 2)
    return [
        ...build.slice(0, half).map((s, i) => `-# ${[stat(s), build[half + i] && stat(build[half + i])].filter(Boolean).join(' ')}`),
        `*Max Energy* ${'●'.repeat(maxEnergy)}${'○'.repeat(Math.max(0, MAX_ENERGY - maxEnergy))}`,
    ]
}

function addBuild(container, files, b, title, { kind, target, expanded = false } = {}) {
    const parts = b.parts.length, abilities = abilitiesOf(b).length
    container.addSectionComponents(new SectionBuilder()
        .addTextDisplayComponents(text([`${cls(b.vehicleClass)} **${title}**`, `${emoji.named(b.speed.emoji)} ${b.speed.value} km/h`,
            [parts && `${parts} part${parts == 1 ? '' : 's'}`, abilities && `${abilities} abilit${abilities == 1 ? 'y' : 'ies'}`].filter(Boolean).join(', ')].filter(Boolean).join(' / ')))
        .setButtonAccessory(new ButtonBuilder().setCustomId(`details_${kind}_${target}_${expanded ? 'hide' : 'show'}`)
            .setEmoji(emoji.component(emoji.named(expanded ? 'chevron_up' : 'chevron_down')))
            .setStyle(ButtonStyle.Secondary)))
    if (!expanded) return
    header(container, statLines(b.build, b.maxEnergy), files.add(data.vehicleClass(b.vehicleClass)?.gif))
    // The build's parts and abilities, looked up from one menu right under it
    const options = [
        ...b.parts.map(x => data.partByName(x.name)).filter(Boolean).map(p => ({ label: p.name, value: `part:${p.id}`, description: p.description.slice(0, 100), emoji: emoji.named(p.emoji) })),
        ...abilitiesOf(b).map(a => ({ label: a.name, value: `ability:${a.id}`, description: a.description.slice(0, 100), emoji: emoji.named(a.emoji) })),
    ]
    if (options.length) container.addActionRowComponents(select('goto', 'View parts and abilities', options))
}

// expanded: the build's details shown (addBuild)
function arcadeEvent(eventId, { expanded = false } = {}) {
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
    ], files.add(e.tile))
    // Where it runs: the track's name on a button to its card (with its planet's emoji), the rest of the line beside it
    container.addSectionComponents(new SectionBuilder()
        .addTextDisplayComponents(text([e.direction == 'Reverse' ? emoji.named('reverse') : e.direction == 'Forward' ? null : e.direction, track.format != 'Point-to-point' && laps(e.laps), e.condition, ...e.notes].filter(Boolean).join(' / ') || '​'))
        .setButtonAccessory(new ButtonBuilder().setCustomId(`track_${track.id}`).setLabel(track.name.slice(0, 80)).setEmoji(emoji.component(emoji.planet[planet.id])).setStyle(ButtonStyle.Secondary)))
    if (e.unlock) container.addTextDisplayComponents(text(unlockLine(e.unlock)))

    container.addSeparatorComponents(separator())
    addBuild(container, files, e, e.vehicle, { kind: 'arcade', target: e.id, expanded })
    // the event's speeder as the game dresses it, in the garage
    const open = garage.openId(e.livery)
    if (open) container.addActionRowComponents(buttons([open, 'Customize', emoji.vehicle[e.vehicleClass]]))

    // Leaderboard, fastest first: the medal rivals, staff times (Fuse's logo, or the publisher's), the community's
    // top 5 and the viewer's own best with its neighbours. A viewer with a time sees the medals still ahead of it and
    // only the best one it beats (all three without a time).
    container.addSeparatorComponents(separator())
    const mine = records.leaderboard('arcade', e.id).find(t => t.user == viewer.id())?.time
    const beaten = mine == null ? null : ['gold', 'silver', 'bronze'].find(m => mine <= e.medals[m].seconds)
    const medals = Object.entries(e.medals).filter(([m, x]) => mine == null || m == beaten || mine > x.seconds)
    const board = [
        ...medals.map(([m, x]) => ({ seconds: x.seconds, line: `${emoji.medal[m]} ${boardTime(x.seconds)} ${x.rival}` })),
        ...records.staffTimes(e.id).map(s => ({ seconds: s.seconds, line: `${emoji.named(s.from == 'publisher' ? 'publisher' : 'staff')} ${boardTime(s.seconds)} ${s.user ? `<@${s.user}>` : s.name}` })),
        ...shownTimes('arcade', e.id).map(t => ({ seconds: t.time, line: timeLine(t, t.rank) })),
    ].sort((a, b) => a.seconds - b.seconds)
    addLeaderboard(container, 'arcade', e.id, [...bountyLines('arcade', e.id), ...board.map(b => b.line)].join('\n'))

    return page(container, files, [
        categorySelect(e.category),
        eventSelect(data.eventsInCategory(e.category), e.id),
        recordButtons('arcade', e.id),
    ])
}

// --- tracks ---

function trackInfo(trackId) {
    const t = data.track(trackId)
    const planet = data.planet(t.planet)
    const events = data.eventsOnTrack(t.id)
    const files = new Files()
    const container = new ContainerBuilder().setAccentColor(PLANET_COLORS[t.planet] ?? DEFAULT_COLOR)

    // "Loop / [vehicles] Speeders + Podracer / 2 laps", then the variants
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

    // Where it's raced, by name only: variants, conditions and laps for each are on the event / scenario pages
    const scenarios = data.scenariosOnTrack(t.id)
    const raced = [
        scenarios.length && `-# **Scenarios**: ${scenarios.map(sc => `${cls(sc.vehicleClass)} ${sc.name}`).join(', ')}`,
        events.length && `-# **Arcade**: ${events.map(e => `${cls(e.vehicleClass)} ${e.name}`).join(', ')}`,
        t.campaign.length && `-# **Campaign**: ${[...new Set(t.campaign.map(c => c.act))].join(', ')}`,
    ].filter(Boolean)
    if (raced.length) {
        container.addSeparatorComponents(separator())
        container.addTextDisplayComponents(text(['### Raced in', ...raced].join('\n')))
    }

    const rows = [planetSelect(t.planet), trackSelect(data.tracksOnPlanet(t.planet), t.id)]
    if (events.length) rows.push(eventSelect(events))
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

// A pool track: its name, then any variants beyond plain Forward ("+ [reverse]" when Forward is in the pool too),
// its conditions and (for races on loop tracks) laps
function poolTrack(t, { laps: showLaps = false } = {}) {
    const track = data.track(t.track)
    const others = t.variants.map(v => variantLabel(v)).filter(Boolean)
    const forward = t.variants.length == 0 || t.variants.some(v => !variantLabel(v))
    return [`**${track.name}**${others.length ? ` ${forward ? '+ ' : ''}${others.join(', ')}` : ''}`,
        (t.conditions ?? []).join(', '),
        showLaps && track.format != 'Point-to-point' && laps(track.defaultLaps)].filter(Boolean).join(' / ')
}

function scenarioInfo(scenarioId, { expanded = false } = {}) {
    const sc = data.scenario(scenarioId)
    const planet = data.planet(sc.planet)
    const files = new Files()
    const container = new ContainerBuilder().setAccentColor(PLANET_COLORS[sc.planet] ?? DEFAULT_COLOR)

    const style = data.styles.find(st => st.name == sc.style.name)
    header(container, [
        crumbs('Scenarios', sc.tier),
        `# ${sc.name}`,
        `*${sc.tagline}*`,
    ], files.add(sc.tile))
    // Where and how hard, beside a button to the character it's named after (like an arcade event's track button)
    const racer = data.racers.find(r => r.name == sc.name)
    sectionWithButton(container, [[`${emoji.planet[planet.id]} ${planet.name}`, sc.difficulty].filter(Boolean).join(' / ')],
        racer && [`character_${racer.id}`, racer.name, face(racer.name)])
    if (sc.unlock) container.addTextDisplayComponents(text(unlockLine(sc.unlock)))
    // The details (which describe the racer style), with the style's name on a button to its card beside them
    if (style) {
        container.addSectionComponents(new SectionBuilder()
            .addTextDisplayComponents(text(sc.details))
            .setButtonAccessory(new ButtonBuilder().setCustomId(`style_${style.id}`).setLabel(style.name.slice(0, 80)).setEmoji(emoji.component(emoji.named(style.emoji))).setStyle(ButtonStyle.Secondary)))
    } else {
        container.addTextDisplayComponents(text(sc.details))
    }

    container.addSeparatorComponents(separator())
    addBuild(container, files, sc, sc.vehicleClass, { kind: 'scenario', target: sc.id, expanded })

    // The schedule: each run of days with its event and the tracks it can draw
    container.addSeparatorComponents(separator())
    container.addTextDisplayComponents(text(sc.schedule.flatMap(d => [
        [`${emoji.named(d.emoji)} **${dayLabel(d.days)}**`, d.event == 'Race' ? null : d.event, d.mustWin && 'must win'].filter(Boolean).join(' / '),
        ...d.tracks.map(t => `-# ${INDENT}+ ${poolTrack(t, { laps: !/Eliminator/.test(d.event) })}`),  // eliminators are timed
    ]).join('\n')))

    // Community times: the top 5 and the viewer's own best, as many as fit under Discord's text limit
    const used = textLength(container)
    const lines = []
    for (const t of shownTimes('scenario', sc.id)) {
        if (used + 30 + [...lines, timeLine(t, t.rank)].join('\n').length > TEXT_LIMIT) break  // 30: the heading
        lines.push(timeLine(t, t.rank))
    }
    container.addSeparatorComponents(separator())
    addLeaderboard(container, 'scenario', sc.id, ['### Times', ...bountyLines('scenario', sc.id), ...(lines.length ? lines : ['-# No times yet. Be the first to submit one!'])].join('\n'))

    return page(container, files, [
        scenarioSelect(sc.id),
        recordButtons('scenario', sc.id),
    ])
}

// --- credits ---

// "Credits 12,345 / [Hutt] The Hutt" (with when a new backer starts counting)
function creditsLine(user) {
    const rec = credits.backerRecord(user), b = rec && credits.BACKERS[rec.backer]
    const counts = rec && rec.since + 24 * 60 * 60 * 1000
    return `${emoji.named('credits')} **${credits.balance(user).toLocaleString('en-US')}**${b ? ` / ${emoji.named(b.emoji)} ${b.name}${counts > Date.now() ? ` (counts <t:${Math.floor(counts / 1000)}:R>)` : ''}` : ''}`
}

// The board a ledger entry is about ('arcade:<id>', 'scenario:<id>', 'aggregate:<main | category>'), if any: runs and
// bounty wins carry it, bounty postings and expiries through their bounty, ratings in their ref (rate:<kind>:<target>)
const ledgerBoard = e => e.board
    ?? (e.ref?.startsWith('rate:') ? e.ref.slice(5) : null)
    ?? (b => b && `${b.kind}:${b.target}`)(e.reason?.startsWith('bounty') && credits.bounty(e.ref))

// A racer's last 25 ledger entries as a menu: the amount and the board, then what it was for and how long ago; picking
// one opens its board (ledger_<racer>, values <board | ->:<n>)
function ledgerSelect(userId) {
    const recent = credits.history(userId).slice(0, 25)
    if (!recent.length) return null
    return select(`ledger_${userId}`, 'Recent transactions', recent.map((e, i) => {
        const board = ledgerBoard(e)
        const [kind, target] = board ? [board.slice(0, board.indexOf(':')), board.slice(board.indexOf(':') + 1)] : []
        const item = kind == 'arcade' ? data.event(target) : kind == 'scenario' ? data.scenario(target) : null
        const name = board && credits.boardName(kind, target)
        // a run's lines, without the board's name the label already gives ("first time on Salt Mines" -> "first time")
        const what = e.reason == 'run' ? (e.lines ?? []).filter(l => l.amount > 0).map(l => l.label.replace(` on ${name}`, '')).join(', ') || 'run' : e.reason
        return {
            label: `${e.amount > 0 ? '+' : e.amount < 0 ? '−' : ''}${Math.abs(e.amount).toLocaleString('en-US')}${name ? ` ${name}` : ''}`.slice(0, 100),
            value: `${board ?? '-'}:${i}`,
            description: [ago(e.date), what].filter(Boolean).join(' · ').slice(0, 100),
            emoji: e.reason?.startsWith('bounty') ? emoji.named('bounty') : item?.planet ? emoji.planet[item.planet] : emoji.named('credits'),
        }
    }))
}

// A racer's credits: balance and backer, with their recent transactions in a menu. racer: { id, name, avatar }
function creditsCard(racer) {
    const container = new ContainerBuilder().setAccentColor(DEFAULT_COLOR)
    header(container, [crumbs('Credits'), `# ${racer.name}`, creditsLine(racer.id)], racer.avatar)
    const ledger = ledgerSelect(racer.id)
    if (!ledger) {
        container.addSeparatorComponents(separator())
        container.addTextDisplayComponents(text('-# No credits yet. Save runs to earn them: personal bests, medals, bops, podiums; video proof pays the most.'))
    }
    return page(container, new Files(), [ledger].filter(Boolean))
}

// The richest racers, and the backer standings (credits earned by each side)
function creditsTop() {
    const container = new ContainerBuilder().setAccentColor(DEFAULT_COLOR)
    header(container, [crumbs('Credits'), '## Leaderboard'])
    const top = credits.balances().filter(b => b.amount > 0).slice(0, 10)
    container.addSeparatorComponents(separator())
    container.addTextDisplayComponents(text(top.length ? top.map((b, i) => {
        const rec = credits.backerRecord(b.user)
        return `${place(i + 1)} ${emoji.named('credits')} **${b.amount.toLocaleString('en-US')}** <@${b.user}>${rec ? ` ${emoji.named(credits.BACKERS[rec.backer].emoji)}` : ''}`
    }).join('\n') : '-# No one has credits yet.'))
    container.addSeparatorComponents(separator())
    container.addTextDisplayComponents(text(['### Backers', ...credits.standings().map(s =>
        `${emoji.named(credits.BACKERS[s.backer].emoji)} **${credits.BACKERS[s.backer].name}** ${emoji.named('credits')} ${s.amount.toLocaleString('en-US')} earned`)].join('\n')))
    return page(container, new Files(), [])
}

// --- timesheets ---

// A racer's arcade results: per event their best time, its place on the board and the best medal it beats
function arcadeResults(userId) {
    return Object.fromEntries(data.events.map(e => {
        const rank = records.leaderboard('arcade', e.id).findIndex(t => t.user == userId) + 1
        if (!rank) return [e.id, null]
        const time = records.leaderboard('arcade', e.id)[rank - 1].time
        return [e.id, { time, rank, medal: ['gold', 'silver', 'bronze'].find(m => time <= e.medals[m].seconds) ?? null }]
    }))
}

// Head to head against a rival on some events: where both have a time, how many each is faster on, and the gap summed
const headToHead = (events, mine, theirs) => {
    const shared = events.filter(e => mine[e.id] && theirs[e.id])
    const wins = shared.filter(e => mine[e.id].time < theirs[e.id].time).length, losses = shared.filter(e => mine[e.id].time > theirs[e.id].time).length
    return { shared: shared.length, wins, losses, gap: shared.reduce((n, e) => n + mine[e.id].time - theirs[e.id].time, 0) }
}
// "you lead 7–5 on 12 shared events / 3.42 faster in total" ("leads" on someone else's)
const rivalSummary = (h, own) => !h.shared ? 'No events in common yet'
    : `${h.wins > h.losses ? (own ? 'You lead' : 'Leads') : h.wins < h.losses ? (own ? 'You trail' : 'Trails') : 'Level at'} **${h.wins}–${h.losses}** on ${h.shared} shared event${h.shared == 1 ? '' : 's'} / ${formatTime(Math.abs(h.gap))} ${h.gap <= 0 ? 'faster' : 'slower'} in total`

// --- racer styles ---

// Imported text marks the game's inline keyword icons as {emoji:name}
const face = name => emoji.named(data.characterEmoji(name))
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

    // Who races it: its owner (in the campaign, multiplayer and the scenario named after them), then any podracer
    // pilot who borrows it, with the mode they use it in. Their cards link the scenario.
    const users = data.racers.flatMap(r => r.styles.filter(s => s.style.name == st.name).map(s => ({ r, modes: r.styles.length > 1 ? s.modes : [] })))
        .sort((a, b) => a.modes.length - b.modes.length)
    if (users.length) {
        container.addTextDisplayComponents(text(['### Characters',
            ...users.map(({ r, modes }) => `-# ${face(r.name)} **${r.name}**${modes.length ? ` (${modes.join(' / ')})` : ''}`)].join('\n')))
    }

    const rows = [styleSelect(st.id)]
    if (abilitiesOf(st).length) rows.push(abilitySelect(abilitiesOf(st), 'Starting abilities'))
    if (users.length) rows.push(buttons(...users.slice(0, 5).map(({ r }) => [`character_${r.id}`, r.name, face(r.name)])))
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
            ...(racers.length ? ['### Raced by', `-# ${racers.map(r => `${face(r)} ${r}`).join(' / ')}`] : []),
            ...(events.length ? ['### Arcade', ...events.map(e => `-# ${emoji.planet[e.planet]} **${e.name}** / ${data.track(e.track).name}`)] : []),
        ].join('\n')))
    }

    const rows = [vehicleClassSelect(c.id), vehicleSelect(v.class, v.id)]
    const related = [
        ...racers.map(name => data.rivals.find(r => r.name == name)).filter(Boolean).map(r => ({ label: r.name, value: `rival:${r.id}`, description: 'Rival' })),
        ...events.map(e => ({ label: e.name, value: `event:${e.id}`, description: `Arcade / ${data.track(e.track).name}`, emoji: emoji.vehicle[e.vehicleClass] })),
    ]
    if (related.length) rows.push(select('goto', 'Rivals and arcade events with it', related))
    // the garage (src/swgr/garage.js), for the classes with preview passes
    if (garage.canCustomise(v.id)) rows.push(buttons([`cust_open_${v.id}`, 'Customize', emoji.named(v.emoji) || emoji.vehicle[v.class]]))
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
    container.addTextDisplayComponents(text(data.favors.map(f => `${emoji.named(f.emoji)} **${f.name}** / ${face(f.character)} ${f.character}`).join('\n')))
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
    const backer = data.sponsors.find(s => s.favor == f.id)
    const about = rival ? [`rival_${rival.id}`, `About ${rival.name}`] : backer ? [`backer_${backer.id}`, `About ${backer.name}`] : null
    return page(container, files, [favorSelect(f.id), ...(about ? [buttons(about)] : [])])
}

// --- rivals ---

function rivalSelect(current) {
    return select('rival', 'Pick a rival', data.rivals.map(r => ({
        label: r.name, value: r.id, emoji: face(r.name),
        description: r.champion ? 'Galactic League Champion' : `Favor: ${r.favor ? data.favor(r.favor).name : 'none'}`,
    })), current)
}

function rivalsOverview() {
    const container = new ContainerBuilder().setAccentColor(DEFAULT_COLOR)
    header(container, [crumbs('Rivals'), '# Rivals',
        `${data.rivals.filter(r => !r.champion).length} rivals to challenge to Head-to-Head races over the campaign, and the champion, Kestar Bool.`])
    container.addSeparatorComponents(separator())
    container.addTextDisplayComponents(text(data.rivals.map(r =>
        `${face(r.name)} **${r.name}** / ${r.vehicles.map(id => data.vehicle(id)).map(v => `${emoji.vehicle[v.class]} ${v.name}`).join(', ')}`).join('\n')))
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

// --- characters ---

// A racer's styles as "Redliner", or "BT310 Quadra, Afterburner" for the pilots whose podracing modes differ
const racerStyles = r => r.styles.map(s => s.style.name).join(', ')
const styleName = st => [emoji.named(st.emoji), st.name].filter(Boolean).join(' ')

function characterSelect(current) {
    return select('character', 'Pick a character', data.racers.map(r => ({
        label: r.name, value: r.id, emoji: face(r.name), description: racerStyles(r).slice(0, 100),
    })), current)
}

function charactersOverview() {
    const container = new ContainerBuilder().setAccentColor(DEFAULT_COLOR)
    const pilots = data.racers.filter(r => r.styles.some(s => s.modes.includes('Quick Podrace')))
    header(container, [crumbs('Characters'), '# Characters',
        `${data.racers.length - pilots.length} racers to pick in Quick Race and ${pilots.length} podracer pilots in Quick Podrace, each with their own racer style and build.`])
    container.addSeparatorComponents(separator())
    container.addTextDisplayComponents(text(data.racers.map(r =>
        `${face(r.name)} **${r.name}** / ${r.styles.map(s => styleName(s.style)).join(', ')} / ${r.vehicles.map(v => emoji.vehicle[v.vehicleClass]).join('')}`).join('\n')))
    return page(container, new Files(), [characterSelect()])
}

// Text with a button to another card beside it (like an arcade event's track button); plain text without one.
// button: [customId, label, emoji]
function sectionWithButton(container, lines, button) {
    const content = lines.filter(Boolean).join('\n')
    if (!button) return container.addTextDisplayComponents(text(content))
    const [customId, label, e] = button
    container.addSectionComponents(new SectionBuilder()
        .addTextDisplayComponents(text(content))
        .setButtonAccessory(new ButtonBuilder().setCustomId(customId).setLabel(label.slice(0, 80)).setEmoji(emoji.component(e)).setStyle(ButtonStyle.Secondary)))
}

// A character's card: their racer style (with its build), favor and speeder, each under its own name. The style's
// modes are named only when they differ between modes (the podracer pilots: their pod in Quick Podrace, a racer
// style in Podracing Tour). Of the rivalry, only an Act III rival's gate is worth saying.
function characterInfo(racerId) {
    const r = data.racer(racerId)
    const rival = r.rival && data.rival(r.rival)
    const files = new Files()
    const container = new ContainerBuilder().setAccentColor(DEFAULT_COLOR)
    header(container, [
        crumbs('Characters'),
        `# ${r.name}`,
        r.bio && `*${r.bio}*`,
        rival?.afterTour2 && `-# ${emoji.named('rival')} A rival from Act III`,
        unlockLine(r.unlock),
    ], files.add(r.portrait))
    // The scenario named after them: its tagline and tier beside a button to it
    const scenario = data.scenarios.find(sc => sc.name == r.name)
    if (scenario) {
        sectionWithButton(container, [`*${scenario.tagline}*`, `-# ${scenario.tier} scenario`],
            [`scenario_${scenario.id}`, 'Scenario', emoji.vehicle[scenario.vehicleClass]])
    }

    // Their speeders sit in the section whose build they race with (the speed is that build's on the class);
    // ones no build covers (Sebulba's skimmer, a pilot's spare pod) join the first section with a build
    const buildClasses = new Set(r.styles.flatMap(s => s.build?.speeds.map(x => x.vehicleClass) ?? []))
    const firstBuild = r.styles.find(s => s.build)
    const speedersOf = s => r.vehicles.filter(v => s.build?.speeds.some(x => x.vehicleClass == v.vehicleClass) || (s == firstBuild && !buildClasses.has(v.vehicleClass)))
    // A speeder: its speed and customisation beside a button to the model's card (like an arcade event's track
    // button). The customisation follows the garage's tabs, Livery / Color / Patina; their options are unlabelled
    // there, so they show as their emojis (a podracer only has its colours). A pod the style's own button already
    // opens is named in the text instead (a message can't have two buttons with the same id).
    const addSpeeder = (v, build, linked) => {
        const vehicle = data.vehicle(v.vehicle)
        const pattern = v.pattern && data.pattern(v.pattern), palette = v.palette && data.palette(v.palette), patina = v.patina && data.patina(v.patina)
        const speed = build?.speeds.find(x => x.vehicleClass == v.vehicleClass)
        const pod = v.vehicleClass == 'Podracer'
        const line = [linked ? `${cls(v.vehicleClass)} **${vehicle.name}**` : cls(v.vehicleClass), speed && `${emoji.named(speed.emoji)} ${speed.value} km/h`,
            !pod && pattern?.emoji && `Livery ${emoji.named(pattern.emoji)}`, palette && `Color ${emoji.named(palette.emoji)}`,
            !pod && patina?.emoji && `Patina ${emoji.named(patina.emoji)}`].filter(Boolean).join(' / ')
        // the button carries the model's manufacturer badge, as the garage's model tiles do (a pod has none)
        // the button opens the garage on that exact speeder (a podracer, not customisable yet, its vehicle card)
        sectionWithButton(container, [line || '​'], linked ? null : [garage.openId(v) ?? `vehicle_${vehicle.id}`, vehicle.name, emoji.named(vehicle.emoji) || emoji.vehicle[v.vehicleClass]])
    }

    const shownAbilities = new Set()  // button ids must be unique within the message
    for (const s of r.styles) {
        const { modes, style: st, build } = s
        container.addSeparatorComponents(separator())
        // Beside it, a button to its card, which names it (so no heading then): the racer style's, or for a podracer
        // pilot's pod, the vehicle's
        const card = data.styles.find(x => x.name == st.name), pod = !card && data.vehicleByName(st.name)
        sectionWithButton(container, [
            !card && !pod && `### ${styleName(st)}`,
            r.styles.length > 1 && `-# ${modes.join(' / ')}`,
            st.description && `*${st.description}*`,
            ...st.traits.map(t => `-# ${[emoji.named(t.emoji), `**${t.name}**`].filter(Boolean).join(' ')}: ${emojify(t.description)}`),
        ], card ? [`style_${card.id}`, card.name, emoji.named(card.emoji)] : pod ? [`vehicle_${pod.id}`, pod.name, emoji.vehicle[pod.class]] : null)
        // Its starting abilities, each what it does beside a button to its card
        for (const a of abilitiesOf(st).filter(a => !shownAbilities.has(a.id))) {
            shownAbilities.add(a.id)
            sectionWithButton(container, [abilityText(a)], [`ability_${a.id}`, a.name, emoji.named(a.emoji)])
        }
        for (const v of speedersOf(s)) addSpeeder(v, build, pod && pod.id == v.vehicle)
        if (build) container.addTextDisplayComponents(text(statLines(build.build, build.maxEnergy).join('\n')))
    }

    for (const f of r.favors.map(data.favor)) {
        container.addSeparatorComponents(separator())
        sectionWithButton(container, [emojify(f.ranks[0].rich), unlockLine(f.ranks[0].unlock)], [`favor_${f.id}`, f.name, emoji.named(f.emoji)])
    }

    return page(container, files, [characterSelect(r.id)])
}

// --- mysteries ---

function mysterySelect(current) {
    return select('mystery', 'Pick a mystery encounter', data.mysteries.map(m => ({
        label: m.title, value: m.id, emoji: face(m.character), description: `${m.character} / ${m.parts[0].brief.replace(/\{emoji:\w+\}\s*|\*\*/g, '')}`.slice(0, 100),
    })), current)
}

function mysteriesOverview() {
    const container = new ContainerBuilder().setAccentColor(DEFAULT_COLOR)
    header(container, [crumbs('Mysteries'), '# Mystery Encounters',
        `${data.mysteries.length} encounters that can turn up on the campaign map. Titles are ours; the game doesn't name them.`])
    container.addSeparatorComponents(separator())
    container.addTextDisplayComponents(text(data.mysteries.map(m => `${face(m.character)} **${m.title}** / ${m.character}${m.favors.length ? ` / ${emoji.named('kw_Favor')}` : ''}`).join('\n')))
    return page(container, new Files(), [mysterySelect()])
}

// One outcome as a line: "30% → Spent 5,000, then 2 days later Fola Kanjen: 20,000 received"
// An outcome's own text, naming the favor when it unlocks one
const outcomeText = o => [o.text && emojify(o.text), o.favor && `(**${data.favor(o.favor).name}**)`].filter(Boolean).join(' ')
function outcomeLine(o) {
    const later = o.followUp && (o.followUp.outcomes.length
        ? o.followUp.outcomes.map(f => `${f.chance != null ? `${f.chance}%: ` : ''}${outcomeText(f)}`).join(' or ')
        : 'nothing comes back')
    const when = o.followUp && `${o.followUp.days ? `${o.followUp.days} days later` : 'later'}, ${o.followUp.character}: ${later}`
    return `-# ${o.chance != null ? `**${o.chance}%** ` : ''}→ ${[outcomeText(o), when].filter(Boolean).join(', then ')}`
}

function mysteryInfo(mysteryId) {
    const m = data.mystery(mysteryId)
    const files = new Files()
    const container = new ContainerBuilder().setAccentColor(DEFAULT_COLOR)
    const conditions = p => [...p.requires, p.lastPlanet && `Offered up to planet ${p.lastPlanet}`].filter(Boolean)
    const first = m.parts[0]
    header(container, [
        crumbs('Mysteries', m.character),
        `# ${m.title}`,
        `*${emojify(first.brief)}*`,
        conditions(first).length && `-# ${conditions(first).join(' / ')}`,
    ], files.add(m.image))

    // Parts of a sequence each have their own offer; versions (one per act) share it
    const versions = m.parts.every(p => p.brief == first.brief)
    m.parts.forEach((p, i) => {
        const lines = []
        if (m.parts.length > 1) {
            const same = p.brief == first.brief
            lines.push(`### ${p.label ?? `${versions ? 'Version' : 'Part'} ${i + 1}`}`)
            if (i && !same) lines.push(`*${emojify(p.brief)}*`)
            if (i && conditions(p).length) lines.push(`-# ${conditions(p).join(' / ')}`)
        }
        for (const c of p.choices) {
            lines.push(`**${c.text}**${c.fallback ? ' *(default)*' : ''}`)
            if (c.info) lines.push(`-# ${emojify(c.info)}`)
            lines.push(...c.outcomes.map(outcomeLine))
        }
        container.addSeparatorComponents(separator())
        container.addTextDisplayComponents(text(lines.join('\n')))
    })

    const rival = data.rivals.find(r => m.character.startsWith(r.name.split(' & ')[0]) || m.character == r.name)
    const related = [
        ...m.favors.map(data.favor).map(f => ({ label: f.name, value: `favor:${f.id}`, description: 'Favor it unlocks', emoji: emoji.named(f.emoji) })),
        rival && { label: rival.name, value: `rival:${rival.id}`, description: 'Rival' },
    ].filter(Boolean)
    return page(container, files, [mysterySelect(m.id), ...(related.length ? [select('goto', 'Related', related)] : [])])
}

// --- status effects ---

// Long mention lists stop at a line break with a note, leaving room for the header
const trimText = t => t.length > 3000 ? `${t.slice(0, t.lastIndexOf('\n', 3000))}\n-# …and more` : t

function statusSelect(current) {
    return select('status', 'Pick a status effect', data.statuses.map(s => ({
        label: s.name, value: s.id, emoji: emoji.named(s.emoji), description: s.description.slice(0, 100),
    })), current)
}

function statusesOverview() {
    const container = new ContainerBuilder().setAccentColor(DEFAULT_COLOR)
    const line = s => `${emoji.named(s.emoji)} **${s.name}**: ${s.description}`
    header(container, [crumbs('Status effects'), '# Status effects'])
    container.addSeparatorComponents(separator())
    container.addTextDisplayComponents(text(['### Positive', ...data.statuses.filter(s => s.positive).map(line),
        '### Negative', ...data.statuses.filter(s => !s.positive).map(line)].join('\n')))
    return page(container, new Files(), [statusSelect()])
}

function statusInfo(statusId) {
    const s = data.status(statusId)
    const files = new Files()
    const container = new ContainerBuilder().setAccentColor(DEFAULT_COLOR)
    // Mentions: anything whose text names the effect ("Surging", "System Malfunction")
    const mentions = t => new RegExp(`\\b${s.name}\\b`).test(t ?? '')
    const abilities = data.abilities.filter(a => mentions(a.description))
    const traits = data.styles.flatMap(st => st.ranks.flatMap(r => r.traits.filter(t => mentions(t.description)).map(t => ({ st, r, t }))))
    const favors = data.favors.filter(f => f.ranks.some(r => mentions(r.description)))
    const keyword = data.partKeywords.find(k => k.name == s.name)
    const parts = keyword ? data.partsWithKeywords([keyword.id]) : []

    header(container, [
        crumbs('Status effects', s.positive ? 'Positive' : 'Negative'),
        `# ${s.name}`,
        `*${s.description}*`,
        [s.stacks != null && (s.stacks ? 'Stacks' : "Doesn't stack"), !s.positive && 'Cleared by Status Scrubber'].filter(Boolean).map(x => `-# ${x}`).join('\n'),
    ], files.add(s.icon))

    const sections = [
        abilities.length && ['### Abilities', `-# ${abilities.map(a => `${emoji.named(a.emoji)} ${a.name}`).join(' / ')}`],
        traits.length && ['### Racer style traits', ...traits.map(({ st, r, t }) => `-# ${emoji.named(st.emoji)} **${st.name}** ${ROMAN[r.rank]}: ${t.name}`)],
        favors.length && ['### Favors', `-# ${favors.map(f => `${emoji.named(f.emoji)} ${f.name}`).join(' / ')}`],
        parts.length && ['### Parts', `-# ${parts.length} parts mention it; open the parts finder below`],
    ].filter(Boolean)
    if (sections.length) {
        container.addSeparatorComponents(separator())
        container.addTextDisplayComponents(text(trimText(sections.flat().join('\n'))))
    }

    const related = [
        keyword && parts.length && { label: `Parts with ${s.name}`, value: `keyword:${keyword.id}`, description: `${parts.length} parts`, emoji: emoji.named(s.emoji) },
        ...abilities.map(a => ({ label: a.name, value: `ability:${a.id}`, description: 'Ability', emoji: emoji.named(a.emoji) })),
        ...[...new Set(traits.map(x => x.st))].map(st => ({ label: st.name, value: `style:${st.id}`, description: 'Racer style', emoji: emoji.named(st.emoji) })),
        ...favors.map(f => ({ label: f.name, value: `favor:${f.id}`, description: 'Favor', emoji: emoji.named(f.emoji) })),
    ].filter(Boolean).slice(0, 25)
    return page(container, files, [statusSelect(s.id), ...(related.length ? [select('goto', 'Parts, abilities, styles and favors with it', related)] : [])])
}

// --- backers (sponsors) ---
// The game calls sponsors "backers" everywhere the player sees them, so the cards do too.

function backerSelect(current) {
    return select('backer', 'Pick a backer', data.sponsors.map(s => ({
        label: s.name, value: s.id, emoji: emoji.named(s.emoji),
        description: `${s.person} / Penalty: ${s.penalty}`.slice(0, 100),
    })), current)
}

const unitText = (n, units) => units == 's' ? `${n}s` : `${n} ${units.toLowerCase()}`
// "Abilities" -> "ability", "Special Corners" -> "special corner", "s" -> "second"
const perUnit = units => units == 's' ? 'second' : units.toLowerCase().replace(/ies$/, 'y').replace(/s$/, '')

function backersOverview() {
    const container = new ContainerBuilder().setAccentColor(DEFAULT_COLOR)
    header(container, [crumbs('Backers'), '# Backers',
        'Pick a backer for a tour, then one of their contracts: every time you do its action, you earn credits.'])
    container.addSeparatorComponents(separator())
    container.addTextDisplayComponents(text(data.sponsors.map(s =>
        `${emoji.named(s.emoji)} **${s.name}** / ${s.person}\n-# Penalty: ${s.penalty}`).join('\n')))
    return page(container, new Files(), [backerSelect()])
}

function backerInfo(sponsorId) {
    const s = data.sponsor(sponsorId)
    const files = new Files()
    const container = new ContainerBuilder().setAccentColor(DEFAULT_COLOR)
    header(container, [
        crumbs('Backers'),
        `# ${s.name}`,
        `**${s.person}**`,
        s.bio && `*${s.bio}*`,
        s.startingCredits && `Start the tour with ${emoji.credits} ${s.startingCredits.toLocaleString('en-US')}`,
    ], files.add(s.icon))

    container.addSeparatorComponents(separator())
    container.addTextDisplayComponents(text(['### Contracts', '-# Pick one; each action pays out, and the target rises planet by planet',
        ...s.contracts.map(c => [
            `**${c.objective.replace(/\.$/, '')}**`,
            `-# ${emoji.credits} ${c.credits} per ${perUnit(c.units)} / target ${c.targets[0]} → ${unitText(c.targets.at(-1), c.units)}`,
        ].join('\n'))].join('\n')))

    const favor = s.favor && data.favor(s.favor)
    container.addSeparatorComponents(separator())
    container.addTextDisplayComponents(text([
        '### Penalty', `-# ${s.penalty}`,
        ...(favor ? ['### Favor', `${emoji.named(favor.emoji)} **${favor.name}**: ${emojify(favor.ranks[0].rich)}`, unlockLine(favor.ranks[0].unlock)] : []),
    ].filter(Boolean).join('\n')))
    return page(container, files, [backerSelect(s.id), ...(favor ? [buttons([`favor_${favor.id}`, favor.name, emoji.named(favor.emoji)])] : [])])
}

// --- Tales of Podracing ---

function taleSelect(current) {
    return select('tale', 'Pick a tale', data.tales.map(t => ({
        label: `${t.number}. ${t.name}`, value: t.id, emoji: emoji.named(t.emoji),
        description: `${t.track ? data.track(t.track).name : ''} / ${t.objectives.filter(o => !/^Finish in/.test(o)).join(' ') || 'Win the race'}`.slice(0, 100),
    })), current)
}

function talesOverview() {
    const container = new ContainerBuilder().setAccentColor(DEFAULT_COLOR)
    header(container, [crumbs('Tales of Podracing'), '# Tales of Podracing',
        `Sebulba's old races, replayed as him in his ${data.vehicle('plug-f-mammoth').name}. Win one to unlock the next.`])
    container.addSeparatorComponents(separator())
    container.addTextDisplayComponents(text(data.tales.map(t =>
        `${emoji.named(t.emoji)} **${t.number}. ${t.name}** / ${t.planet ? emoji.planet[t.planet] : ''} ${t.track ? data.track(t.track).name : ''}`).join('\n')))
    return page(container, new Files(), [taleSelect()])
}

function taleInfo(taleId) {
    const t = data.tale(taleId)
    const files = new Files()
    const container = new ContainerBuilder().setAccentColor(DEFAULT_COLOR)
    const track = t.track && data.track(t.track)
    const pod = t.pod && data.vehicle(t.pod)
    const abilities = t.abilities.map(data.ability).filter(Boolean)
    header(container, [
        crumbs('Tales of Podracing', `Tale ${t.number} of ${data.tales.length}`),
        `# ${t.name}`,
        [track && `${emoji.planet[t.planet]} **${track.name}**`, t.reverse && emoji.named('reverse'), t.condition].filter(Boolean).join(' / '),
        `${emoji.vehicle.Podracer} Sebulba${pod ? ` in the ${pod.name}` : ''}${abilities.length ? ` / ${abilities.map(a => `${emoji.named(a.emoji)} ${a.name}`).join(', ')}` : ''}`,
    ], files.add(t.icon))

    const won = t.rewards.filter(r => r.kind == 'ability').map(r => data.ability(r.id)).filter(Boolean)
    const unlocked = t.rewards.filter(r => r.kind == 'unlock').map(r => data.ability(r.id)).filter(Boolean)
    const favors = t.rewards.filter(r => r.kind == 'favor').map(r => data.favor(r.id))
    const cosmetics = t.rewards.filter(r => r.kind == 'palette' || r.kind == 'livery')
    container.addSeparatorComponents(separator())
    container.addTextDisplayComponents(text([
        '### To win', ...t.objectives.map(o => `-# ${o}`),
        '### On the grid', `-# ${t.opponents.map(o => `${face(o.name)} ${o.vehicle ? `${o.name} (${data.vehicle(o.vehicle).name})` : o.name}`).join(' / ')}`,
        ...(t.rewards.length ? ['### Rewards',
            ...won.map(a => `${emoji.named(a.emoji)} **${a.name}**`),
            unlocked.length && `-# Unlocks ${unlocked.map(a => `${emoji.named(a.emoji)} ${a.name}`).join(', ')} in the campaign`,
            ...favors.map(f => `${emoji.named(f.emoji)} **${f.name}** favor: ${emojify(f.ranks[0].rich)}`),
            ...cosmetics.map(c => `**${c.name}** ${c.kind == 'palette' ? 'livery palette' : 'livery'}`),
        ] : []),
    ].filter(Boolean).join('\n')))

    const i = data.tales.indexOf(t)
    const steps = [i > 0 && [`tale_${data.tales[i - 1].id}`, `← ${data.tales[i - 1].name}`], i < data.tales.length - 1 && [`tale_${data.tales[i + 1].id}`, `${data.tales[i + 1].name} →`]].filter(Boolean)
    const related = [
        ...[...won, ...unlocked].map(a => ({ label: a.name, value: `ability:${a.id}`, description: 'Ability', emoji: emoji.named(a.emoji) })),
        ...favors.map(f => ({ label: f.name, value: `favor:${f.id}`, description: 'Favor', emoji: emoji.named(f.emoji) })),
        track && { label: track.name, value: `track:${track.id}`, description: 'Track', emoji: emoji.planet[t.planet] },
        ...[pod, ...t.opponents.map(o => o.vehicle && data.vehicle(o.vehicle))].filter(Boolean).map(v => ({ label: v.name, value: `vehicle:${v.id}`, description: v.pilot ? `${v.pilot}'s podracer` : 'Podracer', emoji: emoji.vehicle.Podracer })),
    ].filter(Boolean).slice(0, 25)
    return page(container, files, [taleSelect(t.id), ...(steps.length ? [buttons(...steps)] : []), select('goto', 'Its rewards, track and podracers', related)])
}

// --- liveries ---
// A livery is a palette (3 colours), a pattern (per vehicle class) and a finish (patina). Menus go
// kind > group > item: livery_pgroup (palette groups), livery_palette, livery_pclass (pattern classes), livery_pattern.

const LIVERY_GROUPS = ['Starter', 'Shop', 'Rivals', 'Podracing', 'Editions', 'Multiplayer']
const kitCost = n => n ? `${emoji.named('KitPoints')} ${n}` : null
const liveryLine = x => [x.kitPoints && kitCost(x.kitPoints), x.unlock].filter(Boolean).join(' / ') || 'Free'

function paletteGroupSelect(current) {
    return select('livery_pgroup', 'Browse palettes', LIVERY_GROUPS.filter(g => data.palettesIn(g).length).map(g => ({
        label: `${g} palettes`, value: g, description: `${data.palettesIn(g).length} palettes`, emoji: emoji.named(data.palettesIn(g)[0].emoji),
    })), current)
}
function paletteSelect(group, current) {
    return select('livery_palette', `Pick a ${group.toLowerCase()} palette`, data.palettesIn(group).map(p => ({
        label: p.name, value: p.id, emoji: emoji.named(p.emoji), description: liveryLine(p).replace(/<a?:\w+:\d+>\s*/g, '').slice(0, 100),
    })), current)
}
function patternClassSelect(current) {
    return select('livery_pclass', 'Browse patterns', data.classes.filter(c => data.patternsFor(c.name).length).map(c => ({
        label: `${c.name} patterns`, value: c.id, description: `${data.patternsFor(c.name).length} patterns`, emoji: emoji.vehicle[c.name],
    })), current)
}
function patternSelect(className, current) {
    return select('livery_pattern', `Pick a ${className.toLowerCase()} pattern`, data.patternsFor(className).map(p => ({
        label: p.name, value: p.id, description: liveryLine(p).replace(/<a?:\w+:\d+>\s*/g, '').slice(0, 100),
    })), current)
}

function liveriesOverview() {
    const container = new ContainerBuilder().setAccentColor(DEFAULT_COLOR)
    header(container, [crumbs('Liveries'), '# Liveries', 'A livery is a colour palette, a pattern for your vehicle class, and a finish.'])
    container.addSeparatorComponents(separator())
    container.addTextDisplayComponents(text([
        '### Palettes', ...LIVERY_GROUPS.filter(g => data.palettesIn(g).length).map(g =>
            `${data.palettesIn(g).slice(0, 6).map(p => emoji.named(p.emoji)).join('')} **${g}** / ${data.palettesIn(g).length}`),
        '### Patterns', ...data.classes.filter(c => data.patternsFor(c.name).length).map(c => `${emoji.vehicle[c.name]} **${c.name}** / ${data.patternsFor(c.name).length}`),
        '### Finishes', ...data.patinas.map(p => `**${p.name}** / ${liveryLine(p)}`),
    ].join('\n')))
    return page(container, new Files(), [paletteGroupSelect(), patternClassSelect()])
}

function paletteGroupInfo(group) {
    const container = new ContainerBuilder().setAccentColor(DEFAULT_COLOR)
    header(container, [crumbs('Liveries', 'Palettes'), `# ${group} palettes`])
    container.addSeparatorComponents(separator())
    container.addTextDisplayComponents(text(data.palettesIn(group).map(p => `${emoji.named(p.emoji)} **${p.name}** / ${liveryLine(p)}`).join('\n')))
    return page(container, new Files(), [paletteGroupSelect(group), paletteSelect(group)])
}

function paletteInfo(paletteId) {
    const p = data.palette(paletteId)
    const files = new Files()
    const container = new ContainerBuilder().setAccentColor(DEFAULT_COLOR)
    header(container, [
        crumbs('Liveries', 'Palettes', p.group),
        `# ${p.name}`,
        `-# ${p.colors.map((c, i) => `${i ? '' : 'Body '}\`${c}\``).join(' / ')}`,
        kitCost(p.kitPoints),
        unlockLine(p.unlock),
    ], files.add(`assets/emoji/${p.emoji}.png`))
    return page(container, files, [paletteGroupSelect(p.group), paletteSelect(p.group, p.id)])
}

function patternClassInfo(classId) {
    const c = data.vehicleClassById(classId)
    const container = new ContainerBuilder().setAccentColor(DEFAULT_COLOR)
    header(container, [crumbs('Liveries', 'Patterns'), `# ${emoji.vehicle[c.name]} ${c.name} patterns`])
    container.addSeparatorComponents(separator())
    container.addTextDisplayComponents(text(data.patternsFor(c.name).map(p => `**${p.name}** / ${liveryLine(p)}`).join('\n')))
    return page(container, new Files(), [patternClassSelect(c.id), patternSelect(c.name)])
}

function patternInfo(patternId) {
    const p = data.pattern(patternId)
    const c = data.classes.find(x => x.name == p.class)
    const files = new Files()
    const container = new ContainerBuilder().setAccentColor(DEFAULT_COLOR)
    header(container, [
        crumbs('Liveries', 'Patterns', p.class),
        `# ${p.name}`,
        `${emoji.vehicle[p.class]} ${p.class}${p.kitPoints ? ` / ${kitCost(p.kitPoints)}` : ''}`,
        unlockLine(p.unlock),
        '-# Seen from above, nose to the right, in its own palette',
    ])
    gallery(container, files.add(p.image))
    return page(container, files, [patternClassSelect(c.id), patternSelect(p.class, p.id)])
}

module.exports = { bountyPosted, characterInfo, charactersOverview, standingEmoji, buildExpanded, creditsCard, creditsTop, liveriesOverview, paletteGroupInfo, paletteInfo, patternClassInfo, patternInfo, taleInfo, talesOverview, backerInfo, backersOverview, statusInfo, statusesOverview, mysteryInfo, mysteriesOverview, rivalInfo, rivalsOverview, favorInfo, favorsOverview, vehicleInfo, vehicleClassInfo, vehiclesOverview, abilityInfo, abilitiesOverview, arcadeOverview, arcadeCategory, arcadeEvent, trackInfo, planetInfo, scenarioInfo, styleInfo, partInfo, parseKeywordMask }
