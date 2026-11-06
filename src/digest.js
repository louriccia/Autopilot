// The weekly digest: one Components V2 card in ANNOUNCE_CHANNEL_ID (#autopilot; TEST_CHANNEL_ID while testing) every
// Monday, on the week before (Monday 00:00 UTC to Monday 00:00 UTC, by run date): how much was raced, the records that
// fell, who climbed the points standings over the main 50, personal bests and bops, the busiest boards, bounties, top
// earners and new racers. The new digest is pinned and the previous one unpinned (needs Pin Messages / Manage Messages;
// without it the post still goes out).
// In the database: digest/last { week (the week's Monday, ms), message, channel }, so a restart never posts twice
// (digest-testing/ for a testing copy).
const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js')
const { testing } = require('../config.js')
const { database } = require('./firebase.js')
const { announce_channel, test_channel } = require('./data/discord/channel.js')
const records = require('./records.js')
const credits = require('./credits.js')
const data = require('./swgr/data.js')
const emoji = require('./data/discord/emoji.js')
const territory = require('./territory.js')

const DAY = 24 * 60 * 60 * 1000, WEEK = 7 * DAY
const POST_HOUR = 14  // UTC, Monday: morning in the Americas, afternoon in Europe
exports.CHECK_EVERY = 15 * 60 * 1000
const PATH = testing ? 'digest-testing' : 'digest'
const fmt = records.formatTime
const time = s => `**\`${fmt(s)}\`**`
const cr = n => `${emoji.named('credits')} **${Math.round(n).toLocaleString('en-US')}**`
const place = rank => rank <= 10 ? emoji.named(`place_${rank}`) : `**#${rank}**`
const plural = (n, word) => `${n.toLocaleString('en-US')} ${word}${n == 1 ? '' : 's'}`
const day = ms => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const EARNED = ['run', 'board filled', 'bounty won', 'rated a board', 'board of the week', 'territory']

// The Monday 00:00 UTC that starts the week holding `at`
exports.weekOf = at => {
    const d = new Date(at)
    const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - ((d.getUTCDay() + 6) % 7) * DAY
    return monday
}

const boardName = (kind, target) => {
    const name = credits.boardName(kind, target)
    const planet = kind == 'arcade' ? data.event(target)?.planet : kind == 'scenario' ? data.scenario(target)?.planet : null
    const suffix = { scenario: ' (scenario)', tour: ' (final)', fullgame: ' (full game)' }[kind] ?? ''
    return `${planet && emoji.planet[planet] ? `${emoji.planet[planet]} ` : ''}**${name}**${suffix}`
}

// Everything the card says about the week starting at `start`
exports.summarize = start => {
    const end = start + WEEK
    const all = records.allTimes()
    const week = all.filter(t => t.date >= start && t.date < end)
    const boards = [...new Set(week.map(t => `${t.kind}:${t.target}`))].map(k => k.split(':'))

    // Records: boards whose #1 at the end of the week is faster than at its start (a board's first time isn't one)
    const wrs = []
    // Personal bests (a run faster than every earlier one of theirs on the board) and bops (racers who were ahead at
    // the start of the week, or anyone already there for a newcomer, and are behind at its end)
    const pbs = {}, bops = {}
    for (const [kind, target] of boards) {
        const before = records.leaderboard(kind, target, { before: start }), after = records.leaderboard(kind, target, { before: end })
        if (before[0] && after[0].time < before[0].time) wrs.push({ kind, target, user: after[0].user, time: after[0].time, was: before[0], proof: after[0].proof })
        const was = Object.fromEntries(before.map(t => [t.user, t.time])), now = Object.fromEntries(after.map(t => [t.user, t.time]))
        for (const u of Object.keys(now)) {
            if (was[u] != null && now[u] >= was[u]) continue
            const passed = before.filter(t => t.user != u && (was[u] == null || t.time < was[u]) && now[t.user] > now[u]).length
            if (passed) bops[u] = (bops[u] ?? 0) + passed
        }
        const mine = {}
        for (const t of all.filter(t => t.kind == kind && t.target == target && t.date < end).sort((a, b) => a.date - b.date)) {
            if (mine[t.user] != null && t.time < mine[t.user] && t.date >= start) pbs[t.user] = (pbs[t.user] ?? 0) + 1
            if (mine[t.user] == null || t.time < mine[t.user]) mine[t.user] = t.time
        }
    }
    wrs.sort((a, b) => (a.was.time - a.time) / a.was.time < (b.was.time - b.time) / b.was.time ? 1 : -1)

    // Climbers in the points standings over the main 50
    const main = data.boardSet('main').items.map(e => e.id)
    const pointsBefore = Object.fromEntries(records.points('arcade', main, { before: start }).map(s => [s.user, s]))
    const climbers = records.points('arcade', main, { before: end })
        .map(s => ({ ...s, gained: s.points - (pointsBefore[s.user]?.points ?? 0), was: pointsBefore[s.user]?.rank ?? null }))
        .filter(s => s.gained > 0).sort((a, b) => b.gained - a.gained || a.rank - b.rank)

    // New racers: their first time ever is this week
    const first = {}
    for (const t of all) if (first[t.user] == null || t.date < first[t.user]) first[t.user] = t.date
    const newcomers = Object.entries(first).filter(([, d]) => d >= start && d < end).map(([u]) => u)

    // Busiest boards by runs
    const runs = {}
    for (const t of week) runs[`${t.kind}:${t.target}`] = (runs[`${t.kind}:${t.target}`] ?? 0) + 1
    const busiest = Object.entries(runs).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => ({ kind: k.split(':')[0], target: k.split(':')[1], runs: n }))

    // Bounties and credits (by when they happened, not run date)
    const bounties = credits.allBounties()
    const won = bounties.filter(b => b.status == 'won' && b.wonAt >= start && b.wonAt < end)
    const posted = bounties.filter(b => b.postedAt >= start && b.postedAt < end)
    const earned = {}, backers = {}
    for (const e of credits.allEntries()) {
        if (e.date < start || e.date >= end || e.amount <= 0 || !EARNED.includes(e.reason)) continue
        earned[e.user] = (earned[e.user] ?? 0) + e.amount
        if (e.backer) backers[e.backer] = (backers[e.backer] ?? 0) + e.amount
    }
    const sorted = o => Object.entries(o).sort((a, b) => b[1] - a[1])

    return {
        start, end, runs: week.length, racers: new Set(week.map(t => t.user)).size, newcomers,
        wrs, climbers, pbs: sorted(pbs), bops: sorted(bops), busiest, won, posted,
        open: credits.openBounties(), earners: sorted(earned), backers: sorted(backers), territory: territory.control(end),
    }
}

const list = (items, n, line) => [...items.slice(0, n).map(line), items.length > n ? `-# and ${items.length - n} more` : null].filter(Boolean).join('\n')
const names = users => users.map(records.nameFor).join(', ')

// The card for a week (summarize()'s result); null when nothing was raced
exports.card = s => {
    if (!s.runs) return null
    const container = new ContainerBuilder().setAccentColor(0xE3B341)
    const add = content => content && container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
    const sep = () => container.addSeparatorComponents(new SeparatorBuilder())

    add([`-# Weekly digest / ${day(s.start)} – ${day(s.end - DAY)}`, '# The week in racing',
        [plural(s.runs, 'run'), plural(s.racers, 'racer'), s.wrs.length && plural(s.wrs.length, 'record'),
            s.pbs.length && plural(s.pbs.reduce((n, [, c]) => n + c, 0), 'personal best'), s.newcomers.length && `${s.newcomers.length} new`].filter(Boolean).join(' / ')].join('\n'))

    if (s.wrs.length) {
        sep()
        add(`### ${place(1)} Records\n` + list(s.wrs, 8, w =>
            `${w.proof ? `[${time(w.time)}](<${w.proof}>)` : time(w.time)} ${records.nameFor(w.user)} on ${boardName(w.kind, w.target)}` +
            ` (was ${fmt(w.was.time)}${w.was.user != w.user ? ` by ${records.nameFor(w.was.user)}` : ''})`))
    }

    const movers = [
        s.climbers.length && `${emoji.named('crown')} **Climbers** (points, all ${data.boardSet('main').items.length} events): ` +
            s.climbers.slice(0, 3).map(c => `${records.nameFor(c.user)} +${c.gained}${c.was && c.was != c.rank ? ` (${c.was} → ${c.rank})` : !c.was ? ` (new, ${c.rank})` : ''}`).join(', '),
        s.pbs.length && `${emoji.named('stopwatch')} **Personal bests**: ` + s.pbs.slice(0, 3).map(([u, n]) => `${records.nameFor(u)} ${n}`).join(', '),
        s.bops.length && `${emoji.named('chevron_up')} **Bops**: ` + s.bops.slice(0, 3).map(([u, n]) => `${records.nameFor(u)} ${n}`).join(', '),
        s.busiest.length && `${emoji.named('tick')} **Busiest**: ` + s.busiest.map(b => `${boardName(b.kind, b.target)} ${b.runs}`).join(', '),
    ].filter(Boolean)
    if (movers.length) { sep(); add(movers.join('\n')) }

    const money = [
        ...s.won.map(b => `${emoji.named('bounty')} ${records.nameFor(b.winner)} claimed ${cr(b.pot)} on ${boardName(b.kind, b.target)} with ${time(b.time)}`),
        s.posted.length && `${emoji.named('bounty')} ${plural(s.posted.length, 'bounty')} posted`.replace('bountys', 'bounties') +
            (s.open.length ? `; biggest open: ${cr(s.open[0].pot)} on ${boardName(s.open[0].kind, s.open[0].target)} under ${time(s.open[0].under)}` : ''),
        !s.posted.length && s.open.length && `${emoji.named('bounty')} Biggest open bounty: ${cr(s.open[0].pot)} on ${boardName(s.open[0].kind, s.open[0].target)} under ${time(s.open[0].under)}`,
        s.earners.length && `${emoji.named('credits')} **Top earners**: ` + s.earners.slice(0, 3).map(([u, n]) => `${records.nameFor(u)} ${cr(n)}`).join(', '),
        (held => held.some(([, n]) => n) && '**Territory**: ' + held.filter(([, n]) => n).map(([b, n]) => `${emoji.named(credits.BACKERS[b].emoji)} ${credits.BACKERS[b].name} ${n}`).join(' / '))(
            Object.keys(credits.BACKERS).map(b => [b, s.territory.filter(p => p.holder == b).length]).sort((a, b) => b[1] - a[1])),
        s.backers.length && '-# ' + s.backers.map(([b, n]) => `${emoji.named(credits.BACKERS[b].emoji)} ${credits.BACKERS[b].name} ${cr(n)}`).join(' / '),
    ].filter(Boolean)
    if (money.length) { sep(); add(money.join('\n')) }

    if (s.newcomers.length) { sep(); add(`**Welcome to the boards**: ${names(s.newcomers.slice(0, 15))}${s.newcomers.length > 15 ? ` and ${s.newcomers.length - 15} more` : ''}`) }

    container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('arcade_category_overview').setLabel('Arcade standings').setStyle(ButtonStyle.Secondary)))
    return { components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } }
}

// Posts the digest for the week starting at `start` to `channelId`; returns the message or null
exports.post = async (client, start, channelId) => {
    const payload = exports.card(exports.summarize(start))
    const channel = payload && channelId && await client.channels.fetch(channelId).catch(() => null)
    return channel ? channel.send(payload) : null
}

// Once a week (Monday from POST_HOUR UTC): last week's digest, pinned in place of the one before
exports.check = async client => {
    if (!database || !records.loaded()) return
    const now = Date.now(), thisWeek = exports.weekOf(now)
    // Monday from POST_HOUR, or Tuesday if the bot was down; never a stale digest later in the week
    if (now < thisWeek + POST_HOUR * 60 * 60 * 1000 || now >= thisWeek + 2 * DAY) return
    const last = (await database.ref(`${PATH}/last`).get()).val()
    if (last?.week >= thisWeek - WEEK) return
    // Claim the week first, so two checks can't both post
    await database.ref(`${PATH}/last`).update({ week: thisWeek - WEEK })
    const message = await exports.post(client, thisWeek - WEEK, testing ? test_channel : announce_channel)
    if (!message) return
    await database.ref(`${PATH}/last`).update({ message: message.id, channel: message.channel.id })
    await message.pin().catch(error => console.error('[digest] pin', error.message))
    if (last?.message) {
        const old = await client.channels.fetch(last.channel).then(c => c.messages.fetch(last.message)).catch(() => null)
        await old?.unpin().catch(error => console.error('[digest] unpin', error.message))
    }
    return message
}
