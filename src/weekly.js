// Board of the Week and the house's bounties (live bot only; check() every 15 minutes from bot.js).
// Board of the Week: each week (Monday 00:00 to Monday 00:00 UTC, by run date) one of the main 50 events is featured,
// weighted toward boards whose record is old and that few have raced, skipping any featured in the last REPEAT_WEEKS
// weeks. Its week board is the event's runs dated that week with a screenshot or video, each racer's best; when the
// week ends its top 3 are paid PRIZES (Discord racers only) and the results posted, then the next week's is announced.
// The house posts a bounty at the featured board's record and a ladder bounty at its 5th place (which the top 4 can't
// win), both ending with the week, and cold-case bounties (two weeks) on the COLD boards with 5+ racers whose record has
// stood longest and that have no open bounty. House bounties are new credits (credits.postHouseBounty); anyone can add.
// In the database: weekly/<week start ms> { event, at, bounties: { id: true }, message, settled, paid: { user: amount } }
// (weekly-testing/ for a testing copy).
const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SectionBuilder, ThumbnailBuilder, ActionRowBuilder,
    ButtonBuilder, ButtonStyle, AttachmentBuilder, MessageFlags } = require('discord.js')
const path = require('path')
const { testing } = require('../config.js')
const { database } = require('./firebase.js')
const { announce_channel, test_channel } = require('./data/discord/channel.js')
const records = require('./records.js')
const credits = require('./credits.js')
const data = require('./swgr/data.js')
const emoji = require('./data/discord/emoji.js')

const DAY = 24 * 60 * 60 * 1000, WEEK = 7 * DAY
const REPEAT_WEEKS = 10, PRIZES = [1000, 500, 250], COLD = 2, LADDER_PLACE = 5, LADDER_POT = 300
exports.PRIZES = PRIZES
const fmt = records.formatTime
const time = s => `**\`${fmt(s)}\`**`
const cr = n => `${emoji.named('credits')} **${Math.round(n).toLocaleString('en-US')}**`
const place = rank => rank <= 10 ? emoji.named(`place_${rank}`) : `**#${rank}**`
const day = ms => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const MAIN = () => data.boardSet('main').items
const PATH = testing ? 'weekly-testing' : 'weekly'
exports.CHECK_EVERY = 15 * 60 * 1000
// The Monday 00:00 UTC that starts the week holding `at`
const weekOf = at => { const d = new Date(at); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - ((d.getUTCDay() + 6) % 7) * DAY }
exports.weekOf = weekOf

// How much a board needs attention, as of `at`: days its record has stood, plus a bonus for few racers
const neglect = (e, at) => {
    const board = records.leaderboard('arcade', e.id, { before: at })
    const age = board[0] ? (at - board[0].date) / DAY : 30
    return { event: e, board, age, score: age + 3 * Math.max(0, 15 - board.length) }
}

// The featured event for the week starting at `start`: among the five most neglected, one chosen by the week (so a
// restart picks the same)
exports.pick = (start, recent = []) => {
    const ranked = MAIN().filter(e => !recent.includes(e.id)).map(e => neglect(e, start)).sort((a, b) => b.score - a.score).slice(0, 5)
    return ranked[Math.floor(start / WEEK) % ranked.length]
}

// The week board: each racer's best run dated in the week, with proof
exports.weekBoard = (event, start) => {
    const best = {}
    for (const t of records.allTimes()) {
        if (t.kind != 'arcade' || t.target != event || t.date < start || t.date >= start + WEEK || !t.proof) continue
        if (!best[t.user] || t.time < best[t.user].time) best[t.user] = t
    }
    return Object.values(best).sort((a, b) => a.time - b.time || a.date - b.date)
}

// A house bounty's pot: more for a busier board and an older record, in 50s, capped
const pot = (racers, age) => Math.min(3000, Math.round((1000 + 25 * racers + 10 * age) / 50) * 50)

// The bounties the house posts for the week starting at `start`, on the boards as they are `at` (a week can start late,
// after its Monday): [{ kind, target, under, pot, expires, excluded?, why }]
exports.houseBounties = (start, featured, at = Date.now()) => {
    const out = []
    const now = neglect(featured.event, at), board = now.board
    if (board[0]) out.push({ kind: 'arcade', target: featured.event.id, under: board[0].time, pot: pot(board.length, now.age), expires: start + WEEK, why: 'Board of the Week record' })
    if (board.length >= LADDER_PLACE) out.push({ kind: 'arcade', target: featured.event.id, under: board[LADDER_PLACE - 1].time, pot: LADDER_POT, expires: start + WEEK, excluded: board.slice(0, LADDER_PLACE - 1).map(t => t.user), why: `Board of the Week: beat ${LADDER_PLACE}th place (not for the top ${LADDER_PLACE - 1})` })
    const cold = MAIN().filter(e => e.id != featured.event.id).map(e => neglect(e, at)).filter(n => n.board.length >= credits.MIN_RACERS && !credits.openBounties('arcade', n.event.id).length)
        .sort((a, b) => b.age - a.age).slice(0, COLD)
    for (const n of cold) out.push({ kind: 'arcade', target: n.event.id, under: n.board[0].time, pot: pot(n.board.length, n.age), expires: start + 2 * WEEK, why: `cold case: record set ${Math.floor(n.age)} days ago` })
    return out
}

const eventHeader = (e, files) => {
    const tile = e.tile && new AttachmentBuilder(path.join(__dirname, '..', e.tile), { name: path.basename(e.tile) })
    if (tile) files.push(tile)
    return { tile: tile && `attachment://${tile.name}`, title: `# ${emoji.planet[e.planet] ?? ''} ${e.name}`, sub: [data.category(e.category)?.name, `${emoji.vehicle[e.vehicleClass] ?? ''} ${e.vehicleClass}`, data.track(e.track)?.name].filter(Boolean).join(' / ') }
}
const section = (container, content, thumb) => thumb
    ? container.addSectionComponents(new SectionBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(content)).setThumbnailAccessory(new ThumbnailBuilder().setURL(thumb)))
    : container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
const buttons = e => new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`time_open_arcade_${e.id}`).setLabel('Submit').setEmoji(emoji.named('stopwatch')).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`arcade_event_${e.id}`).setLabel('View board').setStyle(ButtonStyle.Secondary))

// Monday's announcement: the event, what's on offer, and the record to chase
exports.announcement = (start, featured, bounties) => {
    featured = neglect(featured.event, Date.now())  // the board as it is now
    const e = featured.event, files = [], h = eventHeader(e, files)
    const container = new ContainerBuilder().setAccentColor(0xE3B341)
    const top = featured.board.slice(0, 3).map((t, i) => `${place(i + 1)} ${time(t.time)} ${records.nameFor(t.user)}`).join('\n')
    section(container, [`-# Board of the Week / ${day(start)} – ${day(start + WEEK - DAY)}`, h.title, h.sub,
        `-# ${featured.board.length} racers / record set ${Math.floor(featured.age)} days ago`].join('\n'), h.tile)
    container.addSeparatorComponents(new SeparatorBuilder())
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
        `The week's fastest runs here (screenshot or video, dated this week) take ${PRIZES.map((p, i) => `${place(i + 1)} ${cr(p)}`).join(' ')} on Sunday night.`,
        ...bounties.filter(b => b.target == e.id).map(b => `${emoji.named('bounty')} ${cr(b.pot)} for the first run under ${time(b.under)}${b.under == featured.board[0]?.time ? ' (the record)' : ` (${LADDER_PLACE}th place; not for the top ${LADDER_PLACE - 1})`}`),
    ].join('\n')))
    if (top) { container.addSeparatorComponents(new SeparatorBuilder()); container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`### All-time\n${top}`)) }
    container.addActionRowComponents(buttons(e))
    return { components: [container], files, flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } }
}

// Sunday night's results: the week board's top 3 and their prizes
exports.prizes = (start, event) => {
    const paid = {}
    exports.weekBoard(event, start).filter(t => records.isDiscord(t.user)).slice(0, PRIZES.length).forEach((t, i) => { paid[t.user] = PRIZES[i] })
    return paid
}
exports.results = (start, event, paid = exports.prizes(start, event)) => {
    const e = data.event(event), files = [], h = eventHeader(e, files), week = exports.weekBoard(event, start)
    const container = new ContainerBuilder().setAccentColor(0xE3B341)
    section(container, [`-# Board of the Week / results`, h.title, h.sub, `-# ${week.length} racer${week.length == 1 ? '' : 's'} this week`].join('\n'), h.tile)
    container.addSeparatorComponents(new SeparatorBuilder())
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(week.length
        ? week.slice(0, 5).map((t, i) => `${place(i + 1)} [${time(t.time)}](<${t.proof}>) ${records.nameFor(t.user)}${paid[t.user] ? ` ${cr(paid[t.user])}` : ''}`).join('\n')
        : 'Nobody raced it this week.'))
    container.addActionRowComponents(buttons(e))
    return { components: [container], files, flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } }
}

const channelOf = async client => client.channels.fetch(testing ? test_channel : announce_channel).catch(() => null)

// Settles the week that ended (prizes and results), then starts this one (pick, house bounties, announcement)
exports.check = async client => {
    if (!database || !records.loaded()) return
    const thisWeek = weekOf(Date.now()), lastWeek = thisWeek - WEEK
    const recent = Object.entries((await database.ref(PATH).orderByKey().limitToLast(REPEAT_WEEKS).get()).val() ?? {})
    const channel = await channelOf(client)

    const last = recent.find(([k]) => Number(k) == lastWeek)?.[1]
    if (last && !last.settled) {
        let claimed = false
        await database.ref(`${PATH}/${lastWeek}/settled`).transaction(v => { if (v) return; claimed = true; return true })
        if (claimed) {
            const paid = exports.prizes(lastWeek, last.event)
            for (const [user, amount] of Object.entries(paid)) await credits.post(user, amount, { reason: 'board of the week', ref: String(lastWeek), board: `arcade:${last.event}` })
            await database.ref(`${PATH}/${lastWeek}/paid`).set(paid)
            await channel?.send(exports.results(lastWeek, last.event, paid))
        }
    }

    if (recent.some(([k]) => Number(k) == thisWeek)) return
    const featured = exports.pick(thisWeek, recent.map(([, w]) => w.event))
    let claimed = false
    await database.ref(`${PATH}/${thisWeek}`).transaction(v => { if (v) return; claimed = true; return { event: featured.event.id, at: Date.now() } })
    if (!claimed) return
    const posted = []
    for (const b of exports.houseBounties(thisWeek, featured)) posted.push(await credits.postHouseBounty(b))
    await database.ref(`${PATH}/${thisWeek}/bounties`).set(Object.fromEntries(posted.map(b => [b.id, true])))
    const message = await channel?.send(exports.announcement(thisWeek, featured, posted))
    if (message) await database.ref(`${PATH}/${thisWeek}/message`).set(message.id)
    const pages = require('./swgr/pages.js')
    for (const b of posted.filter(b => b.target != featured.event.id)) await channel?.send(pages.bountyPosted(b))
}
