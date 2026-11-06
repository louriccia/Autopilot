// The territory war: the three backers (The Hutt / The Broker / The Pirate, credits.BACKERS) fight over the seven
// planets. A planet's main-50 events are scored like the points standings (each event's top 5: 10 / 7 / 5 / 3 / 1), but
// only personal bests set in the last WINDOW count: a racer's all-time best on an event that is older than that drops
// out, so holding ground means improving. Racers outside the factions take places too (and score for nobody). A planet
// goes to the faction with the most points; level at the top is contested, no points is unclaimed. A racer's faction
// counts once they've held its role for LOCK (switching starts the wait again: backers/<id>.since, src/credits.js).
//   sync()    keeps the map pinned in ANNOUNCE_CHANNEL_ID (TEST_CHANNEL_ID while testing) current, editing it in place,
//             and announces planets changing hands there (bot.js: after the times change, and hourly as runs age out)
//   reward()  live bot only: when a week ends (Monday 00:00 UTC), the faction holding the most planets (tied factions
//             split it) shares REWARD among its members who set a personal best (or a first time) on a main-50 event
//             that week; ledger reason `territory`
// In the database: territory/ { started, holders: { planet: faction | contested | none }, key, message, channel,
// rewards/<week start ms>: { factions, members, share } } (territory-testing/ for a testing copy)
const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SectionBuilder, ThumbnailBuilder, AttachmentBuilder, MessageFlags } = require('discord.js')
const path = require('path')
const { testing } = require('../config.js')
const { database } = require('./firebase.js')
const { announce_channel, test_channel } = require('./data/discord/channel.js')
const records = require('./records.js')
const credits = require('./credits.js')
const data = require('./swgr/data.js')
const emoji = require('./data/discord/emoji.js')

const DAY = 24 * 60 * 60 * 1000, WEEK = 7 * DAY
exports.WINDOW = 28 * DAY
const LOCK = WEEK, REWARD = 5000
const PATH = testing ? 'territory-testing' : 'territory'
const FACTIONS = Object.keys(credits.BACKERS)
const factionOf = (user, at) => {
    const rec = records.isDiscord(user) && credits.backerRecord(user)
    return rec && rec.since <= at - LOCK ? rec.backer : null
}
const mark = f => `${emoji.named(credits.BACKERS[f].emoji)} **${credits.BACKERS[f].name}**`
const weekOf = at => { const d = new Date(at); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - ((d.getUTCDay() + 6) % 7) * DAY }

// Control as of `at`: [{ planet, points: { hutt, broker, pirate }, holder (faction | 'contested' | null), top: [user, points] }]
exports.control = (at = Date.now()) => {
    const events = data.boardSet('main').items
    return data.planets.map(planet => {
        const points = Object.fromEntries(FACTIONS.map(f => [f, 0])), mine = {}
        for (const e of events.filter(e => e.planet == planet.id)) {
            records.leaderboard('arcade', e.id, { before: at }).filter(t => t.date >= at - exports.WINDOW)
                .slice(0, records.POINTS.length).forEach((t, i) => {
                    const f = factionOf(t.user, at)
                    if (!f) return
                    points[f] += records.POINTS[i]
                    mine[t.user] = (mine[t.user] ?? 0) + records.POINTS[i]
                })
        }
        const ranked = FACTIONS.slice().sort((a, b) => points[b] - points[a])
        const holder = !points[ranked[0]] ? null : points[ranked[0]] == points[ranked[1]] ? 'contested' : ranked[0]
        const top = Object.entries(mine).sort((a, b) => b[1] - a[1])[0] ?? null
        return { planet, points, holder, top }
    })
}
const held = (control, f) => control.filter(p => p.holder == f).length

// Planets that changed hands between two control() results
exports.flips = (before, after) => after.map((p, i) => ({ ...p, was: before[i].holder })).filter(p => p.holder != p.was)

exports.flipText = p => p.holder == 'contested' ? `${emoji.planet[p.planet.id]} **${p.planet.name}** is contested: ${FACTIONS.filter(f => p.points[f] == Math.max(...Object.values(p.points))).map(mark).join(' and ')} are level`
    : p.holder ? `${emoji.planet[p.planet.id]} **${p.planet.name}** has fallen to ${mark(p.holder)}${p.was && p.was != 'contested' ? `, taken from ${mark(p.was)}` : ''}${p.top ? ` / led by ${records.nameFor(p.top[0])}` : ''}`
    : `${emoji.planet[p.planet.id]} **${p.planet.name}** has gone quiet: no faction holds it`

// The map card: a section per planet with its patch
exports.card = (control = exports.control()) => {
    const container = new ContainerBuilder().setAccentColor(0x7B5BC4), files = []
    const order = FACTIONS.slice().sort((a, b) => held(control, b) - held(control, a))
    const contested = control.filter(p => p.holder == 'contested').length, unclaimed = control.filter(p => !p.holder).length
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(['-# Territory war / personal bests from the last 28 days', '# The galaxy',
        [...order.map(f => `${mark(f)} ${held(control, f)}`), contested && `${contested} contested`, unclaimed && `${unclaimed} unclaimed`].filter(Boolean).join(' / ')].join('\n')))
    container.addSeparatorComponents(new SeparatorBuilder())
    for (const p of control) {
        const art = p.planet.patch && new AttachmentBuilder(path.join(__dirname, '..', p.planet.patch), { name: path.basename(p.planet.patch) })
        if (art) files.push(art)
        const standing = FACTIONS.slice().sort((a, b) => p.points[b] - p.points[a]).filter(f => p.points[f]).map(f => `${emoji.named(credits.BACKERS[f].emoji)} ${p.points[f]}`).join(' / ')
        const content = [`### ${p.planet.name}`,
            p.holder == 'contested' ? '**Contested**' : p.holder ? `Held by ${mark(p.holder)}` : '-# Unclaimed',
            standing && `-# ${standing}${p.top ? ` / led by ${records.nameFor(p.top[0])}` : ''}`].filter(Boolean).join('\n')
        const s = new SectionBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
        container.addSectionComponents(art ? s.setThumbnailAccessory(new ThumbnailBuilder().setURL(`attachment://${art.name}`)) : s)
    }
    container.addSeparatorComponents(new SeparatorBuilder())
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
        `-# Sunday night, the faction holding the most planets splits ${emoji.named('credits')} ${REWARD.toLocaleString('en-US')} among its members who set a personal best that week.`,
        `-# A faction counts a week after you join it. Updated <t:${Math.floor(Date.now() / 1000)}:R>`].join('\n')))
    return { components: [container], files, flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } }
}

const channelOf = client => client.channels.fetch(testing ? test_channel : announce_channel).catch(() => null)

// One sync at a time
let running = Promise.resolve()
exports.sync = client => (running = running.then(() => doSync(client)).catch(error => console.error('[territory]', error.message)))
async function doSync(client) {
    if (!database || !records.loaded()) return
    const ref = database.ref(PATH)
    const state = (await ref.get()).val() ?? {}
    const control = exports.control()
    const holders = Object.fromEntries(control.map(p => [p.planet.id, p.holder ?? 'none']))
    const key = JSON.stringify(control.map(p => [p.holder, p.points, p.top]))
    const channel = await channelOf(client)
    if (!channel) return
    // Planets that changed hands since the last sync (none on the first)
    if (state.holders) {
        const flipped = control.filter(p => (state.holders[p.planet.id] ?? 'none') != holders[p.planet.id])
            .map(p => ({ ...p, was: [undefined, 'none'].includes(state.holders[p.planet.id]) ? null : state.holders[p.planet.id] }))
        if (flipped.length) await channel.send({ content: flipped.map(exports.flipText).join('\n'), allowedMentions: { parse: [] } })
    }
    // The pinned map: edited in place, or posted (and pinned) again if it's gone
    let message = state.message && state.channel == channel.id && await channel.messages.fetch(state.message).catch(() => null)
    if (message && key != state.key) await message.edit({ ...exports.card(control), attachments: [] })
    if (!message) {
        message = await channel.send(exports.card(control))
        await message.pin().catch(error => console.error('[territory] pin', error.message))
    }
    await ref.update({ started: state.started ?? Date.now(), holders, key, message: message.id, channel: channel.id })
}

// Who shares a week's reward: each winning faction's members (as of the week's end) with a personal best or first time
// on a main-50 event dated in the week
exports.rewardees = (start, control) => {
    const end = start + WEEK, most = Math.max(...FACTIONS.map(f => held(control, f)))
    const factions = most ? FACTIONS.filter(f => held(control, f) == most) : []
    const main = new Set(data.boardSet('main').items.map(e => e.id))
    const best = {}, improved = new Set()
    for (const t of records.allTimes().filter(t => t.kind == 'arcade' && main.has(t.target) && t.date < end).sort((a, b) => a.date - b.date)) {
        const k = `${t.target}:${t.user}`
        if ((best[k] == null || t.time < best[k]) && t.date >= start) improved.add(t.user)
        if (best[k] == null || t.time < best[k]) best[k] = t.time
    }
    return Object.fromEntries(factions.map(f => [f, [...improved].filter(u => factionOf(u, end) == f)]))
}

// Pays the week that just ended, once (live bot only: it moves credits)
exports.reward = async client => {
    if (!database || !records.loaded()) return
    const lastWeek = weekOf(Date.now()) - WEEK
    const started = (await database.ref(`${PATH}/started`).get()).val()
    if (!started || lastWeek < weekOf(started)) return  // the war wasn't on that week
    let claimed = false
    await database.ref(`${PATH}/rewards/${lastWeek}`).transaction(v => { if (v) return; claimed = true; return { at: Date.now() } })
    if (!claimed) return
    const control = exports.control(lastWeek + WEEK), winners = exports.rewardees(lastWeek, control)
    const factions = Object.keys(winners), perFaction = factions.length ? Math.floor(REWARD / factions.length) : 0
    const lines = []
    for (const f of factions) {
        const members = winners[f], share = members.length ? Math.floor(perFaction / members.length) : 0
        for (const u of members) await credits.post(u, share, { reason: 'territory', ref: String(lastWeek), backer: f })
        lines.push(`${mark(f)} ${factions.length > 1 ? 'shares' : 'rules'} the galaxy with ${held(control, f)} of ${control.length} planets: ${members.length
            ? `${members.length} racer${members.length == 1 ? '' : 's'} who set a personal best this week take ${emoji.named('credits')} **${share.toLocaleString('en-US')}** each`
            : 'but none of its racers set a personal best this week, so nobody is paid'}`)
    }
    await database.ref(`${PATH}/rewards/${lastWeek}`).update({ factions, members: Object.fromEntries(factions.map(f => [f, winners[f].length])) })
    if (lines.length) await (await channelOf(client))?.send({ content: `${emoji.named('crown')} ${lines.join('\n')}`, allowedMentions: { parse: [] } })
}
