// Saving a time, shared by the card's Submit time form (interactions/time.js) and /submit: checks the input, who it's for,
// updates the details of an exact repeat instead of saving it twice, and words the reply.
const records = require('./records.js')
const data = require('./swgr/data.js')
const { database } = require('./firebase.js')

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

// Returns { error } or { message } (what to tell the submitter)
// trusted: the racer was worked out by the bot (src/replays.js), so no permission is needed to credit them.
// date: when the run happened, if known; youtube: the proof video's channel id. keepPlatform: leave an empty platform
// empty instead of filling in the racer's usual one (imports).
exports.submit = async ({ kind, target, member, memberId, racer, time: rawTime, platform, proof, notes, trusted, date, youtube, keepPlatform }) => {
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
    // Left empty: the racer's last platform, else their console role (fetched when it's someone else). Only a picked
    // platform replaces the one on a resubmitted time.
    const picked = records.PLATFORMS.includes(platform)
    const racerMember = user == memberId ? member : await member?.guild?.members.fetch(user).catch(() => null)
    platform = picked ? platform : keepPlatform ? '' : records.defaultPlatform(user, racerMember)

    const existing = records.allTimes().find(t => t.kind == kind && t.target == target && t.user == user && t.time == time)
    if (existing?.platform && !picked) platform = ''
    const { duplicate, updated } = await records.addTime({ kind, target, user, submittedBy: memberId, time, platform, proof, notes: exports.clean(notes).slice(0, 120), date, youtube })
    const board = records.leaderboard(kind, target)
    const rank = board.findIndex(t => t.user == user) + 1
    const best = board[rank - 1]
    const whose = user == memberId ? 'Your' : `<@${user}>'s`
    if (duplicate && updated.length) return { message: `${whose} ${exports.formatTime(time)} on ${item.name} was already saved (#${rank}); updated its ${updated.length > 1 ? `${updated.slice(0, -1).join(', ')} and ${updated.at(-1)}` : updated[0]}.`, duplicate, updated }
    if (duplicate) return { message: `${whose} ${exports.formatTime(time)} on ${item.name} is already saved (#${rank}), with the same details.`, duplicate, updated }
    return {
        message: best.time < time
            ? `Saved ${exports.formatTime(time)} on ${item.name}. ${whose} best is still ${exports.formatTime(best.time)} (#${rank}).`
            : `Saved! ${whose} ${exports.formatTime(time)} is #${rank} on ${item.name}.`,
    }
}
