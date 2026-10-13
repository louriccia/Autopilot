// Saving a time, shared by the card's Submit time form (interactions/time.js) and /submit: checks the input, who it's for,
// updates the details of an exact repeat instead of saving it twice, and words the reply.
const records = require('./records.js')
const data = require('./swgr/data.js')
const { database } = require('./firebase.js')
const progress = require('./progress.js')
const credits = require('./credits.js')
const emoji = require('./data/discord/emoji.js')

const BOARDS = {
    arcade: { item: data.event },
    scenario: { item: data.scenario },
}
exports.board = (kind, target) => BOARDS[kind]?.item(target) ?? null

// Free text that ends up on a leaderboard line: no markdown, mentions or line breaks
exports.clean = s => String(s ?? '').replace(/[`*_~|<>\\]/g, '').replace(/@(everyone|here)/gi, '$1').replace(/\s+/g, ' ').trim()

exports.formatTime = s => {
    const cs = Math.round(s * 100), m = Math.floor(cs / 6000), rest = (cs % 6000) / 100
    return m ? `${m}:${rest.toFixed(2).padStart(5, '0')}` : rest.toFixed(2)
}

// Returns { error } or { message, receipt, duplicate, updated }: message is a one-line summary (logs, imports), receipt
// the submitter's private reply (src/progress.js). A save that changes a big enough board's top 3 is announced
// (src/progress.js) unless announce is false (imports, backfills).
// trusted: the racer was worked out by the bot (src/replays.js), so no permission is needed to credit them.
// date: when the run happened, if known; youtube: the proof video's channel id. keepPlatform: leave an empty platform
// empty instead of filling in the racer's usual one (imports).
// proofType: 'video' | 'screenshot' | 'claim' when the caller knows better than the proof link (a typed claim's proof is
// its message link; a screenshot post's too). pay: false skips credits (backfills that pay separately).
exports.submit = async ({ kind, target, member, memberId, racer, time: rawTime, platform, proof, notes, trusted, date, youtube, keepPlatform, announce = true, proofType, pay = true }) => {
    if (!database) return { error: "Times can't be saved right now (no database)." }
    const item = exports.board(kind, target)
    if (!item) return { error: "That isn't an arcade event or scenario." }
    const time = records.parseTime(rawTime)
    if (time == null) return { error: `"${exports.clean(rawTime)}" isn't a time. Use minutes:seconds like 1:08.92, or just the digits like 10892.` }
    proof = String(proof ?? '').trim()
    if (proof && !/^https?:\/\/\S+$/i.test(proof)) return { error: 'The proof needs to be a link (starting with https://).' }
    let user = memberId
    if (racer && racer.id != memberId) {
        if (!trusted && !records.canSubmitForOthers(member)) return { error: "You can't submit times for other people." }
        if (racer.bot) return { error: "Bots don't race." }
        user = racer.id
    }
    // Staff (anyone with a staff time linked to their Discord id) keep their arcade runs as staff times, shown with the
    // developer's or publisher's logo instead of on the community board; a slower run doesn't replace a faster one
    const staffer = kind == 'arcade' && records.staffOf(user)
    if (staffer) {
        const current = records.staffTimes(target).find(s => s.user == user || s.name == staffer.name)
        const faster = !current || time < current.seconds
        if (faster) await records.setStaffTime(target, staffer.name, time, staffer.from, user)
        const message = faster
            ? `Saved ${exports.formatTime(time)} on ${item.name} as ${staffer.name}'s ${staffer.from} staff time${current ? ` (was ${exports.formatTime(current.seconds)})` : ''}.`
            : `${staffer.name}'s ${staffer.from} staff time on ${item.name} is already ${exports.formatTime(current.seconds)}, faster than ${exports.formatTime(time)}.`
        return { message, receipt: message, duplicate: !faster, updated: [], staff: true }
    }

    // Left empty: the racer's last platform, else their console role (fetched when it's someone else). Only a picked
    // platform replaces the one on a resubmitted time.
    const picked = records.PLATFORMS.includes(platform)
    const racerMember = user == memberId ? member : await member?.guild?.members.fetch(user).catch(() => null)
    platform = picked ? platform : keepPlatform ? '' : records.defaultPlatform(user, racerMember)

    const existing = records.allTimes().find(t => t.kind == kind && t.target == target && t.user == user && t.time == time)
    if (existing?.platform && !picked) platform = ''
    const before = records.leaderboard(kind, target)
    const { id: timeId, duplicate, updated } = await records.addTime({ kind, target, user, submittedBy: memberId, time, platform, proof, notes: exports.clean(notes).slice(0, 120), date, youtube })
    const board = records.leaderboard(kind, target)
    const rank = board.findIndex(t => t.user == user) + 1
    const best = board[rank - 1]
    const whose = user == memberId ? 'Your' : `<@${user}>'s`
    const history = records.allTimes().filter(t => t.kind == kind && t.target == target && t.user == user).sort((a, b) => a.date - b.date)
    let receipt = progress.receipt({ item, kind, user, forSelf: user == memberId, time, platform, before, after: board, history, duplicate, updated })
    if (!duplicate && announce && member?.client) {
        await progress.announce(member.client, progress.podium({ kind, item, user, time, proof, before, after: board })).catch(error => console.error('[podium]', error))
    }

    // Credits (src/credits.js): what the run earns, the podium of a board it fills, and any bounty it wins (also when a
    // repeat brings the proof a bounty needs)
    let earned = null, won = []
    if (pay) {
        try {
            if (!duplicate) {
                earned = await credits.payRun({ timeId, kind, item, user, time, before, after: board, proof, proofHint: proofType, member: racerMember })
                await credits.payFill({ kind, target, item, before, after: board, user, guild: member?.guild })
            }
            if (!duplicate || updated?.includes('proof')) {
                won = await credits.claimBounties({ kind, target, user, time, proof, proofHint: proofType, member: racerMember, timeId })
                for (const b of won) await progress.announceBounty(member?.client, { kind, item, user, time, proof, ...b }).catch(error => console.error('[bounty]', error))
            }
        } catch (error) { console.error('[credits]', error) }
    }
    const creditLine = [
        earned && `${emoji.named('credits')} **+${earned.total.toLocaleString('en-US')}** credits: ${earned.lines.map(l => `${l.label} ${l.amount > 0 ? '+' : ''}${l.amount}`).join(', ')} (${earned.note})`,
        ...won.map(b => `${emoji.named('credits')} **+${b.paid.toLocaleString('en-US')}** bounty won (under ${exports.formatTime(b.under)})${b.paid > b.pot ? ', the Pirate adds a quarter' : ''}`),
    ].filter(Boolean)
    if (creditLine.length) receipt += `\n${creditLine.join('\n')}`
    const creditNote = [earned && `+${earned.total} credits`, ...won.map(b => `+${b.paid} bounty`)].filter(Boolean).join(', ')

    // first: this very time is #1 on the board (reactions show the crown for it)
    const first = rank == 1 && best.time == time
    if (duplicate && updated.length) return { message: `${whose} ${exports.formatTime(time)} on ${item.name} was already saved (#${rank}); updated its ${updated.length > 1 ? `${updated.slice(0, -1).join(', ')} and ${updated.at(-1)}` : updated[0]}.${creditNote ? ` ${creditNote}.` : ''}`, receipt, duplicate, updated, first }
    if (duplicate) return { message: `${whose} ${exports.formatTime(time)} on ${item.name} is already saved (#${rank}), with the same details.`, receipt, duplicate, updated, first }
    return {
        receipt, first, earned,
        message: (best.time < time
            ? `Saved ${exports.formatTime(time)} on ${item.name}. ${whose} best is still ${exports.formatTime(best.time)} (#${rank}).`
            : `Saved! ${whose} ${exports.formatTime(time)} is #${rank} on ${item.name}.`) + (creditNote ? ` ${creditNote}.` : ''),
    }
}
