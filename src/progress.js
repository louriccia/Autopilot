// What a saved time means for its racer and its board (src/submit.js calls these around every save):
//   receipt()   the submitter's private reply: personal best and by how much, world record, bops (racers they passed,
//               who each drop a place), medals beaten for the first time, their place and the gap to the next one, how
//               they compare with their declared rival, and their progression
//   podium()    a top-3 change worth announcing: on a board with at least MIN_RACERS racers, someone moves into the top
//               3 or up within it, or lowers the record at #1
//   announce()  posts it to ANNOUNCE_CHANNEL_ID (#autopilot; TEST_CHANNEL_ID while testing), without pinging anyone
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js')
const { testing } = require('../config.js')
const { announce_channel, test_channel } = require('./data/discord/channel.js')
const emoji = require('./data/discord/emoji.js')
const records = require('./records.js')

const MIN_RACERS = 5
const MEDALS = ['gold', 'silver', 'bronze']
const fmt = s => {
    const cs = Math.round(s * 100), m = Math.floor(cs / 6000), rest = (cs % 6000) / 100
    return m ? `${m}:${rest.toFixed(2).padStart(5, '0')}` : rest.toFixed(2)
}
const gap = (a, b) => (Math.round(Math.abs(a - b) * 100) / 100).toFixed(2)
const place = rank => rank <= 10 ? emoji.named(`place_${rank}`) : `**#${rank}**`
const medalOf = (item, time) => item.medals ? MEDALS.find(m => time <= item.medals[m].seconds) ?? null : null
const day = ms => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

// before / after: records.leaderboard() of the board around the save (each racer's best, fastest first).
// history: the racer's saved times on the board after the save, oldest first. platform: of this time.
exports.receipt = ({ item, kind, user, forSelf, time, platform, before, after, history, duplicate, updated }) => {
    const prev = before.find(t => t.user == user)
    const rank = after.findIndex(t => t.user == user) + 1
    const best = after[rank - 1]
    const who = forSelf ? 'your' : `${records.who(user)}'s`
    const lines = [`### ${place(rank)} ${fmt(time)} on ${item.name}${forSelf ? '' : ` for ${records.who(user)}`}`]

    if (duplicate) lines.push(updated?.length ? `Already saved; updated its ${updated.join(' and ')}.` : 'Already saved, with the same details.')
    else if (!prev) lines.push(`**First time on this board!** ${forSelf ? 'Welcome to' : 'Now on'} the leaderboard.`)
    else if (time < prev.time) lines.push(`**New personal best!** ${gap(time, prev.time)} off ${who} ${fmt(prev.time)}.`)
    else lines.push(`Saved. ${forSelf ? 'Your' : `${records.who(user)}'s`} best is still **${fmt(best.time)}**, ${gap(time, best.time)} faster.`)

    const improved = !duplicate && (!prev || time < prev.time)
    if (improved) {
        // World record: #1 on the community board, newly or lowered
        if (rank == 1 && after.length > 1) lines.push(`🏆 **World record!** ${before[0] && before[0].user != user ? `Ahead of ${records.who(before[0].user)}'s ${fmt(before[0].time)}.` : `Lowered by ${gap(time, before[0]?.time ?? time)}.`}`)
        // Bops: racers who were ahead of them (or anyone already on the board, for a first time) and are now behind
        const wasAhead = prev ? before.slice(0, before.indexOf(prev)) : before
        const bopped = wasAhead.filter(t => after.findIndex(a => a.user == t.user) + 1 > rank).map(t => t.user)
        if (bopped.length) lines.push(`👊 **Bop${bopped.length > 1 ? ` ×${bopped.length}` : ''}!** ${bopped.slice(0, 3).map(u => `${records.who(u)}`).join(', ')}${bopped.length > 3 ? ` and ${bopped.length - 3} more` : ''} ${bopped.length == 1 ? 'drops' : 'drop'} a place.`)
        // A medal beaten for the first time
        const medal = medalOf(item, time), had = prev && medalOf(item, prev.time)
        if (medal && medal != had) lines.push(`${emoji.medal[medal]} **${medal[0].toUpperCase() + medal.slice(1)} medal** beaten (${item.medals[medal].time}).`)
    }

    // Where they stand and what's next
    const standing = [`**#${rank}** of ${after.length}`]
    if (rank > 1) standing.push(`${gap(best.time, after[rank - 2].time)} behind ${records.who(after[rank - 2].user)} for #${rank - 1}`)
    else if (after[1]) standing.push(`${gap(after[1].time, best.time)} ahead of ${records.who(after[1].user)}`)
    // The next medal up from the one their best has (bronze -> silver -> gold)
    const nextMedal = item.medals && { none: 'bronze', bronze: 'silver', silver: 'gold' }[medalOf(item, best.time) ?? 'none']
    if (nextMedal) standing.push(`${emoji.medal[nextMedal]} ${gap(best.time, item.medals[nextMedal].seconds)} to ${nextMedal}`)
    lines.push(standing.join(' / '))

    // Their declared rival on this board
    const rival = records.rivalOf(user), theirs = rival && after.find(t => t.user == rival)
    if (theirs) {
        const ahead = best.time < theirs.time
        const passedRival = improved && ahead && prev && prev.time >= theirs.time
        lines.push(`${emoji.named('rival')} ${passedRival ? `**Past ${forSelf ? 'your' : 'their'} rival!** ` : ''}${best.time == theirs.time ? 'Tied with' : `${gap(best.time, theirs.time)} ${ahead ? 'ahead of' : 'behind'}`} ${forSelf ? 'your' : 'their'} rival ${records.who(rival)} (${fmt(theirs.time)})`)
    }

    // Progression: their runs on this board in order, and how far they've come
    if (history.length > 1) {
        const shown = history.slice(-6).map(t => t.time == best.time ? `**${fmt(t.time)}**` : fmt(t.time))
        const first = history[0]
        lines.push(`-# ${forSelf ? 'Your' : 'Their'} runs: ${history.length > 6 ? '… → ' : ''}${shown.join(' → ')}${first.time > best.time ? ` / ${gap(first.time, best.time)} faster since ${day(first.date)}` : ''}`)
    }
    return lines.join('\n')
}

// The announcement for a save, or null: { kind, item, user, time, proof, rank, passed: [users moved down within the
// top 3], dropped: user knocked out of it, lowered: by how much, when the record holder beat their own record }
exports.podium = ({ kind, item, user, time, proof, before, after }) => {
    if (after.length < MIN_RACERS) return null
    const rank = after.findIndex(t => t.user == user) + 1
    const was = before.findIndex(t => t.user == user) + 1
    if (!rank || rank > 3 || after[rank - 1].time != time) return null  // not in the top 3, or not with this time
    const topBefore = before.slice(0, 3).map(t => t.user), topAfter = after.slice(0, 3).map(t => t.user)
    if (was && rank == was) return rank == 1 && before[0].time > time ? { kind, item, user, time, proof, rank, lowered: before[0].time - time, passed: [] } : null
    if (was && rank > was) return null
    return {
        kind, item, user, time, proof, rank,
        passed: before.slice(rank - 1, was ? was - 1 : 3).map(t => t.user).filter(u => u != user && topAfter.includes(u)),
        dropped: topBefore.find(u => !topAfter.includes(u) && u != user) ?? null,
    }
}

// A bounty claimed by a save, announced like a podium change
exports.announceBounty = async (client, b) => {
    const channelId = testing ? test_channel : announce_channel
    const channel = client && channelId && await client.channels.fetch(channelId).catch(() => null)
    if (!channel) return
    // A cumulative board's bounty is won by a total, which has no single proof to link
    const aggregate = b.kind == 'aggregate'
    const time = b.proof && !aggregate ? `[**\`${fmt(b.time)}\`**](<${b.proof}>)` : `**\`${fmt(b.time)}\`**`
    const view = aggregate ? `arcade_category_${b.target == 'main' ? 'overview' : b.target}` : b.kind == 'arcade' ? `arcade_event_${b.target}` : `scenario_${b.target}`
    await channel.send({
        content: `${emoji.named('bounty')} ${records.who(b.user)} claims the ${emoji.named('credits')} **${b.paid.toLocaleString('en-US')}** bounty on **${b.name ?? b.item.name}** with ${aggregate ? 'a total of ' : ''}${time}, under ${fmt(b.under)}`,
        allowedMentions: { parse: [] },
        components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(view).setLabel('View board').setStyle(ButtonStyle.Secondary))],
    })
}

exports.announce = async (client, p) => {
    const channelId = testing ? test_channel : announce_channel
    if (!p || !channelId) return
    const channel = await client.channels.fetch(channelId).catch(() => null)
    if (!channel) return
    const time = p.proof ? `[**\`${fmt(p.time)}\`**](<${p.proof}>)` : `**\`${fmt(p.time)}\`**`
    const board = `**${p.item.name}**${p.kind == 'scenario' ? ' (scenario)' : ''}`
    const text = p.lowered
        ? `${place(1)} ${records.who(p.user)} lowers the ${board} record to ${time}, ${gap(p.lowered, 0)} faster`
        : [`${place(p.rank)} ${records.who(p.user)} takes **#${p.rank}** on ${board} with ${time}`,
            p.passed.length && `passing ${p.passed.map(u => `${records.who(u)}`).join(' and ')}`,
            p.dropped && !p.passed.includes(p.dropped) && `bumping ${records.who(p.dropped)} off the podium`].filter(Boolean).join(', ')
    await channel.send({
        content: text,
        allowedMentions: { parse: [] },
        components: [new ActionRowBuilder().addComponents(new ButtonBuilder()
            .setCustomId(p.kind == 'arcade' ? `arcade_event_${p.item.id}` : `scenario_${p.item.id}`).setLabel('View board').setStyle(ButtonStyle.Secondary))],
    })
}
